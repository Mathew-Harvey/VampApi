import prisma from '../config/database';
import { Prisma } from '@prisma/client';
import { vesselShareService } from './vessel-share.service';

const fleetOrgId = () => process.env.FLEET_ORG_ID || '';

/**
 * Build the same access filter the `/vessels` list endpoint uses so the
 * dashboard counts match what the user actually sees in the fleet grid.
 *
 * Previously `dashboardService.getOverview` counted only vessels owned by
 * the user's current organisation — that made the dashboard report a
 * noticeably lower total than the Vessels page, which also includes the
 * FLEET org, explicit vessel shares, and vessels reached via active
 * work-order assignments.
 */
async function buildVesselAccessWhere(
  organisationId: string,
  userId: string,
): Promise<Prisma.VesselWhereInput> {
  const orgIds = [organisationId];
  const fleet = fleetOrgId();
  if (fleet) orgIds.push(fleet);

  const [sharedVesselIds, assignmentVesselIds] = await Promise.all([
    vesselShareService.getSharedVesselIds(userId),
    vesselShareService.getAssignmentVesselIds(userId),
  ]);

  const accessFilters: Prisma.VesselWhereInput[] = [
    { organisationId: { in: orgIds } },
  ];
  if (sharedVesselIds.length > 0) {
    accessFilters.push({ id: { in: sharedVesselIds } });
  }
  if (assignmentVesselIds.length > 0) {
    accessFilters.push({ id: { in: assignmentVesselIds } });
  }

  return {
    isDeleted: false,
    OR: accessFilters,
  };
}

export const dashboardService = {
  async getOverview(organisationId: string, userId: string) {
    const baseVesselWhere = await buildVesselAccessWhere(organisationId, userId);

    const [
      totalVessels,
      compliantVessels,
      nonCompliantVessels,
      dueForInspection,
      underReview,
      activeWorkOrders,
      completedWorkOrders,
      pendingApproval,
    ] = await Promise.all([
      prisma.vessel.count({ where: baseVesselWhere }),
      prisma.vessel.count({ where: { ...baseVesselWhere, complianceStatus: 'COMPLIANT' } }),
      prisma.vessel.count({ where: { ...baseVesselWhere, complianceStatus: 'NON_COMPLIANT' } }),
      prisma.vessel.count({ where: { ...baseVesselWhere, complianceStatus: 'DUE_FOR_INSPECTION' } }),
      prisma.vessel.count({ where: { ...baseVesselWhere, complianceStatus: 'UNDER_REVIEW' } }),
      prisma.workOrder.count({ where: { organisationId, isDeleted: false, status: 'IN_PROGRESS' } }),
      prisma.workOrder.count({ where: { organisationId, isDeleted: false, status: 'COMPLETED' } }),
      prisma.workOrder.count({ where: { organisationId, isDeleted: false, status: 'PENDING_APPROVAL' } }),
    ]);

    return {
      fleet: { total: totalVessels, compliant: compliantVessels, nonCompliant: nonCompliantVessels, dueForInspection, underReview },
      workOrders: { active: activeWorkOrders, completed: completedWorkOrders, pendingApproval },
    };
  },

  async getWorkOrderStats(organisationId: string) {
    const statuses = ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'IN_PROGRESS', 'AWAITING_REVIEW', 'UNDER_REVIEW', 'COMPLETED', 'CANCELLED', 'ON_HOLD'];
    const counts = await Promise.all(
      statuses.map((status) => prisma.workOrder.count({ where: { organisationId, isDeleted: false, status: status as any } }))
    );
    return statuses.reduce((acc, status, i) => ({ ...acc, [status]: counts[i] }), {});
  },

  async getRecentActivity(organisationId: string, limit = 20) {
    const orgUsers = await prisma.organisationUser.findMany({
      where: { organisationId },
      select: { userId: true },
    });
    const userIds = orgUsers.map((ou) => ou.userId);
    return prisma.auditEntry.findMany({
      where: { actorId: { in: userIds } },
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: { actor: { select: { id: true, firstName: true, lastName: true } } },
    });
  },
};
