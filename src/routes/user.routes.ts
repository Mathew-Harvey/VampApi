import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { requirePermission } from '../middleware/permissions';
import { validate } from '../middleware/validate';
import { inviteUserSchema, updateUserSchema } from '../schemas/user.schema';
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
  res.status(201).json({ success: true, data: invitation });
}));

router.put('/:id', authenticate, requirePermission('USER_MANAGE'), validate(updateUserSchema), asyncHandler(async (req, res) => {
  const user = await prisma.user.update({ where: { id: (req.params.id as string) }, data: req.body });
  const { passwordHash, ...safe } = user;
  res.json({ success: true, data: safe });
}));

router.patch('/:id/role', authenticate, requirePermission('USER_MANAGE'), asyncHandler(async (req, res) => {
  const updated = await prisma.organisationUser.update({
    where: { userId_organisationId: { userId: (req.params.id as string), organisationId: req.user!.organisationId } },
    data: { role: req.body.role, permissions: req.body.permissions },
  });
  res.json({ success: true, data: updated });
}));

export default router;
