import prisma from '../config/database';
import { AppError } from '../middleware/error';
import { auditService } from './audit.service';
import { env } from '../config/env';
import { signMediaUrl } from '../config/media-signing';

const ENTRY_UPDATE_FIELDS = [
  'isoZone',
  'condition', 'foulingRating', 'foulingType', 'coverage',
  'measurementType', 'measurementValue', 'measurementUnit',
  'coatingCondition', 'corrosionType', 'corrosionSeverity',
  'notes', 'recommendation', 'actionRequired', 'attachments', 'status',
] as const;

export const workFormService = {
  /**
   * Generate form entries from vessel components when starting a work order.
   * Creates entries for top-level components AND their sub-components.
   */
  async generateForm(workOrderId: string, userId: string) {
    const workOrder = await prisma.workOrder.findFirst({
      where: { id: workOrderId, isDeleted: false },
      include: {
        vessel: {
          include: {
            components: {
              orderBy: { sortOrder: 'asc' },
            },
          },
        },
      },
    });
    if (!workOrder) throw new AppError(404, 'NOT_FOUND', 'Work order not found');

    const allComponents = workOrder.vessel.components;
    if (allComponents.length === 0) {
      throw new AppError(400, 'NO_COMPONENTS', 'Vessel has no components defined in its general arrangement');
    }

    const existing = await prisma.workFormEntry.findMany({ where: { workOrderId } });
    const existingComponentIds = new Set(existing.map((e) => e.vesselComponentId));
    const newComponents = allComponents.filter((c) => !existingComponentIds.has(c.id));

    if (existing.length > 0 && newComponents.length === 0) return existing;

    const newEntries = await Promise.all(
      newComponents.map((comp) =>
        prisma.workFormEntry.create({
          data: {
            workOrderId,
            vesselComponentId: comp.id,
            status: 'PENDING',
          },
        })
      )
    );

    const entries = [...existing, ...newEntries];

    const action = existing.length === 0 ? 'CREATE' : 'UPDATE';
    const description = existing.length === 0
      ? `Generated work form with ${entries.length} entries for ${workOrder.vessel.name}`
      : `Synced work form: added ${newEntries.length} new entries for ${workOrder.vessel.name} (total: ${entries.length})`;

    await auditService.log({
      actorId: userId,
      entityType: 'WorkOrder',
      entityId: workOrderId,
      action,
      description,
    });

    return entries;
  },

  /**
   * Get all form entries for a work order with component details.
   * Returns a nested structure: top-level entries include a `subEntries` array.
   */
  async getFormEntries(workOrderId: string) {
    const entries = await prisma.workFormEntry.findMany({
      where: { workOrderId },
      include: {
        vesselComponent: {
          include: { children: { orderBy: { sortOrder: 'asc' } } },
        },
      },
      orderBy: { vesselComponent: { sortOrder: 'asc' } },
    });

    // Build a map of componentId -> entry for nesting
    const entryByComponentId = new Map(entries.map((e) => [e.vesselComponentId, e]));

    // Separate top-level entries from sub-component entries
    const topLevelEntries = entries.filter((e) => !e.vesselComponent.parentId);

    return topLevelEntries.map((entry) => {
      const subComponentIds = entry.vesselComponent.children.map((sc: any) => sc.id);
      const subEntries = subComponentIds
        .map((scId: string) => entryByComponentId.get(scId))
        .filter(Boolean)
        .map((sub) => withParsedAttachments(sub!));

      return {
        ...withParsedAttachments(entry),
        subEntries,
      };
    });
  },

  async updateEntry(entryId: string, data: any, userId: string) {
    const existing = await prisma.workFormEntry.findUnique({ where: { id: entryId } });
    if (!existing) throw new AppError(404, 'NOT_FOUND', 'Form entry not found');

    const updateData: Record<string, unknown> = { updatedAt: new Date() };
    for (const key of ENTRY_UPDATE_FIELDS) {
      if (key in data) {
        if (key === 'attachments') {
          const raw = Array.isArray(data[key]) ? data[key] : safeParseJsonArray(data[key]);
          const normalized = raw.map(normalizeAttachmentForStorage).filter((x: unknown): x is AttachmentStorage => x !== null);
          updateData[key] = JSON.stringify(normalized);
        } else {
          updateData[key] = data[key];
        }
      }
    }
    if (data.status === 'COMPLETED' && !existing.completedAt) {
      updateData.completedAt = new Date();
      updateData.completedBy = userId;
    }

    const updated = await prisma.workFormEntry.update({
      where: { id: entryId },
      data: updateData,
      include: { vesselComponent: true },
    });

    return withParsedAttachments(updated);
  },

  /**
   * Get the complete form data as JSON for report generation.
   * Includes nested sub-component entries under each parent entry.
   */
  async getFormDataJson(workOrderId: string) {
    const workOrder = await prisma.workOrder.findFirst({
      where: { id: workOrderId, isDeleted: false },
      include: {
        vessel: true,
        organisation: true,
        assignments: { include: { user: { select: { firstName: true, lastName: true, email: true } } } },
      },
    });
    if (!workOrder) throw new AppError(404, 'NOT_FOUND', 'Work order not found');

    const entries = await prisma.workFormEntry.findMany({
      where: { workOrderId },
      include: { vesselComponent: true },
      orderBy: { vesselComponent: { sortOrder: 'asc' } },
    });

    // Split into top-level and sub-component entries
    const topLevel = entries.filter((e) => !e.vesselComponent.parentId);
    const subByParent = new Map<string, typeof entries>();
    for (const e of entries) {
      if (e.vesselComponent.parentId) {
        const arr = subByParent.get(e.vesselComponent.parentId) || [];
        arr.push(e);
        subByParent.set(e.vesselComponent.parentId, arr);
      }
    }

    function mapEntry(e: typeof entries[0]) {
      return {
        id: e.id,
        component: e.vesselComponent.name,
        category: e.vesselComponent.category,
        location: e.vesselComponent.location,
        gaZoneId: e.vesselComponent.gaZoneId ?? null,
        isoZone: (e as any).isoZone ?? (e.vesselComponent as any).isoZone ?? null,
        material: e.vesselComponent.material,
        condition: e.condition,
        foulingRating: e.foulingRating,
        foulingType: e.foulingType,
        coverage: e.coverage,
        measurementType: e.measurementType,
        measurementValue: e.measurementValue,
        measurementUnit: e.measurementUnit,
        coatingCondition: e.coatingCondition,
        corrosionType: e.corrosionType,
        corrosionSeverity: e.corrosionSeverity,
        notes: e.notes,
        recommendation: e.recommendation,
        actionRequired: e.actionRequired,
        status: e.status,
        attachments: e.attachments,
      };
    }

    return {
      workOrder: {
        referenceNumber: workOrder.referenceNumber,
        title: workOrder.title,
        description: workOrder.description,
        metadata: workOrder.metadata,
        type: workOrder.type,
        foulingScale: (workOrder as any).foulingScale ?? null,
        status: workOrder.status,
        location: workOrder.location,
        scheduledStart: workOrder.scheduledStart,
        scheduledEnd: workOrder.scheduledEnd,
        actualStart: workOrder.actualStart,
        actualEnd: workOrder.actualEnd,
        completedAt: workOrder.completedAt,
      },
      vessel: {
        name: workOrder.vessel.name,
        vesselType: workOrder.vessel.vesselType,
        imoNumber: workOrder.vessel.imoNumber,
        homePort: workOrder.vessel.homePort,
        lengthOverall: workOrder.vessel.lengthOverall,
        beam: workOrder.vessel.beam,
        maxDraft: workOrder.vessel.maxDraft,
        grossTonnage: workOrder.vessel.grossTonnage,
        yearBuilt: workOrder.vessel.yearBuilt,
      },
      organisation: {
        name: workOrder.organisation.name,
      },
      team: workOrder.assignments.map((a) => ({
        name: `${a.user.firstName} ${a.user.lastName}`,
        email: a.user.email,
        role: a.role,
      })),
      entries: topLevel.map((e) => ({
        ...mapEntry(e),
        subEntries: (subByParent.get(e.vesselComponentId) || []).map(mapEntry),
      })),
      generatedAt: new Date().toISOString(),
    };
  },

  async updateField(entryId: string, field: string, value: any, userId: string) {
    const existing = await prisma.workFormEntry.findUnique({ where: { id: entryId } });
    if (!existing) throw new AppError(404, 'NOT_FOUND', 'Form entry not found');

    const allowedFields = [
      'isoZone',
      'condition', 'foulingRating', 'foulingType', 'coverage',
      'coatingCondition', 'corrosionType', 'corrosionSeverity',
      'notes', 'recommendation', 'actionRequired', 'status',
      'measurementType', 'measurementValue', 'measurementUnit',
    ];
    if (!allowedFields.includes(field)) {
      throw new AppError(400, 'INVALID_FIELD', `Field '${field}' cannot be updated`);
    }

    const updateData: any = { [field]: value, updatedAt: new Date() };
    if (field === 'status' && value === 'COMPLETED' && !existing.completedAt) {
      updateData.completedAt = new Date();
      updateData.completedBy = userId;
    }

    return prisma.workFormEntry.update({
      where: { id: entryId },
      data: updateData,
      include: { vesselComponent: true },
    });
  },

  async removeScreenshot(entryId: string, index: number) {
    const entry = await prisma.workFormEntry.findUnique({ where: { id: entryId } });
    if (!entry) throw new AppError(404, 'NOT_FOUND', 'Form entry not found');

    const attachments = safeParseJsonArray(entry.attachments)
      .map(normalizeAttachmentForStorage)
      .filter((x): x is AttachmentStorage => x !== null);
    if (index >= 0 && index < attachments.length) {
      attachments.splice(index, 1);
    }

    const updated = await prisma.workFormEntry.update({
      where: { id: entryId },
      data: { attachments: JSON.stringify(attachments), updatedAt: new Date() },
      include: { vesselComponent: true },
    });

    return withParsedAttachments(updated);
  },

  async getFoulingStateByVessel(vesselId: string) {
    const components = await prisma.vesselComponent.findMany({
      where: { vesselId },
      orderBy: { sortOrder: 'asc' },
    });
    if (components.length === 0) return [];

    const results = await Promise.all(
      components.map(async (comp) => {
        const latestEntry = await prisma.workFormEntry.findFirst({
          where: {
            vesselComponentId: comp.id,
            foulingRating: { not: null },
            workOrder: { isDeleted: false },
          },
          orderBy: { updatedAt: 'desc' },
          include: {
            workOrder: {
              select: {
                id: true,
                referenceNumber: true,
                title: true,
                type: true,
                completedAt: true,
                status: true,
              },
            },
          },
        });

        return {
          componentId: comp.id,
          componentName: comp.name,
          category: comp.category,
          location: comp.location,
          gaZoneId: comp.gaZoneId ?? null,
          condition: latestEntry?.condition ?? comp.condition,
          foulingRating: latestEntry?.foulingRating ?? null,
          foulingType: latestEntry?.foulingType ?? null,
          coverage: latestEntry?.coverage ?? null,
          coatingCondition: latestEntry?.coatingCondition ?? null,
          lastAssessedAt: latestEntry?.updatedAt ?? null,
          lastWorkOrder: latestEntry
            ? {
                id: latestEntry.workOrder.id,
                referenceNumber: latestEntry.workOrder.referenceNumber,
                title: latestEntry.workOrder.title,
                type: latestEntry.workOrder.type,
                completedAt: latestEntry.workOrder.completedAt,
              }
            : null,
        };
      })
    );

    return results;
  },

  async getComponentWorkHistory(vesselId: string, componentId: string) {
    const component = await prisma.vesselComponent.findFirst({
      where: { id: componentId, vesselId },
    });
    if (!component) throw new AppError(404, 'NOT_FOUND', 'Component not found');

    const entries = await prisma.workFormEntry.findMany({
      where: {
        vesselComponentId: componentId,
        workOrder: { isDeleted: false },
      },
      orderBy: { updatedAt: 'desc' },
      include: {
        workOrder: {
          select: {
            id: true,
            referenceNumber: true,
            title: true,
            type: true,
            status: true,
            location: true,
            scheduledStart: true,
            scheduledEnd: true,
            actualStart: true,
            actualEnd: true,
            completedAt: true,
            createdAt: true,
          },
        },
      },
    });

    return {
      component: {
        id: component.id,
        name: component.name,
        category: component.category,
        location: component.location,
        gaZoneId: component.gaZoneId ?? null,
        coatingType: component.coatingType,
        material: component.material,
        condition: component.condition,
      },
      entries: entries.map((e) => ({
        id: e.id,
        condition: e.condition,
        foulingRating: e.foulingRating,
        foulingType: e.foulingType,
        coverage: e.coverage,
        coatingCondition: e.coatingCondition,
        corrosionType: e.corrosionType,
        corrosionSeverity: e.corrosionSeverity,
        notes: e.notes,
        recommendation: e.recommendation,
        actionRequired: e.actionRequired,
        status: e.status,
        completedAt: e.completedAt,
        updatedAt: e.updatedAt,
        workOrder: e.workOrder,
      })),
    };
  },

  async addAttachment(entryId: string, mediaId: string) {
    const entry = await prisma.workFormEntry.findUnique({ where: { id: entryId } });
    if (!entry) throw new AppError(404, 'NOT_FOUND', 'Form entry not found');

    const media = await prisma.media.findUnique({
      where: { id: mediaId },
      select: { id: true, url: true },
    });
    if (!media) throw new AppError(404, 'NOT_FOUND', 'Media not found');

    const attachments = safeParseJsonArray(entry.attachments)
      .map(normalizeAttachmentForStorage)
      .filter((x): x is AttachmentStorage => x !== null);
    attachments.push({ kind: 'url', url: toRelativePath(media.url) });

    const updated = await prisma.workFormEntry.update({
      where: { id: entryId },
      data: { attachments: JSON.stringify(attachments) },
      include: { vesselComponent: true },
    });

    const resolvedUrl = toPublicMediaUrl(media.url);
    return {
      ...updated,
      attachments: attachments.map(toApiAttachment),
      mediaId: media.id,
      mediaUrl: resolvedUrl,
    };
  },

  /**
   * Append a client-local attachment ref (pointer to a file on the
   * uploader's own laptop, accessed via the File System Access API).
   * The server stores only the relative path + metadata; no bytes.
   */
  async addLocalAttachment(
    entryId: string,
    payload: { relativePath: string; label?: string | null; mimeType?: string | null; uploaderId: string },
  ) {
    const entry = await prisma.workFormEntry.findUnique({ where: { id: entryId } });
    if (!entry) throw new AppError(404, 'NOT_FOUND', 'Form entry not found');

    if (!payload.relativePath || typeof payload.relativePath !== 'string') {
      throw new AppError(400, 'INVALID_PATH', 'relativePath is required');
    }
    // Prevent path-escape attempts — stored path must be a simple relative
    // path with no `..` segments or absolute drive prefixes.
    if (/(^|[\\/])\.\.([\\/]|$)/.test(payload.relativePath) || /^([a-zA-Z]:|\/)/.test(payload.relativePath)) {
      throw new AppError(400, 'INVALID_PATH', 'relativePath must be a simple relative path');
    }

    const attachments = safeParseJsonArray(entry.attachments)
      .map(normalizeAttachmentForStorage)
      .filter((x): x is AttachmentStorage => x !== null);

    const newAttachment: AttachmentStorage = {
      kind: 'clientLocal',
      relativePath: payload.relativePath,
      label: payload.label ?? null,
      mimeType: payload.mimeType ?? null,
      uploaderId: payload.uploaderId,
    };
    attachments.push(newAttachment);

    const updated = await prisma.workFormEntry.update({
      where: { id: entryId },
      data: { attachments: JSON.stringify(attachments) },
      include: { vesselComponent: true },
    });

    return {
      ...updated,
      attachments: attachments.map(toApiAttachment),
      newAttachment: toApiAttachment(newAttachment),
    };
  },
};

