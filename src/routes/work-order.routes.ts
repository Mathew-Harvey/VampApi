import { Router, Request, Response } from 'express';
import { workOrderService } from '../services/work-order.service';
import { workflowService } from '../services/workflow.service';
import { authenticate } from '../middleware/auth';
import { hasAnyPermission, requirePermission } from '../middleware/permissions';
import { validate } from '../middleware/validate';
import { createWorkOrderSchema, updateWorkOrderSchema, changeStatusSchema, assignWorkOrderSchema } from '../schemas/work-order.schema';
import { getPaginationParams } from '../utils/pagination';
import prisma from '../config/database';

const router = Router();

router.get('/', authenticate, async (req: Request, res: Response) => {
  try {
    const params = getPaginationParams(req);
    const includeOrganisationScope = hasAnyPermission(req.user, 'WORK_ORDER_VIEW');
    const filters = {
      status: req.query.status as string,
      type: req.query.type as string,
      vesselId: req.query.vesselId as string,
      priority: req.query.priority as string,
    };
    const result = await workOrderService.list(
      params,
      req.user!.organisationId,
      req.user!.userId,
      filters,
      includeOrganisationScope,
    );
    res.json(result);
  } catch (error: any) {
    res.status(error.statusCode || 500).json({ success: false, error: { code: error.code || 'ERROR', message: error.message } });
  }
});

router.post('/', authenticate, requirePermission('WORK_ORDER_CREATE'), validate(createWorkOrderSchema), async (req: Request, res: Response) => {
  try {
    const wo = await workOrderService.create(req.body, req.user!.organisationId, req.user!.userId);
    if (req.body.workflowId) {
      await workflowService.initializeWorkflow(wo.id, req.body.workflowId);
    }
    res.status(201).json({ success: true, data: wo });
  } catch (error: any) {
    res.status(error.statusCode || 500).json({ success: false, error: { code: error.code || 'ERROR', message: error.message } });
  }
});

router.get('/:id', authenticate, async (req: Request, res: Response) => {
  try {
    const includeOrganisationScope = hasAnyPermission(req.user, 'WORK_ORDER_VIEW');
    const wo = await workOrderService.getById((req.params.id as string), req.user!.organisationId, req.user!.userId, includeOrganisationScope);
    res.json({ success: true, data: wo });
  } catch (error: any) {
    res.status(error.statusCode || 500).json({ success: false, error: { code: error.code || 'ERROR', message: error.message } });
  }
});

router.put('/:id', authenticate, requirePermission('WORK_ORDER_EDIT'), validate(updateWorkOrderSchema), async (req: Request, res: Response) => {
  try {
    const wo = await workOrderService.update((req.params.id as string), req.user!.organisationId, req.body, req.user!.userId);
    res.json({ success: true, data: wo });
  } catch (error: any) {
    res.status(error.statusCode || 500).json({ success: false, error: { code: error.code || 'ERROR', message: error.message } });
  }
});

router.patch('/:id/status', authenticate, requirePermission('WORK_ORDER_EDIT'), validate(changeStatusSchema), async (req: Request, res: Response) => {
  try {
    const wo = await workOrderService.changeStatus((req.params.id as string), req.user!.organisationId, req.body.status, req.user!.userId, req.body.reason);
    res.json({ success: true, data: wo });
  } catch (error: any) {
    res.status(error.statusCode || 500).json({ success: false, error: { code: error.code || 'ERROR', message: error.message } });
  }
});

router.post('/:id/assign', authenticate, requirePermission('WORK_ORDER_ASSIGN'), validate(assignWorkOrderSchema), async (req: Request, res: Response) => {
  try {
    const assignment = await workOrderService.assign((req.params.id as string), req.user!.organisationId, req.body.userId, req.body.role, req.user!.userId);
    res.status(201).json({ success: true, data: assignment });
  } catch (error: any) {
    res.status(error.statusCode || 500).json({ success: false, error: { code: error.code || 'ERROR', message: error.message } });
  }
});

