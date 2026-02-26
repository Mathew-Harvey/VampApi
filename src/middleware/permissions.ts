import { Request, Response, NextFunction } from 'express';
import { TokenPayload } from '../config/auth';

export function hasAnyPermission(user: TokenPayload | undefined, ...permissions: string[]) {
  if (!user) return false;
  return permissions.some(
    (p) => user.permissions.includes(p) || user.permissions.includes('ADMIN_FULL_ACCESS')
  );
}

export function requirePermission(...permissions: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const user = req.user;
    if (!user) {
      res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Authentication required' } });
      return;
    }

    const hasPermission = hasAnyPermission(user, ...permissions);

    if (!hasPermission) {
      res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Insufficient permissions' } });
      return;
    }
    next();
  };
}

export function requireRole(...roles: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const user = req.user;
    if (!user) {
      res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Authentication required' } });
      return;
    }

    if (!roles.includes(user.role)) {
      res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Insufficient role' } });
      return;
    }
    next();
  };
}
