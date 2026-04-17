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

export function generateRefreshToken(userId: string): string {
  const claims: RefreshTokenClaims = { userId, type: 'refresh' };
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
  const decoded = jwt.verify(token, env.JWT_SECRET) as Partial<AccessTokenClaims> & { type?: string };
  if (decoded.type === 'refresh') {
    throw new Error('Refresh tokens cannot be used as access tokens');
  }
  return {
    userId: decoded.userId as string,
    email: decoded.email as string,
    organisationId: decoded.organisationId as string,
    role: decoded.role as string,
    permissions: Array.isArray(decoded.permissions) ? decoded.permissions : [],
  };
}

/**
 * Verify a refresh token. Accepts only tokens signed with the refresh secret
 * and carrying `type: 'refresh'`.
 */
export function verifyRefreshToken(token: string): { userId: string; type: 'refresh' } {
  const decoded = jwt.verify(token, getRefreshSecret()) as { userId?: string; type?: string };
  if (decoded.type !== 'refresh' || !decoded.userId) {
    throw new Error('Not a refresh token');
  }
  return { userId: decoded.userId, type: 'refresh' };
}
