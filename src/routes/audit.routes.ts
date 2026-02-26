import { Router, Request, Response } from 'express';
import { auditService } from '../services/audit.service';
import { authenticate } from '../middleware/auth';
import { requirePermission } from '../middleware/permissions';
import { getPaginationParams } from '../utils/pagination';

const router = Router();

router.get('/', authenticate, requirePermission('AUDIT_VIEW'), async (req: Request, res: Response) => {
  try {
    const params = getPaginationParams(req);
    const filters = {
      entityType: req.query.entityType as string,
      entityId: req.query.entityId as string,
      action: req.query.action as string,
      actorId: req.query.actorId as string,
      from: req.query.from as string,
      to: req.query.to as string,
    };
    const result = await auditService.list(params, filters);
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ success: false, error: { code: 'ERROR', message: error.message } });
  }
});

router.get('/verify', authenticate, requirePermission('AUDIT_VIEW'), async (_req: Request, res: Response) => {
  try {
    const result = await auditService.verify();
    res.json({ success: true, data: result });
  } catch (error: any) {
    res.status(500).json({ success: false, error: { code: 'ERROR', message: error.message } });
  }
});

export default router;
