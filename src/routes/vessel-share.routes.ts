import { Router } from 'express';
import { vesselShareService } from '../services/vessel-share.service';
import { authenticate } from '../middleware/auth';
import { requirePermission } from '../middleware/permissions';
import { asyncHandler } from '../utils/async-handler';

const router = Router();

router.post('/:vesselId/shares', authenticate, requirePermission('VESSEL_EDIT'), asyncHandler(async (req, res) => {
  const { email, permission } = req.body;
  if (!email || typeof email !== 'string') {
    res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Email is required' } });
    return;
  }
  if (!['READ', 'WRITE'].includes(permission)) {
    res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Permission must be READ or WRITE' } });
    return;
  }

  const result = await vesselShareService.shareVessel(
    req.params.vesselId as string,
    email,
    permission,
    req.user!.userId,
    req.user!.organisationId,
  );
  res.status(201).json({ success: true, data: result });
}));

router.get('/:vesselId/shares', authenticate, requirePermission('VESSEL_VIEW'), asyncHandler(async (req, res) => {
  const shares = await vesselShareService.listShares(
    req.params.vesselId as string,
    req.user!.organisationId,
  );
  res.json({ success: true, data: shares });
}));

router.patch('/:vesselId/shares/:userId/permission', authenticate, requirePermission('VESSEL_EDIT'), asyncHandler(async (req, res) => {
  const { permission } = req.body;
  if (!['READ', 'WRITE'].includes(permission)) {
    res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Permission must be READ or WRITE' } });
    return;
  }

  const result = await vesselShareService.updatePermission(
    req.params.vesselId as string,
    req.params.userId as string,
    permission,
    req.user!.userId,
    req.user!.organisationId,
  );
  res.json({ success: true, data: result });
}));

router.delete('/:vesselId/shares/:userId', authenticate, requirePermission('VESSEL_EDIT'), asyncHandler(async (req, res) => {
  await vesselShareService.revokeShare(
    req.params.vesselId as string,
    req.params.userId as string,
    req.user!.userId,
    req.user!.organisationId,
  );
  res.json({ success: true, data: { message: 'Share revoked' } });
}));

export default router;
