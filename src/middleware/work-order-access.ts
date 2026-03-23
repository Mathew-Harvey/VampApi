import { Request, Response, NextFunction } from 'express';
import { hasAnyPermission } from './permissions';
import { workOrderService } from '../services/work-order.service';

/**
 * Middleware that asserts the authenticated user can VIEW the work order.
 * Returns 404 if the work order is not found or not accessible.
 */
export function requireWorkOrderView(paramName: string = 'workOrderId') {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const workOrderId = req.params[paramName];
    const includeOrganisationScope = hasAnyPermission(req.user, 'WORK_ORDER_VIEW');
    const canView = await workOrderService.canViewWorkOrder(
      workOrderId, req.user!.userId, req.user!.organisationId, includeOrganisationScope,
    );
    if (!canView) {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Work order not found' } });
      return;
    }
    next();
  };
}

/**
 * Middleware that asserts the authenticated user can WRITE to the work order.
 * Also checks view access. Returns 404 or 403 as appropriate.
 */
export function requireWorkOrderWrite(paramName: string = 'workOrderId') {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const workOrderId = req.params[paramName];
    const canEditByOrg = hasAnyPermission(req.user, 'WORK_ORDER_EDIT');
    const includeOrganisationScope = canEditByOrg || hasAnyPermission(req.user, 'WORK_ORDER_VIEW');
    const canView = await workOrderService.canViewWorkOrder(
      workOrderId, req.user!.userId, req.user!.organisationId, includeOrganisationScope,
    );
    if (!canView) {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Work order not found' } });
      return;
    }
    const canWriteAsCollaborator = await workOrderService.canWriteAsCollaborator(workOrderId, req.user!.userId);
    if (!canEditByOrg && !canWriteAsCollaborator) {
      res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Insufficient permissions' } });
      return;
    }
    next();
  };
}

/**
 * Middleware that asserts the user can ADMIN the work order (invite, remove, change permissions).
 */
export function requireWorkOrderAdmin(paramName: string = 'workOrderId') {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const workOrderId = req.params[paramName];
    const hasOrgPermission = hasAnyPermission(req.user, 'WORK_ORDER_ASSIGN');
    const hasAccess = await workOrderService.canViewWorkOrder(
      workOrderId, req.user!.userId, req.user!.organisationId, hasOrgPermission,
    );
    if (!hasAccess) {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Work order not found' } });
      return;
    }
    const canAdminAsCollaborator = await workOrderService.canAdminAsCollaborator(workOrderId, req.user!.userId);
    if (!hasOrgPermission && !canAdminAsCollaborator) {
      res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Insufficient permissions' } });
      return;
    }
    next();
  };
}
