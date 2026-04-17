import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';

vi.mock('../../src/config/database', () => {
  const mockPrisma = {
    $connect: vi.fn().mockResolvedValue(undefined),
    $disconnect: vi.fn().mockResolvedValue(undefined),
    $queryRaw: vi.fn().mockResolvedValue([{ 1: 1 }]),
    $transaction: vi.fn(async (fn: any) => (typeof fn === 'function' ? fn(mockPrisma) : fn)),
    user: { findUnique: vi.fn(), count: vi.fn().mockResolvedValue(0) },
    organisation: { findUnique: vi.fn() },
    organisationUser: { findMany: vi.fn().mockResolvedValue([]), findUnique: vi.fn() },
    invitation: {
      create: vi.fn().mockResolvedValue({
        id: 'inv-abc123', token: 'secret-token-value', email: 'invitee@test.com',
        organisationId: 'org-1', role: 'OPERATOR', createdAt: new Date(), expiresAt: new Date(Date.now() + 1e7),
      }),
      findFirst: vi.fn(),
      findMany: vi.fn().mockResolvedValue([]),
      update: vi.fn(),
    },
    vessel: { findMany: vi.fn().mockResolvedValue([]), count: vi.fn().mockResolvedValue(0) },
    workOrder: { findMany: vi.fn().mockResolvedValue([]), count: vi.fn().mockResolvedValue(0) },
    auditEntry: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: 'a1' }),
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
    },
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

const sendOrganisationInvite = vi.fn().mockResolvedValue({ sent: true, id: 'msg-1' });
vi.mock('../../src/services/email.service', () => ({
  emailService: {
    sendOrganisationInvite,
    sendWorkOrderInvite: vi.fn().mockResolvedValue({ sent: true }),
    sendVesselShareInvite: vi.fn().mockResolvedValue({ sent: true }),
    sendPasswordReset: vi.fn().mockResolvedValue({ sent: true }),
  },
}));

import { generateAccessToken } from '../../src/config/auth';
import app from '../../src/app';
import prisma from '../../src/config/database';

const adminToken = generateAccessToken({
  userId: 'inviter',
  email: 'admin@test.com',
  organisationId: 'org-1',
  role: 'ORGANISATION_ADMIN',
  permissions: ['USER_INVITE'],
});

describe('POST /api/v1/users/invite', () => {
  beforeEach(() => vi.clearAllMocks());

  function mockFindUser(inviter: any, invitee: any) {
    vi.mocked(prisma.user.findUnique).mockImplementation(async (args: any) => {
      const where = args?.where ?? {};
      if (where.id === 'inviter') return inviter;
      if (where.email === 'invitee@test.com') return invitee;
      return null;
    });
  }

  it('sends an invitation email to a new invitee and surfaces the manual share info', async () => {
    mockFindUser(
      { firstName: 'A', lastName: 'Admin', email: 'admin@test.com' },
      null, // invitee not yet a user
    );
    vi.mocked(prisma.organisation.findUnique).mockResolvedValue({ name: 'Acme' } as any);

    const res = await request(app)
      .post('/api/v1/users/invite')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ email: 'invitee@test.com', role: 'OPERATOR' });

    expect(res.status).toBe(201);
    expect(sendOrganisationInvite).toHaveBeenCalledTimes(1);
    const emailArg = sendOrganisationInvite.mock.calls[0][0];
    expect(emailArg.toEmail).toBe('invitee@test.com');
    expect(emailArg.isNewUser).toBe(true);
    expect(emailArg.organisationName).toBe('Acme');

    // Response must expose the manual share URL + code so the admin can copy
    // when email delivery fails, but NEVER the raw DB token.
    expect(res.body.data.manualShare.actionUrl).toMatch(/\/register\?email=/);
    expect(res.body.data.manualShare.inviteCode).toBe('INV-ABC123');
    expect(res.body.data.emailSent).toBe(true);
    expect(res.body.data.token).toBeUndefined();
  });

  it('targets the pending-invitations page when the invitee is already a user', async () => {
    mockFindUser(
      { firstName: 'A', lastName: 'Admin', email: 'admin@test.com' },
      { id: 'existing-user' },
    );
    vi.mocked(prisma.organisation.findUnique).mockResolvedValue({ name: 'Acme' } as any);

    const res = await request(app)
      .post('/api/v1/users/invite')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ email: 'invitee@test.com', role: 'MANAGER' });

    expect(res.status).toBe(201);
    const emailArg = sendOrganisationInvite.mock.calls[0][0];
    expect(emailArg.isNewUser).toBe(false);
    expect(res.body.data.manualShare.actionUrl).toMatch(/pendingInvitations=1/);
  });

  it('reports emailSent=false when the provider fails, without leaking the DB token', async () => {
    mockFindUser(
      { firstName: 'A', lastName: 'Admin', email: 'admin@test.com' },
      null,
    );
    vi.mocked(prisma.organisation.findUnique).mockResolvedValue({ name: 'Acme' } as any);
    sendOrganisationInvite.mockResolvedValueOnce({ sent: false, error: 'SMTP 554' });

    const res = await request(app)
      .post('/api/v1/users/invite')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ email: 'invitee@test.com', role: 'VIEWER' });

    expect(res.status).toBe(201);
    expect(res.body.data.emailSent).toBe(false);
    expect(res.body.data.emailError).toBe('SMTP 554');
    expect(res.body.data.message).toMatch(/could not be sent/i);
    expect(res.body.data.manualShare.actionUrl).toBeDefined();
    expect(res.body.data.token).toBeUndefined();
  });
});
