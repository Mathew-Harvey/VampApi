import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';

vi.mock('../../src/config/database', () => {
  const mockPrisma = {
    $connect: vi.fn().mockResolvedValue(undefined),
    $disconnect: vi.fn().mockResolvedValue(undefined),
    $queryRaw: vi.fn().mockResolvedValue([{ 1: 1 }]),
    $transaction: vi.fn(),
    organisation: {
      create: vi.fn(),
      findUnique: vi.fn(),
    },
    organisationUser: {
      create: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn().mockResolvedValue([]),
    },
    invitation: {
      findFirst: vi.fn(),
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn(),
      update: vi.fn(),
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

const userToken = generateAccessToken({
  userId: 'u1',
  email: 'user@test.com',
  organisationId: 'org1',
  role: 'OPERATOR',
  permissions: ['VESSEL_VIEW', 'WORK_ORDER_VIEW'],
});

describe('Invitation Acceptance', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('POST /api/v1/users/invitations/:id/accept', () => {
    it('returns 401 without auth', async () => {
      const res = await request(app)
        .post('/api/v1/users/invitations/inv1/accept');
      expect(res.status).toBe(401);
    });

    it('returns 404 for non-existent invitation', async () => {
      (prisma.invitation.findFirst as any).mockResolvedValue(null);

      const res = await request(app)
        .post('/api/v1/users/invitations/inv-nope/accept')
        .set('Authorization', `Bearer ${userToken}`);

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });

    it('returns message for already-member user', async () => {
      (prisma.invitation.findFirst as any).mockResolvedValue({
        id: 'inv1',
        email: 'user@test.com',
        organisationId: 'org2',
        role: 'OPERATOR',
        workOrderId: null,
      });
      (prisma.organisationUser.findUnique as any).mockResolvedValue({
        id: 'ou1',
        userId: 'u1',
        organisationId: 'org2',
      });
      (prisma.invitation.update as any).mockResolvedValue({});

      const res = await request(app)
        .post('/api/v1/users/invitations/inv1/accept')
        .set('Authorization', `Bearer ${userToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.message).toContain('already a member');
    });

    it('accepts invitation and returns new tokens with org context', async () => {
      const invitation = {
        id: 'inv1',
        email: 'user@test.com',
        organisationId: 'org2',
        role: 'MANAGER',
        workOrderId: null,
      };
      (prisma.invitation.findFirst as any).mockResolvedValue(invitation);
      (prisma.organisationUser.findUnique as any).mockResolvedValue(null);

      const createdOrgUser = {
        id: 'ou-new',
        userId: 'u1',
        organisationId: 'org2',
        role: 'MANAGER',
        permissions: '[]',
        organisation: {
          id: 'org2',
          name: 'Beta Corp',
          type: 'SERVICE_PROVIDER',
        },
      };

      (prisma.$transaction as any).mockResolvedValue([createdOrgUser, {}]);

      const res = await request(app)
        .post('/api/v1/users/invitations/inv1/accept')
        .set('Authorization', `Bearer ${userToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.accessToken).toBeTruthy();
      expect(res.body.data.refreshToken).toBeTruthy();
      expect(res.body.data.organisation.id).toBe('org2');
      expect(res.body.data.organisation.name).toBe('Beta Corp');
    });
  });

  describe('POST /api/v1/users/invitations/:id/decline', () => {
    it('declines an invitation', async () => {
      (prisma.invitation.findFirst as any).mockResolvedValue({
        id: 'inv2',
        email: 'user@test.com',
        organisationId: 'org3',
        role: 'VIEWER',
        workOrderId: null,
      });
      (prisma.invitation.update as any).mockResolvedValue({});

      const res = await request(app)
        .post('/api/v1/users/invitations/inv2/decline')
        .set('Authorization', `Bearer ${userToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.message).toContain('declined');
    });

    it('returns 404 for non-existent invitation', async () => {
      (prisma.invitation.findFirst as any).mockResolvedValue(null);

      const res = await request(app)
        .post('/api/v1/users/invitations/inv-nope/decline')
        .set('Authorization', `Bearer ${userToken}`);

      expect(res.status).toBe(404);
    });
  });

  describe('GET /api/v1/users/invitations/pending', () => {
    it('returns pending org invitations for current user', async () => {
      (prisma.invitation.findMany as any).mockResolvedValue([
        {
          id: 'inv1',
          email: 'user@test.com',
          organisationId: 'org2',
          role: 'MANAGER',
          createdAt: new Date(),
          expiresAt: new Date(Date.now() + 86400000),
          organisation: { id: 'org2', name: 'Beta Corp', type: 'SERVICE_PROVIDER' },
        },
      ]);

      const res = await request(app)
        .get('/api/v1/users/invitations/pending')
        .set('Authorization', `Bearer ${userToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].organisation.name).toBe('Beta Corp');
      expect(res.body.data[0]).not.toHaveProperty('token');
    });
  });
});
