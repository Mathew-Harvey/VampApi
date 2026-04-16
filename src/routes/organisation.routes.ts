import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { requirePermission, requireRole } from '../middleware/permissions';
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

router.get('/:id', authenticate, asyncHandler(async (req, res) => {
  const membership = await prisma.organisationUser.findUnique({
    where: { userId_organisationId: { userId: req.user!.userId, organisationId: req.params.id as string } },
    include: {
      organisation: {
        include: { _count: { select: { users: true, vessels: true, workOrders: true } } },
      },
    },
  });
  if (!membership) {
    res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Organisation not found' } });
    return;
  }
  res.json({ success: true, data: { ...membership.organisation, role: membership.role } });
}));

const ORG_UPDATE_ALLOWLIST = new Set(['name', 'type', 'contactEmail', 'contactPhone', 'address', 'abn', 'logoUrl']);

router.put('/:id', authenticate, requireRole('ORGANISATION_ADMIN', 'ECOSYSTEM_ADMIN'), asyncHandler(async (req, res) => {
  const orgId = req.params.id as string;

  if (orgId !== req.user!.organisationId) {
    res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'You can only update your current organisation' } });
    return;
  }

  const payload: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(req.body)) {
    if (ORG_UPDATE_ALLOWLIST.has(key)) payload[key] = value;
  }

  if (Object.keys(payload).length === 0) {
    res.status(400).json({ success: false, error: { code: 'NO_FIELDS', message: 'No valid fields to update' } });
    return;
  }

  const org = await prisma.organisation.update({ where: { id: orgId }, data: payload });
  res.json({ success: true, data: org });
}));

router.post('/', authenticate, requirePermission('ADMIN_FULL_ACCESS'), asyncHandler(async (req, res) => {
  const org = await prisma.organisation.create({ data: req.body });
  res.status(201).json({ success: true, data: org });
}));

export default router;
