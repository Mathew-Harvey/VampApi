import prisma from '../config/database';
import { AppError } from '../middleware/error';
import { auditService } from './audit.service';
import { storageService, MulterFile } from './storage.service';
import { storageConfigService } from './storage-config.service';
import { workOrderService } from './work-order.service';
import { vesselShareService } from './vessel-share.service';

const fleetOrgId = () => process.env.FLEET_ORG_ID || '';

/**
 * Shared access check for a single Media record.  Returns true if the caller:
 *   - uploaded the media; or
 *   - has view access to the attached work order (via org or assignment); or
 *   - belongs to the owning organisation of the attached vessel; or
 *   - has a VesselShare on the attached vessel.
 *
 * `includeOrganisationScope` mirrors the convention in workOrderService —
 * callers without `WORK_ORDER_VIEW` must have an explicit assignment/share to
 * see the media, but org admins with the permission see everything in their
 * org's vessels & work orders.
 */
async function canAccessMedia(
  mediaId: string,
  userId: string,
  organisationId: string,
  includeOrganisationScope: boolean,
): Promise<{ allowed: boolean; media: Awaited<ReturnType<typeof prisma.media.findUnique>> }> {
  const media = await prisma.media.findUnique({ where: { id: mediaId } });
  if (!media) return { allowed: false, media: null };

  if (media.uploaderId === userId) return { allowed: true, media };

  if (media.workOrderId) {
    const canView = await workOrderService.canViewWorkOrder(
      media.workOrderId,
      userId,
      organisationId,
      includeOrganisationScope,
    );
    if (canView) return { allowed: true, media };
  }

  if (media.vesselId) {
    const vessel = await prisma.vessel.findFirst({
      where: { id: media.vesselId, isDeleted: false },
      select: { organisationId: true },
    });
    if (vessel) {
      if (
        includeOrganisationScope &&
        (vessel.organisationId === organisationId || vessel.organisationId === fleetOrgId())
      ) {
        return { allowed: true, media };
      }
      const share = await vesselShareService.getSharePermission(media.vesselId, userId);
      if (share) return { allowed: true, media };
    }
  }

  return { allowed: false, media };
}

