import { Request, Response, NextFunction } from 'express';

// The actual audit logging is done by the audit service.
// This middleware just passes through context info.
export function auditContext(req: Request, _res: Response, next: NextFunction): void {
  // Attach IP and user agent to request for audit purposes
  (req as any).auditContext = {
    ipAddress: req.ip || req.socket.remoteAddress,
    userAgent: req.headers['user-agent'],
  };
  next();
}
