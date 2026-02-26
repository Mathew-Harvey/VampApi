import prisma from '../config/database';
import { AppError } from '../middleware/error';
import { PaginationParams, buildPaginatedResponse } from '../utils/pagination';
import { auditService } from './audit.service';
import { Prisma } from '@prisma/client';

const fleetOrgId = () => process.env.FLEET_ORG_ID || '';

export const vesselService = {
  async list(params: PaginationParams, organisationId: string, filters?: Record<string, string>) {
    const orgIds = [organisationId];
    if (fleetOrgId()) orgIds.push(fleetOrgId());
    const where: Prisma.VesselWhereInput = { isDeleted: false, organisationId: { in: orgIds } };

    if (params.search) {
      where.OR = [
        { name: { contains: params.search } },
        { imoNumber: { contains: params.search } },
        { callSign: { contains: params.search } },
      ];
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

    return buildPaginatedResponse(data, total, params);
  },

  async getById(id: string, organisationId?: string) {
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
    if (organisationId && vessel.organisationId !== organisationId && vessel.organisationId !== fleetOrgId()) {
      throw new AppError(404, 'NOT_FOUND', 'Vessel not found');
    }
    return vessel;
  },

  async create(data: any, organisationId: string, userId: string) {
    const payload: any = { organisationId };
    // Copy only defined fields, serializing arrays/objects to JSON strings for SQLite
    const stringFields = ['name', 'vesselType', 'imoNumber', 'mmsi', 'callSign', 'flagState',
      'homePort', 'classificationSociety', 'afsCoatingType', 'afsManufacturer', 'afsProductName',
      'tradingRoutes', 'operatingArea', 'bfmpDocumentUrl', 'bfmpRevision', 'regulatoryRef'];
    const numFields = ['grossTonnage', 'lengthOverall', 'beam', 'maxDraft', 'minDraft',
      'yearBuilt', 'afsServiceLife', 'typicalSpeed'];

    for (const f of stringFields) { if (data[f] !== undefined) payload[f] = data[f]; }
    for (const f of numFields) { if (data[f] !== undefined) payload[f] = data[f]; }

    // JSON fields stored as strings in SQLite
    payload.climateZones = JSON.stringify(data.climateZones || []);
    if (data.metadata != null) payload.metadata = JSON.stringify(data.metadata);

    // Date fields
    if (data.afsApplicationDate) payload.afsApplicationDate = new Date(data.afsApplicationDate);
    if (data.lastDrydockDate) payload.lastDrydockDate = new Date(data.lastDrydockDate);
    if (data.nextDrydockDate) payload.nextDrydockDate = new Date(data.nextDrydockDate);

    const vessel = await prisma.vessel.create({ data: payload });

    await auditService.log({
      actorId: userId,
      entityType: 'Vessel',
      entityId: vessel.id,
      action: 'CREATE',
      description: `Created vessel "${vessel.name}"`,
      newData: vessel as any,
    });

    return vessel;
  },

  async update(id: string, data: any, userId: string) {
    const existing = await prisma.vessel.findFirst({ where: { id, isDeleted: false } });
    if (!existing) throw new AppError(404, 'NOT_FOUND', 'Vessel not found');
    if (existing.source === 'RISE_X') throw new AppError(403, 'FORBIDDEN', 'Synced fleet vessels are read-only');

    const vessel = await prisma.vessel.update({ where: { id }, data });

    await auditService.log({
      actorId: userId,
      entityType: 'Vessel',
      entityId: vessel.id,
      action: 'UPDATE',
      description: `Updated vessel "${vessel.name}"`,
      previousData: existing as any,
      newData: vessel as any,
      changedFields: Object.keys(data),
    });

    return vessel;
  },

  async softDelete(id: string, userId: string) {
    const existing = await prisma.vessel.findFirst({ where: { id, isDeleted: false } });
    if (!existing) throw new AppError(404, 'NOT_FOUND', 'Vessel not found');
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
