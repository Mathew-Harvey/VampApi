import jwt from 'jsonwebtoken';
import { env } from './env';

export interface TokenPayload {
  userId: string;
  email: string;
  organisationId: string;
  role: string;
  permissions: string[];
}

interface AccessTokenClaims extends TokenPayload {
  type: 'access';
}

interface RefreshTokenClaims {
  userId: string;
  // The organisation the user was actively using when this refresh token
  // was issued.  Optional for backward compatibility with tokens minted
  // before this claim existed — those will fall back to the default org
  // on refresh.
  organisationId?: string;
  type: 'refresh';
}

function getRefreshSecret(): string {
  return env.JWT_REFRESH_SECRET || env.JWT_SECRET;
}

export function generateAccessToken(payload: TokenPayload): string {
  const claims: AccessTokenClaims = { ...payload, type: 'access' };
  return jwt.sign(claims, env.JWT_SECRET, {
    expiresIn: env.JWT_EXPIRY as jwt.SignOptions['expiresIn'],
  });
}

export function generateRefreshToken(userId: string, organisationId?: string): string {
  const claims: RefreshTokenClaims = { userId, type: 'refresh' };
  if (organisationId) claims.organisationId = organisationId;
  return jwt.sign(claims, getRefreshSecret(), {
    expiresIn: env.REFRESH_TOKEN_EXPIRY as jwt.SignOptions['expiresIn'],
  });
}

/**
 * Verify an access token. Throws if the token is invalid, expired, or is a
 * refresh token being used in an access context.
 *
 * Historically access tokens didn't carry a `type` claim. For backward
 * compatibility we accept tokens with no `type`, but we explicitly reject
 * tokens claiming `type: 'refresh'` so a refresh token can never be used
 * as an access token.
 */
export function verifyToken(token: string): TokenPayload {
  // Verify + decode.  We deliberately type the result as a loose record
  // because we want to reject `type: 'refresh'` explicitly — a refresh
  // token should never satisfy this function.  Using `Partial<AccessTokenClaims>`
  // would narrow `type` to `'access' | undefined` and make the refresh check
  // a tautology.
  const decoded = jwt.verify(token, env.JWT_SECRET) as Record<string, unknown>;
  if (decoded.type === 'refresh') {
    throw new Error('Refresh tokens cannot be used as access tokens');
  }
  return {
    userId: typeof decoded.userId === 'string' ? decoded.userId : '',
    email: typeof decoded.email === 'string' ? decoded.email : '',
    organisationId: typeof decoded.organisationId === 'string' ? decoded.organisationId : '',
    role: typeof decoded.role === 'string' ? decoded.role : '',
    permissions: Array.isArray(decoded.permissions) ? (decoded.permissions as string[]) : [],
  };
}

/**
 * Verify a refresh token. Accepts only tokens signed with the refresh secret
 * and carrying `type: 'refresh'`.  The `organisationId` claim is optional —
 * tokens minted before the claim was introduced will still verify and the
 * caller should fall back to the user's default organisation.
 */
export function verifyRefreshToken(
  token: string,
): { userId: string; organisationId?: string; type: 'refresh' } {
  const decoded = jwt.verify(token, getRefreshSecret()) as {
    userId?: string;
    organisationId?: string;
    type?: string;
  };
  if (decoded.type !== 'refresh' || !decoded.userId) {
    throw new Error('Not a refresh token');
  }
  return {
    userId: decoded.userId,
    organisationId: typeof decoded.organisationId === 'string' ? decoded.organisationId : undefined,
    type: 'refresh',
  };
}
