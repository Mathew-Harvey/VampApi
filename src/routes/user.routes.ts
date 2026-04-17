import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { requirePermission } from '../middleware/permissions';
import { validate } from '../middleware/validate';
import { inviteUserSchema, updateUserSchema, updateRoleSchema } from '../schemas/user.schema';
import { ROLE_DEFAULT_PERMISSIONS, type UserRole } from '../constants/permissions';
import { generateAccessToken, generateRefreshToken, TokenPayload } from '../config/auth';
import { env } from '../config/env';
import prisma from '../config/database';
import { randomUUID } from 'crypto';
import { asyncHandler } from '../utils/async-handler';
import { emailService } from '../services/email.service';

function resolvePermissions(role: string, storedPermissions: unknown): string[] {
  const roleDefaults = (ROLE_DEFAULT_PERMISSIONS as Record<string, string[]>)[role];
  if (!roleDefaults) return [];
  if (typeof storedPermissions === 'string') {
    try {
      const parsed = JSON.parse(storedPermissions);
      if (Array.isArray(parsed)) return [...new Set([...roleDefaults, ...parsed])];
    } catch { /* ignore */ }
  }
  if (Array.isArray(storedPermissions)) return [...new Set([...roleDefaults, ...storedPermissions])];
  return roleDefaults;
}

const router = Router();

router.get('/', authenticate, asyncHandler(async (req, res) => {
  const users = await prisma.organisationUser.findMany({
    where: { organisationId: req.user!.organisationId },
    include: { user: { select: { id: true, email: true, firstName: true, lastName: true, phone: true, isActive: true, lastLoginAt: true, createdAt: true } } },
  });
  res.json({ success: true, data: users.map((ou) => ({ ...ou.user, role: ou.role, permissions: ou.permissions })) });
}));

// List pending (not-yet-accepted, not-yet-expired) invitations for the current
// organisation.  Exposed to anyone who can invite users so admins can see what
// they sent and chase up unanswered invites.  Work-order-scoped invitations
// are intentionally excluded — those belong on the relevant work order page.
router.get('/invitations', authenticate, requirePermission('USER_INVITE'), asyncHandler(async (req, res) => {
  const invitations = await prisma.invitation.findMany({
    where: {
      organisationId: req.user!.organisationId,
      acceptedAt: null,
      expiresAt: { gt: new Date() },
      workOrderId: null,
    },
    orderBy: { createdAt: 'desc' },
  });
  res.json({
    success: true,
    // Never surface the raw token — the invite code (== id) is what admins
    // need to share manually.
    data: invitations.map(({ token: _t, ...inv }) => ({
      ...inv,
      inviteCode: inv.id.toUpperCase(),
    })),
  });
}));

// Revoke a pending invitation for the current organisation.
router.delete('/invitations/:id', authenticate, requirePermission('USER_MANAGE'), asyncHandler(async (req, res) => {
  const invitation = await prisma.invitation.findFirst({
    where: {
      id: req.params.id as string,
      organisationId: req.user!.organisationId,
      acceptedAt: null,
      workOrderId: null,
    },
  });
  if (!invitation) {
    res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Invitation not found' } });
    return;
  }

  await prisma.invitation.delete({ where: { id: invitation.id } });
  res.json({ success: true, data: { message: 'Invitation revoked' } });
}));

router.post('/invite', authenticate, requirePermission('USER_INVITE'), validate(inviteUserSchema), asyncHandler(async (req, res) => {
  const emailLower = (req.body.email as string).trim().toLowerCase();
  const invitation = await prisma.invitation.create({
    data: {
      email: emailLower,
      organisationId: req.user!.organisationId,
      role: req.body.role,
      token: randomUUID(),
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    },
  });

  const [inviter, organisation, existingUser] = await Promise.all([
    prisma.user.findUnique({ where: { id: req.user!.userId }, select: { firstName: true, lastName: true, email: true } }),
    prisma.organisation.findUnique({ where: { id: req.user!.organisationId }, select: { name: true } }),
    prisma.user.findUnique({ where: { email: emailLower }, select: { id: true } }),
  ]);

  const inviterName = inviter
    ? `${inviter.firstName} ${inviter.lastName}`.trim() || inviter.email
    : 'A team member';
  const organisationName = organisation?.name ?? 'your organisation';

  // Build the one-click invitation URL.  If the invitee is already a user, we
  // point them at the pending-invitations list; otherwise they register with
  // the pre-filled email and the registration flow will pick up the pending
  // invitation automatically.
  const actionUrl = existingUser
    ? `${env.APP_URL.replace(/\/+$/, '')}/settings?pendingInvitations=1`
    : `${env.APP_URL.replace(/\/+$/, '')}/register?email=${encodeURIComponent(emailLower)}`;

  const emailResult = await emailService.sendOrganisationInvite({
    toEmail: emailLower,
    inviterName,
    organisationName,
    role: req.body.role,
    actionUrl,
    isNewUser: !existingUser,
  });

  const { token: _secret, ...safeInvitation } = invitation;
  res.status(201).json({
    success: true,
    data: {
      ...safeInvitation,
      // Surface the action URL (but NOT the DB token) back to the admin so
      // they can copy-paste it if the email fails to deliver.  The invitation
      // ID acts as a short human-friendly code that the invitee can redeem
      // once logged in.
      manualShare: {
        actionUrl,
        inviteCode: invitation.id.toUpperCase(),
      },
      emailSent: emailResult.sent,
      emailError: emailResult.error,
      message: emailResult.sent
        ? `Invitation email sent to ${emailLower}.`
        : `Invitation created but the email could not be sent: ${emailResult.error ?? 'unknown error'}. Share the link manually.`,
    },
  });
}));

