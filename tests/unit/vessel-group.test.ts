import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';

const mockGroup = {
  id: 'grp1',
  organisationId: 'org1',
  name: 'Commercial Fleet',
  description: 'All commercial vessels',
  color: '#3B82F6',
  sortOrder: 0,
  isDeleted: false,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const mockVessel = {
  id: 'v1',
  name: 'Test Vessel',
  vesselType: 'TUG',
  imoNumber: '1234567',
  status: 'ACTIVE',
  complianceStatus: 'COMPLIANT',
  flagState: 'Australia',
  organisationId: 'org1',
  isDeleted: false,
};

const mockMembership = {
  id: 'mem1',
  vesselGroupId: 'grp1',
  vesselId: 'v1',
  sortOrder: 0,
  addedAt: new Date(),
};

vi.mock('../../src/config/database', () => {
  const mockPrisma: any = {
    $connect: vi.fn().mockResolvedValue(undefined),
    $disconnect: vi.fn().mockResolvedValue(undefined),
    $queryRaw: vi.fn().mockResolvedValue([{ 1: 1 }]),
    // audit.service wraps each write in a SERIALIZABLE $transaction.  We need
    // a working mock or every mutating endpoint returns 500.
    $transaction: vi.fn(async (fn: any) => (typeof fn === 'function' ? fn(mockPrisma) : fn)),
    vesselGroup: {
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      aggregate: vi.fn().mockResolvedValue({ _max: { sortOrder: 0 } }),
    },
    vesselGroupMembership: {
      findMany: vi.fn().mockResolvedValue([]),
      createMany: vi.fn().mockResolvedValue({ count: 1 }),
      deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
      aggregate: vi.fn().mockResolvedValue({ _max: { sortOrder: 0 } }),
    },
    vessel: {
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn(),
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
      count: vi.fn().mockResolvedValue(0),
    },
    organisation: {
      create: vi.fn(),
      findUnique: vi.fn(),
    },
    organisationUser: {
      create: vi.fn(),
      findUnique: vi.fn(),
    },
    workOrder: {
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn(),
      count: vi.fn().mockResolvedValue(0),
    },
    auditEntry: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: 'audit-1' }),
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
    },
    notification: {
      create: vi.fn().mockResolvedValue({ id: 'notif-1' }),
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

vi.mock('../../src/services/email.service', () => ({
  emailService: {
    sendVesselShareInvite: vi.fn().mockResolvedValue({ sent: true }),
    sendWorkOrderInvite: vi.fn().mockResolvedValue({ sent: true }),
    sendPasswordReset: vi.fn().mockResolvedValue({ sent: true }),
  },
}));

import { generateAccessToken } from '../../src/config/auth';
import app from '../../src/app';
import prisma from '../../src/config/database';

const adminToken = generateAccessToken({
  userId: 'u1',
  email: 'admin@test.com',
  organisationId: 'org1',
  role: 'ORGANISATION_ADMIN',
  permissions: ['VESSEL_VIEW', 'VESSEL_EDIT', 'VESSEL_CREATE', 'VESSEL_DELETE', 'VESSEL_GROUP_MANAGE', 'ADMIN_FULL_ACCESS'],
});

const viewerToken = generateAccessToken({
  userId: 'u2',
  email: 'viewer@test.com',
  organisationId: 'org1',
  role: 'VIEWER',
  permissions: ['VESSEL_VIEW'],
});

describe('Vessel Group Routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /api/v1/vessel-groups', () => {
    it('returns 401 without auth', async () => {
      const res = await request(app).get('/api/v1/vessel-groups');
      expect(res.status).toBe(401);
    });

    it('returns empty list when no groups exist', async () => {
      (prisma.vesselGroup.findMany as any).mockResolvedValue([]);

      const res = await request(app)
        .get('/api/v1/vessel-groups')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toEqual([]);
    });

    it('returns groups with vessel counts', async () => {
      (prisma.vesselGroup.findMany as any).mockResolvedValue([
        {
          ...mockGroup,
          memberships: [{ ...mockMembership, vessel: mockVessel }],
        },
      ]);

      const res = await request(app)
        .get('/api/v1/vessel-groups')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].name).toBe('Commercial Fleet');
      expect(res.body.data[0].vesselCount).toBe(1);
      expect(res.body.data[0].vessels).toHaveLength(1);
      expect(res.body.data[0].vessels[0].name).toBe('Test Vessel');
    });

    it('excludes deleted vessels from group counts', async () => {
      (prisma.vesselGroup.findMany as any).mockResolvedValue([
        {
          ...mockGroup,
          memberships: [
            { ...mockMembership, vessel: mockVessel },
            { ...mockMembership, id: 'mem2', vesselId: 'v2', vessel: { ...mockVessel, id: 'v2', isDeleted: true } },
          ],
        },
      ]);

      const res = await request(app)
        .get('/api/v1/vessel-groups')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.body.data[0].vesselCount).toBe(1);
    });

    it('allows viewers to list groups', async () => {
      (prisma.vesselGroup.findMany as any).mockResolvedValue([]);

      const res = await request(app)
        .get('/api/v1/vessel-groups')
        .set('Authorization', `Bearer ${viewerToken}`);

      expect(res.status).toBe(200);
    });
  });

  describe('POST /api/v1/vessel-groups', () => {
    it('returns 401 without auth', async () => {
      const res = await request(app)
        .post('/api/v1/vessel-groups')
        .send({ name: 'Test Group' });
      expect(res.status).toBe(401);
    });

    it('returns 403 for viewer', async () => {
      const res = await request(app)
        .post('/api/v1/vessel-groups')
        .set('Authorization', `Bearer ${viewerToken}`)
        .send({ name: 'Test Group' });
      expect(res.status).toBe(403);
    });

    it('returns 400 without name', async () => {
      const res = await request(app)
        .post('/api/v1/vessel-groups')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({});
      expect(res.status).toBe(400);
    });

    it('creates a group successfully', async () => {
      (prisma.vesselGroup.findFirst as any).mockResolvedValue(null);
      (prisma.vesselGroup.aggregate as any).mockResolvedValue({ _max: { sortOrder: 0 } });
      (prisma.vesselGroup.create as any).mockResolvedValue(mockGroup);

      const res = await request(app)
        .post('/api/v1/vessel-groups')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'Commercial Fleet', description: 'All commercial vessels', color: '#3B82F6' });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.name).toBe('Commercial Fleet');
    });

    it('returns 409 for duplicate name', async () => {
      (prisma.vesselGroup.findFirst as any).mockResolvedValue(mockGroup);

      const res = await request(app)
        .post('/api/v1/vessel-groups')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'Commercial Fleet' });

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('CONFLICT');
    });
  });

  describe('GET /api/v1/vessel-groups/:id', () => {
    it('returns a group with vessels', async () => {
      (prisma.vesselGroup.findFirst as any).mockResolvedValue({
        ...mockGroup,
        memberships: [{ ...mockMembership, vessel: mockVessel }],
      });

      const res = await request(app)
        .get('/api/v1/vessel-groups/grp1')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.name).toBe('Commercial Fleet');
      expect(res.body.data.vessels).toHaveLength(1);
    });

    it('returns 404 for non-existent group', async () => {
      (prisma.vesselGroup.findFirst as any).mockResolvedValue(null);

      const res = await request(app)
        .get('/api/v1/vessel-groups/nonexistent')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(404);
    });
  });

  describe('PUT /api/v1/vessel-groups/:id', () => {
    it('returns 403 for viewer', async () => {
      const res = await request(app)
        .put('/api/v1/vessel-groups/grp1')
        .set('Authorization', `Bearer ${viewerToken}`)
        .send({ name: 'Renamed' });
      expect(res.status).toBe(403);
    });

    it('updates a group', async () => {
      (prisma.vesselGroup.findFirst as any)
        .mockResolvedValueOnce(mockGroup)
        .mockResolvedValueOnce(null);
      (prisma.vesselGroup.update as any).mockResolvedValue({ ...mockGroup, name: 'Renamed Fleet' });

      const res = await request(app)
        .put('/api/v1/vessel-groups/grp1')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'Renamed Fleet' });

      expect(res.status).toBe(200);
      expect(res.body.data.name).toBe('Renamed Fleet');
    });

    it('returns 404 for non-existent group', async () => {
      (prisma.vesselGroup.findFirst as any).mockResolvedValue(null);

      const res = await request(app)
        .put('/api/v1/vessel-groups/nonexistent')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'Test' });

      expect(res.status).toBe(404);
    });
  });

  describe('DELETE /api/v1/vessel-groups/:id', () => {
    it('returns 403 for viewer', async () => {
      const res = await request(app)
        .delete('/api/v1/vessel-groups/grp1')
        .set('Authorization', `Bearer ${viewerToken}`);
      expect(res.status).toBe(403);
    });

    it('soft-deletes a group', async () => {
      (prisma.vesselGroup.findFirst as any).mockResolvedValue(mockGroup);
      (prisma.vesselGroup.update as any).mockResolvedValue({ ...mockGroup, isDeleted: true });

      const res = await request(app)
        .delete('/api/v1/vessel-groups/grp1')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.message).toBe('Vessel group deleted');
    });

    it('returns 404 for non-existent group', async () => {
      (prisma.vesselGroup.findFirst as any).mockResolvedValue(null);

      const res = await request(app)
        .delete('/api/v1/vessel-groups/nonexistent')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(404);
    });
  });

  describe('POST /api/v1/vessel-groups/:id/vessels', () => {
    it('returns 403 for viewer', async () => {
      const res = await request(app)
        .post('/api/v1/vessel-groups/grp1/vessels')
        .set('Authorization', `Bearer ${viewerToken}`)
        .send({ vesselIds: ['v1'] });
      expect(res.status).toBe(403);
    });

    it('returns 400 with empty vesselIds', async () => {
      const res = await request(app)
        .post('/api/v1/vessel-groups/grp1/vessels')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ vesselIds: [] });
      expect(res.status).toBe(400);
    });

    it('adds vessels to a group', async () => {
      (prisma.vesselGroup.findFirst as any).mockResolvedValue(mockGroup);
      (prisma.vessel.findMany as any).mockResolvedValue([mockVessel]);
      (prisma.vesselGroupMembership.findMany as any).mockResolvedValue([]);
      (prisma.vesselGroupMembership.aggregate as any).mockResolvedValue({ _max: { sortOrder: 0 } });
      (prisma.vesselGroupMembership.createMany as any).mockResolvedValue({ count: 1 });

      const res = await request(app)
        .post('/api/v1/vessel-groups/grp1/vessels')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ vesselIds: ['v1'] });

      expect(res.status).toBe(201);
      expect(res.body.data.added).toBe(1);
    });

    it('returns 404 for non-existent group', async () => {
      (prisma.vesselGroup.findFirst as any).mockResolvedValue(null);

      const res = await request(app)
        .post('/api/v1/vessel-groups/nonexistent/vessels')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ vesselIds: ['v1'] });

      expect(res.status).toBe(404);
    });

    it('returns 400 for invalid vessel IDs', async () => {
      (prisma.vesselGroup.findFirst as any).mockResolvedValue(mockGroup);
      (prisma.vessel.findMany as any).mockResolvedValue([]);

      const res = await request(app)
        .post('/api/v1/vessel-groups/grp1/vessels')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ vesselIds: ['bad-id'] });

      expect(res.status).toBe(400);
      expect(res.body.error.message).toContain('not found');
    });

    it('reports already-in-group vessels', async () => {
      (prisma.vesselGroup.findFirst as any).mockResolvedValue(mockGroup);
      (prisma.vessel.findMany as any).mockResolvedValue([mockVessel]);
      (prisma.vesselGroupMembership.findMany as any).mockResolvedValue([mockMembership]);

      const res = await request(app)
        .post('/api/v1/vessel-groups/grp1/vessels')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ vesselIds: ['v1'] });

      expect(res.status).toBe(201);
      expect(res.body.data.added).toBe(0);
      expect(res.body.data.alreadyInGroup).toBe(1);
    });
  });

  describe('POST /api/v1/vessel-groups/:id/vessels/remove', () => {
    it('removes vessels from a group', async () => {
      (prisma.vesselGroup.findFirst as any).mockResolvedValue(mockGroup);
      (prisma.vesselGroupMembership.deleteMany as any).mockResolvedValue({ count: 1 });

      const res = await request(app)
        .post('/api/v1/vessel-groups/grp1/vessels/remove')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ vesselIds: ['v1'] });

      expect(res.status).toBe(200);
      expect(res.body.data.removed).toBe(1);
    });

    it('returns 404 for non-existent group', async () => {
      (prisma.vesselGroup.findFirst as any).mockResolvedValue(null);

      const res = await request(app)
        .post('/api/v1/vessel-groups/nonexistent/vessels/remove')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ vesselIds: ['v1'] });

      expect(res.status).toBe(404);
    });
  });

  describe('PUT /api/v1/vessel-groups/reorder', () => {
    it('reorders groups', async () => {
      (prisma.vesselGroup.findMany as any).mockResolvedValue([
        { id: 'grp1' },
        { id: 'grp2' },
      ]);
      (prisma.vesselGroup.update as any).mockResolvedValue(mockGroup);

      const res = await request(app)
        .put('/api/v1/vessel-groups/reorder')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ groupIds: ['grp2', 'grp1'] });

      expect(res.status).toBe(200);
      expect(res.body.data.message).toBe('Groups reordered');
    });

    it('returns 403 for viewer', async () => {
      const res = await request(app)
        .put('/api/v1/vessel-groups/reorder')
        .set('Authorization', `Bearer ${viewerToken}`)
        .send({ groupIds: ['grp1'] });
      expect(res.status).toBe(403);
    });
  });
});
