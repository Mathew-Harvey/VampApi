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
    workOrderAssignment: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
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

const org1UserToken = generateAccessToken({
  userId: 'u1',
  email: 'user1@test.com',
  organisationId: 'org1',
  role: 'MANAGER',
  permissions: ['VESSEL_VIEW', 'WORK_ORDER_VIEW', 'WORK_ORDER_CREATE'],
});

const org2UserToken = generateAccessToken({
  userId: 'u2',
  email: 'user2@test.com',
  organisationId: 'org2',
  role: 'OPERATOR',
  permissions: ['VESSEL_VIEW', 'WORK_ORDER_VIEW'],
});

const ownedWO = {
  id: 'wo1',
  referenceNumber: 'WO-001',
  title: 'Own WO',
  organisationId: 'org1',
  vesselId: 'v1',
  status: 'DRAFT',
  type: 'BIOFOULING_INSPECTION',
  isDeleted: false,
  vessel: { id: 'v1', name: 'My Vessel' },
  organisation: { id: 'org1', name: 'Org One' },
  assignments: [],
};

const assignedWO = {
  id: 'wo2',
  referenceNumber: 'WO-002',
  title: 'Cross-org WO',
  organisationId: 'org2',
  vesselId: 'v2',
  status: 'IN_PROGRESS',
  type: 'HULL_CLEANING',
  isDeleted: false,
  vessel: { id: 'v2', name: 'Their Vessel' },
  organisation: { id: 'org2', name: 'Org Two' },
  assignments: [{ userId: 'u1', role: 'TEAM_MEMBER', user: { id: 'u1', firstName: 'User', lastName: 'One', email: 'user1@test.com', organisations: [] } }],
};

describe('Cross-org Work Order Visibility', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Work order list includes assigned WOs from other orgs', () => {
    it('returns both owned and assigned work orders with org info', async () => {
      (prisma.workOrder.findMany as any).mockResolvedValue([ownedWO, assignedWO]);
      (prisma.workOrder.count as any).mockResolvedValue(2);

      const res = await request(app)
        .get('/api/v1/work-orders')
        .set('Authorization', `Bearer ${org1UserToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(2);

      const own = res.body.data.find((wo: any) => wo.id === 'wo1');
      const crossOrg = res.body.data.find((wo: any) => wo.id === 'wo2');

      expect(own.organisation.name).toBe('Org One');
      expect(crossOrg.organisation.name).toBe('Org Two');
    });
  });

  describe('Work order detail includes org info', () => {
    it('returns org name on work order detail', async () => {
      (prisma.workOrder.findFirst as any).mockResolvedValue({
        ...ownedWO,
        inspections: [],
        taskSubmissions: [],
        comments: [],
        workflow: null,
      });

      const res = await request(app)
        .get('/api/v1/work-orders/wo1')
        .set('Authorization', `Bearer ${org1UserToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.organisation.name).toBe('Org One');
    });
  });

  describe('Unauthenticated access is blocked', () => {
    it('returns 401 for work order list without token', async () => {
      const res = await request(app).get('/api/v1/work-orders');
      expect(res.status).toBe(401);
    });

    it('returns 404 for work order the user has no access to', async () => {
      (prisma.workOrder.findFirst as any).mockResolvedValue(null);

      const res = await request(app)
        .get('/api/v1/work-orders/wo-noaccess')
        .set('Authorization', `Bearer ${org2UserToken}`);

      expect(res.status).toBe(404);
    });
  });
});
