import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/config/database', () => {
  const mockPrisma = {
    $transaction: vi.fn(async (fn: any) => {
      if (typeof fn === 'function') return fn(mockPrisma);
      return fn;
    }),
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
      findMany: vi.fn().mockResolvedValue([]),
      update: vi.fn(),
    },
    vesselShare: {
      findUnique: vi.fn().mockResolvedValue(null),
    },
    workOrder: {
      findFirst: vi.fn(),
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

  it('throws an AppError with 404 status (not a bare Error)', async () => {
    const { notificationService } = await import('../../src/services/notification.service');
    const { AppError } = await import('../../src/middleware/error');

    vi.mocked(prisma.notification.findFirst).mockResolvedValue(null);

    try {
      await notificationService.markRead('missing', 'u1');
      throw new Error('should have thrown');
    } catch (err: any) {
      expect(err).toBeInstanceOf(AppError);
      expect(err.statusCode).toBe(404);
      expect(err.code).toBe('NOT_FOUND');
    }
  });
});

describe('Security fix: vessel.service.update org scoping', () => {
  beforeEach(() => vi.clearAllMocks());

  it('rejects updating a vessel from another org', async () => {
    const { vesselService } = await import('../../src/services/vessel.service');

    vi.mocked(prisma.vessel.findFirst).mockResolvedValue({
      id: 'v1', organisationId: 'org-other', isDeleted: false, source: null,
    } as any);
    vi.mocked(prisma.vesselShare.findUnique).mockResolvedValue(null);

    await expect(
      vesselService.update('v1', { name: 'Hacked' }, 'user-1', 'org-mine')
    ).rejects.toThrow('Vessel not found');

    expect(prisma.vessel.update).not.toHaveBeenCalled();
  });

  it('rejects update when organisationId is falsy (no org-bypass)', async () => {
    const { vesselService } = await import('../../src/services/vessel.service');

    await expect(
      vesselService.update('v1', { name: 'Hacked' }, 'user-1', '' as any)
    ).rejects.toThrow(/organisationId/i);

    expect(prisma.vessel.findFirst).not.toHaveBeenCalled();
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

  it('JSON-serialises climateZones arrays on update', async () => {
    const { vesselService } = await import('../../src/services/vessel.service');

    vi.mocked(prisma.vessel.findFirst).mockResolvedValue({
      id: 'v1', organisationId: 'org-mine', isDeleted: false, source: null, name: 'Old',
    } as any);
    vi.mocked(prisma.vessel.update).mockResolvedValue({ id: 'v1' } as any);

    await vesselService.update('v1', {
      climateZones: ['TROPICAL', 'TEMPERATE'],
      metadata: { hullMaterial: 'steel' },
    }, 'user-1', 'org-mine');

    const updateCall = vi.mocked(prisma.vessel.update).mock.calls[0];
    expect(updateCall[0].data.climateZones).toBe(JSON.stringify(['TROPICAL', 'TEMPERATE']));
    expect(updateCall[0].data.metadata).toBe(JSON.stringify({ hullMaterial: 'steel' }));
  });

  it('does NOT double-stringify a climateZones value that is already a JSON array string', async () => {
    const { vesselService } = await import('../../src/services/vessel.service');

    vi.mocked(prisma.vessel.findFirst).mockResolvedValue({
      id: 'v1', organisationId: 'org-mine', isDeleted: false, source: null,
    } as any);
    vi.mocked(prisma.vessel.update).mockResolvedValue({ id: 'v1' } as any);

    const preStringified = JSON.stringify(['POLAR']);
    await vesselService.update('v1', { climateZones: preStringified }, 'user-1', 'org-mine');

    const updateCall = vi.mocked(prisma.vessel.update).mock.calls[0];
    expect(updateCall[0].data.climateZones).toBe(preStringified);
  });

  it('coerces date strings to Date and rejects invalid dates', async () => {
    const { vesselService } = await import('../../src/services/vessel.service');

    vi.mocked(prisma.vessel.findFirst).mockResolvedValue({
      id: 'v1', organisationId: 'org-mine', isDeleted: false, source: null,
    } as any);
    vi.mocked(prisma.vessel.update).mockResolvedValue({ id: 'v1' } as any);

    await vesselService.update('v1', { lastDrydockDate: '2026-01-15' }, 'user-1', 'org-mine');
    const updateCall = vi.mocked(prisma.vessel.update).mock.calls[0];
    expect(updateCall[0].data.lastDrydockDate).toBeInstanceOf(Date);

    vi.mocked(prisma.vessel.update).mockClear();
    await expect(
      vesselService.update('v1', { lastDrydockDate: 'not-a-date' }, 'user-1', 'org-mine'),
    ).rejects.toThrow(/lastDrydockDate/);
    expect(prisma.vessel.update).not.toHaveBeenCalled();
  });
});

describe('Security fix: audit.service.list org scoping', () => {
  beforeEach(() => vi.clearAllMocks());

  it('includes entries by org members AND entries on org-owned entities', async () => {
    const { auditService } = await import('../../src/services/audit.service');

    vi.mocked(prisma.organisationUser.findMany).mockResolvedValue([
      { userId: 'user-a' } as any,
      { userId: 'user-b' } as any,
    ]);
    vi.mocked(prisma.vessel.findMany).mockResolvedValue([{ id: 'v1' }, { id: 'v2' }] as any);
    vi.mocked(prisma.workOrder.findMany).mockResolvedValue([{ id: 'wo1' }] as any);
    vi.mocked(prisma.auditEntry.findMany).mockResolvedValue([]);
    vi.mocked(prisma.auditEntry.count).mockResolvedValue(0);

    await auditService.list({ page: 1, limit: 20, skip: 0, sort: 'createdAt', order: 'desc' }, 'org-1');

    expect(prisma.organisationUser.findMany).toHaveBeenCalledWith({
      where: { organisationId: 'org-1' },
      select: { userId: true },
    });

    const findCall = vi.mocked(prisma.auditEntry.findMany).mock.calls[0][0] as any;
    expect(findCall.where.OR).toEqual(expect.arrayContaining([
      { actorId: { in: ['user-a', 'user-b'] } },
      { entityType: 'Vessel', entityId: { in: ['v1', 'v2'] } },
      { entityType: 'WorkOrder', entityId: { in: ['wo1'] } },
    ]));
  });

  it('still works when the org owns no vessels or work orders', async () => {
    const { auditService } = await import('../../src/services/audit.service');

    vi.mocked(prisma.organisationUser.findMany).mockResolvedValue([{ userId: 'user-a' } as any]);
    vi.mocked(prisma.vessel.findMany).mockResolvedValue([] as any);
    vi.mocked(prisma.workOrder.findMany).mockResolvedValue([] as any);
    vi.mocked(prisma.auditEntry.findMany).mockResolvedValue([]);
    vi.mocked(prisma.auditEntry.count).mockResolvedValue(0);

    await auditService.list({ page: 1, limit: 20, skip: 0, sort: 'createdAt', order: 'desc' }, 'org-1');

    const findCall = vi.mocked(prisma.auditEntry.findMany).mock.calls[0][0] as any;
    expect(findCall.where.OR).toEqual([{ actorId: { in: ['user-a'] } }]);
  });
});

describe('Security fix: audit.service.log race-condition retry', () => {
  beforeEach(() => vi.clearAllMocks());

  it('retries once on a P2002 (unique violation) before succeeding', async () => {
    const { auditService } = await import('../../src/services/audit.service');

    let attempt = 0;
    (prisma.$transaction as any).mockImplementation(async (fn: any) => {
      attempt++;
      if (attempt === 1) {
        const err: any = new Error('unique');
        err.code = 'P2002';
        throw err;
      }
      return { id: 'audit-ok' } as any;
    });

    const res = await auditService.log({
      actorId: 'u',
      entityType: 'User',
      entityId: 'u',
      action: 'LOGIN',
      description: 'x',
    });

    expect(attempt).toBe(2);
    expect((res as any).id).toBe('audit-ok');
  });

  it('writes inside a SERIALIZABLE transaction', async () => {
    const { auditService } = await import('../../src/services/audit.service');

    (prisma.$transaction as any).mockResolvedValue({ id: 'ok' });
    await auditService.log({
      actorId: 'u',
      entityType: 'User',
      entityId: 'u',
      action: 'LOGIN',
      description: 'x',
    });

    const callArgs = (prisma.$transaction as any).mock.calls[0];
    // Args: [callback, options]
    expect(callArgs[1]).toMatchObject({ isolationLevel: 'Serializable' });
  });
});

describe('Security fix: work order search preserves access control', () => {
  beforeEach(() => vi.clearAllMocks());

  it('combines access filters with search using AND (case-insensitive)', async () => {
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
    // search branch uses case-insensitive contains
    const textFilter = findCall.where.AND[1].OR[0];
    expect(textFilter.title).toEqual({ contains: 'test query', mode: 'insensitive' });
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
