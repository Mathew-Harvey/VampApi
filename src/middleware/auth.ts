import { Request, Response, NextFunction } from 'express';
import { verifyToken, TokenPayload } from '../config/auth';

declare global {
  namespace Express {
    interface Request {
      user?: TokenPayload;
    }
  }
}

export function authenticate(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  const headerToken = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : null;
  const cookieToken = req.cookies?.accessToken;
  const token = headerToken || cookieToken;

  if (!token) {
    res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Missing or invalid authorization header' } });
    return;
  }

  try {
    const payload = verifyToken(token);
    req.user = payload;
    next();
  } catch {
    res.status(401).json({ success: false, error: { code: 'TOKEN_EXPIRED', message: 'Invalid or expired token' } });
  }
}

export function optionalAuth(req: Request, _res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  const headerToken = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : null;
  const cookieToken = req.cookies?.accessToken;
  const token = headerToken || cookieToken;

  if (token) {
      try {
        req.user = verifyToken(token);
      } catch {
        // Ignore invalid tokens for optional auth
      }
  }
  next();
}
