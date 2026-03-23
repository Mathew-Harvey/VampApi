import { Router } from 'express';
import { workflowService } from '../services/workflow.service';
import { authenticate } from '../middleware/auth';
import { asyncHandler } from '../utils/async-handler';

const router = Router();

router.get('/templates', authenticate, asyncHandler(async (_req, res) => {
  const templates = await workflowService.getWorkflowTemplates();
  res.json({ success: true, data: templates });
}));

export default router;
