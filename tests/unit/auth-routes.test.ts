import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';

vi.mock('../../src/config/database', () => {
  const mockPrisma = {
    $connect: vi.fn().mockResolvedValue(undefined),
    $disconnect: vi.fn().mockResolvedValue(undefined),
    $queryRaw: vi.fn().mockResolvedValue([{ 1: 1 }]),
    $transaction: vi.fn(async (fn: any) => (typeof fn === 'function' ? fn(mockPrisma) : fn)),
    user: {
      findUnique: vi.fn(),
      update: vi.fn(),
      count: vi.fn().mockResolvedValue(0),
    },
    organisation: { findUnique: vi.fn(), create: vi.fn() },
    organisationUser: {
      findUnique: vi.fn(),
      findMany: vi.fn().mockResolvedValue([]),
    },
    passwordReset: {
      create: vi.fn().mockResolvedValue({ token: 't', id: 'pr1' }),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    invitation: { findFirst: vi.fn() },
    auditEntry: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: 'a1' }),
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
    },
    vessel: { findMany: vi.fn().mockResolvedValue([]), count: vi.fn().mockResolvedValue(0) },
    workOrder: { findMany: vi.fn().mockResolvedValue([]), count: vi.fn().mockResolvedValue(0) },
    notification: { findMany: vi.fn().mockResolvedValue([]), count: vi.fn().mockResolvedValue(0) },
  };
  return { default: mockPrisma, prisma: mockPrisma };
});

vi.mock('../../src/services/storage-config.service', () => ({
  storageConfigService: {
    get: vi.fn().mockReturnValue({ backend: 'local', localMediaPath: '/tmp/t', s3: {} }),
    getLocalMediaPath: vi.fn().mockReturnValue('/tmp/t'),
    isS3Usable: vi.fn().mockReturnValue(false),
    shouldUseS3: vi.fn().mockReturnValue(false),
    getStatus: vi.fn().mockReturnValue({
      overallStatus: 'ready', summary: '', effectiveBackend: 'local',
      s3Configured: false, localPathExists: true, localMediaPath: '/tmp/t', fields: [],
    }),
  },
}));

// Stub email service so forgot-password never tries to actually send email
vi.mock('../../src/services/email.service', () => ({
  emailService: {
    sendWorkOrderInvite: vi.fn().mockResolvedValue({ sent: true }),
    sendVesselShareInvite: vi.fn().mockResolvedValue({ sent: true }),
    sendOrganisationInvite: vi.fn().mockResolvedValue({ sent: true }),
    sendPasswordReset: vi.fn().mockResolvedValue({ sent: true }),
  },
}));

import app from '../../src/app';
import prisma from '../../src/config/database';
import { env } from '../../src/config/env';

describe('auth routes — cookie + forgot-password + rate limits', () => {
  beforeEach(() => vi.clearAllMocks());

  describe('forgot-password does not leak the reset token', () => {
    it('returns the generic success message regardless of the user existing', async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValue({
        id: 'u1', email: 'a@b.com', isActive: true,
      } as any);

      const res = await request(app)
        .post('/api/v1/auth/forgot-password')
        .send({ email: 'a@b.com' });

      expect(res.status).toBe(200);
      expect(res.body.data.message).toMatch(/reset link has been sent/i);
      // The reset token must never appear in the response body, even in dev.
      expect(res.body.data).not.toHaveProperty('token');
    });

    it('returns the same generic response when the user does not exist', async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValue(null);
      const res = await request(app)
        .post('/api/v1/auth/forgot-password')
        .send({ email: 'missing@b.com' });
      expect(res.status).toBe(200);
      expect(res.body.data.message).toMatch(/reset link has been sent/i);
    });
  });

  describe('refresh rejects an access token as refresh', () => {
    it('returns 401 when called with an access token in the cookie', async () => {
      const { generateAccessToken } = await import('../../src/config/auth');
      const access = generateAccessToken({
        userId: 'u1', email: 'a@b.com', organisationId: 'o1', role: 'X', permissions: [],
      });
      const res = await request(app)
        .post('/api/v1/auth/refresh')
        .set('Cookie', [`refreshToken=${access}`]);
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('INVALID_TOKEN');
    });
  });

  describe('auth cookies', () => {
    it('sets accessToken cookie Max-Age equal to env.ACCESS_COOKIE_MAX_AGE_SECONDS', async () => {
      // Mock successful login so setAuthCookies fires
      const bcrypt = await import('bcryptjs');
      const passwordHash = await bcrypt.hash('password', 4);
      vi.mocked(prisma.user.findUnique).mockResolvedValue({
        id: 'u1', email: 'a@b.com', firstName: 'A', lastName: 'B',
        phone: null, avatarUrl: null, isActive: true, lastLoginAt: null,
        createdAt: new Date(), updatedAt: new Date(),
        passwordHash,
        organisations: [{
          id: 'ou1', userId: 'u1', organisationId: 'o1', role: 'ORGANISATION_ADMIN',
          permissions: JSON.stringify([]), isDefault: true,
          organisation: { id: 'o1', name: 'Org', type: 'VESSEL_OPERATOR', isDeleted: false },
        }],
      } as any);
      vi.mocked(prisma.user.update).mockResolvedValue({ id: 'u1' } as any);

      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: 'a@b.com', password: 'password' });

      expect(res.status).toBe(200);
      const setCookie = (res.headers['set-cookie'] as unknown as string[]) || [];
      const accessCookie = setCookie.find((c) => c.startsWith('accessToken='));
      expect(accessCookie).toBeDefined();
      // `Max-Age=<seconds>` is emitted by express when `maxAge` is set.
      const maxAgeMatch = accessCookie!.match(/Max-Age=(\d+)/);
      expect(maxAgeMatch).not.toBeNull();
      expect(Number(maxAgeMatch![1])).toBe(env.ACCESS_COOKIE_MAX_AGE_SECONDS);
    });
  });
});
