import { Router, Request, Response } from 'express';
import { inviteService } from '../services/invite.service';
import { authenticate } from '../middleware/auth';
import { hasAnyPermission } from '../middleware/permissions';
import { workOrderService } from '../services/work-order.service';

const router = Router();

// Invite user to a work order by email
router.post('/work-orders/:workOrderId/invite', authenticate, async (req: Request, res: Response) => {
  try {
    const { email, permission } = req.body;
    if (!email || !permission) {
      res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Email and permission are required' } });
      return;
    }
    if (!['READ', 'WRITE', 'ADMIN'].includes(permission)) {
      res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Permission must be READ, WRITE, or ADMIN' } });
      return;
    }
    const hasOrgPermission = hasAnyPermission(req.user, 'WORK_ORDER_ASSIGN');
    const hasAccess = await workOrderService.canViewWorkOrder(
      req.params.workOrderId as string,
      req.user!.userId,
      req.user!.organisationId,
      hasOrgPermission,
    );
    if (!hasAccess) {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Work order not found' } });
      return;
    }
    const canAdminAsCollaborator = await workOrderService.canAdminAsCollaborator(req.params.workOrderId as string, req.user!.userId);
    if (!hasOrgPermission && !canAdminAsCollaborator) {
      res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Insufficient permissions' } });
      return;
    }

    const result = await inviteService.inviteToWorkOrder(
      req.params.workOrderId as string,
      email,
      permission,
      req.user!.userId,
    );
    res.status(201).json({ success: true, data: result });
  } catch (error: any) {
    res.status(error.statusCode || 500).json({ success: false, error: { code: error.code || 'ERROR', message: error.message } });
  }
});

// Change collaborator permission
router.patch('/work-orders/:workOrderId/collaborators/:userId/permission', authenticate, async (req: Request, res: Response) => {
  try {
    const { permission } = req.body;
    if (!['READ', 'WRITE', 'ADMIN'].includes(permission)) {
      res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Permission must be READ, WRITE, or ADMIN' } });
      return;
    }
    const hasOrgPermission = hasAnyPermission(req.user, 'WORK_ORDER_ASSIGN');
    const hasAccess = await workOrderService.canViewWorkOrder(
      req.params.workOrderId as string,
      req.user!.userId,
      req.user!.organisationId,
      hasOrgPermission,
    );
    if (!hasAccess) {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Work order not found' } });
      return;
    }
    const canAdminAsCollaborator = await workOrderService.canAdminAsCollaborator(req.params.workOrderId as string, req.user!.userId);
    if (!hasOrgPermission && !canAdminAsCollaborator) {
      res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Insufficient permissions' } });
      return;
    }

    const result = await inviteService.changePermission(
      req.params.workOrderId as string,
      req.params.userId as string,
      permission,
      req.user!.userId,
    );
    res.json({ success: true, data: result });
  } catch (error: any) {
    res.status(error.statusCode || 500).json({ success: false, error: { code: error.code || 'ERROR', message: error.message } });
  }
});

// Remove collaborator
router.delete('/work-orders/:workOrderId/collaborators/:userId', authenticate, async (req: Request, res: Response) => {
  try {
    const hasOrgPermission = hasAnyPermission(req.user, 'WORK_ORDER_ASSIGN');
    const hasAccess = await workOrderService.canViewWorkOrder(
      req.params.workOrderId as string,
      req.user!.userId,
      req.user!.organisationId,
      hasOrgPermission,
    );
    if (!hasAccess) {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Work order not found' } });
      return;
    }
    const canAdminAsCollaborator = await workOrderService.canAdminAsCollaborator(req.params.workOrderId as string, req.user!.userId);
    if (!hasOrgPermission && !canAdminAsCollaborator) {
      res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Insufficient permissions' } });
      return;
    }

    await inviteService.removeFromWorkOrder(
      req.params.workOrderId as string,
      req.params.userId as string,
      req.user!.userId,
    );
    res.json({ success: true, data: { message: 'User removed' } });
  } catch (error: any) {
    res.status(error.statusCode || 500).json({ success: false, error: { code: error.code || 'ERROR', message: error.message } });
  }
});

export default router;
