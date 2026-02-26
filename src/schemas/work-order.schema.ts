import { z } from 'zod';

export const createWorkOrderSchema = z.object({
  vesselId: z.string().min(1, 'Vessel is required'),
  workflowId: z.string().optional().nullable(),
  title: z.string().min(1, 'Title is required').max(300),
  description: z.string().optional().nullable(),
  type: z.string().min(1, 'Work order type is required'),
  priority: z.enum(['LOW', 'NORMAL', 'HIGH', 'URGENT']).default('NORMAL'),
  location: z.string().optional().nullable(),
  latitude: z.number().min(-90).max(90).optional().nullable(),
  longitude: z.number().min(-180).max(180).optional().nullable(),
  scheduledStart: z.string().datetime().optional().nullable(),
  scheduledEnd: z.string().datetime().optional().nullable(),
  regulatoryRef: z.string().optional().nullable(),
  complianceFramework: z.array(z.string()).optional().default([]),
  metadata: z.record(z.unknown()).optional().nullable(),
});

export const updateWorkOrderSchema = createWorkOrderSchema.partial();

export const changeStatusSchema = z.object({
  status: z.enum([
    'DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'IN_PROGRESS',
    'AWAITING_REVIEW', 'UNDER_REVIEW', 'COMPLETED', 'CANCELLED', 'ON_HOLD',
  ]),
  reason: z.string().optional(),
});

export const assignWorkOrderSchema = z.object({
  userId: z.string().min(1),
  role: z.enum(['LEAD', 'TEAM_MEMBER', 'REVIEWER', 'OBSERVER']),
});

export type CreateWorkOrderInput = z.infer<typeof createWorkOrderSchema>;
export type UpdateWorkOrderInput = z.infer<typeof updateWorkOrderSchema>;
