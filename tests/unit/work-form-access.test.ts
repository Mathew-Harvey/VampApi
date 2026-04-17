import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';

vi.mock('../../src/config/database', () => {
  const mockPrisma = {
    $connect: vi.fn().mockResolvedValue(undefined),
    $disconnect: vi.fn().mockResolvedValue(undefined),
    $queryRaw: vi.fn().mockResolvedValue([{ 1: 1 }]),
    $transaction: vi.fn(async (fn: any) => {
      if (typeof fn === 'function') return fn(mockPrisma);
      return fn;
    }),
    vessel: {
      findFirst: vi.fn(),
    },
    vesselComponent: {
      findUnique: vi.fn(),
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn(),
      update: vi.fn(),
      aggregate: vi.fn().mockResolvedValue({ _max: { sortOrder: 0 } }),
    },
    vesselShare: {
      findUnique: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
    },
    workOrder: {
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn(),
      count: vi.fn().mockResolvedValue(0),
    },
    workOrderAssignment: {
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn().mockResolvedValue(null),
      findUnique: vi.fn().mockResolvedValue(null),
    },
    workFormEntry: {
      findMany: vi.fn().mockResolvedValue([]),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      upsert: vi.fn(),
      findFirst: vi.fn(),
    },
    auditEntry: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: 'a1' }),
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
    },
  };
  return { default: mockPrisma, prisma: mockPrisma };
});

vi.mock('../../src/services/storage-config.service', () => ({
  storageConfigService: {
    get: vi.fn().mockReturnValue({ backend: 'local', localMediaPath: '/tmp/test', s3: {} }),
    getLocalMediaPath: vi.fn().mockReturnValue('/tmp/test'),
    isS3Usable: vi.fn().mockReturnValue(false),
    shouldUseS3: vi.fn().mockReturnValue(false),
    getStatus: vi.fn().mockReturnValue({
      overallStatus: 'ready', summary: '', effectiveBackend: 'local',
      s3Configured: false, localPathExists: true, localMediaPath: '/tmp/test', fields: [],
    }),
  },
}));

import { generateAccessToken } from '../../src/config/auth';
import app from '../../src/app';
import prisma from '../../src/config/database';

const tokenOrg1 = generateAccessToken({
  userId: 'u1', email: 'u1@test.com', organisationId: 'org-1',
  role: 'ORGANISATION_ADMIN',
  permissions: ['VESSEL_VIEW', 'VESSEL_EDIT', 'WORK_ORDER_VIEW'],
});

describe('Work-form / component route IDOR protection', () => {
  beforeEach(() => vi.clearAllMocks());

  it('rejects GET sub-components of a foreign-org component with 404', async () => {
    vi.mocked(prisma.vesselComponent.findUnique).mockResolvedValue({
      vessel: { id: 'v-other', organisationId: 'org-other', isDeleted: false },
    } as any);
    vi.mocked(prisma.vesselShare.findUnique).mockResolvedValue(null);

    const res = await request(app)
      .get('/api/v1/components/foreign-comp/sub-components')
      .set('Authorization', `Bearer ${tokenOrg1}`);

    expect(res.status).toBe(404);
    expect(prisma.vesselComponent.findMany).not.toHaveBeenCalled();
  });

  it('allows GET sub-components when the caller owns the parent vessel', async () => {
    vi.mocked(prisma.vesselComponent.findUnique).mockResolvedValue({
      vessel: { id: 'v1', organisationId: 'org-1', isDeleted: false },
    } as any);
    vi.mocked(prisma.vesselComponent.findMany).mockResolvedValue([]);

    const res = await request(app)
      .get('/api/v1/components/my-comp/sub-components')
      .set('Authorization', `Bearer ${tokenOrg1}`);

    expect(res.status).toBe(200);
    expect(prisma.vesselComponent.findMany).toHaveBeenCalled();
  });

  it('rejects PUT /components/:id/zone on a foreign-org component', async () => {
    vi.mocked(prisma.vesselComponent.findUnique).mockResolvedValue({
      vessel: { id: 'v-other', organisationId: 'org-other', isDeleted: false },
    } as any);
    vi.mocked(prisma.vesselShare.findUnique).mockResolvedValue(null);

    const res = await request(app)
      .put('/api/v1/components/foreign-comp/zone')
      .set('Authorization', `Bearer ${tokenOrg1}`)
      .send({ gaZoneId: 'HULL_FWD' });

    expect(res.status).toBe(404);
    expect(prisma.vesselComponent.update).not.toHaveBeenCalled();
  });

  it('rejects GET fouling-state on a foreign-org vessel with 404', async () => {
    vi.mocked(prisma.vessel.findFirst).mockResolvedValue({ organisationId: 'org-other' } as any);
    vi.mocked(prisma.vesselShare.findUnique).mockResolvedValue(null);

    const res = await request(app)
      .get('/api/v1/vessels/v-other/components/fouling-state')
      .set('Authorization', `Bearer ${tokenOrg1}`);

    expect(res.status).toBe(404);
  });

  it('rejects PUT zone-mappings whose components are on a different vessel', async () => {
    vi.mocked(prisma.vessel.findFirst).mockResolvedValue({ organisationId: 'org-1' } as any);
    // Returning fewer components than requested signals "not all belong to this vessel"
    vi.mocked(prisma.vesselComponent.findMany).mockResolvedValue([{ id: 'c-mine' }] as any);

    const res = await request(app)
      .put('/api/v1/vessels/v-mine/components/zone-mappings')
      .set('Authorization', `Bearer ${tokenOrg1}`)
      .send({ mappings: [
        { componentId: 'c-mine', gaZoneId: 'HULL_FWD' },
        { componentId: 'c-foreign', gaZoneId: 'HULL_MID' },
      ] });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});
