import prisma from '../config/database';
import { AppError } from '../middleware/error';
import { PaginationParams, buildPaginatedResponse } from '../utils/pagination';
import { generateWorkOrderReference } from '../utils/helpers';
import { auditService } from './audit.service';
import { Prisma } from '@prisma/client';

const VALID_TRANSITIONS: Record<string, string[]> = {
  DRAFT: ['PENDING_APPROVAL', 'CANCELLED'],
  PENDING_APPROVAL: ['APPROVED', 'CANCELLED'],
  APPROVED: ['IN_PROGRESS', 'CANCELLED'],
  IN_PROGRESS: ['AWAITING_REVIEW', 'ON_HOLD', 'CANCELLED'],
  AWAITING_REVIEW: ['UNDER_REVIEW'],
  UNDER_REVIEW: ['COMPLETED', 'IN_PROGRESS'],
  ON_HOLD: ['IN_PROGRESS', 'CANCELLED'],
  COMPLETED: [],
  CANCELLED: [],
};

const UPDATE_FIELD_ALLOWLIST = new Set([
  'vesselId',
  'workflowId',
  'title',
  'description',
  'type',
  'priority',
  'location',
  'latitude',
  'longitude',
  'scheduledStart',
  'scheduledEnd',
  'regulatoryRef',
  'complianceFramework',
  'metadata',
]);
const COLLABORATOR_WRITE_ROLES = new Set(['TEAM_MEMBER', 'REVIEWER', 'LEAD']);
const COLLABORATOR_ADMIN_ROLES = new Set(['LEAD']);
const assignmentUserInclude = {
  user: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      organisations: {
        where: { isDefault: true },
        select: {
          organisationId: true,
          organisation: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      },
    },
  },
};

function sanitizeUpdatePayload(data: Record<string, unknown>) {
  const payload: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(data)) {
    if (!UPDATE_FIELD_ALLOWLIST.has(key)) continue;
    if (key === 'scheduledStart' || key === 'scheduledEnd') {
      payload[key] = value ? new Date(value as string) : null;
      continue;
    }
    if (key === 'complianceFramework' || key === 'metadata') {
      payload[key] = value == null ? null : JSON.stringify(value);
      continue;
    }
    payload[key] = value;
  }

  return payload;
}

