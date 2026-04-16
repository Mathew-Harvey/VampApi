import prisma from '../config/database';
import { env } from '../config/env';
import { AppError } from '../middleware/error';
import { auditService } from './audit.service';
import { notificationService } from './notification.service';
import { emailService } from './email.service';

export type VesselSharePermission = 'READ' | 'WRITE';

const fleetOrgId = () => process.env.FLEET_ORG_ID || '';

async function assertVesselOwnership(vesselId: string, organisationId: string) {
  const vessel = await prisma.vessel.findFirst({
    where: { id: vesselId, isDeleted: false },
  });
  if (!vessel) throw new AppError(404, 'NOT_FOUND', 'Vessel not found');
  if (vessel.organisationId !== organisationId && vessel.organisationId !== fleetOrgId()) {
    throw new AppError(404, 'NOT_FOUND', 'Vessel not found');
  }
  return vessel;
}

export const vesselShareService = {
  async shareVessel(
    vesselId: string,
    email: string,
    permission: VesselSharePermission,
    sharedByUserId: string,
    organisationId: string,
  ) {
    const vessel = await assertVesselOwnership(vesselId, organisationId);
    const emailLower = email.trim().toLowerCase();

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailLower)) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Please enter a valid email address');
    }

    const sharer = await prisma.user.findUnique({ where: { id: sharedByUserId } });
    if (sharer && sharer.email.toLowerCase() === emailLower) {
      throw new AppError(400, 'VALIDATION_ERROR', 'You cannot share a vessel with yourself');
    }
    const sharerName = sharer ? `${sharer.firstName} ${sharer.lastName}` : 'A team member';

    const user = await prisma.user.findUnique({ where: { email: emailLower } });

    if (user) {
      const existing = await prisma.vesselShare.findUnique({
        where: { vesselId_userId: { vesselId, userId: user.id } },
      });

      if (existing) {
        if (existing.permission === permission) {
          return { status: 'already_shared', permission, user: { id: user.id, email: user.email, firstName: user.firstName, lastName: user.lastName } };
        }
        await prisma.vesselShare.update({
          where: { id: existing.id },
          data: { permission },
        });

        await auditService.log({
          actorId: sharedByUserId, entityType: 'Vessel', entityId: vesselId,
          action: 'SHARE_UPDATE', description: `Updated ${emailLower} vessel share to ${permission} on "${vessel.name}"`,
        });

        return { status: 'updated', permission, user: { id: user.id, email: user.email, firstName: user.firstName, lastName: user.lastName } };
      }

      await prisma.vesselShare.create({
        data: { vesselId, userId: user.id, permission, sharedBy: sharedByUserId },
      });

      await notificationService.create(
        user.id, 'VESSEL_SHARED',
        `Vessel shared with you`,
        `${sharerName} shared "${vessel.name}" with you (${permission === 'WRITE' ? 'can edit' : 'view only'})`,
        'Vessel', vesselId,
      );

      const emailResult = await emailService.sendVesselShareInvite({
        toEmail: emailLower,
        sharerName,
        vesselName: vessel.name,
        permission,
        isNewUser: false,
        actionUrl: `${env.APP_URL}/vessels/${vesselId}`,
      });

      await auditService.log({
        actorId: sharedByUserId, entityType: 'Vessel', entityId: vesselId,
        action: 'SHARE', description: `Shared vessel "${vessel.name}" with ${emailLower} as ${permission}`,
      });

      return {
        status: 'shared',
        permission,
        user: { id: user.id, email: user.email, firstName: user.firstName, lastName: user.lastName },
        emailSent: emailResult.sent,
        emailError: emailResult.error,
      };
    }

    // User doesn't exist yet — send invite email
    const emailResult = await emailService.sendVesselShareInvite({
      toEmail: emailLower,
      sharerName,
      vesselName: vessel.name,
      permission,
      isNewUser: true,
      actionUrl: `${env.APP_URL}/register`,
    });

    await auditService.log({
      actorId: sharedByUserId, entityType: 'Vessel', entityId: vesselId,
      action: 'SHARE', description: `Sent vessel share invite to ${emailLower} for "${vessel.name}" (user not registered)`,
    });

    return {
      status: 'invited',
      email: emailLower,
      permission,
      emailSent: emailResult.sent,
      emailError: emailResult.error,
      message: emailResult.sent
        ? 'Invitation email sent. The share will be activated when they create an account.'
        : `Invitation email could not be sent: ${emailResult.error}`,
    };
  },

  async listShares(vesselId: string, organisationId: string) {
    await assertVesselOwnership(vesselId, organisationId);

    return prisma.vesselShare.findMany({
      where: { vesselId },
      include: {
        user: { select: { id: true, email: true, firstName: true, lastName: true } },
        sharer: { select: { id: true, firstName: true, lastName: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  },

  async updatePermission(
    vesselId: string,
    targetUserId: string,
    permission: VesselSharePermission,
    changedByUserId: string,
    organisationId: string,
  ) {
    await assertVesselOwnership(vesselId, organisationId);

    const share = await prisma.vesselShare.findUnique({
      where: { vesselId_userId: { vesselId, userId: targetUserId } },
    });
    if (!share) throw new AppError(404, 'NOT_FOUND', 'Share not found');

    await prisma.vesselShare.update({ where: { id: share.id }, data: { permission } });

    await auditService.log({
      actorId: changedByUserId, entityType: 'Vessel', entityId: vesselId,
      action: 'SHARE_UPDATE', description: `Changed ${targetUserId} vessel share permission to ${permission}`,
    });

    return { userId: targetUserId, permission };
  },

  async revokeShare(
    vesselId: string,
    targetUserId: string,
    revokedByUserId: string,
    organisationId: string,
  ) {
    await assertVesselOwnership(vesselId, organisationId);

    const share = await prisma.vesselShare.findUnique({
      where: { vesselId_userId: { vesselId, userId: targetUserId } },
    });
    if (!share) throw new AppError(404, 'NOT_FOUND', 'Share not found');

    await prisma.vesselShare.delete({ where: { id: share.id } });

    await auditService.log({
      actorId: revokedByUserId, entityType: 'Vessel', entityId: vesselId,
      action: 'SHARE_REVOKE', description: `Revoked vessel share for ${targetUserId}`,
    });
  },

  async getSharePermission(vesselId: string, userId: string): Promise<VesselSharePermission | null> {
    const share = await prisma.vesselShare.findUnique({
      where: { vesselId_userId: { vesselId, userId } },
    });
    return share ? (share.permission as VesselSharePermission) : null;
  },

  async getSharedVesselIds(userId: string): Promise<string[]> {
    const shares = await prisma.vesselShare.findMany({
      where: { userId },
      select: { vesselId: true },
    });
    return shares.map((s) => s.vesselId);
  },
};
