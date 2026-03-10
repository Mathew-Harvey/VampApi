import prisma from '../config/database';
import { AppError } from '../middleware/error';
import { auditService } from './audit.service';
import { env } from '../config/env';

const ENTRY_UPDATE_FIELDS = [
  'condition', 'foulingRating', 'foulingType', 'coverage',
  'measurementType', 'measurementValue', 'measurementUnit',
  'coatingCondition', 'corrosionType', 'corrosionSeverity',
  'notes', 'recommendation', 'actionRequired', 'attachments', 'status',
] as const;

export const workFormService = {
  /**
   * Generate form entries from vessel components when starting a work order.
   * Creates entries for top-level components AND their sub-components.
   */
  async generateForm(workOrderId: string, userId: string) {
    const workOrder = await prisma.workOrder.findFirst({
      where: { id: workOrderId, isDeleted: false },
      include: {
        vessel: {
          include: {
            components: {
              orderBy: { sortOrder: 'asc' },
            },
          },
        },
      },
    });
    if (!workOrder) throw new AppError(404, 'NOT_FOUND', 'Work order not found');

    const allComponents = workOrder.vessel.components;
    if (allComponents.length === 0) {
      throw new AppError(400, 'NO_COMPONENTS', 'Vessel has no components defined in its general arrangement');
    }

    const existing = await prisma.workFormEntry.findMany({ where: { workOrderId } });
    if (existing.length > 0) return existing;

    const entries = await Promise.all(
      allComponents.map((comp) =>
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

  /**
   * Get all form entries for a work order with component details.
   * Returns a nested structure: top-level entries include a `subEntries` array.
   */
  async getFormEntries(workOrderId: string) {
    const entries = await prisma.workFormEntry.findMany({
      where: { workOrderId },
      include: {
        vesselComponent: {
          include: { children: { orderBy: { sortOrder: 'asc' } } },
        },
      },
      orderBy: { vesselComponent: { sortOrder: 'asc' } },
    });

    // Build a map of componentId -> entry for nesting
    const entryByComponentId = new Map(entries.map((e) => [e.vesselComponentId, e]));

    // Separate top-level entries from sub-component entries
    const topLevelEntries = entries.filter((e) => !e.vesselComponent.parentId);

    return topLevelEntries.map((entry) => {
      const subComponentIds = entry.vesselComponent.children.map((sc: any) => sc.id);
      const subEntries = subComponentIds
        .map((scId: string) => entryByComponentId.get(scId))
        .filter(Boolean);

      return {
        ...entry,
        subEntries,
      };
    });
  },

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

  /**
   * Get the complete form data as JSON for report generation.
   * Includes nested sub-component entries under each parent entry.
   */
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

    // Split into top-level and sub-component entries
    const topLevel = entries.filter((e) => !e.vesselComponent.parentId);
    const subByParent = new Map<string, typeof entries>();
    for (const e of entries) {
      if (e.vesselComponent.parentId) {
        const arr = subByParent.get(e.vesselComponent.parentId) || [];
        arr.push(e);
        subByParent.set(e.vesselComponent.parentId, arr);
      }
    }

    function mapEntry(e: typeof entries[0]) {
      return {
        id: e.id,
        component: e.vesselComponent.name,
        category: e.vesselComponent.category,
        location: e.vesselComponent.location,
        gaZoneId: e.vesselComponent.gaZoneId ?? null,
        material: e.vesselComponent.material,
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
      };
    }

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
      entries: topLevel.map((e) => ({
        ...mapEntry(e),
        subEntries: (subByParent.get(e.vesselComponentId) || []).map(mapEntry),
      })),
      generatedAt: new Date().toISOString(),
    };
  },

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

  async getFoulingStateByVessel(vesselId: string) {
    const components = await prisma.vesselComponent.findMany({
      where: { vesselId },
      orderBy: { sortOrder: 'asc' },
    });
    if (components.length === 0) return [];

    const results = await Promise.all(
      components.map(async (comp) => {
        const latestEntry = await prisma.workFormEntry.findFirst({
          where: {
            vesselComponentId: comp.id,
            foulingRating: { not: null },
            workOrder: { isDeleted: false },
          },
          orderBy: { updatedAt: 'desc' },
          include: {
            workOrder: {
              select: {
                id: true,
                referenceNumber: true,
                title: true,
                type: true,
                completedAt: true,
                status: true,
              },
            },
          },
        });

        return {
          componentId: comp.id,
          componentName: comp.name,
          category: comp.category,
          location: comp.location,
          gaZoneId: comp.gaZoneId ?? null,
          condition: latestEntry?.condition ?? comp.condition,
          foulingRating: latestEntry?.foulingRating ?? null,
          foulingType: latestEntry?.foulingType ?? null,
          coverage: latestEntry?.coverage ?? null,
          coatingCondition: latestEntry?.coatingCondition ?? null,
          lastAssessedAt: latestEntry?.updatedAt ?? null,
          lastWorkOrder: latestEntry
            ? {
                id: latestEntry.workOrder.id,
                referenceNumber: latestEntry.workOrder.referenceNumber,
                title: latestEntry.workOrder.title,
                type: latestEntry.workOrder.type,
                completedAt: latestEntry.workOrder.completedAt,
              }
            : null,
        };
      })
    );

    return results;
  },

  async getComponentWorkHistory(vesselId: string, componentId: string) {
    const component = await prisma.vesselComponent.findFirst({
      where: { id: componentId, vesselId },
    });
    if (!component) throw new AppError(404, 'NOT_FOUND', 'Component not found');

    const entries = await prisma.workFormEntry.findMany({
      where: {
        vesselComponentId: componentId,
        workOrder: { isDeleted: false },
      },
      orderBy: { updatedAt: 'desc' },
      include: {
        workOrder: {
          select: {
            id: true,
            referenceNumber: true,
            title: true,
            type: true,
            status: true,
            location: true,
            scheduledStart: true,
            scheduledEnd: true,
            actualStart: true,
            actualEnd: true,
            completedAt: true,
            createdAt: true,
          },
        },
      },
    });

    return {
      component: {
        id: component.id,
        name: component.name,
        category: component.category,
        location: component.location,
        gaZoneId: component.gaZoneId ?? null,
        coatingType: component.coatingType,
        material: component.material,
        condition: component.condition,
      },
      entries: entries.map((e) => ({
        id: e.id,
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
        completedAt: e.completedAt,
        updatedAt: e.updatedAt,
        workOrder: e.workOrder,
      })),
    };
  },

  async addAttachment(entryId: string, mediaId: string) {
    const entry = await prisma.workFormEntry.findUnique({ where: { id: entryId } });
    if (!entry) throw new AppError(404, 'NOT_FOUND', 'Form entry not found');

    const media = await prisma.media.findUnique({
      where: { id: mediaId },
      select: { id: true, url: true },
    });
    if (!media) throw new AppError(404, 'NOT_FOUND', 'Media not found');

    const attachments = JSON.parse(entry.attachments || '[]');
    const mediaUrl = toPublicMediaUrl(media.url);
    attachments.push(mediaUrl);

    return prisma.workFormEntry.update({
      where: { id: entryId },
      data: { attachments: JSON.stringify(attachments) },
    });
  },
};

function toPublicMediaUrl(url: string): string {
  if (/^https?:\/\//i.test(url)) return url;
  const apiBase = env.API_URL.replace(/\/+$/, '');
  const normalizedPath = url.startsWith('/') ? url : `/${url}`;
  return `${apiBase}${normalizedPath}`;
}
