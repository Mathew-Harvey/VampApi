import prisma from '../config/database';

export const dashboardService = {
  async getOverview(organisationId: string) {
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
      prisma.vessel.count({ where: { organisationId, isDeleted: false } }),
      prisma.vessel.count({ where: { organisationId, isDeleted: false, complianceStatus: 'COMPLIANT' } }),
      prisma.vessel.count({ where: { organisationId, isDeleted: false, complianceStatus: 'NON_COMPLIANT' } }),
      prisma.vessel.count({ where: { organisationId, isDeleted: false, complianceStatus: 'DUE_FOR_INSPECTION' } }),
      prisma.vessel.count({ where: { organisationId, isDeleted: false, complianceStatus: 'UNDER_REVIEW' } }),
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
