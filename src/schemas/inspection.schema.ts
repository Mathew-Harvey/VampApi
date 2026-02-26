import { z } from 'zod';

export const createInspectionSchema = z.object({
  workOrderId: z.string().min(1, 'Work order is required'),
  vesselId: z.string().min(1, 'Vessel is required'),
  type: z.string().min(1, 'Inspection type is required'),
  inspectorName: z.string().min(1, 'Inspector name is required'),
  inspectorOrg: z.string().optional().nullable(),
  inspectorCert: z.string().optional().nullable(),
  waterTemp: z.number().optional().nullable(),
  waterVisibility: z.number().optional().nullable(),
  waterSalinity: z.number().optional().nullable(),
  weatherConditions: z.string().optional().nullable(),
  seaState: z.string().optional().nullable(),
  tideState: z.string().optional().nullable(),
  location: z.string().optional().nullable(),
  latitude: z.number().min(-90).max(90).optional().nullable(),
  longitude: z.number().min(-180).max(180).optional().nullable(),
});

export const updateInspectionSchema = createInspectionSchema.partial();

export const createFindingSchema = z.object({
  nicheAreaId: z.string().optional().nullable(),
  area: z.string().min(1, 'Area is required'),
  foulingRating: z.number().int().min(0).max(5).optional().nullable(),
  foulingType: z.string().optional().nullable(),
  coverage: z.number().min(0).max(100).optional().nullable(),
  condition: z.string().optional().nullable(),
  measurementType: z.string().optional().nullable(),
  measurementValue: z.number().optional().nullable(),
  measurementUnit: z.string().optional().nullable(),
  referenceStandard: z.string().optional().nullable(),
  coatingCondition: z.string().optional().nullable(),
  corrosionType: z.string().optional().nullable(),
  corrosionSeverity: z.string().optional().nullable(),
  description: z.string().optional().nullable(),
  recommendation: z.string().optional().nullable(),
  actionRequired: z.boolean().default(false),
  priority: z.enum(['LOW', 'NORMAL', 'HIGH', 'URGENT']).default('NORMAL'),
  metadata: z.record(z.unknown()).optional().nullable(),
});

export type CreateInspectionInput = z.infer<typeof createInspectionSchema>;
export type CreateFindingInput = z.infer<typeof createFindingSchema>;
