import prisma from '../config/database';

export const notificationService = {
  async create(userId: string, type: string, title: string, message: string, entityType?: string, entityId?: string) {
    return prisma.notification.create({
      data: {
        userId,
        type: type as any,
        title,
        message,
        entityType,
        entityId,
      },
    });
  },

  async getForUser(userId: string, unreadOnly = false) {
    const where: any = { userId };
    if (unreadOnly) where.isRead = false;

    return prisma.notification.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  },

  async markRead(id: string, userId: string) {
    return prisma.notification.update({
      where: { id },
      data: { isRead: true, readAt: new Date() },
    });
  },

  async getUnreadCount(userId: string) {
    return prisma.notification.count({
      where: { userId, isRead: false },
    });
  },
};
