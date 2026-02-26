import { Router, Request, Response } from 'express';
import { workFormService } from '../services/work-form.service';
import { vesselComponentService } from '../services/vessel-component.service';
import { authenticate } from '../middleware/auth';
import { hasAnyPermission } from '../middleware/permissions';
import { workOrderService } from '../services/work-order.service';
import prisma from '../config/database';

const router = Router();

// === Vessel Components (General Arrangement) ===

router.get('/vessels/:vesselId/components', authenticate, async (req: Request, res: Response) => {
  try {
    const components = await vesselComponentService.listByVessel(req.params.vesselId as string);
    res.json({ success: true, data: components });
  } catch (error: any) {
    res.status(error.statusCode || 500).json({ success: false, error: { code: error.code || 'ERROR', message: error.message } });
  }
});

router.post('/vessels/:vesselId/components', authenticate, async (req: Request, res: Response) => {
  try {
    const component = await vesselComponentService.create(req.params.vesselId as string, req.body);
    res.status(201).json({ success: true, data: component });
  } catch (error: any) {
    res.status(error.statusCode || 500).json({ success: false, error: { code: error.code || 'ERROR', message: error.message } });
  }
});

router.post('/vessels/:vesselId/components/bulk', authenticate, async (req: Request, res: Response) => {
  try {
    const components = await vesselComponentService.bulkCreate(req.params.vesselId as string, req.body.components);
    res.status(201).json({ success: true, data: components });
  } catch (error: any) {
    res.status(error.statusCode || 500).json({ success: false, error: { code: error.code || 'ERROR', message: error.message } });
  }
});

router.put('/components/:id', authenticate, async (req: Request, res: Response) => {
  try {
    const component = await vesselComponentService.update(req.params.id as string, req.body);
    res.json({ success: true, data: component });
  } catch (error: any) {
    res.status(error.statusCode || 500).json({ success: false, error: { code: error.code || 'ERROR', message: error.message } });
  }
});

router.delete('/components/:id', authenticate, async (req: Request, res: Response) => {
  try {
    await vesselComponentService.delete(req.params.id as string);
    res.json({ success: true, data: { message: 'Component deleted' } });
  } catch (error: any) {
    res.status(error.statusCode || 500).json({ success: false, error: { code: error.code || 'ERROR', message: error.message } });
  }
});

// === Work Form Entries ===

router.post('/work-orders/:workOrderId/form/generate', authenticate, async (req: Request, res: Response) => {
  try {
    const canEditByOrg = hasAnyPermission(req.user, 'WORK_ORDER_EDIT');
    const canWriteAsCollaborator = await workOrderService.canWriteAsCollaborator(req.params.workOrderId as string, req.user!.userId);
    const canWrite = canEditByOrg || canWriteAsCollaborator;
    const canView = await workOrderService.canViewWorkOrder(
      req.params.workOrderId as string,
      req.user!.userId,
      req.user!.organisationId,
      canEditByOrg || hasAnyPermission(req.user, 'WORK_ORDER_VIEW'),
    );
    if (!canView) {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Work order not found' } });
      return;
    }
    if (!canWrite) {
      res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Insufficient permissions' } });
      return;
    }

    const entries = await workFormService.generateForm(req.params.workOrderId as string, req.user!.userId);
    res.status(201).json({ success: true, data: entries });
  } catch (error: any) {
    res.status(error.statusCode || 500).json({ success: false, error: { code: error.code || 'ERROR', message: error.message } });
  }
});

router.get('/work-orders/:workOrderId/form', authenticate, async (req: Request, res: Response) => {
  try {
    const includeOrganisationScope = hasAnyPermission(req.user, 'WORK_ORDER_VIEW');
    const canView = await workOrderService.canViewWorkOrder(
      req.params.workOrderId as string,
      req.user!.userId,
      req.user!.organisationId,
      includeOrganisationScope,
    );
    if (!canView) {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Work order not found' } });
      return;
    }

    const entries = await workFormService.getFormEntries(req.params.workOrderId as string);
    res.json({ success: true, data: entries });
  } catch (error: any) {
    res.status(error.statusCode || 500).json({ success: false, error: { code: error.code || 'ERROR', message: error.message } });
  }
});

