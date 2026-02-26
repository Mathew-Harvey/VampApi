import { Router, Request, Response } from 'express';
import { mediaService } from '../services/media.service';
import { authenticate } from '../middleware/auth';
import { upload } from '../middleware/upload';

const router = Router();

router.post('/upload', authenticate, upload.single('file'), async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      res.status(400).json({ success: false, error: { code: 'NO_FILE', message: 'No file uploaded' } });
      return;
    }
    const media = await mediaService.create(req.file, req.user!.userId, req.body);
    res.status(201).json({ success: true, data: media });
  } catch (error: any) {
    res.status(error.statusCode || 500).json({ success: false, error: { code: error.code || 'ERROR', message: error.message } });
  }
});

router.get('/:id', authenticate, async (req: Request, res: Response) => {
  try {
    const media = await mediaService.getById((req.params.id as string));
    res.json({ success: true, data: media });
  } catch (error: any) {
    res.status(error.statusCode || 500).json({ success: false, error: { code: error.code || 'ERROR', message: error.message } });
  }
});

router.delete('/:id', authenticate, async (req: Request, res: Response) => {
  try {
    await mediaService.delete((req.params.id as string), req.user!.userId);
    res.json({ success: true, data: { message: 'Media deleted' } });
  } catch (error: any) {
    res.status(error.statusCode || 500).json({ success: false, error: { code: error.code || 'ERROR', message: error.message } });
  }
});

export default router;