export const mediaService = {
  async create(file: MulterFile, userId: string, metadata: Record<string, string>) {
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

    const status = storageConfigService.getStatus();
    const totalPending = workOrders.reduce((sum, wo) => sum + wo.media.length, 0);

    const remoteSyncEnabled = storageService.isRemoteSyncEnabled();

    let guidance: {
      title: string;
      message: string;
      actionLabel: string;
      actionUrl: string | null;
    } | null = null;

    if (!remoteSyncEnabled) {
      guidance = {
        title: 'Using Local Storage',
        message:
          `Cloud sync is not configured. Media files will be stored locally.` +
          `\n\nStorage path: ${status.localMediaPath}` +
          `\n\nYou can configure cloud storage anytime in Settings > Storage for automatic sync.`,
        actionLabel: 'OK',
        actionUrl: null,
      };
    } else if (totalPending > 0) {
      guidance = {
        title: `${totalPending} file(s) awaiting cloud sync`,
        message:
          'These files are stored locally and can be synced to cloud storage. ' +
          'Sync individual work orders below or wait for automatic background sync.',
        actionLabel: 'Sync All',
        actionUrl: null,
      };
    }

    return {
      remoteSyncEnabled,
      storageStatus: {
        overallStatus: status.overallStatus,
        effectiveBackend: status.effectiveBackend,
        s3Configured: status.s3Configured,
        summary: status.summary,
        configUrl: '/api/v1/storage/config',
      },
      totalPendingFiles: totalPending,
      guidance,
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
      throw new AppError(400, 'REMOTE_SYNC_DISABLED', 'Cloud storage is not configured. Go to Settings > Storage to set up your S3 credentials before syncing.');
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

  /**
   * Fetch a single media record.  Enforces that the caller has access via
   * upload ownership, associated work-order view permission, or vessel org /
   * share — see `canAccessMedia`.  Returns `null` (treated as 404 at the
   * route layer) if the caller has no path to the file.
   */
  async getForUser(
    id: string,
    userId: string,
    organisationId: string,
    includeOrganisationScope: boolean,
  ) {
    const { allowed, media } = await canAccessMedia(id, userId, organisationId, includeOrganisationScope);
    if (!allowed || !media) return null;
    return media;
  },

  async delete(
    id: string,
    userId: string,
    organisationId: string,
    canAdminAsOrg: boolean,
  ) {
    const media = await prisma.media.findUnique({ where: { id } });
    if (!media) throw new AppError(404, 'NOT_FOUND', 'Media not found');

    // Uploader can always delete their own file.  Org admins with
    // WORK_ORDER_EDIT (or VESSEL_EDIT, via the `canAdminAsOrg` flag passed in
    // from the route) can also delete media in their org's work orders or
    // vessels.  Anyone else is rejected with 403.
    const isUploader = media.uploaderId === userId;
    let hasOrgAccess = false;
    if (!isUploader && canAdminAsOrg) {
      if (media.workOrderId) {
        hasOrgAccess = await workOrderService.canViewWorkOrder(
          media.workOrderId, userId, organisationId, true,
        );
      }
      if (!hasOrgAccess && media.vesselId) {
        const vessel = await prisma.vessel.findFirst({
          where: { id: media.vesselId, isDeleted: false },
          select: { organisationId: true },
        });
        if (
          vessel &&
          (vessel.organisationId === organisationId || vessel.organisationId === fleetOrgId())
        ) {
          hasOrgAccess = true;
        }
      }
    }
    if (!isUploader && !hasOrgAccess) {
      throw new AppError(403, 'FORBIDDEN', 'You do not have permission to delete this media');
    }

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

  async getWorkOrderMediaStatus(workOrderId: string) {
    // Server-stored Media records for this work order.
    const media = await prisma.media.findMany({
      where: { workOrderId },
      select: {
        id: true,
        url: true,
        uploader: {
          select: { id: true, firstName: true, lastName: true, email: true },
        },
      },
    });

    // Client-local photos: scan form entries' attachments JSON for
    // `{ kind: 'clientLocal', uploaderId, ... }` objects. These refer to
    // files that only exist on the uploader's laptop (File System Access
    // API) and are NOT accessible to other users.
    const entries = await prisma.workFormEntry.findMany({
      where: { workOrderId },
      select: { attachments: true },
    });

    type ClientLocalSummary = { uploaderId: string | null; relativePath: string };
    const clientLocal: ClientLocalSummary[] = [];
    for (const e of entries) {
      let arr: unknown[] = [];
      try {
        arr = typeof e.attachments === 'string' ? JSON.parse(e.attachments) : [];
      } catch { /* ignore */ }
      if (!Array.isArray(arr)) continue;
      for (const a of arr) {
        if (a && typeof a === 'object') {
          const obj = a as Record<string, unknown>;
          if (obj.kind === 'clientLocal' && typeof obj.relativePath === 'string') {
            clientLocal.push({
              uploaderId: typeof obj.uploaderId === 'string' ? obj.uploaderId : null,
              relativePath: obj.relativePath,
            });
          }
        }
      }
    }

    // Legacy "local" = server disk uploads (storage backend = local)
    const serverLocalMedia = media.filter((m) => m.url.startsWith('/uploads/'));

    const uploaderMap = new Map<string, { id: string; firstName: string; lastName: string; email: string }>();
    for (const m of serverLocalMedia) {
      if (m.uploader && !uploaderMap.has(m.uploader.id)) {
        uploaderMap.set(m.uploader.id, m.uploader);
      }
    }

    // For client-local refs, look up uploader details
    const clientLocalUploaderIds = Array.from(
      new Set(clientLocal.map((c) => c.uploaderId).filter((id): id is string => !!id)),
    );
    const clientLocalUploaders = clientLocalUploaderIds.length > 0
      ? await prisma.user.findMany({
          where: { id: { in: clientLocalUploaderIds } },
          select: { id: true, firstName: true, lastName: true, email: true },
        })
      : [];

    return {
      totalMediaCount: media.length + clientLocal.length,
      // Legacy (server-disk) local count — retained for backwards compat.
      localMediaCount: serverLocalMedia.length,
      cloudMediaCount: media.length - serverLocalMedia.length,
      hasLocalMedia: serverLocalMedia.length > 0,
      // New: photos stored only on the uploader's laptop.
      clientLocalCount: clientLocal.length,
      hasClientLocalMedia: clientLocal.length > 0,
      clientLocalUploaders,
      // Uploaders of server-local media (existing behaviour)
      uploaders: Array.from(uploaderMap.values()),
    };
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
