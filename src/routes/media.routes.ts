import { Router, Request } from 'express';
import { mediaService } from '../services/media.service';
import { authenticate } from '../middleware/auth';
import { upload } from '../middleware/upload';
import { workOrderService } from '../services/work-order.service';
import { hasAnyPermission } from '../middleware/permissions';
import { asyncHandler } from '../utils/async-handler';

const router = Router();

async function canViewWorkOrderFromRequest(req: Request, workOrderId: string) {
  const includeOrganisationScope = hasAnyPermission(req.user, 'WORK_ORDER_VIEW');
  return workOrderService.canViewWorkOrder(
    workOrderId,
    req.user!.userId,
    req.user!.organisationId,
    includeOrganisationScope,
  );
}

router.post('/upload', authenticate, upload.single('file'), asyncHandler(async (req, res) => {
  if (!req.file) {
    res.status(400).json({ success: false, error: { code: 'NO_FILE', message: 'No file uploaded' } });
    return;
  }
  const media = await mediaService.create(req.file, req.user!.userId, req.body);
  res.status(201).json({ success: true, data: media });
}));

router.get('/sync/pending', authenticate, asyncHandler(async (req, res) => {
  const data = await mediaService.getPendingSyncWorkOrders(req.user!.userId, req.user!.organisationId);
  res.json({ success: true, data });
}));

router.post('/sync/work-order/:workOrderId', authenticate, asyncHandler(async (req, res) => {
  const workOrderId = req.params.workOrderId as string;
  const canView = await canViewWorkOrderFromRequest(req, workOrderId);
  if (!canView) {
    res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Work order not found' } });
    return;
  }

  const data = await mediaService.syncWorkOrderMedia(workOrderId);
  res.json({ success: true, data });
}));

router.get('/:id', authenticate, asyncHandler(async (req, res) => {
  const media = await mediaService.getById((req.params.id as string));
  res.json({ success: true, data: media });
}));

router.delete('/:id', authenticate, asyncHandler(async (req, res) => {
  await mediaService.delete((req.params.id as string), req.user!.userId);
  res.json({ success: true, data: { message: 'Media deleted' } });
}));

export default router;
