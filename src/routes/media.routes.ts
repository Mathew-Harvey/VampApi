import { Router, Request, Response } from 'express';
import { mediaService } from '../services/media.service';
import { authenticate } from '../middleware/auth';
import { upload } from '../middleware/upload';
import { workOrderService } from '../services/work-order.service';
import { hasAnyPermission } from '../middleware/permissions';

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

router.post('/upload', authenticate, upload.single('file'), async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      res.status(400).json({ success: false, error: { code: 'NO_FILE', message: 'No file uploaded' } });
      return;
    }
    const media = await mediaService.create(req.file, req.user!.userId, req.body);
    res.status(201).json({ success: true, data: media });
  } catch (error: any) {
    res.status(error.statusCode || 500).json({ success: false, error: { code: error.code || 'ERROR', message: error.message } });
  }
});

router.get('/sync/pending', authenticate, async (req: Request, res: Response) => {
  try {
    const data = await mediaService.getPendingSyncWorkOrders(req.user!.userId, req.user!.organisationId);
    res.json({ success: true, data });
  } catch (error: any) {
    res.status(error.statusCode || 500).json({ success: false, error: { code: error.code || 'ERROR', message: error.message } });
  }
});

router.post('/sync/work-order/:workOrderId', authenticate, async (req: Request, res: Response) => {
  try {
    const workOrderId = req.params.workOrderId as string;
    const canView = await canViewWorkOrderFromRequest(req, workOrderId);
    if (!canView) {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Work order not found' } });
      return;
    }

    const data = await mediaService.syncWorkOrderMedia(workOrderId);
    res.json({ success: true, data });
  } catch (error: any) {
    res.status(error.statusCode || 500).json({ success: false, error: { code: error.code || 'ERROR', message: error.message } });
  }
});

router.get('/:id', authenticate, async (req: Request, res: Response) => {
  try {
    const media = await mediaService.getById((req.params.id as string));
    res.json({ success: true, data: media });
  } catch (error: any) {
    res.status(error.statusCode || 500).json({ success: false, error: { code: error.code || 'ERROR', message: error.message } });
  }
});

router.delete('/:id', authenticate, async (req: Request, res: Response) => {
  try {
    await mediaService.delete((req.params.id as string), req.user!.userId);
    res.json({ success: true, data: { message: 'Media deleted' } });
  } catch (error: any) {
    res.status(error.statusCode || 500).json({ success: false, error: { code: error.code || 'ERROR', message: error.message } });
  }
});

export default router;
