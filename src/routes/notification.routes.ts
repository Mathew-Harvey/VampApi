import { Router } from 'express';
import { notificationService } from '../services/notification.service';
import { authenticate } from '../middleware/auth';
import { asyncHandler } from '../utils/async-handler';

const router = Router();

router.get('/', authenticate, asyncHandler(async (req, res) => {
  const unreadOnly = req.query.unread === 'true';
  const data = await notificationService.getForUser(req.user!.userId, unreadOnly);
  res.json({ success: true, data });
}));

router.get('/count', authenticate, asyncHandler(async (req, res) => {
  const count = await notificationService.getUnreadCount(req.user!.userId);
  res.json({ success: true, data: { count } });
}));

router.patch('/:id/read', authenticate, asyncHandler(async (req, res) => {
  const notification = await notificationService.markRead((req.params.id as string), req.user!.userId);
  res.json({ success: true, data: notification });
}));

export default router;
