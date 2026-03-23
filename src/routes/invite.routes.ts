import { Router } from 'express';
import { inviteService } from '../services/invite.service';
import { authenticate } from '../middleware/auth';
import { requireWorkOrderAdmin } from '../middleware/work-order-access';
import { asyncHandler } from '../utils/async-handler';

const router = Router();

// Invite user to a work order by email
router.post('/work-orders/:workOrderId/invite', authenticate, requireWorkOrderAdmin(), asyncHandler(async (req, res) => {
  const { email, permission } = req.body;
  if (!email || !permission) {
    res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Email and permission are required' } });
    return;
  }
  if (!['READ', 'WRITE', 'ADMIN'].includes(permission)) {
    res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Permission must be READ, WRITE, or ADMIN' } });
    return;
  }

  const result = await inviteService.inviteToWorkOrder(
    req.params.workOrderId as string,
    email,
    permission,
    req.user!.userId,
  );
  res.status(201).json({ success: true, data: result });
}));

// Resolve invite link metadata (for invite landing page)
router.get('/invites/work-orders/resolve', asyncHandler(async (req, res) => {
  const token = String(req.query.token || '');
  if (!token) {
    res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'token query parameter is required' } });
    return;
  }
  const result = await inviteService.getWorkOrderInvitationDetails(token);
  res.json({ success: true, data: result });
}));

// Redeem an invitation by URL token or invite code
router.post('/invites/work-orders/redeem', authenticate, asyncHandler(async (req, res) => {
  const token = typeof req.body.token === 'string' ? req.body.token : undefined;
  const code = typeof req.body.code === 'string' ? req.body.code : undefined;
  if (!token && !code) {
    res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Provide token or code' } });
    return;
  }

  const result = await inviteService.redeemWorkOrderInvitation({
    userId: req.user!.userId,
    token,
    code,
  });
  res.json({ success: true, data: result });
}));

// Change collaborator permission
router.patch('/work-orders/:workOrderId/collaborators/:userId/permission', authenticate, requireWorkOrderAdmin(), asyncHandler(async (req, res) => {
  const { permission } = req.body;
  if (!['READ', 'WRITE', 'ADMIN'].includes(permission)) {
    res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Permission must be READ, WRITE, or ADMIN' } });
    return;
  }

  const result = await inviteService.changePermission(
    req.params.workOrderId as string,
    req.params.userId as string,
    permission,
    req.user!.userId,
  );
  res.json({ success: true, data: result });
}));

// Remove collaborator
router.delete('/work-orders/:workOrderId/collaborators/:userId', authenticate, requireWorkOrderAdmin(), asyncHandler(async (req, res) => {
  await inviteService.removeFromWorkOrder(
    req.params.workOrderId as string,
    req.params.userId as string,
    req.user!.userId,
  );
  res.json({ success: true, data: { message: 'User removed' } });
}));

export default router;
