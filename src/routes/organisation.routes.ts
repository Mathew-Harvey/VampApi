import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { requirePermission } from '../middleware/permissions';
import prisma from '../config/database';
import { asyncHandler } from '../utils/async-handler';

const router = Router();

router.get('/', authenticate, asyncHandler(async (req, res) => {
  const memberships = await prisma.organisationUser.findMany({
    where: { userId: req.user!.userId },
    include: { organisation: true },
  });
  const orgs = memberships
    .map((m) => ({ ...m.organisation, role: m.role }))
    .sort((a, b) => a.name.localeCompare(b.name));
  res.json({ success: true, data: orgs });
}));

router.post('/', authenticate, requirePermission('ADMIN_FULL_ACCESS'), asyncHandler(async (req, res) => {
  const org = await prisma.organisation.create({ data: req.body });
  res.status(201).json({ success: true, data: org });
}));

export default router;