/**
 * Shape of an attachment as persisted to the DB. We store a small
 * discriminated union so legacy string entries (which are treated as
 * `kind: 'url'`) and new client-local entries coexist.
 */
type AttachmentStorage =
  | { kind: 'url'; url: string }
  | {
      kind: 'clientLocal';
      relativePath: string;
      label?: string | null;
      mimeType?: string | null;
      uploaderId?: string | null;
    };

/**
 * Shape returned to the API consumer. URLs are public/signed; clientLocal
 * entries are returned as-is (the client resolves them itself).
 */
type ApiAttachment =
  | string
  | {
      kind: 'clientLocal';
      relativePath: string;
      label?: string | null;
      mimeType?: string | null;
      uploaderId?: string | null;
    };

/**
 * Normalize a raw attachments entry (legacy string, legacy URL object, or
 * structured clientLocal object) into the current storage shape. Returns
 * `null` for malformed entries so they can be dropped.
 */
function normalizeAttachmentForStorage(raw: unknown): AttachmentStorage | null {
  if (typeof raw === 'string') {
    if (!raw) return null;
    return { kind: 'url', url: toRelativePath(raw) };
  }
  if (raw && typeof raw === 'object') {
    const obj = raw as Record<string, unknown>;
    const kind = typeof obj.kind === 'string' ? obj.kind : null;
    if (kind === 'clientLocal' && typeof obj.relativePath === 'string') {
      return {
        kind: 'clientLocal',
        relativePath: obj.relativePath,
        label: typeof obj.label === 'string' ? obj.label : null,
        mimeType: typeof obj.mimeType === 'string' ? obj.mimeType : null,
        uploaderId: typeof obj.uploaderId === 'string' ? obj.uploaderId : null,
      };
    }
    if (kind === 'url' && typeof obj.url === 'string') {
      return { kind: 'url', url: toRelativePath(obj.url) };
    }
    if (typeof obj.url === 'string') {
      return { kind: 'url', url: toRelativePath(obj.url) };
    }
  }
  return null;
}

