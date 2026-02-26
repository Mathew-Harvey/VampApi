import prisma from '../config/database';
import { computeAuditHash } from '../utils/hash';
import { PaginationParams, buildPaginatedResponse } from '../utils/pagination';

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

export const auditService = {
  async log(input: AuditLogInput) {
    // Get previous entry for hash chain and next sequence number
    const lastEntry = await prisma.auditEntry.findFirst({
      orderBy: { sequence: 'desc' },
      select: { hash: true, sequence: true },
    });

    const previousHash = lastEntry?.hash ?? null;
    const nextSequence = (lastEntry?.sequence ?? 0) + 1;
    const now = new Date();

    // Compute hash
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

    // Create the entry with computed hash and sequence
    return prisma.auditEntry.create({
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

  async list(params: PaginationParams, filters?: Record<string, string>) {
    const where: any = {};
    if (filters?.entityType) where.entityType = filters.entityType;
    if (filters?.entityId) where.entityId = filters.entityId;
    if (filters?.action) where.action = filters.action;
    if (filters?.actorId) where.actorId = filters.actorId;

    if (filters?.from || filters?.to) {
      where.createdAt = {};
      if (filters?.from) where.createdAt.gte = new Date(filters.from);
      if (filters?.to) where.createdAt.lte = new Date(filters.to);
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
