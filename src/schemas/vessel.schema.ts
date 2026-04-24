import { z } from 'zod';

/**
 * Accepts either an ISO 8601 datetime string (`2026-04-17T00:00:00Z`) or a
 * bare date string (`2026-04-17`) from <input type="date"> pickers.
 */
const dateLike = z.string().refine(
  (v) => !Number.isNaN(new Date(v).getTime()),
  { message: 'Invalid date' },
);

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
  afsApplicationDate: dateLike.optional().nullable(),
  afsServiceLife: z.number().int().positive().optional().nullable(),
  lastDrydockDate: dateLike.optional().nullable(),
  nextDrydockDate: dateLike.optional().nullable(),
  typicalSpeed: z.number().positive().optional().nullable(),
  tradingRoutes: z.string().optional().nullable(),
  operatingArea: z.string().optional().nullable(),
  climateZones: z.array(z.string()).optional().default([]),
  metadata: z.record(z.unknown()).optional().nullable(),
  // Optional base64-encoded icon image stored as a `data:image/...;base64,...`
  // URL.  We cap at ~350 KB of encoded text (~260 KB of raw image) to keep
  // row sizes sane — the web client is expected to downscale before upload.
  iconImage: z
    .string()
    .max(350_000, 'Icon image is too large (max ~256 KB after encoding)')
    .regex(/^data:image\/(png|jpeg|jpg|webp);base64,/i, 'Icon image must be a data URL')
    .optional()
    .nullable(),
});

export const updateVesselSchema = createVesselSchema.partial();

export type CreateVesselInput = z.infer<typeof createVesselSchema>;
export type UpdateVesselInput = z.infer<typeof updateVesselSchema>;
