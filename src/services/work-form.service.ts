import prisma from '../config/database';
import { AppError } from '../middleware/error';
import { auditService } from './audit.service';
import path from 'path';
import fs from 'fs/promises';
import { randomUUID } from 'crypto';

const ENTRY_UPDATE_FIELDS = [
  'condition', 'foulingRating', 'foulingType', 'coverage',
  'measurementType', 'measurementValue', 'measurementUnit',
  'coatingCondition', 'corrosionType', 'corrosionSeverity',
  'notes', 'recommendation', 'actionRequired', 'attachments', 'status',
] as const;

export const workFormService = {
  // Generate form entries from vessel components when starting a work order
  async generateForm(workOrderId: string, userId: string) {
    const workOrder = await prisma.workOrder.findFirst({
      where: { id: workOrderId, isDeleted: false },
      include: { vessel: { include: { components: { orderBy: { sortOrder: 'asc' } } } } },
    });
    if (!workOrder) throw new AppError(404, 'NOT_FOUND', 'Work order not found');
    if (workOrder.vessel.components.length === 0) {
      throw new AppError(400, 'NO_COMPONENTS', 'Vessel has no components defined in its general arrangement');
    }

    // Check if form already exists
    const existing = await prisma.workFormEntry.findMany({ where: { workOrderId } });
    if (existing.length > 0) return existing;

    // Create one form entry per vessel component
    const entries = await Promise.all(
      workOrder.vessel.components.map((comp) =>
        prisma.workFormEntry.create({
          data: {
            workOrderId,
            vesselComponentId: comp.id,
            status: 'PENDING',
          },
        })
      )
    );

    await auditService.log({
      actorId: userId,
      entityType: 'WorkOrder',
      entityId: workOrderId,
      action: 'CREATE',
      description: `Generated work form with ${entries.length} entries for ${workOrder.vessel.name}`,
    });

    return entries;
  },

  // Get all form entries for a work order with component details
  async getFormEntries(workOrderId: string) {
    return prisma.workFormEntry.findMany({
      where: { workOrderId },
      include: { vesselComponent: true },
      orderBy: { vesselComponent: { sortOrder: 'asc' } },
    });
  },

  // Update a single form entry
  async updateEntry(entryId: string, data: any, userId: string) {
    const existing = await prisma.workFormEntry.findUnique({ where: { id: entryId } });
    if (!existing) throw new AppError(404, 'NOT_FOUND', 'Form entry not found');

    const updateData: Record<string, unknown> = { updatedAt: new Date() };
    for (const key of ENTRY_UPDATE_FIELDS) {
      if (key in data) {
        updateData[key] = data[key];
      }
    }
    if (data.status === 'COMPLETED' && !existing.completedAt) {
      updateData.completedAt = new Date();
      updateData.completedBy = userId;
    }

    return prisma.workFormEntry.update({
      where: { id: entryId },
      data: updateData,
      include: { vesselComponent: true },
    });
  },

  // Get the complete form data as JSON for report generation
  async getFormDataJson(workOrderId: string) {
    const workOrder = await prisma.workOrder.findFirst({
      where: { id: workOrderId, isDeleted: false },
      include: {
        vessel: true,
        organisation: true,
        assignments: { include: { user: { select: { firstName: true, lastName: true, email: true } } } },
      },
    });
    if (!workOrder) throw new AppError(404, 'NOT_FOUND', 'Work order not found');

    const entries = await prisma.workFormEntry.findMany({
      where: { workOrderId },
      include: { vesselComponent: true },
      orderBy: { vesselComponent: { sortOrder: 'asc' } },
    });

    return {
      workOrder: {
        referenceNumber: workOrder.referenceNumber,
        title: workOrder.title,
        description: workOrder.description,
        metadata: workOrder.metadata,
        type: workOrder.type,
        status: workOrder.status,
        location: workOrder.location,
        scheduledStart: workOrder.scheduledStart,
        scheduledEnd: workOrder.scheduledEnd,
        actualStart: workOrder.actualStart,
        actualEnd: workOrder.actualEnd,
        completedAt: workOrder.completedAt,
      },
      vessel: {
        name: workOrder.vessel.name,
        vesselType: workOrder.vessel.vesselType,
        imoNumber: workOrder.vessel.imoNumber,
        homePort: workOrder.vessel.homePort,
        lengthOverall: workOrder.vessel.lengthOverall,
        beam: workOrder.vessel.beam,
        maxDraft: workOrder.vessel.maxDraft,
        grossTonnage: workOrder.vessel.grossTonnage,
        yearBuilt: workOrder.vessel.yearBuilt,
      },
      organisation: {
        name: workOrder.organisation.name,
      },
      team: workOrder.assignments.map((a) => ({
        name: `${a.user.firstName} ${a.user.lastName}`,
        email: a.user.email,
        role: a.role,
      })),
      entries: entries.map((e) => ({
        id: e.id,
        component: e.vesselComponent.name,
        category: e.vesselComponent.category,
        location: e.vesselComponent.location,
        condition: e.condition,
        foulingRating: e.foulingRating,
        foulingType: e.foulingType,
        coverage: e.coverage,
        coatingCondition: e.coatingCondition,
        corrosionType: e.corrosionType,
        corrosionSeverity: e.corrosionSeverity,
        notes: e.notes,
        recommendation: e.recommendation,
        actionRequired: e.actionRequired,
        status: e.status,
        attachments: e.attachments,
      })),
      generatedAt: new Date().toISOString(),
    };
  },

  // Update a single field on a form entry (for real-time collaboration)
  async updateField(entryId: string, field: string, value: any, userId: string) {
    const existing = await prisma.workFormEntry.findUnique({ where: { id: entryId } });
    if (!existing) throw new AppError(404, 'NOT_FOUND', 'Form entry not found');

    const allowedFields = [
      'condition', 'foulingRating', 'foulingType', 'coverage',
      'coatingCondition', 'corrosionType', 'corrosionSeverity',
      'notes', 'recommendation', 'actionRequired', 'status',
      'measurementType', 'measurementValue', 'measurementUnit',
    ];
    if (!allowedFields.includes(field)) {
      throw new AppError(400, 'INVALID_FIELD', `Field '${field}' cannot be updated`);
    }

    const updateData: any = { [field]: value, updatedAt: new Date() };
    if (field === 'status' && value === 'COMPLETED' && !existing.completedAt) {
      updateData.completedAt = new Date();
      updateData.completedBy = userId;
    }

    return prisma.workFormEntry.update({
      where: { id: entryId },
      data: updateData,
      include: { vesselComponent: true },
    });
  },

  // Persist screenshot as media file and attach media ID to the form entry
  async addScreenshot(entryId: string, dataUrl: string, userId: string, workOrderId?: string) {
    const entry = await prisma.workFormEntry.findUnique({ where: { id: entryId } });
    if (!entry) throw new AppError(404, 'NOT_FOUND', 'Form entry not found');

    const parsedScreenshot = parseScreenshotDataUrl(dataUrl);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `screenshot-${timestamp}-${randomUUID()}${parsedScreenshot.ext}`;
    const uploadsDir = path.join(process.cwd(), 'uploads');
    const storagePath = path.join(uploadsDir, filename);
    await fs.mkdir(uploadsDir, { recursive: true });
    await fs.writeFile(storagePath, parsedScreenshot.buffer);

    const media = await prisma.media.create({
      data: {
        uploaderId: userId,
        workOrderId: workOrderId ?? entry.workOrderId,
        filename,
        originalName: `Screenshot-${timestamp}${parsedScreenshot.ext}`,
        mimeType: parsedScreenshot.mimeType,
        size: parsedScreenshot.buffer.length,
        storageKey: filename,
        url: `/uploads/${filename}`,
        tags: JSON.stringify(['screenshot']),
      },
    });

    const attachments = JSON.parse(entry.attachments || '[]');
    attachments.push(media.id);

    return prisma.workFormEntry.update({
      where: { id: entryId },
      data: { attachments: JSON.stringify(attachments), updatedAt: new Date() },
      include: { vesselComponent: true },
    });
  },

  // Remove a screenshot from a form entry's attachments by index
  async removeScreenshot(entryId: string, index: number) {
    const entry = await prisma.workFormEntry.findUnique({ where: { id: entryId } });
    if (!entry) throw new AppError(404, 'NOT_FOUND', 'Form entry not found');

    const attachments = JSON.parse(entry.attachments || '[]');
    if (index >= 0 && index < attachments.length) {
      attachments.splice(index, 1);
    }

    return prisma.workFormEntry.update({
      where: { id: entryId },
      data: { attachments: JSON.stringify(attachments), updatedAt: new Date() },
      include: { vesselComponent: true },
    });
  },

  // Add attachment (media ID) to a form entry
  async addAttachment(entryId: string, mediaId: string) {
    const entry = await prisma.workFormEntry.findUnique({ where: { id: entryId } });
    if (!entry) throw new AppError(404, 'NOT_FOUND', 'Form entry not found');

    const attachments = JSON.parse(entry.attachments || '[]');
    attachments.push(mediaId);

    return prisma.workFormEntry.update({
      where: { id: entryId },
      data: { attachments: JSON.stringify(attachments) },
    });
  },
};

function parseScreenshotDataUrl(dataUrl: string): { mimeType: string; ext: string; buffer: Buffer } {
  const match = /^data:(image\/(?:png|jpeg|jpg|webp));base64,(.+)$/i.exec(dataUrl || '');
  if (!match) {
    throw new AppError(400, 'INVALID_IMAGE', 'Screenshot must be a valid base64 image data URL');
  }

  const mimeType = match[1].toLowerCase();
  const extMap: Record<string, string> = {
    'image/png': '.png',
    'image/jpeg': '.jpg',
    'image/jpg': '.jpg',
    'image/webp': '.webp',
  };
  const ext = extMap[mimeType] || '.png';
  const buffer = Buffer.from(match[2], 'base64');

  if (!buffer.length) {
    throw new AppError(400, 'INVALID_IMAGE', 'Screenshot payload is empty');
  }

  return { mimeType, ext, buffer };
}
