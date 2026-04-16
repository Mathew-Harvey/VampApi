import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';

vi.mock('../../src/config/database', () => {
  const mockPrisma = {
    $connect: vi.fn().mockResolvedValue(undefined),
    $disconnect: vi.fn().mockResolvedValue(undefined),
    $queryRaw: vi.fn().mockResolvedValue([{ 1: 1 }]),
    vessel: {
      findFirst: vi.fn(),
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
      create: vi.fn(),
      update: vi.fn(),
    },
    vesselShare: {
      findUnique: vi.fn(),
      findMany: vi.fn().mockResolvedValue([]),
    },
    user: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      count: vi.fn().mockResolvedValue(0),
    },
    organisation: {
      create: vi.fn(),
      findUnique: vi.fn(),
    },
    organisationUser: {
      create: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn().mockResolvedValue([]),
    },
    workOrder: {
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn(),
      count: vi.fn().mockResolvedValue(0),
      create: vi.fn(),
      update: vi.fn(),
    },
    auditEntry: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: 'audit-1' }),
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
    },
    notification: {
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
    },
  };
  return { default: mockPrisma, prisma: mockPrisma };
});

vi.mock('../../src/services/storage-config.service', () => ({
  storageConfigService: {
    get: vi.fn().mockReturnValue({ backend: 'local', localMediaPath: '/tmp/test-uploads', s3: {} }),
    getLocalMediaPath: vi.fn().mockReturnValue('/tmp/test-uploads'),
    isS3Usable: vi.fn().mockReturnValue(false),
    shouldUseS3: vi.fn().mockReturnValue(false),
    getStatus: vi.fn().mockReturnValue({
      overallStatus: 'ready', summary: 'Local storage active',
      effectiveBackend: 'local', s3Configured: false, localPathExists: true,
      localMediaPath: '/tmp/test-uploads', fields: [],
    }),
  },
}));

import { generateAccessToken } from '../../src/config/auth';
import app from '../../src/app';
import prisma from '../../src/config/database';

const org1Token = generateAccessToken({
  userId: 'u1',
  email: 'user1@test.com',
  organisationId: 'org1',
  role: 'ORGANISATION_ADMIN',
  permissions: ['VESSEL_VIEW', 'VESSEL_EDIT', 'VESSEL_CREATE'],
});

const org2Token = generateAccessToken({
  userId: 'u2',
  email: 'user2@test.com',
  organisationId: 'org2',
  role: 'OPERATOR',
  permissions: ['VESSEL_VIEW'],
});

const ownedVessel = {
  id: 'v-owned', name: 'My Vessel', organisationId: 'org1', vesselType: 'TUG',
  isDeleted: false, source: null, status: 'ACTIVE',
  organisation: { id: 'org1', name: 'Org One' },
};

const otherVessel = {
  id: 'v-other', name: 'Other Vessel', organisationId: 'org2', vesselType: 'BARGE',
  isDeleted: false, source: null, status: 'ACTIVE',
  organisation: { id: 'org2', name: 'Org Two' },
};

describe('Cross-org Vessel Visibility', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Vessel list includes shared vessels with org info', () => {
    it('marks shared vessels with _shared=true and includes org name', async () => {
      (prisma.vesselShare.findMany as any).mockResolvedValue([{ vesselId: 'v-other' }]);
      (prisma.vessel.findMany as any).mockResolvedValue([ownedVessel, otherVessel]);
      (prisma.vessel.count as any).mockResolvedValue(2);

      const res = await request(app)
        .get('/api/v1/vessels')
        .set('Authorization', `Bearer ${org1Token}`);

      expect(res.status).toBe(200);
      const owned = res.body.data.find((v: any) => v.id === 'v-owned');
      const shared = res.body.data.find((v: any) => v.id === 'v-other');
      expect(owned._shared).toBe(false);
      expect(owned.organisation.name).toBe('Org One');
      expect(shared._shared).toBe(true);
      expect(shared.organisation.name).toBe('Org Two');
    });
  });

  describe('Vessel list excludes unrelated orgs', () => {
    it('does not return vessels from orgs the user has no access to', async () => {
      (prisma.vesselShare.findMany as any).mockResolvedValue([]);
      (prisma.vessel.findMany as any).mockResolvedValue([ownedVessel]);
      (prisma.vessel.count as any).mockResolvedValue(1);

      const res = await request(app)
        .get('/api/v1/vessels')
        .set('Authorization', `Bearer ${org1Token}`);

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].id).toBe('v-owned');
    });
  });

  describe('Vessel detail via share', () => {
    it('allows access to vessel via share', async () => {
      (prisma.vessel.findFirst as any).mockResolvedValue({
        ...otherVessel,
        nicheAreas: [],
        components: [],
        inspections: [],
        workOrders: [],
      });
      (prisma.vesselShare.findUnique as any).mockResolvedValue({
        vesselId: 'v-other', userId: 'u1', permission: 'READ',
      });

      const res = await request(app)
        .get('/api/v1/vessels/v-other')
        .set('Authorization', `Bearer ${org1Token}`);

      expect(res.status).toBe(200);
      expect(res.body.data.name).toBe('Other Vessel');
    });

    it('returns 404 for vessel without share and different org', async () => {
      (prisma.vessel.findFirst as any).mockResolvedValue(otherVessel);
      (prisma.vesselShare.findUnique as any).mockResolvedValue(null);

      const res = await request(app)
        .get('/api/v1/vessels/v-other')
        .set('Authorization', `Bearer ${org1Token}`);

      expect(res.status).toBe(404);
    });
  });
});
