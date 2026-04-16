import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { requirePermission, requireRole } from '../middleware/permissions';
import { generateAccessToken, generateRefreshToken, TokenPayload } from '../config/auth';
import { ROLE_DEFAULT_PERMISSIONS } from '../constants/permissions';
import prisma from '../config/database';
import { asyncHandler } from '../utils/async-handler';

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
  const memberships = await prisma.organisationUser.findMany({
    where: { userId: req.user!.userId, organisation: { isDeleted: false } },
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
  if (!membership || membership.organisation.isDeleted) {
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

router.delete('/:id', authenticate, requireRole('ORGANISATION_ADMIN', 'ECOSYSTEM_ADMIN'), asyncHandler(async (req, res) => {
  const orgId = req.params.id as string;

  if (orgId !== req.user!.organisationId) {
    res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'You can only delete your current organisation' } });
    return;
  }

  const org = await prisma.organisation.findUnique({ where: { id: orgId } });
  if (!org || org.isDeleted) {
    res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Organisation not found' } });
    return;
  }

  await prisma.$transaction([
    prisma.organisation.update({ where: { id: orgId }, data: { isDeleted: true } }),
    prisma.organisationUser.deleteMany({ where: { organisationId: orgId } }),
    prisma.invitation.deleteMany({ where: { organisationId: orgId, acceptedAt: null } }),
  ]);

  const remainingMemberships = await prisma.organisationUser.findMany({
    where: { userId: req.user!.userId },
    include: { organisation: true },
  });
  const activeMembership = remainingMemberships.find((m) => !m.organisation.isDeleted);

  if (activeMembership) {
    const permissions = resolvePermissions(activeMembership.role, activeMembership.permissions);
    const tokenPayload: TokenPayload = {
      userId: req.user!.userId,
      email: req.user!.email,
      organisationId: activeMembership.organisationId,
      role: activeMembership.role,
      permissions,
    };
    res.json({
      success: true,
      data: {
        message: `Organisation "${org.name}" has been deleted`,
        action: 'switch',
        accessToken: generateAccessToken(tokenPayload),
        refreshToken: generateRefreshToken(req.user!.userId),
        organisation: {
          id: activeMembership.organisation.id,
          name: activeMembership.organisation.name,
          type: activeMembership.organisation.type,
        },
      },
    });
  } else {
    res.json({
      success: true,
      data: {
        message: `Organisation "${org.name}" has been deleted`,
        action: 'logout',
      },
    });
  }
}));

router.post('/', authenticate, requirePermission('ADMIN_FULL_ACCESS'), asyncHandler(async (req, res) => {
  const org = await prisma.organisation.create({ data: req.body });
  res.status(201).json({ success: true, data: org });
}));

export default router;