router.put('/form-entries/:entryId', authenticate, async (req: Request, res: Response) => {
  try {
    const existing = await prisma.workFormEntry.findUnique({
      where: { id: req.params.entryId as string },
      select: { workOrderId: true },
    });
    if (!existing) {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Form entry not found' } });
      return;
    }

    const canEditByOrg = hasAnyPermission(req.user, 'WORK_ORDER_EDIT');
    const canWriteAsCollaborator = await workOrderService.canWriteAsCollaborator(existing.workOrderId, req.user!.userId);
    const canWrite = canEditByOrg || canWriteAsCollaborator;
    const canView = await workOrderService.canViewWorkOrder(
      existing.workOrderId,
      req.user!.userId,
      req.user!.organisationId,
      canEditByOrg || hasAnyPermission(req.user, 'WORK_ORDER_VIEW'),
    );
    if (!canView) {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Work order not found' } });
      return;
    }
    if (!canWrite) {
      res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Insufficient permissions' } });
      return;
    }

    const entry = await workFormService.updateEntry(req.params.entryId as string, req.body, req.user!.userId);
    res.json({ success: true, data: entry });
  } catch (error: any) {
    res.status(error.statusCode || 500).json({ success: false, error: { code: error.code || 'ERROR', message: error.message } });
  }
});

// Update a single field on a form entry (for real-time collaboration)
router.patch('/form-entries/:entryId/field', authenticate, async (req: Request, res: Response) => {
  try {
    const { field, value } = req.body;
    if (!field) {
      res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'field is required' } });
      return;
    }
    const existing = await prisma.workFormEntry.findUnique({
      where: { id: req.params.entryId as string },
      select: { workOrderId: true },
    });
    if (!existing) {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Form entry not found' } });
      return;
    }
    const canEditByOrg = hasAnyPermission(req.user, 'WORK_ORDER_EDIT');
    const canWriteAsCollaborator = await workOrderService.canWriteAsCollaborator(existing.workOrderId, req.user!.userId);
    if (!canEditByOrg && !canWriteAsCollaborator) {
      res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Insufficient permissions' } });
      return;
    }
    const entry = await workFormService.updateField(req.params.entryId as string, field, value, req.user!.userId);
    res.json({ success: true, data: entry });
  } catch (error: any) {
    res.status(error.statusCode || 500).json({ success: false, error: { code: error.code || 'ERROR', message: error.message } });
  }
});

router.post('/form-entries/:entryId/attachments', authenticate, async (req: Request, res: Response) => {
  try {
    const existing = await prisma.workFormEntry.findUnique({
      where: { id: req.params.entryId as string },
      select: { workOrderId: true },
    });
    if (!existing) {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Form entry not found' } });
      return;
    }

    const canEditByOrg = hasAnyPermission(req.user, 'WORK_ORDER_EDIT');
    const canWriteAsCollaborator = await workOrderService.canWriteAsCollaborator(existing.workOrderId, req.user!.userId);
    const canWrite = canEditByOrg || canWriteAsCollaborator;
    if (!canWrite) {
      res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Insufficient permissions' } });
      return;
    }

    const entry = await workFormService.addAttachment(req.params.entryId as string, req.body.mediaId);
    res.json({ success: true, data: entry });
  } catch (error: any) {
    res.status(error.statusCode || 500).json({ success: false, error: { code: error.code || 'ERROR', message: error.message } });
  }
});

router.get('/work-orders/:workOrderId/form/json', authenticate, async (req: Request, res: Response) => {
  try {
    const includeOrganisationScope = hasAnyPermission(req.user, 'WORK_ORDER_VIEW');
    const canView = await workOrderService.canViewWorkOrder(
      req.params.workOrderId as string,
      req.user!.userId,
      req.user!.organisationId,
      includeOrganisationScope,
    );
    if (!canView) {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Work order not found' } });
      return;
    }

    const data = await workFormService.getFormDataJson(req.params.workOrderId as string);
    res.json({ success: true, data });
  } catch (error: any) {
    res.status(error.statusCode || 500).json({ success: false, error: { code: error.code || 'ERROR', message: error.message } });
  }
});

// Pass through unmatched requests (e.g. /vessels/:id) to other route handlers
router.use((_req, _res, next) => next());

export default router;
