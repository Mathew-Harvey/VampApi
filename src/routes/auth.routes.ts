import { Router, Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { authService } from '../services/auth.service';
import { authenticate, optionalAuth } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { loginSchema, registerSchema, forgotPasswordSchema, resetPasswordSchema, changePasswordSchema } from '../schemas/user.schema';
import { asyncHandler } from '../utils/async-handler';
import { AppError } from '../middleware/error';
import { env } from '../config/env';

const router = Router();

const isTest = process.env.NODE_ENV === 'test';
const noopLimiter = (_req: Request, _res: Response, next: (err?: unknown) => void) => next();

/**
 * Extra-strict limiter for password-reset requests. Forgot-password is a vector
 * for enumeration + outbound email spam, so we cap much more aggressively than
 * the shared /auth limiter.
 */
const forgotPasswordLimiter = isTest
  ? noopLimiter
  : rateLimit({
      windowMs: 60 * 60 * 1000, // 1 hour
      max: 5,                   // 5 requests/ip/hour
      standardHeaders: true,
      legacyHeaders: false,
      message: { success: false, error: { code: 'RATE_LIMITED', message: 'Too many password reset attempts, please try again later' } },
    });

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
  // Cookie lifetimes are driven by env so they always match the JWT's own
  // `exp` claim. Previously the cookie lived 24h while the access token
  // expired in 15m, so browsers kept sending already-expired cookies.
  res.cookie('accessToken', accessToken, {
    ...baseCookieOptions,
    maxAge: env.ACCESS_COOKIE_MAX_AGE_SECONDS * 1000,
  });
  res.cookie('refreshToken', refreshToken, {
    ...baseCookieOptions,
    maxAge: env.REFRESH_COOKIE_MAX_AGE_SECONDS * 1000,
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

router.post('/forgot-password', forgotPasswordLimiter, validate(forgotPasswordSchema), asyncHandler(async (req: Request, res: Response) => {
  try {
    await authService.forgotPassword(req.body.email);
  } catch {
    // Always return the same 200 response whether or not the email exists
    // or the email-send succeeded — callers must not be able to enumerate.
  }
  res.json({ success: true, data: { message: 'If an account exists, a reset link has been sent' } });
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
  // Accept an optional `organisationId` hint from the client so a browser
  // holding a legacy refresh token can still keep its active-org context
  // across a page reload.  Membership is verified server-side.
  const hint = typeof req.body?.organisationId === 'string'
    ? req.body.organisationId
    : undefined;
  const result = await authService.refreshAccessToken(refreshToken, hint);
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
