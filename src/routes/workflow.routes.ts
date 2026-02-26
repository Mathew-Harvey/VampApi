import { Router, Request, Response } from 'express';
import { workflowService } from '../services/workflow.service';
import { authenticate } from '../middleware/auth';

const router = Router();

router.get('/templates', authenticate, async (_req: Request, res: Response) => {
  try {
    const templates = await workflowService.getWorkflowTemplates();
    res.json({ success: true, data: templates });
  } catch (error: any) {
    res.status(500).json({ success: false, error: { code: 'ERROR', message: error.message } });
  }
});

export default router;