/** Convert storage shape to the shape returned over the wire. */
function toApiAttachment(a: AttachmentStorage): ApiAttachment {
  if (a.kind === 'url') return toPublicMediaUrl(a.url);
  return {
    kind: 'clientLocal',
    relativePath: a.relativePath,
    label: a.label ?? null,
    mimeType: a.mimeType ?? null,
    uploaderId: a.uploaderId ?? null,
  };
}

/**
 * Resolve a relative path like /uploads/x.jpg to a full URL using the current
 * API_URL and append a short-lived HMAC signature so the frontend can load the
 * image without forwarding the caller's access token.
 */
function toPublicMediaUrl(url: string): string {
  let absolute: string;
  if (/^https?:\/\//i.test(url)) {
    absolute = url;
  } else {
    const normalizedPath = url.startsWith('/') ? url : `/${url}`;
    const apiBase = (env.API_URL || '').replace(/\/+$/, '');
    absolute = apiBase ? `${apiBase}${normalizedPath}` : normalizedPath;
  }
  return signMediaUrl(absolute);
}

/** Strip any baked-in absolute API origin, keeping only the path (e.g. /uploads/x.jpg). */
function toRelativePath(url: string): string {
  if (!url) return url;
  try {
    const parsed = new URL(url);
    if (parsed.pathname.startsWith('/uploads/')) return parsed.pathname;
  } catch {
    // not a full URL — already relative
  }
  return url;
}

function safeParseJsonArray(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  if (typeof raw !== 'string' || !raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * Parse attachments JSON, normalize legacy absolute URLs, and return a mixed
 * array of signed public URLs (for server-hosted media) and clientLocal
 * pointer objects (for files that only exist on a user's laptop).
 */
function withParsedAttachments<T extends { attachments: unknown }>(
  entry: T,
): T & { attachments: ApiAttachment[] } {
  const normalized = safeParseJsonArray(entry.attachments)
    .map(normalizeAttachmentForStorage)
    .filter((x): x is AttachmentStorage => x !== null);
  return {
    ...entry,
    attachments: normalized.map(toApiAttachment),
  };
}