router.get('/invitations/pending', authenticate, asyncHandler(async (req, res) => {
  const invitations = await prisma.invitation.findMany({
    where: {
      email: req.user!.email,
      acceptedAt: null,
      expiresAt: { gt: new Date() },
      workOrderId: null,
    },
    include: { organisation: { select: { id: true, name: true, type: true } } },
    orderBy: { createdAt: 'desc' },
  });
  res.json({ success: true, data: invitations.map(({ token: _t, ...inv }) => inv) });
}));

router.post('/invitations/:id/accept', authenticate, asyncHandler(async (req, res) => {
  const invitation = await prisma.invitation.findFirst({
    where: {
      id: req.params.id as string,
      email: req.user!.email,
      acceptedAt: null,
      expiresAt: { gt: new Date() },
      workOrderId: null,
    },
  });
  if (!invitation) {
    res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Invitation not found or expired' } });
    return;
  }

  const existing = await prisma.organisationUser.findUnique({
    where: { userId_organisationId: { userId: req.user!.userId, organisationId: invitation.organisationId } },
  });
  if (existing) {
    await prisma.invitation.update({ where: { id: invitation.id }, data: { acceptedAt: new Date() } });
    res.json({ success: true, data: { message: 'You are already a member of this organisation' } });
    return;
  }

  const newRole = invitation.role as UserRole;
  const defaultPerms = ROLE_DEFAULT_PERMISSIONS[newRole] || [];

  const [orgUser] = await prisma.$transaction([
    prisma.organisationUser.create({
      data: {
        userId: req.user!.userId,
        organisationId: invitation.organisationId,
        role: newRole,
        permissions: JSON.stringify(defaultPerms),
      },
      include: { organisation: true },
    }),
    prisma.invitation.update({ where: { id: invitation.id }, data: { acceptedAt: new Date() } }),
  ]);

  const permissions = resolvePermissions(newRole, defaultPerms);
  const tokenPayload: TokenPayload = {
    userId: req.user!.userId,
    email: req.user!.email,
    organisationId: orgUser.organisationId,
    role: newRole,
    permissions,
  };

  res.json({
    success: true,
    data: {
      message: 'Invitation accepted',
      accessToken: generateAccessToken(tokenPayload),
      refreshToken: generateRefreshToken(req.user!.userId, orgUser.organisationId),
      organisation: {
        id: orgUser.organisation.id,
        name: orgUser.organisation.name,
        type: orgUser.organisation.type,
      },
    },
  });
}));

router.post('/invitations/:id/decline', authenticate, asyncHandler(async (req, res) => {
  const invitation = await prisma.invitation.findFirst({
    where: {
      id: req.params.id as string,
      email: req.user!.email,
      acceptedAt: null,
      workOrderId: null,
    },
  });
  if (!invitation) {
    res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Invitation not found' } });
    return;
  }

  await prisma.invitation.update({ where: { id: invitation.id }, data: { acceptedAt: new Date() } });
  res.json({ success: true, data: { message: 'Invitation declined' } });
}));

router.put('/:id', authenticate, requirePermission('USER_MANAGE'), validate(updateUserSchema), asyncHandler(async (req, res) => {
  const targetId = req.params.id as string;
  const membership = await prisma.organisationUser.findFirst({
    where: { userId: targetId, organisationId: req.user!.organisationId },
  });
  if (!membership) {
    res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'User not found in your organisation' } });
    return;
  }
  const { passwordHash: _ph, ...allowedFields } = req.body;
  const user = await prisma.user.update({ where: { id: targetId }, data: allowedFields });
  const { passwordHash, ...safe } = user;
  res.json({ success: true, data: safe });
}));

router.patch('/:id/role', authenticate, requirePermission('USER_MANAGE'), validate(updateRoleSchema), asyncHandler(async (req, res) => {
  const targetId = req.params.id as string;

  if (targetId === req.user!.userId) {
    res.status(400).json({ success: false, error: { code: 'SELF_ROLE_CHANGE', message: 'You cannot change your own role' } });
    return;
  }

  const newRole = req.body.role as UserRole;
  const defaultPerms = ROLE_DEFAULT_PERMISSIONS[newRole] || [];

  const updated = await prisma.organisationUser.update({
    where: { userId_organisationId: { userId: targetId, organisationId: req.user!.organisationId } },
    data: { role: newRole, permissions: JSON.stringify(defaultPerms) },
  });
  res.json({ success: true, data: updated });
}));

router.delete('/:id/membership', authenticate, requirePermission('USER_MANAGE'), asyncHandler(async (req, res) => {
  const targetId = req.params.id as string;

  if (targetId === req.user!.userId) {
    res.status(400).json({ success: false, error: { code: 'SELF_REMOVE', message: 'You cannot remove yourself from the organisation' } });
    return;
  }

  const membership = await prisma.organisationUser.findUnique({
    where: { userId_organisationId: { userId: targetId, organisationId: req.user!.organisationId } },
  });
  if (!membership) {
    res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'User not found in your organisation' } });
    return;
  }

  await prisma.organisationUser.delete({
    where: { userId_organisationId: { userId: targetId, organisationId: req.user!.organisationId } },
  });
  res.json({ success: true, data: { message: 'User removed from organisation' } });
}));

export default router;
