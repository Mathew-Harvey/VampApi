import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AppError, notFound, errorHandler } from '../../src/middleware/error';
import { validate } from '../../src/middleware/validate';
import { hasAnyPermission, requirePermission, requireRole } from '../../src/middleware/permissions';
import { z } from 'zod';

// ──────────────────────────────────────────────────────────
// AppError
// ──────────────────────────────────────────────────────────

describe('AppError', () => {
  it('extends Error', () => {
    const err = new AppError(400, 'BAD_REQUEST', 'Invalid data');
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('AppError');
  });

  it('stores statusCode, code, and message', () => {
    const err = new AppError(404, 'NOT_FOUND', 'Missing', { extra: true });
    expect(err.statusCode).toBe(404);
    expect(err.code).toBe('NOT_FOUND');
    expect(err.message).toBe('Missing');
    expect(err.details).toEqual({ extra: true });
  });
});

// ──────────────────────────────────────────────────────────
// notFound middleware
// ──────────────────────────────────────────────────────────

describe('notFound', () => {
  it('responds with 404 and route info', () => {
    const req = { method: 'GET', path: '/api/v1/missing' } as any;
    const json = vi.fn();
    const res = { status: vi.fn().mockReturnValue({ json }) } as any;
    notFound(req, res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(404);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({
      success: false,
      error: expect.objectContaining({
        code: 'NOT_FOUND',
        message: expect.stringContaining('GET /api/v1/missing'),
      }),
    }));
  });
});

// ──────────────────────────────────────────────────────────
// errorHandler middleware
// ──────────────────────────────────────────────────────────

describe('errorHandler', () => {
  const createRes = () => {
    const json = vi.fn();
    return { status: vi.fn().mockReturnValue({ json }), json } as any;
  };

  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('handles AppError with correct status and code', () => {
    const err = new AppError(409, 'CONFLICT', 'Duplicate');
    const res = createRes();
    errorHandler(err, {} as any, res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.status(409).json).toHaveBeenCalledWith(
      expect.objectContaining({ success: false, error: expect.objectContaining({ code: 'CONFLICT' }) }),
    );
  });

  it('handles generic errors with 500', () => {
    const err = new Error('Oops');
    const res = createRes();
    errorHandler(err, {} as any, res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(500);
  });

  it('hides error details in production', () => {
    const oldEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    const err = new Error('secret internal detail');
    const res = createRes();
    errorHandler(err, {} as any, res, vi.fn());
    const body = res.status(500).json.mock.calls[0][0];
    expect(body.error.message).toBe('Internal server error');
    process.env.NODE_ENV = oldEnv;
  });
});

// ──────────────────────────────────────────────────────────
// validate middleware
// ──────────────────────────────────────────────────────────

describe('validate', () => {
  const schema = z.object({ name: z.string().min(1), age: z.number().int() });

  it('passes valid body to next()', () => {
    const req = { body: { name: 'Alice', age: 30 } } as any;
    const res = { status: vi.fn().mockReturnValue({ json: vi.fn() }) } as any;
    const next = vi.fn();
    validate(schema)(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(req.body).toEqual({ name: 'Alice', age: 30 });
  });

  it('returns 400 for invalid body', () => {
    const req = { body: { name: '', age: 'not-a-number' } } as any;
    const json = vi.fn();
    const res = { status: vi.fn().mockReturnValue({ json }) } as any;
    const next = vi.fn();
    validate(schema)(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({
      success: false,
      error: expect.objectContaining({ code: 'VALIDATION_ERROR' }),
    }));
  });

  it('validates query params when source is "query"', () => {
    const querySchema = z.object({ page: z.string() });
    const req = { query: { page: '1' } } as any;
    const next = vi.fn();
    validate(querySchema, 'query')(req, {} as any, next);
    expect(next).toHaveBeenCalled();
  });
});

// ──────────────────────────────────────────────────────────
// Permissions middleware
// ──────────────────────────────────────────────────────────

describe('hasAnyPermission', () => {
  it('returns false for undefined user', () => {
    expect(hasAnyPermission(undefined, 'VESSEL_VIEW')).toBe(false);
  });

  it('returns true when user has the permission', () => {
    const user = { permissions: ['VESSEL_VIEW', 'VESSEL_EDIT'] } as any;
    expect(hasAnyPermission(user, 'VESSEL_VIEW')).toBe(true);
  });

  it('returns true when user has ADMIN_FULL_ACCESS', () => {
    const user = { permissions: ['ADMIN_FULL_ACCESS'] } as any;
    expect(hasAnyPermission(user, 'VESSEL_VIEW')).toBe(true);
  });

  it('returns false when user lacks permission', () => {
    const user = { permissions: ['VESSEL_VIEW'] } as any;
    expect(hasAnyPermission(user, 'VESSEL_DELETE')).toBe(false);
  });

  it('returns true if user has any of multiple permissions', () => {
    const user = { permissions: ['VESSEL_VIEW'] } as any;
    expect(hasAnyPermission(user, 'VESSEL_DELETE', 'VESSEL_VIEW')).toBe(true);
  });
});

describe('requirePermission', () => {
  it('calls next() when user has permission', () => {
    const req = { user: { permissions: ['VESSEL_VIEW'] } } as any;
    const res = { status: vi.fn().mockReturnValue({ json: vi.fn() }) } as any;
    const next = vi.fn();
    requirePermission('VESSEL_VIEW')(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it('returns 401 when user is missing', () => {
    const req = { user: undefined } as any;
    const json = vi.fn();
    const res = { status: vi.fn().mockReturnValue({ json }) } as any;
    const next = vi.fn();
    requirePermission('VESSEL_VIEW')(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 403 when user lacks permission', () => {
    const req = { user: { permissions: ['VESSEL_VIEW'] } } as any;
    const json = vi.fn();
    const res = { status: vi.fn().mockReturnValue({ json }) } as any;
    const next = vi.fn();
    requirePermission('VESSEL_DELETE')(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });
});

describe('requireRole', () => {
  it('calls next() when user has required role', () => {
    const req = { user: { role: 'ORGANISATION_ADMIN' } } as any;
    const next = vi.fn();
    requireRole('ORGANISATION_ADMIN')(req, {} as any, next);
    expect(next).toHaveBeenCalled();
  });

  it('returns 403 when user has wrong role', () => {
    const req = { user: { role: 'VIEWER' } } as any;
    const json = vi.fn();
    const res = { status: vi.fn().mockReturnValue({ json }) } as any;
    const next = vi.fn();
    requireRole('ORGANISATION_ADMIN')(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });
});
