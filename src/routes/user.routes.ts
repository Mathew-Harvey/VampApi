import { Router, Request, Response } from 'express';
import { authenticate } from '../middleware/auth';
import { requirePermission } from '../middleware/permissions';
import { validate } from '../middleware/validate';
import { inviteUserSchema, updateUserSchema } from '../schemas/user.schema';
import prisma from '../config/database';
import { randomUUID } from 'crypto';

const router = Router();

router.get('/', authenticate, async (req: Request, res: Response) => {
  try {
    const users = await prisma.organisationUser.findMany({
      where: { organisationId: req.user!.organisationId },
      include: { user: { select: { id: true, email: true, firstName: true, lastName: true, phone: true, isActive: true, lastLoginAt: true, createdAt: true } } },
    });
    res.json({ success: true, data: users.map((ou) => ({ ...ou.user, role: ou.role, permissions: ou.permissions })) });
  } catch (error: any) {
    res.status(500).json({ success: false, error: { code: 'ERROR', message: error.message } });
  }
});

router.post('/invite', authenticate, requirePermission('USER_INVITE'), validate(inviteUserSchema), async (req: Request, res: Response) => {
  try {
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
  } catch (error: any) {
    res.status(500).json({ success: false, error: { code: 'ERROR', message: error.message } });
  }
});

router.put('/:id', authenticate, requirePermission('USER_MANAGE'), validate(updateUserSchema), async (req: Request, res: Response) => {
  try {
    const user = await prisma.user.update({ where: { id: (req.params.id as string) }, data: req.body });
    const { passwordHash, ...safe } = user;
    res.json({ success: true, data: safe });
  } catch (error: any) {
    res.status(500).json({ success: false, error: { code: 'ERROR', message: error.message } });
  }
});

router.patch('/:id/role', authenticate, requirePermission('USER_MANAGE'), async (req: Request, res: Response) => {
  try {
    const updated = await prisma.organisationUser.update({
      where: { userId_organisationId: { userId: (req.params.id as string), organisationId: req.user!.organisationId } },
      data: { role: req.body.role, permissions: req.body.permissions },
    });
    res.json({ success: true, data: updated });
  } catch (error: any) {
    res.status(500).json({ success: false, error: { code: 'ERROR', message: error.message } });
  }
});

export default router;
