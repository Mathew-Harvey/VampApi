import prisma from '../config/database';
import { AppError } from '../middleware/error';
import { auditService } from './audit.service';
import { notificationService } from './notification.service';

export const workflowService = {
  async submitTask(workOrderId: string, taskId: string, data: any, userId: string) {
    const workOrder = await prisma.workOrder.findFirst({
      where: { id: workOrderId, isDeleted: false },
      include: { workflow: { include: { steps: { include: { tasks: true }, orderBy: { order: 'asc' } } } } },
    });
    if (!workOrder) throw new AppError(404, 'NOT_FOUND', 'Work order not found');

    const submission = await prisma.taskSubmission.create({
      data: {
        taskId,
        workOrderId,
        userId,
        data: JSON.stringify(data.data || {}),
        notes: data.notes,
        signature: data.signature,
        status: 'SUBMITTED',
        submittedAt: new Date(),
      },
    });

    await auditService.log({
      actorId: userId,
      entityType: 'TaskSubmission',
      entityId: submission.id,
      action: 'SUBMISSION',
      description: `Submitted task ${taskId} for work order ${workOrder.referenceNumber}`,
    });

    // Check if step is complete and auto-advance
    await this.checkAndAdvance(workOrderId);

    return submission;
  },

  async approveTask(workOrderId: string, taskId: string, userId: string, notes?: string) {
    const submission = await prisma.taskSubmission.findFirst({
      where: { taskId, workOrderId, status: 'SUBMITTED' },
      orderBy: { createdAt: 'desc' },
    });
    if (!submission) throw new AppError(404, 'NOT_FOUND', 'No pending submission found');

    const updated = await prisma.taskSubmission.update({
      where: { id: submission.id },
      data: { status: 'APPROVED', reviewedAt: new Date(), reviewedBy: userId, reviewNotes: notes },
    });

    await auditService.log({
      actorId: userId,
      entityType: 'TaskSubmission',
      entityId: submission.id,
      action: 'APPROVAL',
      description: `Approved task submission for work order ${workOrderId}`,
    });

    await this.checkAndAdvance(workOrderId);

    return updated;
  },

  async rejectTask(workOrderId: string, taskId: string, userId: string, notes?: string) {
    const submission = await prisma.taskSubmission.findFirst({
      where: { taskId, workOrderId, status: 'SUBMITTED' },
      orderBy: { createdAt: 'desc' },
    });
    if (!submission) throw new AppError(404, 'NOT_FOUND', 'No pending submission found');

    const updated = await prisma.taskSubmission.update({
      where: { id: submission.id },
      data: { status: 'REJECTED', reviewedAt: new Date(), reviewedBy: userId, reviewNotes: notes },
    });

    await auditService.log({
      actorId: userId,
      entityType: 'TaskSubmission',
      entityId: submission.id,
      action: 'REJECTION',
      description: `Rejected task submission for work order ${workOrderId}`,
    });

    return updated;
  },

  async checkAndAdvance(workOrderId: string) {
    const workOrder = await prisma.workOrder.findFirst({
      where: { id: workOrderId },
      include: {
        workflow: { include: { steps: { include: { tasks: true }, orderBy: { order: 'asc' } } } },
        taskSubmissions: true,
      },
    });

    if (!workOrder?.workflow) return;

    const currentStep = workOrder.workflow.steps.find((s) => s.id === workOrder.currentStepId);
    if (!currentStep) return;

    // Check if all required tasks in current step are completed/approved
    const requiredTasks = currentStep.tasks.filter((t) => t.isRequired);
    const allComplete = requiredTasks.every((task) => {
      const submissions = workOrder.taskSubmissions.filter((s) => s.taskId === task.id);
      if (currentStep.type === 'REVIEW' || currentStep.type === 'PARALLEL_REVIEW') {
        return submissions.some((s) => s.status === 'APPROVED');
      }
      return submissions.some((s) => s.status === 'SUBMITTED' || s.status === 'APPROVED');
    });

    if (!allComplete) return;

    // Find next step
    const currentIdx = workOrder.workflow.steps.findIndex((s) => s.id === currentStep.id);
    const nextStep = workOrder.workflow.steps[currentIdx + 1];

    if (!nextStep) {
      // Workflow complete
      await prisma.workOrder.update({
        where: { id: workOrderId },
        data: { status: 'COMPLETED', completedAt: new Date(), currentStepId: null },
      });
      return;
    }

    // Advance to next step
    await prisma.workOrder.update({
      where: { id: workOrderId },
      data: { currentStepId: nextStep.id },
    });

    // Handle step-type-specific logic
    if (nextStep.type === 'NOTIFICATION') {
      // Auto-advance past notification steps
      await this.checkAndAdvance(workOrderId);
    }
  },

  async getWorkflowTemplates() {
    return prisma.workflow.findMany({
      where: { isTemplate: true, isActive: true },
      include: { steps: { include: { tasks: true }, orderBy: { order: 'asc' } } },
    });
  },

  async initializeWorkflow(workOrderId: string, workflowId: string) {
    const workflow = await prisma.workflow.findUnique({
      where: { id: workflowId },
      include: { steps: { orderBy: { order: 'asc' } } },
    });
    if (!workflow) throw new AppError(404, 'NOT_FOUND', 'Workflow not found');

    const firstStep = workflow.steps[0];
    if (firstStep) {
      await prisma.workOrder.update({
        where: { id: workOrderId },
        data: { currentStepId: firstStep.id, workflowId },
      });
    }
  },
};
