import { Router } from 'express';
import { workOrderService } from '../services/work-order.service';
import { workflowService } from '../services/workflow.service';
import { authenticate } from '../middleware/auth';
import { hasAnyPermission, requirePermission } from '../middleware/permissions';
import { requireWorkOrderView, requireWorkOrderWrite } from '../middleware/work-order-access';
import { validate } from '../middleware/validate';
import { createWorkOrderSchema, updateWorkOrderSchema, changeStatusSchema, assignWorkOrderSchema } from '../schemas/work-order.schema';
import { getPaginationParams } from '../utils/pagination';
import prisma from '../config/database';
import { asyncHandler } from '../utils/async-handler';

const router = Router();

router.get('/', authenticate, asyncHandler(async (req, res) => {
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
}));

router.post('/', authenticate, requirePermission('WORK_ORDER_CREATE'), validate(createWorkOrderSchema), asyncHandler(async (req, res) => {
  const wo = await workOrderService.create(req.body, req.user!.organisationId, req.user!.userId);
  if (req.body.workflowId) {
    await workflowService.initializeWorkflow(wo.id, req.body.workflowId);
  }
  res.status(201).json({ success: true, data: wo });
}));

router.get('/:id', authenticate, asyncHandler(async (req, res) => {
  const includeOrganisationScope = hasAnyPermission(req.user, 'WORK_ORDER_VIEW');
  const wo = await workOrderService.getById((req.params.id as string), req.user!.organisationId, req.user!.userId, includeOrganisationScope);
  res.json({ success: true, data: wo });
}));

router.put('/:id', authenticate, requirePermission('WORK_ORDER_EDIT'), validate(updateWorkOrderSchema), asyncHandler(async (req, res) => {
  const wo = await workOrderService.update((req.params.id as string), req.user!.organisationId, req.body, req.user!.userId);
  res.json({ success: true, data: wo });
}));

router.patch('/:id/status', authenticate, requirePermission('WORK_ORDER_EDIT'), validate(changeStatusSchema), asyncHandler(async (req, res) => {
  const wo = await workOrderService.changeStatus((req.params.id as string), req.user!.organisationId, req.body.status, req.user!.userId, req.body.reason);
  res.json({ success: true, data: wo });
}));

router.post('/:id/assign', authenticate, requirePermission('WORK_ORDER_ASSIGN'), validate(assignWorkOrderSchema), asyncHandler(async (req, res) => {
  const assignment = await workOrderService.assign((req.params.id as string), req.user!.organisationId, req.body.userId, req.body.role, req.user!.userId);
  res.status(201).json({ success: true, data: assignment });
}));

router.delete('/:id/assign/:userId', authenticate, requirePermission('WORK_ORDER_ASSIGN'), asyncHandler(async (req, res) => {
  await workOrderService.unassign((req.params.id as string), req.user!.organisationId, (req.params.userId as string), req.user!.userId);
  res.json({ success: true, data: { message: 'User unassigned' } });
}));

router.post('/:id/tasks/:taskId/submit', authenticate, requireWorkOrderWrite('id'), asyncHandler(async (req, res) => {
  const result = await workflowService.submitTask((req.params.id as string), (req.params.taskId as string), req.body, req.user!.userId);
  res.status(201).json({ success: true, data: result });
}));

router.post('/:id/tasks/:taskId/approve', authenticate, requirePermission('WORK_ORDER_APPROVE'), requireWorkOrderView('id'), asyncHandler(async (req, res) => {
  const result = await workflowService.approveTask((req.params.id as string), (req.params.taskId as string), req.user!.userId, req.body.notes);
  res.json({ success: true, data: result });
}));

router.post('/:id/tasks/:taskId/reject', authenticate, requirePermission('WORK_ORDER_APPROVE'), requireWorkOrderView('id'), asyncHandler(async (req, res) => {
  const result = await workflowService.rejectTask((req.params.id as string), (req.params.taskId as string), req.user!.userId, req.body.notes);
  res.json({ success: true, data: result });
}));

router.get('/:id/comments', authenticate, requireWorkOrderView('id'), asyncHandler(async (req, res) => {
  const comments = await prisma.comment.findMany({
    where: { workOrderId: (req.params.id as string) },
    include: { author: { select: { id: true, firstName: true, lastName: true } } },
    orderBy: { createdAt: 'asc' },
  });
  res.json({ success: true, data: comments });
}));

router.post('/:id/comments', authenticate, requireWorkOrderWrite('id'), asyncHandler(async (req, res) => {
  const comment = await prisma.comment.create({
    data: { workOrderId: (req.params.id as string), authorId: req.user!.userId, content: req.body.content, parentId: req.body.parentId },
  });
  res.status(201).json({ success: true, data: comment });
}));

router.delete('/:id', authenticate, requirePermission('WORK_ORDER_DELETE'), asyncHandler(async (req, res) => {
  await workOrderService.softDelete((req.params.id as string), req.user!.organisationId, req.user!.userId);
  res.json({ success: true, data: { message: 'Work order deleted' } });
}));

export default router;
