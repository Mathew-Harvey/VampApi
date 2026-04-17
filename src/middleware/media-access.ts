import { Request, Response, NextFunction } from 'express';
import { verifyToken } from '../config/auth';
import {
  verifyMediaSignature,
  MEDIA_SIGNATURE_QUERY_PARAM,
  MEDIA_EXPIRY_QUERY_PARAM,
} from '../config/media-signing';

/**
 * Gate for `/uploads/*` static files.
 *
 * Accepts, in this order:
 *   1. An HMAC-signed URL (`?mt=<sig>&me=<exp>`).  This is what the server
 *      emits when it renders media URLs so that <img> tags in cross-origin
 *      HTML (report previews, emails, etc.) load without needing cookies.
 *   2. A bearer/cookie/query access-token that passes `verifyToken`.  This
 *      covers same-origin fetches from the SPA.
 *
 * Any other request is rejected with 401.
 */
export function verifyMediaAccess(req: Request, res: Response, next: NextFunction): void {
  const sig = req.query?.[MEDIA_SIGNATURE_QUERY_PARAM];
  const exp = req.query?.[MEDIA_EXPIRY_QUERY_PARAM];
  if (sig && exp && verifyMediaSignature(req.path, sig, exp)) {
    next();
    return;
  }

  const authHeader = req.headers.authorization;
  const headerToken = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : null;
  const cookieToken = (req as any).cookies?.accessToken as string | undefined;
  const queryToken = typeof req.query?.token === 'string' ? req.query.token : null;
  const token = headerToken || cookieToken || queryToken;

  if (token) {
    try {
      verifyToken(token);
      next();
      return;
    } catch {
      // fall through to 401
    }
  }

  res.status(401).json({
    success: false,
    error: { code: 'UNAUTHORIZED', message: 'Media access requires authentication or a signed URL' },
  });
}
