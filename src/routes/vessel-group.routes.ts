import { Router } from 'express';
import { vesselGroupService } from '../services/vessel-group.service';
import { authenticate } from '../middleware/auth';
import { requirePermission } from '../middleware/permissions';
import { validate } from '../middleware/validate';
import {
  createVesselGroupSchema,
  updateVesselGroupSchema,
  addVesselsToGroupSchema,
  removeVesselsFromGroupSchema,
  reorderGroupsSchema,
} from '../schemas/vessel-group.schema';
import { asyncHandler } from '../utils/async-handler';

const router = Router();

router.get('/', authenticate, requirePermission('VESSEL_VIEW'), asyncHandler(async (req, res) => {
  const groups = await vesselGroupService.list(req.user!.organisationId);
  res.json({ success: true, data: groups });
}));

router.post('/', authenticate, requirePermission('VESSEL_GROUP_MANAGE'), validate(createVesselGroupSchema), asyncHandler(async (req, res) => {
  const group = await vesselGroupService.create(req.body, req.user!.organisationId, req.user!.userId);
  res.status(201).json({ success: true, data: group });
}));

router.put('/reorder', authenticate, requirePermission('VESSEL_GROUP_MANAGE'), validate(reorderGroupsSchema), asyncHandler(async (req, res) => {
  await vesselGroupService.reorder(req.body.groupIds, req.user!.organisationId, req.user!.userId);
  res.json({ success: true, data: { message: 'Groups reordered' } });
}));

router.get('/:id', authenticate, requirePermission('VESSEL_VIEW'), asyncHandler(async (req, res) => {
  const group = await vesselGroupService.getById(req.params.id, req.user!.organisationId);
  res.json({ success: true, data: group });
}));

router.put('/:id', authenticate, requirePermission('VESSEL_GROUP_MANAGE'), validate(updateVesselGroupSchema), asyncHandler(async (req, res) => {
  const group = await vesselGroupService.update(req.params.id, req.body, req.user!.organisationId, req.user!.userId);
  res.json({ success: true, data: group });
}));

router.delete('/:id', authenticate, requirePermission('VESSEL_GROUP_MANAGE'), asyncHandler(async (req, res) => {
  await vesselGroupService.softDelete(req.params.id, req.user!.organisationId, req.user!.userId);
  res.json({ success: true, data: { message: 'Vessel group deleted' } });
}));

router.post('/:id/vessels', authenticate, requirePermission('VESSEL_GROUP_MANAGE'), validate(addVesselsToGroupSchema), asyncHandler(async (req, res) => {
  const result = await vesselGroupService.addVessels(req.params.id, req.body.vesselIds, req.user!.organisationId, req.user!.userId);
  res.status(201).json({ success: true, data: result });
}));

router.post('/:id/vessels/remove', authenticate, requirePermission('VESSEL_GROUP_MANAGE'), validate(removeVesselsFromGroupSchema), asyncHandler(async (req, res) => {
  const result = await vesselGroupService.removeVessels(req.params.id, req.body.vesselIds, req.user!.organisationId, req.user!.userId);
  res.json({ success: true, data: result });
}));

export default router;
