import { describe, it, expect, vi } from 'vitest';
import { authenticate, optionalAuth } from '../../src/middleware/auth';
import { generateAccessToken } from '../../src/config/auth';

function mockReq(overrides: Record<string, any> = {}) {
  return {
    headers: {},
    cookies: {},
    query: {},
    ...overrides,
  } as any;
}

function mockRes() {
  const json = vi.fn();
  return { status: vi.fn().mockReturnValue({ json }), json } as any;
}

const validPayload = {
  userId: 'u1', email: 'a@b.com', organisationId: 'o1',
  role: 'ORGANISATION_ADMIN', permissions: ['VESSEL_VIEW'],
};

describe('authenticate', () => {
  it('extracts token from Authorization header', () => {
    const token = generateAccessToken(validPayload);
    const req = mockReq({ headers: { authorization: `Bearer ${token}` } });
    const next = vi.fn();
    authenticate(req, mockRes(), next);
    expect(next).toHaveBeenCalled();
    expect(req.user.userId).toBe('u1');
  });

  it('extracts token from cookie', () => {
    const token = generateAccessToken(validPayload);
    const req = mockReq({ cookies: { accessToken: token } });
    const next = vi.fn();
    authenticate(req, mockRes(), next);
    expect(next).toHaveBeenCalled();
    expect(req.user.email).toBe('a@b.com');
  });

  it('extracts token from query param', () => {
    const token = generateAccessToken(validPayload);
    const req = mockReq({ query: { token } });
    const next = vi.fn();
    authenticate(req, mockRes(), next);
    expect(next).toHaveBeenCalled();
  });

  it('returns 401 when no token is present', () => {
    const res = mockRes();
    const next = vi.fn();
    authenticate(mockReq(), res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 401 for invalid token', () => {
    const req = mockReq({ headers: { authorization: 'Bearer invalid-token' } });
    const res = mockRes();
    const next = vi.fn();
    authenticate(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('prefers header token over cookie', () => {
    const headerToken = generateAccessToken({ ...validPayload, email: 'header@test.com' });
    const cookieToken = generateAccessToken({ ...validPayload, email: 'cookie@test.com' });
    const req = mockReq({
      headers: { authorization: `Bearer ${headerToken}` },
      cookies: { accessToken: cookieToken },
    });
    const next = vi.fn();
    authenticate(req, mockRes(), next);
    expect(req.user.email).toBe('header@test.com');
  });
});

describe('optionalAuth', () => {
  it('sets user when valid token is present', () => {
    const token = generateAccessToken(validPayload);
    const req = mockReq({ headers: { authorization: `Bearer ${token}` } });
    const next = vi.fn();
    optionalAuth(req, mockRes(), next);
    expect(next).toHaveBeenCalled();
    expect(req.user.userId).toBe('u1');
  });

  it('continues without error when no token', () => {
    const req = mockReq();
    const next = vi.fn();
    optionalAuth(req, mockRes(), next);
    expect(next).toHaveBeenCalled();
    expect(req.user).toBeUndefined();
  });

  it('continues without error for invalid token', () => {
    const req = mockReq({ headers: { authorization: 'Bearer invalid' } });
    const next = vi.fn();
    optionalAuth(req, mockRes(), next);
    expect(next).toHaveBeenCalled();
    expect(req.user).toBeUndefined();
  });
});
