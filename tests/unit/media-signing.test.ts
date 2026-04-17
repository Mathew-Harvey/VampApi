import { describe, it, expect, vi } from 'vitest';
import {
  signMediaUrl, verifyMediaSignature,
  MEDIA_SIGNATURE_QUERY_PARAM, MEDIA_EXPIRY_QUERY_PARAM,
} from '../../src/config/media-signing';
import { verifyMediaAccess } from '../../src/middleware/media-access';
import { generateAccessToken, generateRefreshToken } from '../../src/config/auth';

function mockReq(overrides: Record<string, any> = {}) {
  return {
    path: '/uploads/test.jpg',
    headers: {},
    cookies: {},
    query: {},
    ...overrides,
  } as any;
}
function mockRes() {
  const json = vi.fn();
  const status = vi.fn().mockReturnValue({ json });
  return { status, json } as any;
}

describe('signMediaUrl / verifyMediaSignature', () => {
  it('appends an HMAC + expiry to relative /uploads URLs', () => {
    const signed = signMediaUrl('/uploads/abc.jpg');
    expect(signed).toMatch(new RegExp(`/uploads/abc\\.jpg\\?${MEDIA_EXPIRY_QUERY_PARAM}=\\d+&${MEDIA_SIGNATURE_QUERY_PARAM}=.+`));
  });

  it('appends an HMAC + expiry to absolute /uploads URLs', () => {
    const signed = signMediaUrl('https://api.example.com/uploads/abc.jpg');
    expect(signed).toContain('?me=');
    expect(signed).toContain('&mt=');
  });

  it('leaves non-/uploads URLs untouched', () => {
    expect(signMediaUrl('https://cdn.example.com/other.png')).toBe('https://cdn.example.com/other.png');
    expect(signMediaUrl('data:image/png;base64,AAA')).toBe('data:image/png;base64,AAA');
  });

  it('leaves already-signed URLs untouched (no double-signing)', () => {
    const signed = signMediaUrl('/uploads/a.jpg');
    expect(signMediaUrl(signed)).toBe(signed);
  });

  it('verifies a signature it just issued', () => {
    const signed = signMediaUrl('/uploads/x.jpg');
    const url = new URL(`http://localhost${signed}`);
    const sig = url.searchParams.get(MEDIA_SIGNATURE_QUERY_PARAM);
    const exp = url.searchParams.get(MEDIA_EXPIRY_QUERY_PARAM);
    expect(verifyMediaSignature('/uploads/x.jpg', sig, exp)).toBe(true);
  });

  it('rejects a signature for a different path (constant-time safe)', () => {
    const signed = signMediaUrl('/uploads/x.jpg');
    const url = new URL(`http://localhost${signed}`);
    const sig = url.searchParams.get(MEDIA_SIGNATURE_QUERY_PARAM);
    const exp = url.searchParams.get(MEDIA_EXPIRY_QUERY_PARAM);
    expect(verifyMediaSignature('/uploads/OTHER.jpg', sig, exp)).toBe(false);
  });

  it('rejects an expired signature', () => {
    const signed = signMediaUrl('/uploads/x.jpg', -60); // already expired
    const url = new URL(`http://localhost${signed}`);
    const sig = url.searchParams.get(MEDIA_SIGNATURE_QUERY_PARAM);
    const exp = url.searchParams.get(MEDIA_EXPIRY_QUERY_PARAM);
    expect(verifyMediaSignature('/uploads/x.jpg', sig, exp)).toBe(false);
  });

  it('rejects a tampered signature', () => {
    const signed = signMediaUrl('/uploads/x.jpg');
    const url = new URL(`http://localhost${signed}`);
    const sig = url.searchParams.get(MEDIA_SIGNATURE_QUERY_PARAM) + 'ff';
    const exp = url.searchParams.get(MEDIA_EXPIRY_QUERY_PARAM);
    expect(verifyMediaSignature('/uploads/x.jpg', sig, exp)).toBe(false);
  });

  it('rejects missing / non-string query params', () => {
    expect(verifyMediaSignature('/uploads/x.jpg', undefined, '1234567890')).toBe(false);
    expect(verifyMediaSignature('/uploads/x.jpg', 'sig', undefined)).toBe(false);
    expect(verifyMediaSignature('/uploads/x.jpg', ['a'] as any, '1')).toBe(false);
  });
});

describe('verifyMediaAccess middleware', () => {
  const validPayload = {
    userId: 'u1', email: 'a@b.com', organisationId: 'o1',
    role: 'ORGANISATION_ADMIN', permissions: ['VESSEL_VIEW'],
  };

  it('allows requests with a valid signed URL', () => {
    const signed = signMediaUrl('/uploads/x.jpg');
    const url = new URL(`http://localhost${signed}`);
    const req = mockReq({
      path: '/uploads/x.jpg',
      query: {
        mt: url.searchParams.get(MEDIA_SIGNATURE_QUERY_PARAM),
        me: url.searchParams.get(MEDIA_EXPIRY_QUERY_PARAM),
      },
    });
    const next = vi.fn();
    verifyMediaAccess(req, mockRes(), next);
    expect(next).toHaveBeenCalled();
  });

  it('allows requests with a valid access token via header', () => {
    const token = generateAccessToken(validPayload);
    const req = mockReq({ headers: { authorization: `Bearer ${token}` } });
    const next = vi.fn();
    verifyMediaAccess(req, mockRes(), next);
    expect(next).toHaveBeenCalled();
  });

  it('allows requests with a valid access token via cookie', () => {
    const token = generateAccessToken(validPayload);
    const req = mockReq({ cookies: { accessToken: token } });
    const next = vi.fn();
    verifyMediaAccess(req, mockRes(), next);
    expect(next).toHaveBeenCalled();
  });

  it('allows requests with ?token= query fallback', () => {
    const token = generateAccessToken(validPayload);
    const req = mockReq({ query: { token } });
    const next = vi.fn();
    verifyMediaAccess(req, mockRes(), next);
    expect(next).toHaveBeenCalled();
  });

  it('rejects a refresh token masquerading as an access token', () => {
    const refresh = generateRefreshToken('u1');
    const req = mockReq({ headers: { authorization: `Bearer ${refresh}` } });
    const res = mockRes();
    const next = vi.fn();
    verifyMediaAccess(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects anonymous requests', () => {
    const req = mockReq();
    const res = mockRes();
    const next = vi.fn();
    verifyMediaAccess(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects a signed URL whose path does not match the request', () => {
    const signed = signMediaUrl('/uploads/secret.jpg');
    const url = new URL(`http://localhost${signed}`);
    // Caller is using the sig for /uploads/secret.jpg but asking for
    // /uploads/other.jpg — must be rejected.
    const req = mockReq({
      path: '/uploads/other.jpg',
      query: {
        mt: url.searchParams.get(MEDIA_SIGNATURE_QUERY_PARAM),
        me: url.searchParams.get(MEDIA_EXPIRY_QUERY_PARAM),
      },
    });
    const res = mockRes();
    const next = vi.fn();
    verifyMediaAccess(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });
});
