import { z } from 'zod';

export const createVesselGroupSchema = z.object({
  name: z.string().min(1, 'Group name is required').max(100),
  description: z.string().max(500).optional().nullable(),
  color: z.string().max(20).optional().nullable(),
});

export const updateVesselGroupSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional().nullable(),
  color: z.string().max(20).optional().nullable(),
});

export const addVesselsToGroupSchema = z.object({
  vesselIds: z.array(z.string().min(1)).min(1, 'At least one vessel ID is required'),
});

export const removeVesselsFromGroupSchema = z.object({
  vesselIds: z.array(z.string().min(1)).min(1, 'At least one vessel ID is required'),
});

export const reorderGroupsSchema = z.object({
  groupIds: z.array(z.string().min(1)).min(1, 'At least one group ID is required'),
});

export type CreateVesselGroupInput = z.infer<typeof createVesselGroupSchema>;
export type UpdateVesselGroupInput = z.infer<typeof updateVesselGroupSchema>;
