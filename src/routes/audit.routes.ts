import { Router } from 'express';
import { auditService } from '../services/audit.service';
import { authenticate } from '../middleware/auth';
import { requirePermission } from '../middleware/permissions';
import { getPaginationParams } from '../utils/pagination';
import { asyncHandler } from '../utils/async-handler';

const router = Router();

router.get('/', authenticate, requirePermission('AUDIT_VIEW'), asyncHandler(async (req, res) => {
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
}));

router.get('/verify', authenticate, requirePermission('AUDIT_VIEW'), asyncHandler(async (_req, res) => {
  const result = await auditService.verify();
  res.json({ success: true, data: result });
}));

export default router;
