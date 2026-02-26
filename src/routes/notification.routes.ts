import { Router, Request, Response } from 'express';
import { notificationService } from '../services/notification.service';
import { authenticate } from '../middleware/auth';

const router = Router();

router.get('/', authenticate, async (req: Request, res: Response) => {
  try {
    const unreadOnly = req.query.unread === 'true';
    const data = await notificationService.getForUser(req.user!.userId, unreadOnly);
    res.json({ success: true, data });
  } catch (error: any) {
    res.status(500).json({ success: false, error: { code: 'ERROR', message: error.message } });
  }
});

router.get('/count', authenticate, async (req: Request, res: Response) => {
  try {
    const count = await notificationService.getUnreadCount(req.user!.userId);
    res.json({ success: true, data: { count } });
  } catch (error: any) {
    res.status(500).json({ success: false, error: { code: 'ERROR', message: error.message } });
  }
});

router.patch('/:id/read', authenticate, async (req: Request, res: Response) => {
  try {
    const notification = await notificationService.markRead((req.params.id as string), req.user!.userId);
    res.json({ success: true, data: notification });
  } catch (error: any) {
    res.status(500).json({ success: false, error: { code: 'ERROR', message: error.message } });
  }
});

export default router;
