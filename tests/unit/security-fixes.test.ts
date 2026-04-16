import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/config/database', () => {
  const mockPrisma = {
    notification: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    organisationUser: {
      findMany: vi.fn(),
    },
    auditEntry: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: 'a1' }),
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
    },
    vessel: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    workOrder: {
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
    },
  };
  return { default: mockPrisma, prisma: mockPrisma };
});

import prisma from '../../src/config/database';

describe('Security fix: notification.service.markRead IDOR protection', () => {
  beforeEach(() => vi.clearAllMocks());

  it('rejects marking a notification that belongs to another user', async () => {
    const { notificationService } = await import('../../src/services/notification.service');

    vi.mocked(prisma.notification.findFirst).mockResolvedValue(null);

    await expect(
      notificationService.markRead('notif-1', 'wrong-user')
    ).rejects.toThrow('Notification not found');

    expect(prisma.notification.findFirst).toHaveBeenCalledWith({
      where: { id: 'notif-1', userId: 'wrong-user' },
    });
    expect(prisma.notification.update).not.toHaveBeenCalled();
  });

  it('allows marking own notification as read', async () => {
    const { notificationService } = await import('../../src/services/notification.service');

    vi.mocked(prisma.notification.findFirst).mockResolvedValue({
      id: 'notif-1', userId: 'user-1', isRead: false,
    } as any);
    vi.mocked(prisma.notification.update).mockResolvedValue({
      id: 'notif-1', isRead: true,
    } as any);

    const result = await notificationService.markRead('notif-1', 'user-1');
    expect(result.isRead).toBe(true);
    expect(prisma.notification.update).toHaveBeenCalled();
  });
});

describe('Security fix: vessel.service.update org scoping', () => {
  beforeEach(() => vi.clearAllMocks());

  it('rejects updating a vessel from another org', async () => {
    const { vesselService } = await import('../../src/services/vessel.service');

    vi.mocked(prisma.vessel.findFirst).mockResolvedValue({
      id: 'v1', organisationId: 'org-other', isDeleted: false, source: null,
    } as any);

    await expect(
      vesselService.update('v1', { name: 'Hacked' }, 'user-1', 'org-mine')
    ).rejects.toThrow('Vessel not found');

    expect(prisma.vessel.update).not.toHaveBeenCalled();
  });

  it('allows updating own org vessel with allowlisted fields only', async () => {
    const { vesselService } = await import('../../src/services/vessel.service');

    vi.mocked(prisma.vessel.findFirst).mockResolvedValue({
      id: 'v1', organisationId: 'org-mine', isDeleted: false, source: null, name: 'Old',
    } as any);
    vi.mocked(prisma.vessel.update).mockResolvedValue({
      id: 'v1', name: 'New Name',
    } as any);

    await vesselService.update('v1', {
      name: 'New Name',
      organisationId: 'org-attacker',
      isDeleted: true,
    }, 'user-1', 'org-mine');

    const updateCall = vi.mocked(prisma.vessel.update).mock.calls[0];
    expect(updateCall[0].data).toHaveProperty('name', 'New Name');
    expect(updateCall[0].data).not.toHaveProperty('organisationId');
    expect(updateCall[0].data).not.toHaveProperty('isDeleted');
  });
});

describe('Security fix: audit.service.list org scoping', () => {
  beforeEach(() => vi.clearAllMocks());

  it('filters audit entries to org members only', async () => {
    const { auditService } = await import('../../src/services/audit.service');

    vi.mocked(prisma.organisationUser.findMany).mockResolvedValue([
      { userId: 'user-a' } as any,
      { userId: 'user-b' } as any,
    ]);
    vi.mocked(prisma.auditEntry.findMany).mockResolvedValue([]);
    vi.mocked(prisma.auditEntry.count).mockResolvedValue(0);

    await auditService.list({ page: 1, limit: 20, skip: 0, sort: 'createdAt', order: 'desc' }, 'org-1');

    expect(prisma.organisationUser.findMany).toHaveBeenCalledWith({
      where: { organisationId: 'org-1' },
      select: { userId: true },
    });

    const findCall = vi.mocked(prisma.auditEntry.findMany).mock.calls[0][0] as any;
    expect(findCall.where.actorId).toEqual({ in: ['user-a', 'user-b'] });
  });
});

describe('Security fix: work order search preserves access control', () => {
  beforeEach(() => vi.clearAllMocks());

  it('combines access filters with search using AND', async () => {
    const { workOrderService } = await import('../../src/services/work-order.service');

    vi.mocked(prisma.workOrder.findMany).mockResolvedValue([]);
    vi.mocked(prisma.workOrder.count).mockResolvedValue(0);

    await workOrderService.list(
      { page: 1, limit: 20, skip: 0, sort: 'createdAt', order: 'desc', search: 'test query' },
      'org-1',
      'user-1',
    );

    const findCall = vi.mocked(prisma.workOrder.findMany).mock.calls[0][0] as any;
    expect(findCall.where.isDeleted).toBe(false);
    expect(findCall.where.AND).toBeDefined();
    expect(findCall.where.AND).toHaveLength(2);
    expect(findCall.where.OR).toBeUndefined();
  });

  it('uses OR for access when no search', async () => {
    const { workOrderService } = await import('../../src/services/work-order.service');

    vi.mocked(prisma.workOrder.findMany).mockResolvedValue([]);
    vi.mocked(prisma.workOrder.count).mockResolvedValue(0);

    await workOrderService.list(
      { page: 1, limit: 20, skip: 0, sort: 'createdAt', order: 'desc' },
      'org-1',
      'user-1',
    );

    const findCall = vi.mocked(prisma.workOrder.findMany).mock.calls[0][0] as any;
    expect(findCall.where.OR).toBeDefined();
    expect(findCall.where.AND).toBeUndefined();
  });
});
