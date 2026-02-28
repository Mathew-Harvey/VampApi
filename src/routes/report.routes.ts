import { Router, Request, Response } from 'express';
import { reportService } from '../services/report.service';
import { authenticate } from '../middleware/auth';
import { hasAnyPermission, requirePermission } from '../middleware/permissions';
import { workOrderService } from '../services/work-order.service';

const router = Router();

async function assertReportAccess(req: Request, res: Response): Promise<boolean> {
  const workOrderId = req.params.workOrderId as string;
  const hasOrgPermission = hasAnyPermission(req.user, 'REPORT_VIEW');
  const hasAccess = await workOrderService.canViewWorkOrder(
    workOrderId,
    req.user!.userId,
    req.user!.organisationId,
    hasOrgPermission,
  );
  if (!hasAccess) {
    res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Work order not found' } });
    return false;
  }

  if (!hasOrgPermission) {
    const collaboratorRole = await workOrderService.getAssignmentRole(workOrderId, req.user!.userId);
    if (!collaboratorRole) {
      res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Insufficient permissions' } });
      return false;
    }
  }
  return true;
}

async function assertReportWriteAccess(req: Request, res: Response): Promise<boolean> {
  if (!(await assertReportAccess(req, res))) return false;
  const workOrderId = req.params.workOrderId as string;
  const canEditByOrg = hasAnyPermission(req.user, 'WORK_ORDER_EDIT', 'REPORT_GENERATE');
  const canWriteAsCollaborator = await workOrderService.canWriteAsCollaborator(workOrderId, req.user!.userId);
  if (!canEditByOrg && !canWriteAsCollaborator) {
    res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Insufficient permissions' } });
    return false;
  }
  return true;
}

router.post('/generate', authenticate, requirePermission('REPORT_GENERATE'), async (req: Request, res: Response) => {
  try {
    const { type, workOrderId, ...payload } = req.body;
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
    } else if (type === 'bfmp') {
      const data = await reportService.generateBFMPReport(payload, req.user!.organisationId);
      res.json({ success: true, data });
    } else if (type === 'compliance') {
      const data = await reportService.generateComplianceReport(payload, req.user!.organisationId);
      res.json({ success: true, data });
    } else if (type === 'audit') {
      const data = await reportService.generateAuditReport(payload, req.user!.organisationId);
      res.json({ success: true, data });
    } else {
      res.status(400).json({ success: false, error: { code: 'INVALID_TYPE', message: 'Provide a valid report type' } });
    }
  } catch (error: any) {
    res.status(error.statusCode || 500).json({ success: false, error: { code: error.code || 'ERROR', message: error.message } });
  }
});

// Save BFMP draft
router.post('/bfmp/draft', authenticate, requirePermission('REPORT_GENERATE'), async (req: Request, res: Response) => {
  try {
    const data = await reportService.saveBFMPDraft(req.body, req.user!.organisationId, req.user!.userId);
    res.json({ success: true, data });
  } catch (error: any) {
    res.status(error.statusCode || 500).json({ success: false, error: { code: error.code || 'ERROR', message: error.message } });
  }
});

// Serve rendered HTML report for preview / print
// Supports ?type=inspection (default) or ?type=work-order
router.get('/preview/:workOrderId', authenticate, async (req: Request, res: Response) => {
  try {
    if (!(await assertReportAccess(req, res))) return;

    const reportType = (req.query.type as string) || 'inspection';
    let report: any;
    if (reportType === 'work-order') {
      report = await reportService.generateWorkOrderReport(req.params.workOrderId as string);
    } else {
      report = await reportService.generateInspectionReport(req.params.workOrderId as string);
    }

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

// Branded report viewer with page controls + print
// Supports ?type=inspection (default) or ?type=work-order
router.get('/view/:workOrderId', authenticate, async (req: Request, res: Response) => {
  try {
    if (!(await assertReportAccess(req, res))) return;
    const reportType = (req.query.type as string) || 'inspection';
    const title = reportType === 'work-order' ? 'Work Order Report' : 'Inspection Report';
    const queryToken = typeof req.query?.token === 'string' ? req.query.token : undefined;
    const html = await reportService.getReportViewHtml(req.params.workOrderId as string, reportType, title, queryToken);
    res.setHeader('Content-Type', 'text/html');
    res.send(html);
  } catch (error: any) {
    res.status(error.statusCode || 500).json({ success: false, error: { code: error.code || 'ERROR', message: error.message } });
  }
});

router.get('/config/:workOrderId', authenticate, async (req: Request, res: Response) => {
  try {
    if (!(await assertReportAccess(req, res))) return;
    const data = await reportService.getInspectionReportConfig(req.params.workOrderId as string);
    res.json({ success: true, data });
  } catch (error: any) {
    res.status(error.statusCode || 500).json({ success: false, error: { code: error.code || 'ERROR', message: error.message } });
  }
});

router.put('/config/:workOrderId', authenticate, async (req: Request, res: Response) => {
  try {
    if (!(await assertReportWriteAccess(req, res))) return;
    const data = await reportService.updateInspectionReportConfig(req.params.workOrderId as string, req.body || {});
    res.json({ success: true, data });
  } catch (error: any) {
    res.status(error.statusCode || 500).json({ success: false, error: { code: error.code || 'ERROR', message: error.message } });
  }
});

// Return the exact Handlebars context payload used for rendering
router.get('/context/:workOrderId', authenticate, async (req: Request, res: Response) => {
  try {
    if (!(await assertReportAccess(req, res))) return;

    const data = await reportService.getInspectionReportContext(req.params.workOrderId as string);
    res.json({ success: true, data });
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
