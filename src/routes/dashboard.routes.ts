import { Router } from 'express';
import { dashboardService } from '../services/dashboard.service';
import { authenticate } from '../middleware/auth';
import { asyncHandler } from '../utils/async-handler';

const router = Router();

router.get('/overview', authenticate, asyncHandler(async (req, res) => {
  const data = await dashboardService.getOverview(req.user!.organisationId, req.user!.userId);
  res.json({ success: true, data });
}));

router.get('/work-orders', authenticate, asyncHandler(async (req, res) => {
  const data = await dashboardService.getWorkOrderStats(req.user!.organisationId);
  res.json({ success: true, data });
}));

router.get('/recent-activity', authenticate, asyncHandler(async (req, res) => {
  const data = await dashboardService.getRecentActivity(req.user!.organisationId);
  res.json({ success: true, data });
}));

export default router;
