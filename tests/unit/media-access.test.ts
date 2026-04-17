import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/config/database', () => {
  const mockPrisma = {
    $transaction: vi.fn(async (fn: any) => {
      if (typeof fn === 'function') return fn(mockPrisma);
      return fn;
    }),
    media: {
      findUnique: vi.fn(),
      delete: vi.fn(),
    },
    vessel: {
      findFirst: vi.fn(),
    },
    vesselShare: {
      findUnique: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
    },
    workOrder: {
      findFirst: vi.fn(),
    },
    auditEntry: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: 'a1' }),
    },
  };
  return { default: mockPrisma, prisma: mockPrisma };
});

vi.mock('../../src/services/storage.service', () => ({
  storageService: {
    deleteStoredMedia: vi.fn().mockResolvedValue(undefined),
    isRemoteSyncEnabled: vi.fn().mockReturnValue(false),
  },
}));

import prisma from '../../src/config/database';

describe('mediaService.getForUser access control', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns the media when the caller is the uploader', async () => {
    const { mediaService } = await import('../../src/services/media.service');
    vi.mocked(prisma.media.findUnique).mockResolvedValue({
      id: 'm1', uploaderId: 'u1', workOrderId: null, vesselId: null,
    } as any);

    const out = await mediaService.getForUser('m1', 'u1', 'org-1', false);
    expect(out).not.toBeNull();
    expect((out as any).id).toBe('m1');
  });

  it('returns null when media belongs to a work order outside the caller org (no uploader / no share)', async () => {
    const { mediaService } = await import('../../src/services/media.service');
    vi.mocked(prisma.media.findUnique).mockResolvedValue({
      id: 'm1', uploaderId: 'other-user', workOrderId: 'wo-other', vesselId: null,
    } as any);
    // canViewWorkOrder check → no hit
    vi.mocked(prisma.workOrder.findFirst).mockResolvedValue(null);

    const out = await mediaService.getForUser('m1', 'u1', 'org-mine', true);
    expect(out).toBeNull();
  });

  it('returns the media via work-order view permission', async () => {
    const { mediaService } = await import('../../src/services/media.service');
    vi.mocked(prisma.media.findUnique).mockResolvedValue({
      id: 'm1', uploaderId: 'other-user', workOrderId: 'wo1', vesselId: null,
    } as any);
    vi.mocked(prisma.workOrder.findFirst).mockResolvedValue({ id: 'wo1' } as any);

    const out = await mediaService.getForUser('m1', 'u1', 'org-1', true);
    expect(out).not.toBeNull();
  });

  it('returns the media via vessel share when the vessel is outside the org', async () => {
    const { mediaService } = await import('../../src/services/media.service');
    vi.mocked(prisma.media.findUnique).mockResolvedValue({
      id: 'm1', uploaderId: 'other-user', workOrderId: null, vesselId: 'v-shared',
    } as any);
    vi.mocked(prisma.vessel.findFirst).mockResolvedValue({ organisationId: 'org-other' } as any);
    vi.mocked(prisma.vesselShare.findUnique).mockResolvedValue({ permission: 'READ' } as any);

    const out = await mediaService.getForUser('m1', 'u1', 'org-mine', true);
    expect(out).not.toBeNull();
  });

  it('returns null when media record doesn\'t exist', async () => {
    const { mediaService } = await import('../../src/services/media.service');
    vi.mocked(prisma.media.findUnique).mockResolvedValue(null);
    const out = await mediaService.getForUser('missing', 'u1', 'org-1', true);
    expect(out).toBeNull();
  });
});

describe('mediaService.delete access control', () => {
  beforeEach(() => vi.clearAllMocks());

  it('lets the uploader delete their own media regardless of org', async () => {
    const { mediaService } = await import('../../src/services/media.service');
    vi.mocked(prisma.media.findUnique).mockResolvedValue({
      id: 'm1', uploaderId: 'u1', workOrderId: 'wo-other',
      storageKey: 'k', url: '/uploads/m1.jpg', originalName: 'x.jpg',
    } as any);
    vi.mocked(prisma.media.delete).mockResolvedValue({} as any);

    await mediaService.delete('m1', 'u1', 'org-mine', false);
    expect(prisma.media.delete).toHaveBeenCalledWith({ where: { id: 'm1' } });
  });

  it('rejects deletion by a non-uploader without org-admin rights', async () => {
    const { mediaService } = await import('../../src/services/media.service');
    vi.mocked(prisma.media.findUnique).mockResolvedValue({
      id: 'm1', uploaderId: 'other-user', workOrderId: 'wo1',
      storageKey: 'k', url: '/uploads/m1.jpg', originalName: 'x.jpg',
    } as any);

    await expect(mediaService.delete('m1', 'u1', 'org-mine', false))
      .rejects.toThrow(/permission/i);
    expect(prisma.media.delete).not.toHaveBeenCalled();
  });

  it('allows an org admin (canAdminAsOrg=true) to delete media for their own work order', async () => {
    const { mediaService } = await import('../../src/services/media.service');
    vi.mocked(prisma.media.findUnique).mockResolvedValue({
      id: 'm1', uploaderId: 'other-user', workOrderId: 'wo-mine',
      storageKey: 'k', url: '/uploads/m1.jpg', originalName: 'x.jpg',
    } as any);
    vi.mocked(prisma.workOrder.findFirst).mockResolvedValue({ id: 'wo-mine' } as any);
    vi.mocked(prisma.media.delete).mockResolvedValue({} as any);

    await mediaService.delete('m1', 'u1', 'org-mine', true);
    expect(prisma.media.delete).toHaveBeenCalled();
  });

  it('rejects an org admin deleting media for a foreign-org work order', async () => {
    const { mediaService } = await import('../../src/services/media.service');
    vi.mocked(prisma.media.findUnique).mockResolvedValue({
      id: 'm1', uploaderId: 'other-user', workOrderId: 'wo-foreign',
      storageKey: 'k', url: '/uploads/m1.jpg', originalName: 'x.jpg',
    } as any);
    vi.mocked(prisma.workOrder.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.vessel.findFirst).mockResolvedValue(null);

    await expect(mediaService.delete('m1', 'u1', 'org-mine', true))
      .rejects.toThrow(/permission/i);
    expect(prisma.media.delete).not.toHaveBeenCalled();
  });
});
