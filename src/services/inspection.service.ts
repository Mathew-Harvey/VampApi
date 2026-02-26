import prisma from '../config/database';
import { AppError } from '../middleware/error';
import { PaginationParams, buildPaginatedResponse } from '../utils/pagination';
import { auditService } from './audit.service';
import { Prisma } from '@prisma/client';

export const inspectionService = {
  async list(params: PaginationParams, filters?: Record<string, string>) {
    const where: Prisma.InspectionWhereInput = {};
    if (filters?.vesselId) where.vesselId = filters.vesselId;
    if (filters?.workOrderId) where.workOrderId = filters.workOrderId;
    if (filters?.status) where.status = filters.status as any;
    if (filters?.type) where.type = filters.type as any;

    const [data, total] = await Promise.all([
      prisma.inspection.findMany({
        where,
        skip: params.skip,
        take: params.limit,
        orderBy: { [params.sort]: params.order },
        include: {
          vessel: { select: { id: true, name: true } },
          workOrder: { select: { id: true, referenceNumber: true, title: true } },
        },
      }),
      prisma.inspection.count({ where }),
    ]);

    return buildPaginatedResponse(data, total, params);
  },

  async getById(id: string) {
    const inspection = await prisma.inspection.findUnique({
      where: { id },
      include: {
        vessel: { select: { id: true, name: true } },
        workOrder: { select: { id: true, referenceNumber: true, title: true } },
        findings: { include: { nicheArea: true, media: true } },
        media: true,
      },
    });
    if (!inspection) throw new AppError(404, 'NOT_FOUND', 'Inspection not found');
    return inspection;
  },

  async create(data: any, userId: string) {
    const inspection = await prisma.inspection.create({ data });

    await auditService.log({
      actorId: userId,
      entityType: 'Inspection',
      entityId: inspection.id,
      action: 'CREATE',
      description: `Created ${data.type} inspection for vessel ${data.vesselId}`,
      newData: inspection as any,
    });

    return inspection;
  },

  async update(id: string, data: any, userId: string) {
    const existing = await prisma.inspection.findUnique({ where: { id } });
    if (!existing) throw new AppError(404, 'NOT_FOUND', 'Inspection not found');

    const inspection = await prisma.inspection.update({ where: { id }, data });

    await auditService.log({
      actorId: userId,
      entityType: 'Inspection',
      entityId: id,
      action: 'UPDATE',
      description: `Updated inspection`,
      previousData: existing as any,
      newData: inspection as any,
      changedFields: Object.keys(data),
    });

    return inspection;
  },

  async addFinding(inspectionId: string, data: any, userId: string) {
    const inspection = await prisma.inspection.findUnique({ where: { id: inspectionId } });
    if (!inspection) throw new AppError(404, 'NOT_FOUND', 'Inspection not found');

    const finding = await prisma.inspectionFinding.create({
      data: { ...data, inspectionId },
    });

    await auditService.log({
      actorId: userId,
      entityType: 'InspectionFinding',
      entityId: finding.id,
      action: 'CREATE',
      description: `Added finding for area "${data.area}" with rating ${data.foulingRating ?? 'N/A'}`,
    });

    return finding;
  },

  async updateFinding(findingId: string, data: any, userId: string) {
    const existing = await prisma.inspectionFinding.findUnique({ where: { id: findingId } });
    if (!existing) throw new AppError(404, 'NOT_FOUND', 'Finding not found');

    const finding = await prisma.inspectionFinding.update({ where: { id: findingId }, data });

    await auditService.log({
      actorId: userId,
      entityType: 'InspectionFinding',
      entityId: findingId,
      action: 'UPDATE',
      description: `Updated finding for area "${finding.area}"`,
    });

    return finding;
  },

  async complete(id: string, userId: string) {
    const inspection = await prisma.inspection.findUnique({ where: { id } });
    if (!inspection) throw new AppError(404, 'NOT_FOUND', 'Inspection not found');

    const updated = await prisma.inspection.update({
      where: { id },
      data: { status: 'COMPLETED', completedAt: new Date() },
    });

    await auditService.log({
      actorId: userId,
      entityType: 'Inspection',
      entityId: id,
      action: 'STATUS_CHANGE',
      description: 'Marked inspection as completed',
    });

    return updated;
  },

  async approve(id: string, userId: string) {
    const inspection = await prisma.inspection.findUnique({ where: { id } });
    if (!inspection) throw new AppError(404, 'NOT_FOUND', 'Inspection not found');

    const updated = await prisma.inspection.update({
      where: { id },
      data: { status: 'APPROVED' },
    });

    await auditService.log({
      actorId: userId,
      entityType: 'Inspection',
      entityId: id,
      action: 'APPROVAL',
      description: 'Approved inspection',
    });

    return updated;
  },
};
