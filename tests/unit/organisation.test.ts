import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';

vi.mock('../../src/config/database', () => {
  const mockPrisma = {
    $connect: vi.fn().mockResolvedValue(undefined),
    $disconnect: vi.fn().mockResolvedValue(undefined),
    $queryRaw: vi.fn().mockResolvedValue([{ 1: 1 }]),
    organisation: {
      create: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    organisationUser: {
      create: vi.fn(),
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

const adminToken = generateAccessToken({
  userId: 'u1',
  email: 'admin@test.com',
  organisationId: 'org1',
  role: 'ORGANISATION_ADMIN',
  permissions: ['VESSEL_VIEW', 'VESSEL_EDIT', 'USER_MANAGE', 'USER_INVITE'],
});

const viewerToken = generateAccessToken({
  userId: 'u2',
  email: 'viewer@test.com',
  organisationId: 'org1',
  role: 'VIEWER',
  permissions: ['VESSEL_VIEW', 'WORK_ORDER_VIEW'],
});

const ecosystemAdminToken = generateAccessToken({
  userId: 'u1',
  email: 'admin@test.com',
  organisationId: 'org1',
  role: 'ECOSYSTEM_ADMIN',
  permissions: ['ADMIN_FULL_ACCESS'],
});

const otherOrgToken = generateAccessToken({
  userId: 'u3',
  email: 'other@test.com',
  organisationId: 'org2',
  role: 'ORGANISATION_ADMIN',
  permissions: ['VESSEL_VIEW'],
});

describe('Organisation Routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /api/v1/organisations', () => {
    it('returns 401 without auth', async () => {
      const res = await request(app).get('/api/v1/organisations');
      expect(res.status).toBe(401);
    });

    it('returns user orgs with roles', async () => {
      (prisma.organisationUser.findMany as any).mockResolvedValue([
        {
          role: 'ORGANISATION_ADMIN',
          organisation: { id: 'org1', name: 'Alpha Org', type: 'VESSEL_OPERATOR', createdAt: new Date(), updatedAt: new Date() },
        },
        {
          role: 'VIEWER',
          organisation: { id: 'org2', name: 'Beta Org', type: 'SERVICE_PROVIDER', createdAt: new Date(), updatedAt: new Date() },
        },
      ]);

      const res = await request(app)
        .get('/api/v1/organisations')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(2);
      expect(res.body.data[0].name).toBe('Alpha Org');
      expect(res.body.data[0].role).toBe('ORGANISATION_ADMIN');
      expect(res.body.data[1].name).toBe('Beta Org');
      expect(res.body.data[1].role).toBe('VIEWER');
    });
  });

  describe('GET /api/v1/organisations/:id', () => {
    it('returns 404 for non-member org', async () => {
      (prisma.organisationUser.findUnique as any).mockResolvedValue(null);

      const res = await request(app)
        .get('/api/v1/organisations/org-unknown')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });

    it('returns org details with counts for member', async () => {
      (prisma.organisationUser.findUnique as any).mockResolvedValue({
        role: 'ORGANISATION_ADMIN',
        organisation: {
          id: 'org1', name: 'Alpha Org', type: 'VESSEL_OPERATOR',
          contactEmail: 'contact@alpha.com', contactPhone: '+61400000000',
          address: '123 Marine Dr', abn: '12345678901', logoUrl: null,
          createdAt: new Date(), updatedAt: new Date(),
          _count: { users: 5, vessels: 12, workOrders: 34 },
        },
      });

      const res = await request(app)
        .get('/api/v1/organisations/org1')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.name).toBe('Alpha Org');
      expect(res.body.data._count.users).toBe(5);
      expect(res.body.data._count.vessels).toBe(12);
      expect(res.body.data.role).toBe('ORGANISATION_ADMIN');
    });
  });

  describe('PUT /api/v1/organisations/:id', () => {
    it('returns 403 for non-admin role', async () => {
      const res = await request(app)
        .put('/api/v1/organisations/org1')
        .set('Authorization', `Bearer ${viewerToken}`)
        .send({ name: 'New Name' });

      expect(res.status).toBe(403);
    });

    it('returns 403 for updating a different org', async () => {
      const res = await request(app)
        .put('/api/v1/organisations/org2')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'Hijack' });

      expect(res.status).toBe(403);
      expect(res.body.error.message).toContain('current organisation');
    });

    it('returns 400 when no valid fields are sent', async () => {
      const res = await request(app)
        .put('/api/v1/organisations/org1')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ invalidField: 'value' });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('NO_FIELDS');
    });

    it('updates org details for admin', async () => {
      const updatedOrg = {
        id: 'org1', name: 'Updated Alpha', type: 'SERVICE_PROVIDER',
        contactEmail: 'new@alpha.com', contactPhone: '+61499999999',
        address: '456 Dock St', abn: '99999999999', logoUrl: null,
        createdAt: new Date(), updatedAt: new Date(),
      };
      (prisma.organisation.update as any).mockResolvedValue(updatedOrg);

      const res = await request(app)
        .put('/api/v1/organisations/org1')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'Updated Alpha', type: 'SERVICE_PROVIDER', contactEmail: 'new@alpha.com' });

      expect(res.status).toBe(200);
      expect(res.body.data.name).toBe('Updated Alpha');
      expect(res.body.data.type).toBe('SERVICE_PROVIDER');
    });

    it('allows ECOSYSTEM_ADMIN to update org', async () => {
      (prisma.organisation.update as any).mockResolvedValue({
        id: 'org1', name: 'Eco Update', type: 'VESSEL_OPERATOR',
      });

      const res = await request(app)
        .put('/api/v1/organisations/org1')
        .set('Authorization', `Bearer ${ecosystemAdminToken}`)
        .send({ name: 'Eco Update' });

      expect(res.status).toBe(200);
      expect(res.body.data.name).toBe('Eco Update');
    });

    it('strips disallowed fields from update payload', async () => {
      (prisma.organisation.update as any).mockResolvedValue({
        id: 'org1', name: 'Safe Update', type: 'VESSEL_OPERATOR',
      });

      await request(app)
        .put('/api/v1/organisations/org1')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'Safe Update', id: 'hacked-id', createdAt: '2020-01-01' });

      const updateCall = (prisma.organisation.update as any).mock.calls[0];
      expect(updateCall[0].data).not.toHaveProperty('id');
      expect(updateCall[0].data).not.toHaveProperty('createdAt');
      expect(updateCall[0].data.name).toBe('Safe Update');
    });
  });
});
