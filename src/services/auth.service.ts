import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import prisma from '../config/database';
import { generateAccessToken, generateRefreshToken, verifyRefreshToken, TokenPayload } from '../config/auth';
import { AppError } from '../middleware/error';
import { auditService } from './audit.service';
import { ROLE_DEFAULT_PERMISSIONS } from '../constants/permissions';
import { env } from '../config/env';

const SALT_ROUNDS = 10;

export const authService = {
  async register(data: { email: string; password: string; firstName: string; lastName: string; phone?: string | null }) {
    // Check if email is already taken
    const existing = await prisma.user.findUnique({ where: { email: data.email } });
    if (existing) {
      throw new AppError(409, 'EMAIL_TAKEN', 'An account with this email already exists');
    }

    const passwordHash = await bcrypt.hash(data.password, SALT_ROUNDS);

    // Create user
    const user = await prisma.user.create({
      data: {
        email: data.email,
        passwordHash,
        firstName: data.firstName,
        lastName: data.lastName,
        phone: data.phone ?? null,
      },
    });

    // Check if there's a pending invitation for this email
    const invitation = await prisma.invitation.findFirst({
      where: { email: data.email, acceptedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
      include: { organisation: true },
    });

    const createPersonalOrganisation = async () => {
      const personalOrg = await prisma.organisation.create({
        data: {
          name: `${data.firstName} ${data.lastName}`,
          type: 'VESSEL_OPERATOR',
        },
      });
      return prisma.organisationUser.create({
        data: {
          userId: user.id,
          organisationId: personalOrg.id,
          role: 'ORGANISATION_ADMIN',
          permissions: JSON.stringify(ROLE_DEFAULT_PERMISSIONS.ORGANISATION_ADMIN),
          isDefault: true,
        },
      });
    };

    let orgUser;
    if (invitation) {
      if (invitation.workOrderId) {
        // Work-order collaboration invitation: keep user's own org boundary.
        orgUser = await createPersonalOrganisation();
      } else {
        // Organisation invitation: join the inviting org with invited role.
        const defaultPerms = (ROLE_DEFAULT_PERMISSIONS as any)[invitation.role] || ['VESSEL_VIEW', 'WORK_ORDER_VIEW'];
        orgUser = await prisma.organisationUser.create({
          data: {
            userId: user.id,
            organisationId: invitation.organisationId,
            role: invitation.role,
            permissions: JSON.stringify(defaultPerms),
            isDefault: true,
          },
        });
      }

      await prisma.invitation.update({
        where: { id: invitation.id },
        data: { acceptedAt: new Date() },
      });

      if (invitation.workOrderId && invitation.assignmentRole) {
        await prisma.workOrderAssignment.upsert({
          where: { workOrderId_userId: { workOrderId: invitation.workOrderId, userId: user.id } },
          update: { role: invitation.assignmentRole },
          create: { workOrderId: invitation.workOrderId, userId: user.id, role: invitation.assignmentRole },
        });
      }
    } else {
      // No invitation - create a personal org for the user (self-signup)
      orgUser = await createPersonalOrganisation();
    }

    await auditService.log({
      actorId: user.id,
      actorEmail: user.email,
      entityType: 'User',
      entityId: user.id,
      action: 'CREATE',
      description: `User ${user.email} registered`,
    });

    // Auto-login after registration
    const orgUserWithOrg = await prisma.organisationUser.findUnique({
      where: { id: orgUser.id },
      include: { organisation: true },
    });

    const permissions = typeof orgUser.permissions === 'string'
      ? JSON.parse(orgUser.permissions)
      : orgUser.permissions;

    const tokenPayload: TokenPayload = {
      userId: user.id,
      email: user.email,
      organisationId: orgUser.organisationId,
      role: orgUser.role,
      permissions,
    };

    return {
      accessToken: generateAccessToken(tokenPayload),
      refreshToken: generateRefreshToken(user.id),
      user: {
        id: user.id, email: user.email, firstName: user.firstName,
        lastName: user.lastName, phone: user.phone, avatarUrl: user.avatarUrl,
        isActive: user.isActive, lastLoginAt: user.lastLoginAt,
        createdAt: user.createdAt, updatedAt: user.updatedAt,
      },
      organisation: {
        id: orgUserWithOrg!.organisation.id,
        name: orgUserWithOrg!.organisation.name,
        type: orgUserWithOrg!.organisation.type,
      },
    };
  },

  async login(email: string, password: string, organisationId?: string) {
    const user = await prisma.user.findUnique({
      where: { email },
      include: { organisations: { include: { organisation: true } } },
    });

    if (!user || !user.isActive) {
      throw new AppError(401, 'INVALID_CREDENTIALS', 'Invalid email or password');
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      throw new AppError(401, 'INVALID_CREDENTIALS', 'Invalid email or password');
    }

    // Select organisation
    let orgUser = user.organisations.find((ou) => ou.isDefault);
    if (organisationId) {
      orgUser = user.organisations.find((ou) => ou.organisationId === organisationId);
    }
    if (!orgUser) {
      orgUser = user.organisations[0];
    }
    if (!orgUser) {
      throw new AppError(403, 'NO_ORGANISATION', 'User has no organisation membership');
    }

    const permissions = typeof orgUser.permissions === 'string'
      ? JSON.parse(orgUser.permissions)
      : orgUser.permissions;

    const tokenPayload: TokenPayload = {
      userId: user.id,
      email: user.email,
      organisationId: orgUser.organisationId,
      role: orgUser.role,
      permissions,
    };

    const accessToken = generateAccessToken(tokenPayload);
    const refreshToken = generateRefreshToken(user.id);

    await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });

    await auditService.log({
      actorId: user.id,
      actorEmail: user.email,
      actorOrg: orgUser.organisation.name,
      entityType: 'User',
      entityId: user.id,
      action: 'LOGIN',
      description: `User ${user.email} logged in`,
    });

    return {
      accessToken,
      refreshToken,
      user: {
        id: user.id, email: user.email, firstName: user.firstName,
        lastName: user.lastName, phone: user.phone, avatarUrl: user.avatarUrl,
        isActive: user.isActive, lastLoginAt: user.lastLoginAt,
        createdAt: user.createdAt, updatedAt: user.updatedAt,
      },
      organisation: {
        id: orgUser.organisation.id, name: orgUser.organisation.name,
        type: orgUser.organisation.type,
      },
    };
  },

  async forgotPassword(email: string) {
    const user = await prisma.user.findUnique({ where: { email } });

    // Always return success (don't reveal if email exists)
    if (!user) return { message: 'If an account exists, a reset link has been sent' };

    // Invalidate any existing tokens
    await prisma.passwordReset.updateMany({
      where: { userId: user.id, usedAt: null },
      data: { usedAt: new Date() },
    });

    // Create reset token (valid 1 hour)
    const token = crypto.randomBytes(32).toString('hex');
    await prisma.passwordReset.create({
      data: {
        userId: user.id,
        token,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000), // 1 hour
      },
    });

    // Send branded reset email
    const resetUrl = `${env.APP_URL}/reset-password?token=${token}`;
    const { emailService } = await import('./email.service');
    await emailService.sendPasswordReset({ toEmail: email, resetUrl });
    console.log(`[PASSWORD RESET] Token for ${email}: ${token}`);
    console.log(`[PASSWORD RESET] Reset URL: ${resetUrl}`);

    await auditService.log({
      actorId: user.id,
      actorEmail: user.email,
      entityType: 'User',
      entityId: user.id,
      action: 'UPDATE',
      description: `Password reset requested for ${user.email}`,
    });

    return {
      message: 'If an account exists, a reset link has been sent',
      // Include token in dev/test mode for easy testing
      ...(process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test' ? { token } : {}),
    };
  },

  async resetPassword(token: string, newPassword: string) {
    const resetRecord = await prisma.passwordReset.findUnique({
      where: { token },
      include: { user: true },
    });

    if (!resetRecord) {
      throw new AppError(400, 'INVALID_TOKEN', 'Invalid or expired reset token');
    }

    if (resetRecord.usedAt) {
      throw new AppError(400, 'TOKEN_USED', 'This reset token has already been used');
    }

    if (resetRecord.expiresAt < new Date()) {
      throw new AppError(400, 'TOKEN_EXPIRED', 'This reset token has expired');
    }

    const passwordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);

    // Update password and mark token as used
    await prisma.$transaction([
      prisma.user.update({
        where: { id: resetRecord.userId },
        data: { passwordHash },
      }),
      prisma.passwordReset.update({
        where: { id: resetRecord.id },
        data: { usedAt: new Date() },
      }),
    ]);

    await auditService.log({
      actorId: resetRecord.userId,
      actorEmail: resetRecord.user.email,
      entityType: 'User',
      entityId: resetRecord.userId,
      action: 'UPDATE',
      description: `Password reset completed for ${resetRecord.user.email}`,
    });

    return { message: 'Password has been reset successfully' };
  },

  async refreshAccessToken(refreshTokenStr: string) {
    try {
      const decoded = verifyRefreshToken(refreshTokenStr);
      if (decoded.type !== 'refresh') throw new Error('Invalid token type');

      const user = await prisma.user.findUnique({
        where: { id: decoded.userId },
        include: { organisations: { include: { organisation: true } } },
      });

      if (!user || !user.isActive) {
        throw new AppError(401, 'INVALID_TOKEN', 'User not found or inactive');
      }

      const orgUser = user.organisations.find((ou) => ou.isDefault) || user.organisations[0];
      if (!orgUser) throw new AppError(403, 'NO_ORGANISATION', 'No organisation');

      const perms = typeof orgUser.permissions === 'string'
        ? JSON.parse(orgUser.permissions)
        : orgUser.permissions;

      const tokenPayload: TokenPayload = {
        userId: user.id,
        email: user.email,
        organisationId: orgUser.organisationId,
        role: orgUser.role,
        permissions: perms,
      };

      return {
        accessToken: generateAccessToken(tokenPayload),
        refreshToken: generateRefreshToken(user.id),
      };
    } catch {
      throw new AppError(401, 'INVALID_TOKEN', 'Invalid or expired refresh token');
    }
  },

  async getProfile(userId: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { organisations: { include: { organisation: true } } },
    });
    if (!user) throw new AppError(404, 'NOT_FOUND', 'User not found');
    const { passwordHash, ...profile } = user;
    return profile;
  },

  async hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, SALT_ROUNDS);
  },
};
