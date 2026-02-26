import prisma from '../config/database';
import { env } from '../config/env';
import { AppError } from '../middleware/error';
import { auditService } from './audit.service';
import { notificationService } from './notification.service';
import { emailService } from './email.service';
import { randomUUID } from 'crypto';

export type CollaboratorPermission = 'READ' | 'WRITE' | 'ADMIN';

function buildManualShare(invitation: { id: string; token: string }) {
  const inviteCode = invitation.id.toUpperCase();
  const inviteUrl = `${env.APP_URL}/join-work-order?inviteToken=${encodeURIComponent(invitation.token)}`;
  const qrCodeUrl = `https://api.qrserver.com/v1/create-qr-code/?size=280x280&data=${encodeURIComponent(inviteUrl)}`;
  return { inviteCode, inviteUrl, qrCodeUrl };
}

async function getWorkOrderSummary(workOrderId: string) {
  return prisma.workOrder.findUnique({
    where: { id: workOrderId },
    select: {
      id: true,
      referenceNumber: true,
      title: true,
      vessel: { select: { name: true } },
    },
  });
}

export const inviteService = {
  async inviteToWorkOrder(
    workOrderId: string,
    email: string,
    permission: CollaboratorPermission,
    invitedByUserId: string,
  ) {
    const emailLower = email.trim().toLowerCase();
    const wo = await prisma.workOrder.findFirst({
      where: { id: workOrderId, isDeleted: false },
      include: { vessel: { select: { name: true } }, organisation: { select: { name: true } } },
    });
    if (!wo) throw new AppError(404, 'NOT_FOUND', 'Work order not found');

    const inviter = await prisma.user.findUnique({ where: { id: invitedByUserId } });
    const inviterName = inviter ? `${inviter.firstName} ${inviter.lastName}` : 'A team member';

    const roleMap: Record<CollaboratorPermission, string> = { READ: 'OBSERVER', WRITE: 'TEAM_MEMBER', ADMIN: 'LEAD' };
    const assignmentRole = roleMap[permission];
    const invitationRole = permission === 'ADMIN' ? 'MANAGER' : permission === 'WRITE' ? 'OPERATOR' : 'VIEWER';

    const invitation = await prisma.invitation.create({
      data: {
        email: emailLower,
        organisationId: wo.organisationId,
        role: invitationRole,
        workOrderId,
        assignmentRole,
        token: randomUUID(),
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
    });
    const manualShare = buildManualShare(invitation);

    const user = await prisma.user.findUnique({ where: { email: emailLower } });

    if (user) {
      const existing = await prisma.workOrderAssignment.findFirst({ where: { workOrderId, userId: user.id } });
      if (existing) {
        if (existing.role !== assignmentRole) {
          await prisma.workOrderAssignment.update({ where: { id: existing.id }, data: { role: assignmentRole } });
        }
        const emailResult = await emailService.sendWorkOrderInvite({
          toEmail: emailLower,
          inviterName,
          workOrderRef: wo.referenceNumber,
          workOrderTitle: wo.title,
          vesselName: wo.vessel.name,
          permission,
          isNewUser: false,
          actionUrl: manualShare.inviteUrl,
          actionLabel: 'Open Invitation',
          inviteCode: manualShare.inviteCode,
        });
        return {
          status: 'updated',
          user: { id: user.id, email: user.email, firstName: user.firstName, lastName: user.lastName },
          role: assignmentRole,
          emailSent: emailResult.sent,
          emailError: emailResult.error,
          manualShare,
        };
      }

      await prisma.workOrderAssignment.create({ data: { workOrderId, userId: user.id, role: assignmentRole } });

      await notificationService.create(
        user.id, 'WORK_ORDER_ASSIGNED',
        `Invited to ${wo.referenceNumber}`,
        `${inviterName} invited you to "${wo.title}" as ${permission.toLowerCase()}`,
        'WorkOrder', workOrderId,
      );

      const emailResult = await emailService.sendWorkOrderInvite({
        toEmail: emailLower,
        inviterName,
        workOrderRef: wo.referenceNumber,
        workOrderTitle: wo.title,
        vesselName: wo.vessel.name,
        permission,
        isNewUser: false,
        actionUrl: manualShare.inviteUrl,
        actionLabel: 'Open Invitation',
        inviteCode: manualShare.inviteCode,
      });

      await auditService.log({
        actorId: invitedByUserId, entityType: 'WorkOrder', entityId: workOrderId,
        action: 'ASSIGNMENT', description: `Invited ${emailLower} to ${wo.referenceNumber} as ${permission}`,
      });

      return {
        status: 'assigned',
        user: { id: user.id, email: user.email, firstName: user.firstName, lastName: user.lastName },
        role: assignmentRole,
        emailSent: emailResult.sent,
        emailError: emailResult.error,
        manualShare,
      };
    }

    const emailResult = await emailService.sendWorkOrderInvite({
      toEmail: emailLower,
      inviterName,
      workOrderRef: wo.referenceNumber,
      workOrderTitle: wo.title,
      vesselName: wo.vessel.name,
      permission,
      isNewUser: true,
      actionUrl: manualShare.inviteUrl,
      actionLabel: 'Open Invitation',
      inviteCode: manualShare.inviteCode,
    });

    await auditService.log({
      actorId: invitedByUserId, entityType: 'WorkOrder', entityId: workOrderId,
      action: 'ASSIGNMENT', description: `Sent invitation to ${emailLower} for ${wo.referenceNumber}${emailResult.sent ? '' : ' (email failed)'}`,
    });

    return {
      status: 'invited',
      email: emailLower,
      role: assignmentRole,
      emailSent: emailResult.sent,
      emailError: emailResult.error,
      manualShare,
      message: emailResult.sent
        ? 'Invitation email sent successfully.'
        : `Invitation created but email could not be sent: ${emailResult.error}`,
    };
  },

  async getWorkOrderInvitationDetails(token: string) {
    const invitation = await prisma.invitation.findUnique({
      where: { token },
    });

    if (!invitation || !invitation.workOrderId || !invitation.assignmentRole) {
      throw new AppError(404, 'NOT_FOUND', 'Invitation not found');
    }
    if (invitation.expiresAt < new Date()) {
      throw new AppError(410, 'INVITATION_EXPIRED', 'Invitation has expired');
    }

    const workOrder = await getWorkOrderSummary(invitation.workOrderId);

    return {
      invitationId: invitation.id,
      email: invitation.email,
      assignmentRole: invitation.assignmentRole,
      expiresAt: invitation.expiresAt,
      acceptedAt: invitation.acceptedAt,
      manualShare: buildManualShare(invitation),
      workOrder,
    };
  },

  async redeemWorkOrderInvitation(params: { userId: string; token?: string; code?: string }) {
    const token = params.token?.trim();
    const code = params.code?.trim();
    if (!token && !code) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Provide token or code');
    }

    const invitation = await prisma.invitation.findFirst({
      where: token ? { token } : { id: code!.toLowerCase() },
    });

    if (!invitation || !invitation.workOrderId || !invitation.assignmentRole) {
      throw new AppError(404, 'NOT_FOUND', 'Invitation not found');
    }
    if (invitation.expiresAt < new Date()) {
      throw new AppError(410, 'INVITATION_EXPIRED', 'Invitation has expired');
    }

    const user = await prisma.user.findUnique({ where: { id: params.userId } });
    if (!user) throw new AppError(404, 'NOT_FOUND', 'User not found');
    if (user.email.toLowerCase() !== invitation.email.toLowerCase()) {
      throw new AppError(403, 'FORBIDDEN', 'Sign in with the invited email address to join this work order');
    }

    await prisma.workOrderAssignment.upsert({
      where: { workOrderId_userId: { workOrderId: invitation.workOrderId, userId: params.userId } },
      update: { role: invitation.assignmentRole },
      create: {
        workOrderId: invitation.workOrderId,
        userId: params.userId,
        role: invitation.assignmentRole,
      },
    });

    if (!invitation.acceptedAt) {
      await prisma.invitation.update({
        where: { id: invitation.id },
        data: { acceptedAt: new Date() },
      });
    }

    const workOrder = await getWorkOrderSummary(invitation.workOrderId);

    await auditService.log({
      actorId: params.userId,
      entityType: 'WorkOrder',
      entityId: invitation.workOrderId,
      action: 'ASSIGNMENT',
      description: `Accepted invitation for ${workOrder?.referenceNumber || invitation.workOrderId}`,
    });

    return {
      status: invitation.acceptedAt ? 'already_joined' : 'joined',
      assignmentRole: invitation.assignmentRole,
      workOrder,
    };
  },

  async changePermission(workOrderId: string, userId: string, permission: CollaboratorPermission, changedByUserId: string) {
    const roleMap: Record<CollaboratorPermission, string> = { READ: 'OBSERVER', WRITE: 'TEAM_MEMBER', ADMIN: 'LEAD' };
    const assignment = await prisma.workOrderAssignment.findFirst({ where: { workOrderId, userId } });
    if (!assignment) throw new AppError(404, 'NOT_FOUND', 'User is not assigned to this work order');

    await prisma.workOrderAssignment.update({ where: { id: assignment.id }, data: { role: roleMap[permission] } });

    await auditService.log({
      actorId: changedByUserId, entityType: 'WorkOrder', entityId: workOrderId,
      action: 'PERMISSION_CHANGE', description: `Changed ${userId} permission to ${permission}`,
    });

    return { userId, role: roleMap[permission] };
  },

  async removeFromWorkOrder(workOrderId: string, userId: string, removedByUserId: string) {
    await prisma.workOrderAssignment.deleteMany({ where: { workOrderId, userId } });

    await auditService.log({
      actorId: removedByUserId, entityType: 'WorkOrder', entityId: workOrderId,
      action: 'ASSIGNMENT', description: `Removed ${userId} from work order`,
    });
  },
};
