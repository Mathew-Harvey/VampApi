import { Router, Request, Response } from 'express';
import { authenticate } from '../middleware/auth';
import { requirePermission } from '../middleware/permissions';
import prisma from '../config/database';

const router = Router();

router.get('/', authenticate, async (_req: Request, res: Response) => {
  try {
    const orgs = await prisma.organisation.findMany({ orderBy: { name: 'asc' } });
    res.json({ success: true, data: orgs });
  } catch (error: any) {
    res.status(500).json({ success: false, error: { code: 'ERROR', message: error.message } });
  }
});

router.post('/', authenticate, requirePermission('ADMIN_FULL_ACCESS'), async (req: Request, res: Response) => {
  try {
    const org = await prisma.organisation.create({ data: req.body });
    res.status(201).json({ success: true, data: org });
  } catch (error: any) {
    res.status(500).json({ success: false, error: { code: 'ERROR', message: error.message } });
  }
});

export default router;
