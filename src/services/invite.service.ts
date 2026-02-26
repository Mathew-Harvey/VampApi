import prisma from '../config/database';
import { AppError } from '../middleware/error';
import { auditService } from './audit.service';
import { notificationService } from './notification.service';
import { emailService } from './email.service';
import { randomUUID } from 'crypto';

export type CollaboratorPermission = 'READ' | 'WRITE' | 'ADMIN';

export const inviteService = {
  async inviteToWorkOrder(
    workOrderId: string,
    email: string,
    permission: CollaboratorPermission,
    invitedByUserId: string,
  ) {
    const wo = await prisma.workOrder.findFirst({
      where: { id: workOrderId, isDeleted: false },
      include: { vessel: { select: { name: true } }, organisation: { select: { name: true } } },
    });
    if (!wo) throw new AppError(404, 'NOT_FOUND', 'Work order not found');

    // Get inviter name
    const inviter = await prisma.user.findUnique({ where: { id: invitedByUserId } });
    const inviterName = inviter ? `${inviter.firstName} ${inviter.lastName}` : 'A team member';

    const roleMap: Record<CollaboratorPermission, string> = { READ: 'OBSERVER', WRITE: 'TEAM_MEMBER', ADMIN: 'LEAD' };
    const assignmentRole = roleMap[permission];

    let user = await prisma.user.findUnique({ where: { email } });

    if (user) {
      // Check if already assigned
      const existing = await prisma.workOrderAssignment.findFirst({ where: { workOrderId, userId: user.id } });
      if (existing) {
        if (existing.role !== assignmentRole) {
          await prisma.workOrderAssignment.update({ where: { id: existing.id }, data: { role: assignmentRole } });
        }
        // Still send email for updated role
        await emailService.sendWorkOrderInvite({
          toEmail: email,
          inviterName,
          workOrderRef: wo.referenceNumber,
          workOrderTitle: wo.title,
          vesselName: wo.vessel.name,
          permission,
          isNewUser: false,
        });
        return { status: 'updated', user: { id: user.id, email: user.email, firstName: user.firstName, lastName: user.lastName }, role: assignmentRole };
      }

      // Assign user
      await prisma.workOrderAssignment.create({ data: { workOrderId, userId: user.id, role: assignmentRole } });

      // In-app notification
      await notificationService.create(
        user.id, 'WORK_ORDER_ASSIGNED',
        `Invited to ${wo.referenceNumber}`,
        `${inviterName} invited you to "${wo.title}" as ${permission.toLowerCase()}`,
        'WorkOrder', workOrderId,
      );

      // Send branded email
      const emailResult = await emailService.sendWorkOrderInvite({
        toEmail: email,
        inviterName,
        workOrderRef: wo.referenceNumber,
        workOrderTitle: wo.title,
        vesselName: wo.vessel.name,
        permission,
        isNewUser: false,
      });

      await auditService.log({
        actorId: invitedByUserId, entityType: 'WorkOrder', entityId: workOrderId,
        action: 'ASSIGNMENT', description: `Invited ${email} to ${wo.referenceNumber} as ${permission}`,
      });

      return {
        status: 'assigned',
        user: { id: user.id, email: user.email, firstName: user.firstName, lastName: user.lastName },
        role: assignmentRole,
        emailSent: emailResult.sent,
        emailError: emailResult.error,
      };
    } else {
      // User doesn't exist - create invitation
      await prisma.invitation.create({
        data: {
          email,
          organisationId: wo.organisationId,
          role: permission === 'ADMIN' ? 'MANAGER' : permission === 'WRITE' ? 'OPERATOR' : 'VIEWER',
          workOrderId,
          assignmentRole,
          token: randomUUID(),
          expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        },
      });

      // Send branded email to new user
      const emailResult = await emailService.sendWorkOrderInvite({
        toEmail: email,
        inviterName,
        workOrderRef: wo.referenceNumber,
        workOrderTitle: wo.title,
        vesselName: wo.vessel.name,
        permission,
        isNewUser: true,
      });

      await auditService.log({
        actorId: invitedByUserId, entityType: 'WorkOrder', entityId: workOrderId,
        action: 'ASSIGNMENT', description: `Sent invitation to ${email} for ${wo.referenceNumber}${emailResult.sent ? '' : ' (email failed)'}`,
      });

      return {
        status: 'invited',
        email,
        role: assignmentRole,
        emailSent: emailResult.sent,
        emailError: emailResult.error,
        message: emailResult.sent
          ? 'Invitation email sent successfully.'
          : `Invitation created but email could not be sent: ${emailResult.error}`,
      };
    }
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
