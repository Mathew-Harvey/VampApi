import { Router } from 'express';
import { inspectionService } from '../services/inspection.service';
import { authenticate } from '../middleware/auth';
import { requirePermission } from '../middleware/permissions';
import { validate } from '../middleware/validate';
import { createInspectionSchema, updateInspectionSchema, createFindingSchema } from '../schemas/inspection.schema';
import { getPaginationParams } from '../utils/pagination';
import { asyncHandler } from '../utils/async-handler';

const router = Router();

router.get('/', authenticate, requirePermission('INSPECTION_VIEW'), asyncHandler(async (req, res) => {
  const params = getPaginationParams(req);
  const filters = {
    vesselId: req.query.vesselId as string,
    workOrderId: req.query.workOrderId as string,
    status: req.query.status as string,
    type: req.query.type as string,
  };
  const result = await inspectionService.list(params, req.user!.organisationId, req.user!.userId, filters);
  res.json(result);
}));

router.post('/', authenticate, requirePermission('INSPECTION_CREATE'), validate(createInspectionSchema), asyncHandler(async (req, res) => {
  const inspection = await inspectionService.create(req.body, req.user!.userId);
  res.status(201).json({ success: true, data: inspection });
}));

router.get('/:id', authenticate, requirePermission('INSPECTION_VIEW'), asyncHandler(async (req, res) => {
  const inspection = await inspectionService.getById((req.params.id as string));
  res.json({ success: true, data: inspection });
}));

router.put('/:id', authenticate, requirePermission('INSPECTION_EDIT'), validate(updateInspectionSchema), asyncHandler(async (req, res) => {
  const inspection = await inspectionService.update((req.params.id as string), req.body, req.user!.userId);
  res.json({ success: true, data: inspection });
}));

router.post('/:id/findings', authenticate, requirePermission('INSPECTION_EDIT'), validate(createFindingSchema), asyncHandler(async (req, res) => {
  const finding = await inspectionService.addFinding((req.params.id as string), req.body, req.user!.userId);
  res.status(201).json({ success: true, data: finding });
}));

router.put('/:id/findings/:findingId', authenticate, requirePermission('INSPECTION_EDIT'), asyncHandler(async (req, res) => {
  const finding = await inspectionService.updateFinding((req.params.findingId as string), req.body, req.user!.userId);
  res.json({ success: true, data: finding });
}));

router.patch('/:id/complete', authenticate, requirePermission('INSPECTION_EDIT'), asyncHandler(async (req, res) => {
  const inspection = await inspectionService.complete((req.params.id as string), req.user!.userId);
  res.json({ success: true, data: inspection });
}));

router.patch('/:id/approve', authenticate, requirePermission('INSPECTION_APPROVE'), asyncHandler(async (req, res) => {
  const inspection = await inspectionService.approve((req.params.id as string), req.user!.userId);
  res.json({ success: true, data: inspection });
}));

export default router;
