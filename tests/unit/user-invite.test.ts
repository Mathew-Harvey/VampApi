import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';

// `vi.mock` factories are hoisted above the top-level `const` declarations,
// so any variables we want to reference inside them must be declared via
// `vi.hoisted` so they share the same hoist phase.
const hoistedEmailMocks = vi.hoisted(() => ({
  sendOrganisationInvite: vi.fn(),
  sendWorkOrderInvite: vi.fn(),
  sendVesselShareInvite: vi.fn(),
  sendPasswordReset: vi.fn(),
}));

vi.mock('../../src/config/database', () => {
  const mockPrisma: any = {
    $connect: vi.fn().mockResolvedValue(undefined),
    $disconnect: vi.fn().mockResolvedValue(undefined),
    $queryRaw: vi.fn().mockResolvedValue([{ 1: 1 }]),
    $transaction: vi.fn(async (fn: any) => (typeof fn === 'function' ? fn(mockPrisma) : fn)),
    user: { findUnique: vi.fn(), count: vi.fn().mockResolvedValue(0) },
    organisation: { findUnique: vi.fn() },
    organisationUser: { findMany: vi.fn().mockResolvedValue([]), findUnique: vi.fn() },
    invitation: {
      create: vi.fn().mockResolvedValue({
        id: 'inv-abc123',
        token: 'secret-token-value',
        email: 'invitee@test.com',
        organisationId: 'org-1',
        role: 'OPERATOR',
        workOrderId: null,
        assignmentRole: null,
        acceptedAt: null,
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 1e7),
      }),
      findFirst: vi.fn(),
      findMany: vi.fn().mockResolvedValue([]),
      update: vi.fn(),
      delete: vi.fn(),
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

vi.mock('../../src/services/email.service', () => ({
  emailService: hoistedEmailMocks,
}));

import { generateAccessToken } from '../../src/config/auth';
import app from '../../src/app';
import prisma from '../../src/config/database';

const adminToken = generateAccessToken({
  userId: 'inviter',
  email: 'admin@test.com',
  organisationId: 'org-1',
  role: 'ORGANISATION_ADMIN',
  permissions: ['USER_INVITE', 'USER_MANAGE'],
});

const viewerToken = generateAccessToken({
  userId: 'viewer',
  email: 'viewer@test.com',
  organisationId: 'org-1',
  role: 'VIEWER',
  permissions: ['VESSEL_VIEW'],
});

describe('POST /api/v1/users/invite', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoistedEmailMocks.sendOrganisationInvite.mockResolvedValue({ sent: true, id: 'msg-1' });
    hoistedEmailMocks.sendWorkOrderInvite.mockResolvedValue({ sent: true });
    hoistedEmailMocks.sendVesselShareInvite.mockResolvedValue({ sent: true });
    hoistedEmailMocks.sendPasswordReset.mockResolvedValue({ sent: true });
  });

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
    expect(hoistedEmailMocks.sendOrganisationInvite).toHaveBeenCalledTimes(1);
    const emailArg = hoistedEmailMocks.sendOrganisationInvite.mock.calls[0][0];
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
    const emailArg = hoistedEmailMocks.sendOrganisationInvite.mock.calls[0][0];
    expect(emailArg.isNewUser).toBe(false);
    expect(res.body.data.manualShare.actionUrl).toMatch(/pendingInvitations=1/);
  });

  it('reports emailSent=false when the provider fails, without leaking the DB token', async () => {
    mockFindUser(
      { firstName: 'A', lastName: 'Admin', email: 'admin@test.com' },
      null,
    );
    vi.mocked(prisma.organisation.findUnique).mockResolvedValue({ name: 'Acme' } as any);
    hoistedEmailMocks.sendOrganisationInvite.mockResolvedValueOnce({ sent: false, error: 'SMTP 554' });

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

describe('GET /api/v1/users/invitations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 without auth', async () => {
    const res = await request(app).get('/api/v1/users/invitations');
    expect(res.status).toBe(401);
  });

  it('returns 403 for users without USER_INVITE permission', async () => {
    const res = await request(app)
      .get('/api/v1/users/invitations')
      .set('Authorization', `Bearer ${viewerToken}`);
    expect(res.status).toBe(403);
  });

  it('lists pending invitations for the current organisation', async () => {
    const now = new Date();
    vi.mocked(prisma.invitation.findMany).mockResolvedValue([
      {
        id: 'inv-1',
        token: 'do-not-leak',
        email: 'pending@test.com',
        role: 'OPERATOR',
        organisationId: 'org-1',
        workOrderId: null,
        assignmentRole: null,
        acceptedAt: null,
        createdAt: now,
        expiresAt: new Date(now.getTime() + 1e7),
      } as any,
    ]);

    const res = await request(app)
      .get('/api/v1/users/invitations')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].email).toBe('pending@test.com');
    // The uppercased invitation id is what the frontend shows as a manual code.
    expect(res.body.data[0].inviteCode).toBe('INV-1');
    // The raw token must never be exposed.
    expect(res.body.data[0].token).toBeUndefined();

    // The query must be scoped to the caller's org and filter out accepted /
    // expired / work-order-scoped invites.
    const args = vi.mocked(prisma.invitation.findMany).mock.calls[0][0] as any;
    expect(args.where.organisationId).toBe('org-1');
    expect(args.where.acceptedAt).toBeNull();
    expect(args.where.workOrderId).toBeNull();
    expect(args.where.expiresAt.gt).toBeInstanceOf(Date);
  });
});

describe('DELETE /api/v1/users/invitations/:id', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('revokes an invitation belonging to the current organisation', async () => {
    vi.mocked(prisma.invitation.findFirst).mockResolvedValue({
      id: 'inv-revoke',
      organisationId: 'org-1',
      acceptedAt: null,
      workOrderId: null,
    } as any);
    vi.mocked(prisma.invitation.delete).mockResolvedValue({ id: 'inv-revoke' } as any);

    const res = await request(app)
      .delete('/api/v1/users/invitations/inv-revoke')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.message).toMatch(/revoked/i);
    expect(prisma.invitation.delete).toHaveBeenCalledWith({ where: { id: 'inv-revoke' } });
  });

  it('returns 404 when the invitation is not for the current organisation', async () => {
    vi.mocked(prisma.invitation.findFirst).mockResolvedValue(null);

    const res = await request(app)
      .delete('/api/v1/users/invitations/inv-other')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(404);
    expect(prisma.invitation.delete).not.toHaveBeenCalled();
  });
});