export const workOrderService = {
  async list(
    params: PaginationParams,
    organisationId: string,
    userId: string,
    filters?: Record<string, string>,
    includeOrganisationScope = true,
  ) {
    const accessFilters: Prisma.WorkOrderWhereInput[] = [
      { assignments: { some: { userId } } },
    ];
    if (includeOrganisationScope) {
      accessFilters.push({ organisationId });
    }

    const where: Prisma.WorkOrderWhereInput = {
      isDeleted: false,
      OR: accessFilters,
    };

    if (params.search) {
      where.OR = [
        { title: { contains: params.search } },
        { referenceNumber: { contains: params.search } },
      ];
    }
    if (filters?.status) where.status = filters.status as any;
    if (filters?.type) where.type = filters.type as any;
    if (filters?.vesselId) where.vesselId = filters.vesselId;
    if (filters?.priority) where.priority = filters.priority as any;

    const [data, total] = await Promise.all([
      prisma.workOrder.findMany({
        where,
        skip: params.skip,
        take: params.limit,
        orderBy: { [params.sort]: params.order },
        include: {
          vessel: { select: { id: true, name: true } },
          assignments: { include: assignmentUserInclude },
        },
      }),
      prisma.workOrder.count({ where }),
    ]);

    return buildPaginatedResponse(data, total, params);
  },

  async getById(id: string, organisationId: string, userId: string, includeOrganisationScope = true) {
    const accessFilters: Prisma.WorkOrderWhereInput[] = [
      { assignments: { some: { userId } } },
    ];
    if (includeOrganisationScope) {
      accessFilters.push({ organisationId });
    }

    const wo = await prisma.workOrder.findFirst({
      where: {
        id,
        isDeleted: false,
        OR: accessFilters,
      },
      include: {
        vessel: { select: { id: true, name: true, vesselType: true } },
        organisation: { select: { id: true, name: true } },
        assignments: { include: assignmentUserInclude },
        inspections: { orderBy: { createdAt: 'desc' } },
        taskSubmissions: { include: { task: true, user: { select: { id: true, firstName: true, lastName: true } } } },
        comments: { include: { author: { select: { id: true, firstName: true, lastName: true } } }, orderBy: { createdAt: 'asc' } },
        workflow: { include: { steps: { include: { tasks: true }, orderBy: { order: 'asc' } } } },
      },
    });
    if (!wo) throw new AppError(404, 'NOT_FOUND', 'Work order not found');
    return wo;
  },

  async existsInOrganisation(id: string, organisationId: string) {
    const wo = await prisma.workOrder.findFirst({
      where: { id, organisationId, isDeleted: false },
      select: { id: true },
    });
    return Boolean(wo);
  },

  async getAssignmentRole(id: string, userId: string) {
    const assignment = await prisma.workOrderAssignment.findUnique({
      where: {
        workOrderId_userId: { workOrderId: id, userId },
      },
      select: { role: true },
    });
    return assignment?.role || null;
  },

  async canViewWorkOrder(id: string, userId: string, organisationId: string, includeOrganisationScope = true) {
    const accessFilters: Prisma.WorkOrderWhereInput[] = [
      { assignments: { some: { userId } } },
    ];
    if (includeOrganisationScope) {
      accessFilters.push({ organisationId });
    }

    const workOrder = await prisma.workOrder.findFirst({
      where: { id, isDeleted: false, OR: accessFilters },
      select: { id: true },
    });
    return Boolean(workOrder);
  },

  async canWriteAsCollaborator(id: string, userId: string) {
    const role = await this.getAssignmentRole(id, userId);
    return role ? COLLABORATOR_WRITE_ROLES.has(role) : false;
  },

  async canAdminAsCollaborator(id: string, userId: string) {
    const role = await this.getAssignmentRole(id, userId);
    return role ? COLLABORATOR_ADMIN_ROLES.has(role) : false;
  },

  async create(data: any, organisationId: string, userId: string) {
    const referenceNumber = await generateWorkOrderReference();
    const payload: any = {
      organisationId,
      referenceNumber,
      vesselId: data.vesselId,
      title: data.title,
      type: data.type,
      priority: data.priority || 'NORMAL',
      status: 'DRAFT',
      description: data.description || null,
      location: data.location || null,
      latitude: data.latitude || null,
      longitude: data.longitude || null,
      regulatoryRef: data.regulatoryRef || null,
      workflowId: data.workflowId || null,
      complianceFramework: JSON.stringify(data.complianceFramework || []),
      metadata: data.metadata ? JSON.stringify(data.metadata) : null,
    };
    if (data.scheduledStart) payload.scheduledStart = new Date(data.scheduledStart);
    if (data.scheduledEnd) payload.scheduledEnd = new Date(data.scheduledEnd);
    const wo = await prisma.workOrder.create({ data: payload });

    await auditService.log({
      actorId: userId,
      entityType: 'WorkOrder',
      entityId: wo.id,
      action: 'CREATE',
      description: `Created work order ${wo.referenceNumber}: "${wo.title}"`,
      newData: wo as any,
    });

    return wo;
  },

  async update(id: string, organisationId: string, data: any, userId: string) {
    const existing = await prisma.workOrder.findFirst({ where: { id, organisationId, isDeleted: false } });
    if (!existing) throw new AppError(404, 'NOT_FOUND', 'Work order not found');
    const updateData = sanitizeUpdatePayload(data);

    const wo = await prisma.workOrder.update({ where: { id }, data: updateData });

    await auditService.log({
      actorId: userId,
      entityType: 'WorkOrder',
      entityId: wo.id,
      action: 'UPDATE',
      description: `Updated work order ${wo.referenceNumber}`,
      previousData: existing as any,
      newData: wo as any,
      changedFields: Object.keys(updateData),
    });

    return wo;
  },

  async changeStatus(id: string, organisationId: string, newStatus: string, userId: string, reason?: string) {
    const wo = await prisma.workOrder.findFirst({ where: { id, organisationId, isDeleted: false } });
    if (!wo) throw new AppError(404, 'NOT_FOUND', 'Work order not found');

    const allowedTransitions = VALID_TRANSITIONS[wo.status] || [];
    if (!allowedTransitions.includes(newStatus)) {
      throw new AppError(400, 'INVALID_TRANSITION', `Cannot transition from ${wo.status} to ${newStatus}`);
    }

    const updateData: any = { status: newStatus };
    if (newStatus === 'IN_PROGRESS' && !wo.actualStart) updateData.actualStart = new Date();
    if (newStatus === 'COMPLETED') { updateData.completedAt = new Date(); updateData.actualEnd = new Date(); }

    const updated = await prisma.workOrder.update({ where: { id }, data: updateData });

    await auditService.log({
      actorId: userId,
      entityType: 'WorkOrder',
      entityId: id,
      action: 'STATUS_CHANGE',
      description: `Changed status of ${wo.referenceNumber} from ${wo.status} to ${newStatus}${reason ? `: ${reason}` : ''}`,
      previousData: { status: wo.status } as any,
      newData: { status: newStatus } as any,
    });

    return updated;
  },

  async assign(workOrderId: string, organisationId: string, userId: string, role: string, actorId: string) {
    const wo = await prisma.workOrder.findFirst({ where: { id: workOrderId, organisationId, isDeleted: false } });
    if (!wo) throw new AppError(404, 'NOT_FOUND', 'Work order not found');

    const assignment = await prisma.workOrderAssignment.upsert({
      where: { workOrderId_userId: { workOrderId, userId } },
      update: { role: role as any },
      create: { workOrderId, userId, role: role as any },
    });

    await auditService.log({
      actorId: actorId,
      entityType: 'WorkOrder',
      entityId: workOrderId,
      action: 'ASSIGNMENT',
      description: `Assigned user ${userId} as ${role} to ${wo.referenceNumber}`,
    });

    return assignment;
  },

  async unassign(workOrderId: string, organisationId: string, userId: string, actorId: string) {
    const wo = await prisma.workOrder.findFirst({ where: { id: workOrderId, organisationId, isDeleted: false } });
    if (!wo) throw new AppError(404, 'NOT_FOUND', 'Work order not found');

    await prisma.workOrderAssignment.delete({
      where: { workOrderId_userId: { workOrderId, userId } },
    });

    await auditService.log({
      actorId: actorId,
      entityType: 'WorkOrder',
      entityId: workOrderId,
      action: 'ASSIGNMENT',
      description: `Unassigned user ${userId} from work order`,
    });
  },

  async softDelete(id: string, organisationId: string, userId: string) {
    const existing = await prisma.workOrder.findFirst({ where: { id, organisationId, isDeleted: false } });
    if (!existing) throw new AppError(404, 'NOT_FOUND', 'Work order not found');

    await prisma.workOrder.update({ where: { id }, data: { isDeleted: true } });

    await auditService.log({
      actorId: userId,
      entityType: 'WorkOrder',
      entityId: id,
      action: 'DELETE',
      description: `Soft-deleted work order ${existing.referenceNumber}`,
    });
  },
};
