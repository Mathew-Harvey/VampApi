import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';

const mockVessel = {
  id: 'v1',
  name: 'Test Vessel',
  organisationId: 'org1',
  isDeleted: false,
  source: null,
  vesselType: 'TUG',
};

const mockUser = {
  id: 'u2',
  email: 'shared@test.com',
  firstName: 'Shared',
  lastName: 'User',
};

const mockShare = {
  id: 'share1',
  vesselId: 'v1',
  userId: 'u2',
  permission: 'READ',
  sharedBy: 'u1',
  createdAt: new Date(),
  updatedAt: new Date(),
};

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
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
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
    sendVesselShareInvite: vi.fn().mockResolvedValue({ sent: true, id: 'msg-1' }),
    sendWorkOrderInvite: vi.fn().mockResolvedValue({ sent: true, id: 'msg-2' }),
    sendPasswordReset: vi.fn().mockResolvedValue({ sent: true }),
  },
}));

import { generateAccessToken } from '../../src/config/auth';
import app from '../../src/app';
import prisma from '../../src/config/database';

const authToken = generateAccessToken({
  userId: 'u1',
  email: 'admin@test.com',
  organisationId: 'org1',
  role: 'ORGANISATION_ADMIN',
  permissions: ['VESSEL_VIEW', 'VESSEL_EDIT', 'VESSEL_CREATE', 'VESSEL_DELETE', 'ADMIN_FULL_ACCESS'],
});

const viewerToken = generateAccessToken({
  userId: 'u3',
  email: 'viewer@test.com',
  organisationId: 'org1',
  role: 'VIEWER',
  permissions: ['VESSEL_VIEW'],
});

describe('Vessel Share Routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('POST /api/v1/vessels/:vesselId/shares', () => {
    it('returns 401 without auth', async () => {
      const res = await request(app)
        .post('/api/v1/vessels/v1/shares')
        .send({ email: 'test@test.com', permission: 'READ' });
      expect(res.status).toBe(401);
    });

    it('returns 400 without email', async () => {
      const res = await request(app)
        .post('/api/v1/vessels/v1/shares')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ permission: 'READ' });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('returns 400 with invalid permission', async () => {
      const res = await request(app)
        .post('/api/v1/vessels/v1/shares')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ email: 'test@test.com', permission: 'ADMIN' });
      expect(res.status).toBe(400);
      expect(res.body.error.message).toContain('READ or WRITE');
    });

    it('returns 403 for viewer trying to share', async () => {
      const res = await request(app)
        .post('/api/v1/vessels/v1/shares')
        .set('Authorization', `Bearer ${viewerToken}`)
        .send({ email: 'test@test.com', permission: 'READ' });
      expect(res.status).toBe(403);
    });

    it('shares vessel with existing user', async () => {
      (prisma.vessel.findFirst as any).mockResolvedValue(mockVessel);
      (prisma.user.findUnique as any)
        .mockResolvedValueOnce({ id: 'u1', firstName: 'Admin', lastName: 'User' })
        .mockResolvedValueOnce(mockUser);
      (prisma.vesselShare.findUnique as any).mockResolvedValue(null);
      (prisma.vesselShare.create as any).mockResolvedValue(mockShare);

      const res = await request(app)
        .post('/api/v1/vessels/v1/shares')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ email: 'shared@test.com', permission: 'READ' });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe('shared');
      expect(res.body.data.user.email).toBe('shared@test.com');
    });

    it('returns invited status for non-existent user', async () => {
      (prisma.vessel.findFirst as any).mockResolvedValue(mockVessel);
      (prisma.user.findUnique as any)
        .mockResolvedValueOnce({ id: 'u1', firstName: 'Admin', lastName: 'User' })
        .mockResolvedValueOnce(null);

      const res = await request(app)
        .post('/api/v1/vessels/v1/shares')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ email: 'newuser@test.com', permission: 'READ' });

      expect(res.status).toBe(201);
      expect(res.body.data.status).toBe('invited');
      expect(res.body.data.email).toBe('newuser@test.com');
    });
  });

  describe('GET /api/v1/vessels/:vesselId/shares', () => {
    it('returns 401 without auth', async () => {
      const res = await request(app).get('/api/v1/vessels/v1/shares');
      expect(res.status).toBe(401);
    });

    it('returns shares list for the vessel', async () => {
      (prisma.vessel.findFirst as any).mockResolvedValue(mockVessel);
      (prisma.vesselShare.findMany as any).mockResolvedValue([
        {
          ...mockShare,
          user: mockUser,
          sharer: { id: 'u1', firstName: 'Admin', lastName: 'User' },
        },
      ]);

      const res = await request(app)
        .get('/api/v1/vessels/v1/shares')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].user.email).toBe('shared@test.com');
    });
  });

  describe('PATCH /api/v1/vessels/:vesselId/shares/:userId/permission', () => {
    it('updates permission', async () => {
      (prisma.vessel.findFirst as any).mockResolvedValue(mockVessel);
      (prisma.vesselShare.findUnique as any).mockResolvedValue(mockShare);
      (prisma.vesselShare.update as any).mockResolvedValue({ ...mockShare, permission: 'WRITE' });

      const res = await request(app)
        .patch('/api/v1/vessels/v1/shares/u2/permission')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ permission: 'WRITE' });

      expect(res.status).toBe(200);
      expect(res.body.data.permission).toBe('WRITE');
    });

    it('returns 400 with invalid permission', async () => {
      const res = await request(app)
        .patch('/api/v1/vessels/v1/shares/u2/permission')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ permission: 'ADMIN' });

      expect(res.status).toBe(400);
    });
  });

  describe('DELETE /api/v1/vessels/:vesselId/shares/:userId', () => {
    it('revokes share', async () => {
      (prisma.vessel.findFirst as any).mockResolvedValue(mockVessel);
      (prisma.vesselShare.findUnique as any).mockResolvedValue(mockShare);
      (prisma.vesselShare.delete as any).mockResolvedValue(mockShare);

      const res = await request(app)
        .delete('/api/v1/vessels/v1/shares/u2')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.message).toBe('Share revoked');
    });

    it('returns 403 for viewer trying to revoke', async () => {
      const res = await request(app)
        .delete('/api/v1/vessels/v1/shares/u2')
        .set('Authorization', `Bearer ${viewerToken}`);

      expect(res.status).toBe(403);
    });
  });
});

describe('Vessel list includes shared vessels', () => {
  it('GET /api/v1/vessels returns shared vessels with _shared flag', async () => {
    (prisma.vesselShare.findMany as any).mockResolvedValue([{ vesselId: 'v-shared' }]);
    (prisma.vessel.findMany as any).mockResolvedValue([
      { ...mockVessel, id: 'v1', organisation: { id: 'org1', name: 'Test Org' } },
      { ...mockVessel, id: 'v-shared', organisationId: 'org-other', organisation: { id: 'org-other', name: 'Other Org' } },
    ]);
    (prisma.vessel.count as any).mockResolvedValue(2);

    const res = await request(app)
      .get('/api/v1/vessels')
      .set('Authorization', `Bearer ${authToken}`);

    expect(res.status).toBe(200);
    const owned = res.body.data.find((v: any) => v.id === 'v1');
    const shared = res.body.data.find((v: any) => v.id === 'v-shared');
    expect(owned._shared).toBe(false);
    expect(shared._shared).toBe(true);
  });
});
