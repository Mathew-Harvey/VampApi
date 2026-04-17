import crypto from 'crypto';
import { env } from './env';

/**
 * Media URL signing
 * -----------------
 *
 * Problem: the `/uploads/*` static route is now authenticated, but plain
 * `<img>` elements in cross-origin pages (report HTML rendered on the API,
 * emails, PDF exports, etc.) can't send `Authorization` headers or in many
 * browsers the cookie either.  We therefore issue short-lived HMAC-signed
 * URLs: `/uploads/<file>?mt=<sig>&me=<expSec>`.
 *
 * The signature is over `<pathname>|<expUnixSec>` using a secret derived from
 * JWT_SECRET (deliberately not the same value so a signed URL token can't be
 * mistaken for a JWT).
 */

const MEDIA_SIG_QUERY = 'mt' as const;
const MEDIA_EXP_QUERY = 'me' as const;
const DEFAULT_TTL_SECONDS = 60 * 60; // 1 hour

function getSecret(): string {
  // Derive a distinct secret so the token can never be used for JWT verification
  return `media-sig:${env.JWT_SECRET}`;
}

function sign(payload: string): string {
  return crypto.createHmac('sha256', getSecret()).update(payload).digest('base64url');
}

/**
 * Returns the unsigned pathname with signed query parameters appended.
 * If the URL already has a `?mt=` parameter, returns the URL unchanged.
 */
export function signMediaUrl(urlOrPath: string, ttlSeconds: number = DEFAULT_TTL_SECONDS): string {
  if (!urlOrPath) return urlOrPath;
  // Only sign `/uploads/` URLs — leave absolute third-party URLs alone.
  if (!/\/uploads\//i.test(urlOrPath)) return urlOrPath;

  let pathname: string;
  let prefix = '';
  if (/^https?:\/\//i.test(urlOrPath)) {
    try {
      const u = new URL(urlOrPath);
      pathname = u.pathname;
      prefix = `${u.origin}`;
      // If caller already supplied a signature, don't re-sign — just return.
      if (u.searchParams.has(MEDIA_SIG_QUERY)) return urlOrPath;
    } catch {
      return urlOrPath;
    }
  } else {
    // Relative path
    pathname = urlOrPath.split('?')[0];
    if (urlOrPath.includes(`${MEDIA_SIG_QUERY}=`)) return urlOrPath;
  }

  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const sig = sign(`${pathname}|${exp}`);

  const separator = urlOrPath.includes('?') ? '&' : '?';
  if (prefix) {
    return `${prefix}${pathname}${separator}${MEDIA_EXP_QUERY}=${exp}&${MEDIA_SIG_QUERY}=${sig}`;
  }
  return `${urlOrPath}${separator}${MEDIA_EXP_QUERY}=${exp}&${MEDIA_SIG_QUERY}=${sig}`;
}

/**
 * Verify a signed URL. `pathname` is the request URL's pathname (no query).
 */
export function verifyMediaSignature(pathname: string, sigQuery: unknown, expQuery: unknown): boolean {
  if (typeof sigQuery !== 'string' || typeof expQuery !== 'string') return false;
  const exp = Number.parseInt(expQuery, 10);
  if (!Number.isFinite(exp)) return false;
  if (exp < Math.floor(Date.now() / 1000)) return false;

  const expected = sign(`${pathname}|${exp}`);
  // Constant-time comparison to prevent timing attacks
  const a = Buffer.from(expected);
  const b = Buffer.from(sigQuery);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export const MEDIA_SIGNATURE_QUERY_PARAM = MEDIA_SIG_QUERY;
export const MEDIA_EXPIRY_QUERY_PARAM = MEDIA_EXP_QUERY;
