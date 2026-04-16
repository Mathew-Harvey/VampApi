import { Router, Request, Response } from 'express';
import { authService } from '../services/auth.service';
import { authenticate, optionalAuth } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { loginSchema, registerSchema, forgotPasswordSchema, resetPasswordSchema, changePasswordSchema } from '../schemas/user.schema';
import { asyncHandler } from '../utils/async-handler';
import { AppError } from '../middleware/error';

const router = Router();

function getCookieOptions() {
  const isProd = process.env.NODE_ENV === 'production';
  // Cross-origin requests (e.g. vamp-web.onrender.com → vamp-api.onrender.com)
  // require sameSite:'none' + secure:true so the browser sends cookies on fetch.
  const sameSite: 'lax' | 'none' = isProd ? 'none' : 'lax';
  return {
    httpOnly: true,
    secure: isProd,
    sameSite,
    path: '/',
  } as const;
}

function setAuthCookies(res: Response, accessToken: string, refreshToken: string) {
  const baseCookieOptions = getCookieOptions();
  res.cookie('accessToken', accessToken, {
    ...baseCookieOptions,
    maxAge: 24 * 60 * 60 * 1000,
  });
  res.cookie('refreshToken', refreshToken, {
    ...baseCookieOptions,
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });
}

router.post('/register', validate(registerSchema), asyncHandler(async (req: Request, res: Response) => {
  const result = await authService.register(req.body);
  setAuthCookies(res, result.accessToken, result.refreshToken);
  res.status(201).json({
    success: true,
    data: {
      accessToken: result.accessToken,
      user: result.user,
      organisation: result.organisation,
    },
  });
}));

router.post('/login', validate(loginSchema), asyncHandler(async (req: Request, res: Response) => {
  const { email, password, organisationId } = req.body;
  const result = await authService.login(email, password, organisationId);
  setAuthCookies(res, result.accessToken, result.refreshToken);
  res.json({ success: true, data: { accessToken: result.accessToken, user: result.user, organisation: result.organisation } });
}));

router.post('/forgot-password', validate(forgotPasswordSchema), asyncHandler(async (req: Request, res: Response) => {
  try {
    const result = await authService.forgotPassword(req.body.email);
    res.json({ success: true, data: result });
  } catch {
    // Always return 200 for forgot-password (don't reveal email existence)
    res.json({ success: true, data: { message: 'If an account exists, a reset link has been sent' } });
  }
}));

router.post('/reset-password', validate(resetPasswordSchema), asyncHandler(async (req: Request, res: Response) => {
  const result = await authService.resetPassword(req.body.token, req.body.password);
  res.json({ success: true, data: result });
}));

router.post('/refresh', asyncHandler(async (req: Request, res: Response) => {
  const refreshToken = req.cookies?.refreshToken || req.body.refreshToken;
  if (!refreshToken) {
    throw new AppError(401, 'NO_TOKEN', 'No refresh token');
  }
  const result = await authService.refreshAccessToken(refreshToken);
  setAuthCookies(res, result.accessToken, result.refreshToken);
  res.json({ success: true, data: { accessToken: result.accessToken } });
}));

router.post('/switch-organisation', authenticate, asyncHandler(async (req: Request, res: Response) => {
  const { organisationId } = req.body;
  if (!organisationId) {
    throw new AppError(400, 'VALIDATION_ERROR', 'organisationId is required');
  }
  const result = await authService.switchOrganisation(req.user!.userId, organisationId);
  setAuthCookies(res, result.accessToken, result.refreshToken);
  res.json({ success: true, data: { accessToken: result.accessToken, user: result.user, organisation: result.organisation } });
}));

router.post('/logout', optionalAuth, (_req: Request, res: Response) => {
  const cookieOptions = getCookieOptions();
  res.clearCookie('accessToken', cookieOptions);
  res.clearCookie('refreshToken', cookieOptions);
  res.json({ success: true, data: { message: 'Logged out' } });
});

router.get('/me', authenticate, asyncHandler(async (req: Request, res: Response) => {
  const profile = await authService.getProfile(req.user!.userId);
  res.json({ success: true, data: profile });
}));

router.post('/change-password', authenticate, validate(changePasswordSchema), asyncHandler(async (req: Request, res: Response) => {
  const result = await authService.changePassword(req.user!.userId, req.body.currentPassword, req.body.newPassword);
  res.json({ success: true, data: result });
}));

export default router;
