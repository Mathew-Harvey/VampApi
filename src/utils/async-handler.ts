import { Request, Response, NextFunction } from 'express';

/**
 * Wraps an async route handler so that thrown errors are forwarded
 * to the Express error-handling middleware instead of causing
 * unhandled promise rejections.
 *
 * Usage:
 *   router.get('/path', asyncHandler(async (req, res) => { ... }));
 *
 * Any AppError thrown will be caught by the centralised errorHandler
 * in middleware/error.ts, which already formats the response.
 */
type AsyncRouteHandler = (req: Request, res: Response, next: NextFunction) => Promise<void>;

export function asyncHandler(fn: AsyncRouteHandler) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };
}
