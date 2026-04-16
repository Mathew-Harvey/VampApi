import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { requirePermission } from '../middleware/permissions';
import { validate } from '../middleware/validate';
import { inviteUserSchema, updateUserSchema, updateRoleSchema } from '../schemas/user.schema';
import { ROLE_DEFAULT_PERMISSIONS, type UserRole } from '../constants/permissions';
import prisma from '../config/database';
import { randomUUID } from 'crypto';
import { asyncHandler } from '../utils/async-handler';

const router = Router();

router.get('/', authenticate, asyncHandler(async (req, res) => {
  const users = await prisma.organisationUser.findMany({
    where: { organisationId: req.user!.organisationId },
    include: { user: { select: { id: true, email: true, firstName: true, lastName: true, phone: true, isActive: true, lastLoginAt: true, createdAt: true } } },
  });
  res.json({ success: true, data: users.map((ou) => ({ ...ou.user, role: ou.role, permissions: ou.permissions })) });
}));

router.post('/invite', authenticate, requirePermission('USER_INVITE'), validate(inviteUserSchema), asyncHandler(async (req, res) => {
  const invitation = await prisma.invitation.create({
    data: {
      email: req.body.email,
      organisationId: req.user!.organisationId,
      role: req.body.role,
      token: randomUUID(),
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    },
  });
  const { token: _secret, ...safeInvitation } = invitation;
  res.status(201).json({ success: true, data: safeInvitation });
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
