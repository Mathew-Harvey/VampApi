import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { requirePermission } from '../middleware/permissions';
import prisma from '../config/database';
import { asyncHandler } from '../utils/async-handler';

const router = Router();

router.get('/', authenticate, asyncHandler(async (_req, res) => {
  const orgs = await prisma.organisation.findMany({ orderBy: { name: 'asc' } });
  res.json({ success: true, data: orgs });
}));

router.post('/', authenticate, requirePermission('ADMIN_FULL_ACCESS'), asyncHandler(async (req, res) => {
  const org = await prisma.organisation.create({ data: req.body });
  res.status(201).json({ success: true, data: org });
}));

export default router;
