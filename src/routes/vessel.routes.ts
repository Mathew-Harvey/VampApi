import { Router, Request, Response } from 'express';
import { vesselService } from '../services/vessel.service';
import { authenticate } from '../middleware/auth';
import { requirePermission } from '../middleware/permissions';
import { validate } from '../middleware/validate';
import { createVesselSchema, updateVesselSchema } from '../schemas/vessel.schema';
import { getPaginationParams } from '../utils/pagination';

const router = Router();

router.get('/', authenticate, requirePermission('VESSEL_VIEW'), async (req: Request, res: Response) => {
  try {
    const params = getPaginationParams(req);
    const filters = { status: req.query.status as string, vesselType: req.query.vesselType as string, complianceStatus: req.query.complianceStatus as string };
    const result = await vesselService.list(params, req.user!.organisationId, filters);
    res.json(result);
  } catch (error: any) {
    res.status(error.statusCode || 500).json({ success: false, error: { code: error.code || 'ERROR', message: error.message } });
  }
});

router.post('/', authenticate, requirePermission('VESSEL_CREATE'), validate(createVesselSchema), async (req: Request, res: Response) => {
  try {
    const vessel = await vesselService.create(req.body, req.user!.organisationId, req.user!.userId);
    res.status(201).json({ success: true, data: vessel });
  } catch (error: any) {
    res.status(error.statusCode || 500).json({ success: false, error: { code: error.code || 'ERROR', message: error.message } });
  }
});

router.get('/:id', authenticate, requirePermission('VESSEL_VIEW'), async (req: Request, res: Response) => {
  try {
    const vessel = await vesselService.getById((req.params.id as string), req.user!.organisationId);
    res.json({ success: true, data: vessel });
  } catch (error: any) {
    res.status(error.statusCode || 500).json({ success: false, error: { code: error.code || 'ERROR', message: error.message } });
  }
});

router.put('/:id', authenticate, requirePermission('VESSEL_EDIT'), validate(updateVesselSchema), async (req: Request, res: Response) => {
  try {
    const vessel = await vesselService.update((req.params.id as string), req.body, req.user!.userId);
    res.json({ success: true, data: vessel });
  } catch (error: any) {
    res.status(error.statusCode || 500).json({ success: false, error: { code: error.code || 'ERROR', message: error.message } });
  }
});

router.delete('/:id', authenticate, requirePermission('VESSEL_DELETE'), async (req: Request, res: Response) => {
  try {
    await vesselService.softDelete((req.params.id as string), req.user!.userId);
    res.json({ success: true, data: { message: 'Vessel deleted' } });
  } catch (error: any) {
    res.status(error.statusCode || 500).json({ success: false, error: { code: error.code || 'ERROR', message: error.message } });
  }
});

export default router;
