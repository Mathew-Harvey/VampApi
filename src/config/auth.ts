import jwt from 'jsonwebtoken';
import { env } from './env';

export interface TokenPayload {
  userId: string;
  email: string;
  organisationId: string;
  role: string;
  permissions: string[];
}

export function generateAccessToken(payload: TokenPayload): string {
  return jwt.sign(payload, env.JWT_SECRET, { expiresIn: env.JWT_EXPIRY as any });
}

export function generateRefreshToken(userId: string): string {
  return jwt.sign({ userId, type: 'refresh' }, env.JWT_SECRET, { expiresIn: env.REFRESH_TOKEN_EXPIRY as any });
}

export function verifyToken(token: string): TokenPayload {
  return jwt.verify(token, env.JWT_SECRET) as TokenPayload;
}

export function verifyRefreshToken(token: string): { userId: string; type: string } {
  return jwt.verify(token, env.JWT_SECRET) as { userId: string; type: string };
}
