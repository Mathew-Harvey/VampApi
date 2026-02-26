import { Router, Request, Response } from 'express';
import { inspectionService } from '../services/inspection.service';
import { authenticate } from '../middleware/auth';
import { requirePermission } from '../middleware/permissions';
import { validate } from '../middleware/validate';
import { createInspectionSchema, updateInspectionSchema, createFindingSchema } from '../schemas/inspection.schema';
import { getPaginationParams } from '../utils/pagination';

const router = Router();

router.get('/', authenticate, requirePermission('INSPECTION_VIEW'), async (req: Request, res: Response) => {
  try {
    const params = getPaginationParams(req);
    const filters = {
      vesselId: req.query.vesselId as string,
      workOrderId: req.query.workOrderId as string,
      status: req.query.status as string,
      type: req.query.type as string,
    };
    const result = await inspectionService.list(params, filters);
    res.json(result);
  } catch (error: any) {
    res.status(error.statusCode || 500).json({ success: false, error: { code: error.code || 'ERROR', message: error.message } });
  }
});

router.post('/', authenticate, requirePermission('INSPECTION_CREATE'), validate(createInspectionSchema), async (req: Request, res: Response) => {
  try {
    const inspection = await inspectionService.create(req.body, req.user!.userId);
    res.status(201).json({ success: true, data: inspection });
  } catch (error: any) {
    res.status(error.statusCode || 500).json({ success: false, error: { code: error.code || 'ERROR', message: error.message } });
  }
});

router.get('/:id', authenticate, requirePermission('INSPECTION_VIEW'), async (req: Request, res: Response) => {
  try {
    const inspection = await inspectionService.getById((req.params.id as string));
    res.json({ success: true, data: inspection });
  } catch (error: any) {
    res.status(error.statusCode || 500).json({ success: false, error: { code: error.code || 'ERROR', message: error.message } });
  }
});

router.put('/:id', authenticate, requirePermission('INSPECTION_EDIT'), validate(updateInspectionSchema), async (req: Request, res: Response) => {
  try {
    const inspection = await inspectionService.update((req.params.id as string), req.body, req.user!.userId);
    res.json({ success: true, data: inspection });
  } catch (error: any) {
    res.status(error.statusCode || 500).json({ success: false, error: { code: error.code || 'ERROR', message: error.message } });
  }
});

router.post('/:id/findings', authenticate, requirePermission('INSPECTION_EDIT'), validate(createFindingSchema), async (req: Request, res: Response) => {
  try {
    const finding = await inspectionService.addFinding((req.params.id as string), req.body, req.user!.userId);
    res.status(201).json({ success: true, data: finding });
  } catch (error: any) {
    res.status(error.statusCode || 500).json({ success: false, error: { code: error.code || 'ERROR', message: error.message } });
  }
});

router.put('/:id/findings/:findingId', authenticate, requirePermission('INSPECTION_EDIT'), async (req: Request, res: Response) => {
  try {
    const finding = await inspectionService.updateFinding((req.params.findingId as string), req.body, req.user!.userId);
    res.json({ success: true, data: finding });
  } catch (error: any) {
    res.status(error.statusCode || 500).json({ success: false, error: { code: error.code || 'ERROR', message: error.message } });
  }
});

router.patch('/:id/complete', authenticate, requirePermission('INSPECTION_EDIT'), async (req: Request, res: Response) => {
  try {
    const inspection = await inspectionService.complete((req.params.id as string), req.user!.userId);
    res.json({ success: true, data: inspection });
  } catch (error: any) {
    res.status(error.statusCode || 500).json({ success: false, error: { code: error.code || 'ERROR', message: error.message } });
  }
});

router.patch('/:id/approve', authenticate, requirePermission('INSPECTION_APPROVE'), async (req: Request, res: Response) => {
  try {
    const inspection = await inspectionService.approve((req.params.id as string), req.user!.userId);
    res.json({ success: true, data: inspection });
  } catch (error: any) {
    res.status(error.statusCode || 500).json({ success: false, error: { code: error.code || 'ERROR', message: error.message } });
  }
});

export default router;
