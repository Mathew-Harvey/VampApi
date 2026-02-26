import { Router, Request, Response } from 'express';
import { reportService } from '../services/report.service';
import { authenticate } from '../middleware/auth';
import { hasAnyPermission, requirePermission } from '../middleware/permissions';
import { workOrderService } from '../services/work-order.service';

const router = Router();

router.post('/generate', authenticate, requirePermission('REPORT_GENERATE'), async (req: Request, res: Response) => {
  try {
    const { type, workOrderId } = req.body;
    if (workOrderId) {
      const hasAccess = await workOrderService.canViewWorkOrder(workOrderId, req.user!.userId, req.user!.organisationId, true);
      if (!hasAccess) {
        res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Work order not found' } });
        return;
      }
    }

    if (type === 'inspection' && workOrderId) {
      const data = await reportService.generateInspectionReport(workOrderId);
      res.json({ success: true, data });
    } else if (type === 'work-order' && workOrderId) {
      const data = await reportService.generateWorkOrderReport(workOrderId);
      res.json({ success: true, data });
    } else {
      res.status(400).json({ success: false, error: { code: 'INVALID_TYPE', message: 'Provide type and workOrderId' } });
    }
  } catch (error: any) {
    res.status(error.statusCode || 500).json({ success: false, error: { code: error.code || 'ERROR', message: error.message } });
  }
});

// Serve rendered HTML report for preview / print
router.get('/preview/:workOrderId', authenticate, async (req: Request, res: Response) => {
  try {
    const hasOrgPermission = hasAnyPermission(req.user, 'REPORT_VIEW');
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

    if (!hasOrgPermission) {
      const collaboratorRole = await workOrderService.getAssignmentRole(req.params.workOrderId as string, req.user!.userId);
      if (!collaboratorRole) {
        res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Insufficient permissions' } });
        return;
      }
    }

    const report = await reportService.generateInspectionReport(req.params.workOrderId as string);
    if (report.html) {
      res.setHeader('Content-Type', 'text/html');
      res.send(report.html);
    } else {
      res.json({ success: true, data: report });
    }
  } catch (error: any) {
    res.status(error.statusCode || 500).json({ success: false, error: { code: error.code || 'ERROR', message: error.message } });
  }
});

router.get('/documents', authenticate, requirePermission('REPORT_VIEW'), async (req: Request, res: Response) => {
  try {
    const data = await reportService.getDocuments({
      vesselId: req.query.vesselId as string,
      workOrderId: req.query.workOrderId as string,
    }, req.user!.organisationId);
    res.json({ success: true, data });
  } catch (error: any) {
    res.status(500).json({ success: false, error: { code: 'ERROR', message: error.message } });
  }
});

export default router;
