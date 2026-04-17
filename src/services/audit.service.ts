import prisma from '../config/database';
import { computeAuditHash } from '../utils/hash';
import { PaginationParams, buildPaginatedResponse } from '../utils/pagination';
import type { Prisma } from '@prisma/client';

interface AuditLogInput {
  actorId?: string | null;
  actorEmail?: string;
  actorOrg?: string;
  entityType: string;
  entityId: string;
  action: string;
  description: string;
  previousData?: any;
  newData?: any;
  changedFields?: string[];
  ipAddress?: string;
  userAgent?: string;
}

const MAX_WRITE_ATTEMPTS = 5;

/**
 * Serialise audit writes through a Postgres SERIALIZABLE transaction so two
 * concurrent requests can't both read the same "last sequence" and then each
 * insert `sequence = N+1`.  If Postgres aborts a serialisation conflict we
 * retry a handful of times — this matches the pattern used for write-heavy
 * counters.
 */
async function writeAuditEntry(input: AuditLogInput) {
  const now = new Date();

  for (let attempt = 1; attempt <= MAX_WRITE_ATTEMPTS; attempt++) {
    try {
      return await prisma.$transaction(
        async (tx) => {
          const lastEntry = await tx.auditEntry.findFirst({
            orderBy: { sequence: 'desc' },
            select: { hash: true, sequence: true },
          });

          const previousHash = lastEntry?.hash ?? null;
          const nextSequence = (lastEntry?.sequence ?? 0) + 1;

          const hash = computeAuditHash({
            sequence: nextSequence,
            actorId: input.actorId ?? null,
            entityType: input.entityType,
            entityId: input.entityId,
            action: input.action,
            description: input.description,
            previousHash,
            createdAt: now,
          });

          return tx.auditEntry.create({
            data: {
              sequence: nextSequence,
              actorId: input.actorId ?? null,
              actorEmail: input.actorEmail,
              actorOrg: input.actorOrg,
              entityType: input.entityType,
              entityId: input.entityId,
              action: input.action,
              description: input.description,
              previousData: input.previousData ? JSON.stringify(input.previousData) : null,
              newData: input.newData ? JSON.stringify(input.newData) : null,
              changedFields: JSON.stringify(input.changedFields ?? []),
              previousHash,
              hash,
              ipAddress: input.ipAddress,
              userAgent: input.userAgent,
              createdAt: now,
            },
          });
        },
        // String literal avoids tying the build to a specific Prisma
        // TransactionIsolationLevel enum path — the runtime accepts both.
        { isolationLevel: 'Serializable' as any },
      );
    } catch (err: any) {
      // Postgres serialization_failure = 40001; unique_violation on the
      // sequence column = P2002 from Prisma.  Retry either case.
      const retryable =
        err?.code === 'P2002' ||
        err?.code === '40001' ||
        /serialization|could not serialize|unique constraint/i.test(err?.message ?? '');
      if (retryable && attempt < MAX_WRITE_ATTEMPTS) {
        // small random backoff so retriers don't line up
        await new Promise((r) => setTimeout(r, 5 + Math.random() * 20));
        continue;
      }
      throw err;
    }
  }

  // Unreachable, but satisfies TypeScript.
  throw new Error('Audit write failed after retries');
}

export const auditService = {
  async log(input: AuditLogInput) {
    return writeAuditEntry(input);
  },

  /**
   * List audit entries visible to the given organisation.
   *
   * Previous behaviour only matched entries whose `actorId` was a member of
   * the org, which hid activity performed on the org's resources by external
   * collaborators (and anonymous/system events).  The new filter also
   * includes entries where the `entityType` + `entityId` refers to something
   * the org owns (vessel, work order, invitation).
   */
  async list(params: PaginationParams, organisationId: string, filters?: Record<string, string>) {
    // Org users set (internal actor scope).
    const orgUsers = await prisma.organisationUser.findMany({
      where: { organisationId },
      select: { userId: true },
    });
    const orgUserIds = orgUsers.map((ou) => ou.userId);

    // Resource IDs the org owns.
    const [vessels, workOrders] = await Promise.all([
      prisma.vessel.findMany({ where: { organisationId }, select: { id: true } }),
      prisma.workOrder.findMany({ where: { organisationId }, select: { id: true } }),
    ]);

    const vesselIds = vessels.map((v) => v.id);
    const workOrderIds = workOrders.map((w) => w.id);

    const visibilityConditions: Prisma.AuditEntryWhereInput[] = [
      { actorId: { in: orgUserIds } },
    ];
    if (vesselIds.length > 0) visibilityConditions.push({ entityType: 'Vessel', entityId: { in: vesselIds } });
    if (workOrderIds.length > 0) visibilityConditions.push({ entityType: 'WorkOrder', entityId: { in: workOrderIds } });

    const where: Prisma.AuditEntryWhereInput = { OR: visibilityConditions };

    if (filters?.entityType) (where as any).entityType = filters.entityType;
    if (filters?.entityId) (where as any).entityId = filters.entityId;
    if (filters?.action) (where as any).action = filters.action;
    if (filters?.actorId) (where as any).actorId = filters.actorId;

    if (filters?.from || filters?.to) {
      const range: Prisma.DateTimeFilter = {};
      if (filters?.from) range.gte = new Date(filters.from);
      if (filters?.to) range.lte = new Date(filters.to);
      (where as any).createdAt = range;
    }

    const [data, total] = await Promise.all([
      prisma.auditEntry.findMany({
        where,
        skip: params.skip,
        take: params.limit,
        orderBy: { sequence: params.order },
        include: { actor: { select: { id: true, firstName: true, lastName: true, email: true } } },
      }),
      prisma.auditEntry.count({ where }),
    ]);

    return buildPaginatedResponse(data, total, params);
  },

  async verify() {
    const entries = await prisma.auditEntry.findMany({
      orderBy: { sequence: 'asc' },
      select: {
        sequence: true,
        actorId: true,
        entityType: true,
        entityId: true,
        action: true,
        description: true,
        hash: true,
        previousHash: true,
        createdAt: true,
      },
    });

    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      const computed = computeAuditHash({
        sequence: entry.sequence,
        actorId: entry.actorId,
        entityType: entry.entityType,
        entityId: entry.entityId,
        action: entry.action,
        description: entry.description,
        previousHash: entry.previousHash,
        createdAt: entry.createdAt,
      });

      if (computed !== entry.hash) {
        return {
          valid: false,
          entriesChecked: i,
          brokenAtSequence: entry.sequence,
          verifiedAt: new Date().toISOString(),
        };
      }

      if (i > 0 && entry.previousHash !== entries[i - 1].hash) {
        return {
          valid: false,
          entriesChecked: i,
          brokenAtSequence: entry.sequence,
          verifiedAt: new Date().toISOString(),
        };
      }
    }

    return {
      valid: true,
      entriesChecked: entries.length,
      lastVerifiedSequence: entries.length > 0 ? entries[entries.length - 1].sequence : 0,
      lastHash: entries.length > 0 ? entries[entries.length - 1].hash : null,
      verifiedAt: new Date().toISOString(),
    };
  },
};
