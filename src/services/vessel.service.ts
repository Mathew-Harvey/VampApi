import prisma from '../config/database';
import { AppError } from '../middleware/error';
import { PaginationParams, buildPaginatedResponse } from '../utils/pagination';
import { auditService } from './audit.service';
import { vesselShareService } from './vessel-share.service';
import { Prisma } from '@prisma/client';

const fleetOrgId = () => process.env.FLEET_ORG_ID || '';

const STRING_FIELDS = [
  'name', 'vesselType', 'imoNumber', 'mmsi', 'callSign', 'flagState',
  'homePort', 'classificationSociety', 'afsCoatingType', 'afsManufacturer',
  'afsProductName', 'tradingRoutes', 'operatingArea', 'bfmpDocumentUrl',
  'bfmpRevision', 'regulatoryRef', 'status', 'complianceStatus',
  'iconImage',
] as const;

const NUMBER_FIELDS = [
  'grossTonnage', 'lengthOverall', 'beam', 'maxDraft', 'minDraft',
  'yearBuilt', 'afsServiceLife', 'typicalSpeed',
] as const;

const DATE_FIELDS = ['afsApplicationDate', 'lastDrydockDate', 'nextDrydockDate'] as const;

const VESSEL_UPDATE_ALLOWLIST = new Set<string>([
  ...STRING_FIELDS, ...NUMBER_FIELDS, ...DATE_FIELDS, 'climateZones', 'metadata',
]);

/**
 * Build an audit-safe snapshot of a vessel row.  `iconImage` is a base64
 * data URL that can comfortably hit ~250 KB; dumping it into both
 * `previousData` and `newData` on every update would balloon the audit
 * table without adding any auditable value.  We replace it with a short
 * marker so reviewers can still see the field was touched.
 */
function auditSafeVessel<T extends { iconImage?: string | null } | null | undefined>(v: T): T {
  if (!v || typeof v !== 'object') return v;
  if (!('iconImage' in v) || v.iconImage == null) return v;
  return { ...v, iconImage: '[image omitted]' } as T;
}

/**
 * Normalise inbound vessel payloads so the columns (which are TEXT in the
 * database) always receive JSON-stringified or correctly-typed values.
 *
 *   - `climateZones` is coerced to `string[]` then stringified; passing an
 *     already-stringified JSON array returns it untouched instead of being
 *     double-stringified.
 *   - `metadata` is JSON-stringified (object or array), left alone if already
 *     a string, and nulled if null.
 *   - Date fields are parsed via `new Date(...)` and rejected as 400 if the
 *     string isn't parseable.
 */
function normaliseClimateZones(value: unknown): string {
  if (value == null) return JSON.stringify([]);
  if (Array.isArray(value)) return JSON.stringify(value);
  if (typeof value === 'string') {
    // If it already parses as a JSON array leave it; otherwise treat the
    // string as a single-entry list.
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return value;
    } catch { /* fall through */ }
    return JSON.stringify([value]);
  }
  return JSON.stringify([]);
}

function normaliseMetadata(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === 'string') return value;
  try { return JSON.stringify(value); } catch { return null; }
}

function coerceDate(field: string, value: unknown): Date | null {
  if (value == null || value === '') return null;
  const d = new Date(value as string);
  if (Number.isNaN(d.getTime())) {
    throw new AppError(400, 'VALIDATION_ERROR', `${field} is not a valid date`);
  }
  return d;
}

function buildVesselPayload(data: Record<string, unknown>, options: { forUpdate: boolean }) {
  const payload: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (options.forUpdate && !VESSEL_UPDATE_ALLOWLIST.has(key)) continue;
    if (!options.forUpdate && !VESSEL_UPDATE_ALLOWLIST.has(key) && key !== 'organisationId') continue;
    if (value === undefined) continue;
    if (key === 'climateZones') {
      payload[key] = normaliseClimateZones(value);
      continue;
    }
    if (key === 'metadata') {
      payload[key] = normaliseMetadata(value);
      continue;
    }
    if ((DATE_FIELDS as readonly string[]).includes(key)) {
      payload[key] = coerceDate(key, value);
      continue;
    }
    payload[key] = value;
  }
  return payload;
}

