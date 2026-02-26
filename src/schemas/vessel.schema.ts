import { z } from 'zod';

export const createVesselSchema = z.object({
  name: z.string().min(1, 'Vessel name is required').max(200),
  imoNumber: z.string().optional().nullable(),
  mmsi: z.string().optional().nullable(),
  callSign: z.string().optional().nullable(),
  flagState: z.string().optional().nullable(),
  vesselType: z.string().min(1, 'Vessel type is required'),
  grossTonnage: z.number().positive().optional().nullable(),
  lengthOverall: z.number().positive().optional().nullable(),
  beam: z.number().positive().optional().nullable(),
  maxDraft: z.number().positive().optional().nullable(),
  minDraft: z.number().positive().optional().nullable(),
  yearBuilt: z.number().int().min(1800).max(2100).optional().nullable(),
  homePort: z.string().optional().nullable(),
  classificationSociety: z.string().optional().nullable(),
  afsCoatingType: z.string().optional().nullable(),
  afsManufacturer: z.string().optional().nullable(),
  afsProductName: z.string().optional().nullable(),
  afsApplicationDate: z.string().datetime().optional().nullable(),
  afsServiceLife: z.number().int().positive().optional().nullable(),
  lastDrydockDate: z.string().datetime().optional().nullable(),
  nextDrydockDate: z.string().datetime().optional().nullable(),
  typicalSpeed: z.number().positive().optional().nullable(),
  tradingRoutes: z.string().optional().nullable(),
  operatingArea: z.string().optional().nullable(),
  climateZones: z.array(z.string()).optional().default([]),
  metadata: z.record(z.unknown()).optional().nullable(),
});

export const updateVesselSchema = createVesselSchema.partial();

export type CreateVesselInput = z.infer<typeof createVesselSchema>;
export type UpdateVesselInput = z.infer<typeof updateVesselSchema>;
