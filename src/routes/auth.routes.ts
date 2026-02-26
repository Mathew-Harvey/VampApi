import { Router, Request, Response } from 'express';
import { authService } from '../services/auth.service';
import { authenticate, optionalAuth } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { loginSchema, registerSchema, forgotPasswordSchema, resetPasswordSchema } from '../schemas/user.schema';

const router = Router();

router.post('/register', validate(registerSchema), async (req: Request, res: Response) => {
  try {
    const result = await authService.register(req.body);
    res.cookie('refreshToken', result.refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });
    res.status(201).json({
      success: true,
      data: {
        accessToken: result.accessToken,
        user: result.user,
        organisation: result.organisation,
      },
    });
  } catch (error: any) {
    const status = error.statusCode || 500;
    res.status(status).json({ success: false, error: { code: error.code || 'ERROR', message: error.message } });
  }
});

router.post('/login', validate(loginSchema), async (req: Request, res: Response) => {
  try {
    const { email, password, organisationId } = req.body;
    const result = await authService.login(email, password, organisationId);
    res.cookie('refreshToken', result.refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });
    res.json({ success: true, data: { accessToken: result.accessToken, user: result.user, organisation: result.organisation } });
  } catch (error: any) {
    const status = error.statusCode || 500;
    res.status(status).json({ success: false, error: { code: error.code || 'ERROR', message: error.message } });
  }
});

router.post('/forgot-password', validate(forgotPasswordSchema), async (req: Request, res: Response) => {
  try {
    const result = await authService.forgotPassword(req.body.email);
    res.json({ success: true, data: result });
  } catch (error: any) {
    // Always return 200 for forgot-password (don't reveal email existence)
    res.json({ success: true, data: { message: 'If an account exists, a reset link has been sent' } });
  }
});

router.post('/reset-password', validate(resetPasswordSchema), async (req: Request, res: Response) => {
  try {
    const result = await authService.resetPassword(req.body.token, req.body.password);
    res.json({ success: true, data: result });
  } catch (error: any) {
    const status = error.statusCode || 500;
    res.status(status).json({ success: false, error: { code: error.code || 'ERROR', message: error.message } });
  }
});

router.post('/refresh', async (req: Request, res: Response) => {
  try {
    const refreshToken = req.cookies?.refreshToken || req.body.refreshToken;
    if (!refreshToken) {
      res.status(401).json({ success: false, error: { code: 'NO_TOKEN', message: 'No refresh token' } });
      return;
    }
    const result = await authService.refreshAccessToken(refreshToken);
    res.cookie('refreshToken', result.refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });
    res.json({ success: true, data: { accessToken: result.accessToken } });
  } catch (error: any) {
    const status = error.statusCode || 500;
    res.status(status).json({ success: false, error: { code: error.code || 'ERROR', message: error.message } });
  }
});

router.post('/logout', optionalAuth, (_req: Request, res: Response) => {
  res.clearCookie('refreshToken');
  res.json({ success: true, data: { message: 'Logged out' } });
});

router.get('/me', authenticate, async (req: Request, res: Response) => {
  try {
    const profile = await authService.getProfile(req.user!.userId);
    res.json({ success: true, data: profile });
  } catch (error: any) {
    const status = error.statusCode || 500;
    res.status(status).json({ success: false, error: { code: error.code || 'ERROR', message: error.message } });
  }
});

export default router;