export const vesselService = {
  async list(params: PaginationParams, organisationId: string, filters?: Record<string, string>, userId?: string) {
    const orgIds = [organisationId];
    if (fleetOrgId()) orgIds.push(fleetOrgId());

    let sharedVesselIds: string[] = [];
    let assignmentVesselIds: string[] = [];
    if (userId) {
      [sharedVesselIds, assignmentVesselIds] = await Promise.all([
        vesselShareService.getSharedVesselIds(userId),
        vesselShareService.getAssignmentVesselIds(userId),
      ]);
    }

    const accessFilters: Prisma.VesselWhereInput[] = [
      { organisationId: { in: orgIds } },
    ];
    if (sharedVesselIds.length > 0) {
      accessFilters.push({ id: { in: sharedVesselIds } });
    }
    // Collaborators on active work orders get implicit read access to the
    // vessel they're working on; include those in the list so the fleet
    // grid is consistent with what `GET /vessels/:id` will serve.
    if (assignmentVesselIds.length > 0) {
      accessFilters.push({ id: { in: assignmentVesselIds } });
    }

    const where: Prisma.VesselWhereInput = {
      isDeleted: false,
      OR: accessFilters,
    };

    if (params.search) {
      where.AND = [
        { OR: accessFilters },
        {
          OR: [
            { name: { contains: params.search, mode: 'insensitive' } },
            { imoNumber: { contains: params.search, mode: 'insensitive' } },
            { callSign: { contains: params.search, mode: 'insensitive' } },
          ],
        },
      ];
      delete (where as any).OR;
    }
    if (filters?.status) where.status = filters.status as any;
    if (filters?.vesselType) where.vesselType = filters.vesselType as any;
    if (filters?.complianceStatus) where.complianceStatus = filters.complianceStatus as any;

    const [data, total] = await Promise.all([
      prisma.vessel.findMany({
        where,
        skip: params.skip,
        take: params.limit,
        orderBy: { [params.sort]: params.order },
        include: { organisation: { select: { id: true, name: true } } },
      }),
      prisma.vessel.count({ where }),
    ]);

    const sharedSet = new Set(sharedVesselIds);
    const assignmentSet = new Set(assignmentVesselIds);
    const annotated = data.map((v) => ({
      ...v,
      // `_shared` flag covers both explicit shares and vessels reached via
      // a work-order assignment — in both cases the vessel is not owned by
      // the user's current org and the UI badges it "shared".
      _shared:
        v.organisationId !== organisationId &&
        v.organisationId !== fleetOrgId() &&
        (sharedSet.has(v.id) || assignmentSet.has(v.id)),
    }));

    return buildPaginatedResponse(annotated, total, params);
  },

  async getById(id: string, organisationId?: string, userId?: string) {
    const vessel = await prisma.vessel.findFirst({
      where: { id, isDeleted: false },
      include: {
        organisation: { select: { id: true, name: true } },
        nicheAreas: true,
        components: { orderBy: { sortOrder: 'asc' } },
        inspections: { orderBy: { createdAt: 'desc' }, take: 5 },
        workOrders: { orderBy: { createdAt: 'desc' }, take: 5, where: { isDeleted: false } },
      },
    });
    if (!vessel) throw new AppError(404, 'NOT_FOUND', 'Vessel not found');

    const isOrgOwned = vessel.organisationId === organisationId || vessel.organisationId === fleetOrgId();

    if (organisationId && !isOrgOwned) {
      if (!userId) throw new AppError(404, 'NOT_FOUND', 'Vessel not found');
      // Accept either an explicit `vesselShare` row OR an active work-order
      // assignment that references this vessel.  The latter makes the
      // access model consistent with what the work-orders list already
      // exposes — you can see any vessel you're contracted to work on.
      const share = await prisma.vesselShare.findUnique({
        where: { vesselId_userId: { vesselId: id, userId } },
        select: { id: true },
      });
      if (!share) {
        const assignment = await prisma.workOrderAssignment.findFirst({
          where: {
            userId,
            workOrder: {
              vesselId: id,
              isDeleted: false,
              status: {
                in: [
                  'DRAFT',
                  'PENDING_APPROVAL',
                  'APPROVED',
                  'IN_PROGRESS',
                  'AWAITING_REVIEW',
                  'UNDER_REVIEW',
                  'ON_HOLD',
                ],
              },
            },
          },
          select: { id: true },
        });
        if (!assignment) throw new AppError(404, 'NOT_FOUND', 'Vessel not found');
      }
    }
    return vessel;
  },

  async create(data: any, organisationId: string, userId: string) {
    const payload = buildVesselPayload(data, { forUpdate: false });
    payload.organisationId = organisationId;
    // `climateZones` is required by the schema; default to [] when omitted.
    if (payload.climateZones === undefined) payload.climateZones = JSON.stringify([]);

    const vessel = await prisma.vessel.create({ data: payload as any });

    await auditService.log({
      actorId: userId,
      entityType: 'Vessel',
      entityId: vessel.id,
      action: 'CREATE',
      description: `Created vessel "${vessel.name}"`,
      newData: auditSafeVessel(vessel) as any,
    });

    return vessel;
  },

  /**
   * Update a vessel.  `organisationId` is now REQUIRED (previously, passing
   * undefined let the caller bypass the ownership check).  The caller must
   * either own the vessel via their current organisation, match the fleet
   * org, or hold a WRITE share.
   */
  async update(id: string, data: any, userId: string, organisationId: string) {
    if (!organisationId) {
      throw new AppError(400, 'VALIDATION_ERROR', 'organisationId is required');
    }
    const existing = await prisma.vessel.findFirst({ where: { id, isDeleted: false } });
    if (!existing) throw new AppError(404, 'NOT_FOUND', 'Vessel not found');

    const isOrgOwned = existing.organisationId === organisationId || existing.organisationId === fleetOrgId();
    if (!isOrgOwned) {
      const share = await prisma.vesselShare.findUnique({
        where: { vesselId_userId: { vesselId: id, userId } },
      });
      if (!share || share.permission !== 'WRITE') {
        throw new AppError(404, 'NOT_FOUND', 'Vessel not found');
      }
    }
    if (existing.source === 'RISE_X') throw new AppError(403, 'FORBIDDEN', 'Synced fleet vessels are read-only');

    const sanitized = buildVesselPayload(data, { forUpdate: true });

    const vessel = await prisma.vessel.update({ where: { id }, data: sanitized as any });

    await auditService.log({
      actorId: userId,
      entityType: 'Vessel',
      entityId: vessel.id,
      action: 'UPDATE',
      description: `Updated vessel "${vessel.name}"`,
      previousData: auditSafeVessel(existing) as any,
      newData: auditSafeVessel(vessel) as any,
      changedFields: Object.keys(sanitized),
    });

    return vessel;
  },

  async softDelete(id: string, userId: string, organisationId?: string) {
    const existing = await prisma.vessel.findFirst({ where: { id, isDeleted: false } });
    if (!existing) throw new AppError(404, 'NOT_FOUND', 'Vessel not found');
    if (organisationId && existing.organisationId !== organisationId && existing.organisationId !== fleetOrgId()) {
      throw new AppError(404, 'NOT_FOUND', 'Vessel not found');
    }
    if (existing.source === 'RISE_X') throw new AppError(403, 'FORBIDDEN', 'Synced fleet vessels are read-only');

    await prisma.vessel.update({ where: { id }, data: { isDeleted: true } });

    await auditService.log({
      actorId: userId,
      entityType: 'Vessel',
      entityId: id,
      action: 'DELETE',
      description: `Soft-deleted vessel "${existing.name}"`,
    });
  },
};
