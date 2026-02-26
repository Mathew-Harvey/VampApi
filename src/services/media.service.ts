import prisma from '../config/database';
import { AppError } from '../middleware/error';
import { auditService } from './audit.service';
import { storageService } from './storage.service';

export const mediaService = {
  async create(file: Express.Multer.File, userId: string, metadata: Record<string, string>) {
    const stored = await storageService.saveUploadedFile(file);

    const media = await prisma.media.create({
      data: {
        uploaderId: userId,
        vesselId: metadata.vesselId || null,
        workOrderId: metadata.workOrderId || null,
        inspectionId: metadata.inspectionId || null,
        findingId: metadata.findingId || null,
        submissionId: metadata.submissionId || null,
        filename: file.filename,
        originalName: file.originalname,
        mimeType: file.mimetype,
        size: file.size,
        storageKey: stored.storageKey,
        url: stored.url,
        thumbnailUrl: null,
        latitude: metadata.latitude ? parseFloat(metadata.latitude) : null,
        longitude: metadata.longitude ? parseFloat(metadata.longitude) : null,
        tags: JSON.stringify({
          ...(safeJsonObject(metadata.tags)),
          storageBackend: stored.backend,
          pendingRemoteSync: stored.backend === 'local' && storageService.isRemoteSyncEnabled(),
        }),
      },
    });

    await auditService.log({
      actorId: userId,
      entityType: 'Media',
      entityId: media.id,
      action: 'FILE_UPLOAD',
      description: `Uploaded file "${file.originalname}"`,
    });

    return media;
  },

  async getPendingSyncWorkOrders(userId: string, organisationId: string) {
    const workOrders = await prisma.workOrder.findMany({
      where: {
        isDeleted: false,
        OR: [{ organisationId }, { assignments: { some: { userId } } }],
        media: {
          some: {
            url: { startsWith: '/uploads/' },
          },
        },
      },
      select: {
        id: true,
        referenceNumber: true,
        title: true,
        media: {
          where: { url: { startsWith: '/uploads/' } },
          select: { id: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return {
      remoteSyncEnabled: storageService.isRemoteSyncEnabled(),
      jobs: workOrders.map((wo) => ({
        workOrderId: wo.id,
        referenceNumber: wo.referenceNumber,
        title: wo.title,
        pendingCount: wo.media.length,
      })),
    };
  },

  async syncWorkOrderMedia(workOrderId: string) {
    if (!storageService.isRemoteSyncEnabled()) {
      throw new AppError(400, 'REMOTE_SYNC_DISABLED', 'Remote storage is not configured');
    }

    const medias = await prisma.media.findMany({
      where: {
        workOrderId,
        url: { startsWith: '/uploads/' },
      },
      select: {
        id: true,
        filename: true,
        mimeType: true,
        storageKey: true,
        url: true,
      },
    });

    let synced = 0;
    let failed = 0;

    for (const media of medias) {
      try {
        const remote = await storageService.syncLocalMediaToRemote({
          filename: media.filename,
          mimeType: media.mimeType,
          storageKey: media.storageKey,
          url: media.url,
        });

        await prisma.media.update({
          where: { id: media.id },
          data: {
            storageKey: remote.storageKey,
            url: remote.url,
          },
        });
        synced += 1;
      } catch {
        failed += 1;
      }
    }

    return {
      workOrderId,
      total: medias.length,
      synced,
      failed,
      remaining: medias.length - synced,
    };
  },

  async getById(id: string) {
    const media = await prisma.media.findUnique({ where: { id } });
    if (!media) throw new AppError(404, 'NOT_FOUND', 'Media not found');
    return media;
  },

  async delete(id: string, userId: string) {
    const media = await prisma.media.findUnique({ where: { id } });
    if (!media) throw new AppError(404, 'NOT_FOUND', 'Media not found');

    await storageService.deleteStoredMedia({ storageKey: media.storageKey, url: media.url });
    await prisma.media.delete({ where: { id } });

    await auditService.log({
      actorId: userId,
      entityType: 'Media',
      entityId: id,
      action: 'FILE_DELETE',
      description: `Deleted file "${media.originalName}"`,
    });
  },
};

function safeJsonObject(raw: string | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}