router.delete('/:id/assign/:userId', authenticate, requirePermission('WORK_ORDER_ASSIGN'), async (req: Request, res: Response) => {
  try {
    await workOrderService.unassign((req.params.id as string), req.user!.organisationId, (req.params.userId as string), req.user!.userId);
    res.json({ success: true, data: { message: 'User unassigned' } });
  } catch (error: any) {
    res.status(error.statusCode || 500).json({ success: false, error: { code: error.code || 'ERROR', message: error.message } });
  }
});

router.post('/:id/tasks/:taskId/submit', authenticate, async (req: Request, res: Response) => {
  try {
    const result = await workflowService.submitTask((req.params.id as string), (req.params.taskId as string), req.body, req.user!.userId);
    res.status(201).json({ success: true, data: result });
  } catch (error: any) {
    res.status(error.statusCode || 500).json({ success: false, error: { code: error.code || 'ERROR', message: error.message } });
  }
});

router.post('/:id/tasks/:taskId/approve', authenticate, requirePermission('WORK_ORDER_APPROVE'), async (req: Request, res: Response) => {
  try {
    const result = await workflowService.approveTask((req.params.id as string), (req.params.taskId as string), req.user!.userId, req.body.notes);
    res.json({ success: true, data: result });
  } catch (error: any) {
    res.status(error.statusCode || 500).json({ success: false, error: { code: error.code || 'ERROR', message: error.message } });
  }
});

router.post('/:id/tasks/:taskId/reject', authenticate, requirePermission('WORK_ORDER_APPROVE'), async (req: Request, res: Response) => {
  try {
    const result = await workflowService.rejectTask((req.params.id as string), (req.params.taskId as string), req.user!.userId, req.body.notes);
    res.json({ success: true, data: result });
  } catch (error: any) {
    res.status(error.statusCode || 500).json({ success: false, error: { code: error.code || 'ERROR', message: error.message } });
  }
});

router.get('/:id/comments', authenticate, async (req: Request, res: Response) => {
  try {
    const includeOrganisationScope = hasAnyPermission(req.user, 'WORK_ORDER_VIEW');
    const canView = await workOrderService.canViewWorkOrder(
      req.params.id as string,
      req.user!.userId,
      req.user!.organisationId,
      includeOrganisationScope,
    );
    if (!canView) {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Work order not found' } });
      return;
    }

    const comments = await prisma.comment.findMany({
      where: { workOrderId: (req.params.id as string) },
      include: { author: { select: { id: true, firstName: true, lastName: true } } },
      orderBy: { createdAt: 'asc' },
    });
    res.json({ success: true, data: comments });
  } catch (error: any) {
    res.status(500).json({ success: false, error: { code: 'ERROR', message: error.message } });
  }
});

router.post('/:id/comments', authenticate, async (req: Request, res: Response) => {
  try {
    const canEditByOrg = hasAnyPermission(req.user, 'WORK_ORDER_EDIT');
    const canWriteAsCollaborator = await workOrderService.canWriteAsCollaborator(req.params.id as string, req.user!.userId);
    const canWrite = canEditByOrg || canWriteAsCollaborator;
    const canView = await workOrderService.canViewWorkOrder(
      req.params.id as string,
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

    const comment = await prisma.comment.create({
      data: { workOrderId: (req.params.id as string), authorId: req.user!.userId, content: req.body.content, parentId: req.body.parentId },
    });
    res.status(201).json({ success: true, data: comment });
  } catch (error: any) {
    res.status(500).json({ success: false, error: { code: 'ERROR', message: error.message } });
  }
});

router.delete('/:id', authenticate, requirePermission('WORK_ORDER_DELETE'), async (req: Request, res: Response) => {
  try {
    await workOrderService.softDelete((req.params.id as string), req.user!.organisationId, req.user!.userId);
    res.json({ success: true, data: { message: 'Work order deleted' } });
  } catch (error: any) {
    res.status(error.statusCode || 500).json({ success: false, error: { code: error.code || 'ERROR', message: error.message } });
  }
});

export default router;
