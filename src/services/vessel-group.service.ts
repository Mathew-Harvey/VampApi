import prisma from '../config/database';
import { AppError } from '../middleware/error';
import { auditService } from './audit.service';

export const vesselGroupService = {
  async list(organisationId: string) {
    const groups = await prisma.vesselGroup.findMany({
      where: { organisationId, isDeleted: false },
      orderBy: { sortOrder: 'asc' },
      include: {
        memberships: {
          include: {
            vessel: {
              select: {
                id: true,
                name: true,
                vesselType: true,
                imoNumber: true,
                status: true,
                complianceStatus: true,
                flagState: true,
                iconImage: true,
                isDeleted: true,
              },
            },
          },
          orderBy: { sortOrder: 'asc' },
        },
      },
    });

    return groups.map((g) => ({
      ...g,
      vessels: g.memberships
        .filter((m) => !m.vessel.isDeleted)
        .map((m) => m.vessel),
      vesselCount: g.memberships.filter((m) => !m.vessel.isDeleted).length,
      memberships: undefined,
    }));
  },

  async getById(id: string, organisationId: string) {
    const group = await prisma.vesselGroup.findFirst({
      where: { id, organisationId, isDeleted: false },
      include: {
        memberships: {
          include: {
            vessel: {
              select: {
                id: true,
                name: true,
                vesselType: true,
                imoNumber: true,
                status: true,
                complianceStatus: true,
                flagState: true,
                iconImage: true,
                isDeleted: true,
              },
            },
          },
          orderBy: { sortOrder: 'asc' },
        },
      },
    });

    if (!group) throw new AppError(404, 'NOT_FOUND', 'Vessel group not found');

    return {
      ...group,
      vessels: group.memberships
        .filter((m) => !m.vessel.isDeleted)
        .map((m) => m.vessel),
      vesselCount: group.memberships.filter((m) => !m.vessel.isDeleted).length,
      memberships: undefined,
    };
  },

  async create(data: { name: string; description?: string | null; color?: string | null }, organisationId: string, userId: string) {
    const existing = await prisma.vesselGroup.findFirst({
      where: { organisationId, name: data.name, isDeleted: false },
    });
    if (existing) throw new AppError(409, 'CONFLICT', 'A group with this name already exists');

    const maxSort = await prisma.vesselGroup.aggregate({
      where: { organisationId, isDeleted: false },
      _max: { sortOrder: true },
    });

    const group = await prisma.vesselGroup.create({
      data: {
        name: data.name,
        description: data.description ?? null,
        color: data.color ?? null,
        sortOrder: (maxSort._max.sortOrder ?? -1) + 1,
        organisationId,
      },
    });

    await auditService.log({
      actorId: userId,
      entityType: 'VesselGroup',
      entityId: group.id,
      action: 'CREATE',
      description: `Created vessel group "${group.name}"`,
      newData: group as any,
    });

    return group;
  },

  async update(id: string, data: { name?: string; description?: string | null; color?: string | null }, organisationId: string, userId: string) {
    const existing = await prisma.vesselGroup.findFirst({
      where: { id, organisationId, isDeleted: false },
    });
    if (!existing) throw new AppError(404, 'NOT_FOUND', 'Vessel group not found');

    if (data.name && data.name !== existing.name) {
      const dupe = await prisma.vesselGroup.findFirst({
        where: { organisationId, name: data.name, isDeleted: false, id: { not: id } },
      });
      if (dupe) throw new AppError(409, 'CONFLICT', 'A group with this name already exists');
    }

    const updated = await prisma.vesselGroup.update({
      where: { id },
      data: {
        ...(data.name !== undefined && { name: data.name }),
        ...(data.description !== undefined && { description: data.description }),
        ...(data.color !== undefined && { color: data.color }),
      },
    });

    await auditService.log({
      actorId: userId,
      entityType: 'VesselGroup',
      entityId: id,
      action: 'UPDATE',
      description: `Updated vessel group "${updated.name}"`,
      previousData: existing as any,
      newData: updated as any,
      changedFields: Object.keys(data),
    });

    return updated;
  },

  async softDelete(id: string, organisationId: string, userId: string) {
    const existing = await prisma.vesselGroup.findFirst({
      where: { id, organisationId, isDeleted: false },
    });
    if (!existing) throw new AppError(404, 'NOT_FOUND', 'Vessel group not found');

    await prisma.vesselGroup.update({ where: { id }, data: { isDeleted: true } });

    await auditService.log({
      actorId: userId,
      entityType: 'VesselGroup',
      entityId: id,
      action: 'DELETE',
      description: `Deleted vessel group "${existing.name}"`,
    });
  },

  async addVessels(groupId: string, vesselIds: string[], organisationId: string, userId: string) {
    const group = await prisma.vesselGroup.findFirst({
      where: { id: groupId, organisationId, isDeleted: false },
    });
    if (!group) throw new AppError(404, 'NOT_FOUND', 'Vessel group not found');

    const vessels = await prisma.vessel.findMany({
      where: { id: { in: vesselIds }, organisationId, isDeleted: false },
      select: { id: true },
    });
    const validIds = new Set(vessels.map((v) => v.id));
    const invalidIds = vesselIds.filter((id) => !validIds.has(id));
    if (invalidIds.length > 0) {
      throw new AppError(400, 'BAD_REQUEST', `Vessels not found or not accessible: ${invalidIds.join(', ')}`);
    }

    const existingMemberships = await prisma.vesselGroupMembership.findMany({
      where: { vesselGroupId: groupId, vesselId: { in: vesselIds } },
      select: { vesselId: true },
    });
    const existingIds = new Set(existingMemberships.map((m) => m.vesselId));
    const newIds = vesselIds.filter((id) => !existingIds.has(id));

    if (newIds.length === 0) {
      return { added: 0, alreadyInGroup: vesselIds.length };
    }

    const maxSort = await prisma.vesselGroupMembership.aggregate({
      where: { vesselGroupId: groupId },
      _max: { sortOrder: true },
    });
    let nextSort = (maxSort._max.sortOrder ?? -1) + 1;

    await prisma.vesselGroupMembership.createMany({
      data: newIds.map((vesselId) => ({
        vesselGroupId: groupId,
        vesselId,
        sortOrder: nextSort++,
      })),
    });

    await auditService.log({
      actorId: userId,
      entityType: 'VesselGroup',
      entityId: groupId,
      action: 'UPDATE',
      description: `Added ${newIds.length} vessel(s) to group "${group.name}"`,
    });

    return { added: newIds.length, alreadyInGroup: existingIds.size };
  },

  async removeVessels(groupId: string, vesselIds: string[], organisationId: string, userId: string) {
    const group = await prisma.vesselGroup.findFirst({
      where: { id: groupId, organisationId, isDeleted: false },
    });
    if (!group) throw new AppError(404, 'NOT_FOUND', 'Vessel group not found');

    const result = await prisma.vesselGroupMembership.deleteMany({
      where: { vesselGroupId: groupId, vesselId: { in: vesselIds } },
    });

    await auditService.log({
      actorId: userId,
      entityType: 'VesselGroup',
      entityId: groupId,
      action: 'UPDATE',
      description: `Removed ${result.count} vessel(s) from group "${group.name}"`,
    });

    return { removed: result.count };
  },

  async reorder(groupIds: string[], organisationId: string, userId: string) {
    const groups = await prisma.vesselGroup.findMany({
      where: { id: { in: groupIds }, organisationId, isDeleted: false },
      select: { id: true },
    });
    const validIds = new Set(groups.map((g) => g.id));

    await Promise.all(
      groupIds
        .filter((id) => validIds.has(id))
        .map((id, index) =>
          prisma.vesselGroup.update({ where: { id }, data: { sortOrder: index } }),
        ),
    );

    await auditService.log({
      actorId: userId,
      entityType: 'VesselGroup',
      entityId: 'batch',
      action: 'UPDATE',
      description: `Reordered ${groupIds.length} vessel group(s)`,
    });
  },
};
