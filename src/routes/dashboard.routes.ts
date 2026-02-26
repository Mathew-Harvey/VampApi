import { Router, Request, Response } from 'express';
import { dashboardService } from '../services/dashboard.service';
import { authenticate } from '../middleware/auth';

const router = Router();

router.get('/overview', authenticate, async (req: Request, res: Response) => {
  try {
    const data = await dashboardService.getOverview(req.user!.organisationId);
    res.json({ success: true, data });
  } catch (error: any) {
    res.status(500).json({ success: false, error: { code: 'ERROR', message: error.message } });
  }
});

router.get('/work-orders', authenticate, async (req: Request, res: Response) => {
  try {
    const data = await dashboardService.getWorkOrderStats(req.user!.organisationId);
    res.json({ success: true, data });
  } catch (error: any) {
    res.status(500).json({ success: false, error: { code: 'ERROR', message: error.message } });
  }
});

router.get('/recent-activity', authenticate, async (req: Request, res: Response) => {
  try {
    const data = await dashboardService.getRecentActivity(req.user!.organisationId);
    res.json({ success: true, data });
  } catch (error: any) {
    res.status(500).json({ success: false, error: { code: 'ERROR', message: error.message } });
  }
});

export default router;
