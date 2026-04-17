import prisma from '../config/database';
import { AppError } from '../middleware/error';
import { PaginationParams, buildPaginatedResponse } from '../utils/pagination';
import { auditService } from './audit.service';
import { Prisma } from '@prisma/client';

/**
 * Shared where-clause that restricts inspection lookups to ones whose parent
 * work order the caller can access (via org ownership OR explicit assignment).
 */
function inspectionAccessFilter(userId: string, organisationId: string): Prisma.InspectionWhereInput {
  return {
    workOrder: {
      isDeleted: false,
      OR: [
        { organisationId },
        { assignments: { some: { userId } } },
      ],
    },
  };
}

const UPDATE_FIELD_ALLOWLIST = new Set([
  'type', 'inspectorName', 'inspectorOrg', 'inspectorCert',
  'waterTemp', 'waterVisibility', 'isoVisibility', 'waterSalinity',
  'weatherConditions', 'seaState', 'tideState',
  'location', 'latitude', 'longitude',
  'overallRating', 'summary', 'recommendations',
  'status',
]);

const FINDING_FIELD_ALLOWLIST = new Set([
  'area', 'nicheAreaId', 'isoZone',
  'foulingRating', 'foulingType', 'coverage', 'condition',
  'measurementType', 'measurementValue', 'measurementUnit',
  'referenceStandard', 'coatingCondition', 'corrosionType', 'corrosionSeverity',
  'description', 'recommendation', 'actionRequired', 'priority',
  'metadata',
]);

function pickAllowlisted(data: Record<string, unknown>, allowlist: Set<string>) {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (allowlist.has(key)) out[key] = value;
  }
  return out;
}

/**
 * Load an inspection by id and enforce that the caller has access via the
 * parent work order.  Returns the inspection (with include fields tailored
 * for the caller) or throws 404.
 */
async function loadInspectionForUser(
  id: string,
  userId: string,
  organisationId: string,
  include: Prisma.InspectionInclude = {},
) {
  const inspection = await prisma.inspection.findFirst({
    where: {
      id,
      ...inspectionAccessFilter(userId, organisationId),
    },
    include,
  });
  if (!inspection) throw new AppError(404, 'NOT_FOUND', 'Inspection not found');
  return inspection;
}

export const inspectionService = {
  async list(params: PaginationParams, organisationId: string, userId: string, filters?: Record<string, string>) {
    const where: Prisma.InspectionWhereInput = inspectionAccessFilter(userId, organisationId);
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

  async getById(id: string, userId: string, organisationId: string) {
    return loadInspectionForUser(id, userId, organisationId, {
      vessel: { select: { id: true, name: true } },
      workOrder: { select: { id: true, referenceNumber: true, title: true } },
      findings: { include: { nicheArea: true, media: true } },
      media: true,
    });
  },

  /**
   * Create an inspection.  Enforces that both the referenced work order and
   * vessel belong to a context the caller can access — i.e. the WO is in
   * their org or they're assigned to it, and (when provided) the vessel is
   * the one the WO points at.
   */
  async create(data: any, userId: string, organisationId: string) {
    if (!data?.workOrderId) {
      throw new AppError(400, 'VALIDATION_ERROR', 'workOrderId is required');
    }
    const workOrder = await prisma.workOrder.findFirst({
      where: {
        id: data.workOrderId,
        isDeleted: false,
        OR: [
          { organisationId },
          { assignments: { some: { userId } } },
        ],
      },
      select: { id: true, vesselId: true, organisationId: true },
    });
    if (!workOrder) throw new AppError(404, 'NOT_FOUND', 'Work order not found');
    if (data.vesselId && data.vesselId !== workOrder.vesselId) {
      throw new AppError(400, 'VALIDATION_ERROR', 'vesselId does not match the work order');
    }
    const payload = {
      ...data,
      vesselId: data.vesselId ?? workOrder.vesselId,
    };

    const inspection = await prisma.inspection.create({ data: payload });

    await auditService.log({
      actorId: userId,
      entityType: 'Inspection',
      entityId: inspection.id,
      action: 'CREATE',
      description: `Created ${data.type} inspection for vessel ${payload.vesselId}`,
      newData: inspection as any,
    });

    return inspection;
  },

  async update(id: string, data: any, userId: string, organisationId: string) {
    const existing = await loadInspectionForUser(id, userId, organisationId);

    const sanitized = pickAllowlisted(data, UPDATE_FIELD_ALLOWLIST);
    const inspection = await prisma.inspection.update({ where: { id }, data: sanitized });

    await auditService.log({
      actorId: userId,
      entityType: 'Inspection',
      entityId: id,
      action: 'UPDATE',
      description: `Updated inspection`,
      previousData: existing as any,
      newData: inspection as any,
      changedFields: Object.keys(sanitized),
    });

    return inspection;
  },

  async addFinding(inspectionId: string, data: any, userId: string, organisationId: string) {
    await loadInspectionForUser(inspectionId, userId, organisationId);

    const sanitized = pickAllowlisted(data, FINDING_FIELD_ALLOWLIST);
    if (!sanitized.area) {
      throw new AppError(400, 'VALIDATION_ERROR', 'area is required');
    }
    const finding = await prisma.inspectionFinding.create({
      data: { ...sanitized, inspectionId } as any,
    });

    await auditService.log({
      actorId: userId,
      entityType: 'InspectionFinding',
      entityId: finding.id,
      action: 'CREATE',
      description: `Added finding for area "${sanitized.area}" with rating ${sanitized.foulingRating ?? 'N/A'}`,
    });

    return finding;
  },

  async updateFinding(findingId: string, data: any, userId: string, organisationId: string) {
    const existing = await prisma.inspectionFinding.findFirst({
      where: {
        id: findingId,
        inspection: inspectionAccessFilter(userId, organisationId),
      },
    });
    if (!existing) throw new AppError(404, 'NOT_FOUND', 'Finding not found');

    const sanitized = pickAllowlisted(data, FINDING_FIELD_ALLOWLIST);
    const finding = await prisma.inspectionFinding.update({ where: { id: findingId }, data: sanitized });

    await auditService.log({
      actorId: userId,
      entityType: 'InspectionFinding',
      entityId: findingId,
      action: 'UPDATE',
      description: `Updated finding for area "${finding.area}"`,
    });

    return finding;
  },

  async complete(id: string, userId: string, organisationId: string) {
    await loadInspectionForUser(id, userId, organisationId);

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

  async approve(id: string, userId: string, organisationId: string) {
    await loadInspectionForUser(id, userId, organisationId);

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
