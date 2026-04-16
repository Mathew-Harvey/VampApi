import { Router } from 'express';
import { vesselService } from '../services/vessel.service';
import { authenticate } from '../middleware/auth';
import { requirePermission } from '../middleware/permissions';
import { validate } from '../middleware/validate';
import { createVesselSchema, updateVesselSchema } from '../schemas/vessel.schema';
import { getPaginationParams } from '../utils/pagination';
import { asyncHandler } from '../utils/async-handler';

const router = Router();

router.get('/', authenticate, requirePermission('VESSEL_VIEW'), asyncHandler(async (req, res) => {
  const params = getPaginationParams(req);
  const filters = { status: req.query.status as string, vesselType: req.query.vesselType as string, complianceStatus: req.query.complianceStatus as string };
  const result = await vesselService.list(params, req.user!.organisationId, filters);
  res.json(result);
}));

router.post('/', authenticate, requirePermission('VESSEL_CREATE'), validate(createVesselSchema), asyncHandler(async (req, res) => {
  const vessel = await vesselService.create(req.body, req.user!.organisationId, req.user!.userId);
  res.status(201).json({ success: true, data: vessel });
}));

router.get('/:id', authenticate, requirePermission('VESSEL_VIEW'), asyncHandler(async (req, res) => {
  const vessel = await vesselService.getById((req.params.id as string), req.user!.organisationId);
  res.json({ success: true, data: vessel });
}));

router.put('/:id', authenticate, requirePermission('VESSEL_EDIT'), validate(updateVesselSchema), asyncHandler(async (req, res) => {
  const vessel = await vesselService.update((req.params.id as string), req.body, req.user!.userId, req.user!.organisationId);
  res.json({ success: true, data: vessel });
}));

router.delete('/:id', authenticate, requirePermission('VESSEL_DELETE'), asyncHandler(async (req, res) => {
  await vesselService.softDelete((req.params.id as string), req.user!.userId, req.user!.organisationId);
  res.json({ success: true, data: { message: 'Vessel deleted' } });
}));

export default router;
