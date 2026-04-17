import { describe, it, expect } from 'vitest';
import jwt from 'jsonwebtoken';
import {
  generateAccessToken, generateRefreshToken,
  verifyToken, verifyRefreshToken,
} from '../../src/config/auth';
import { env } from '../../src/config/env';

describe('JWT token generation and verification', () => {
  const payload = {
    userId: 'user-123',
    email: 'test@example.com',
    organisationId: 'org-456',
    role: 'ORGANISATION_ADMIN',
    permissions: ['VESSEL_VIEW', 'VESSEL_EDIT'],
  };

  describe('generateAccessToken / verifyToken', () => {
    it('generates a valid JWT that can be verified', () => {
      const token = generateAccessToken(payload);
      expect(token).toBeTruthy();
      expect(typeof token).toBe('string');

      const decoded = verifyToken(token);
      expect(decoded.userId).toBe(payload.userId);
      expect(decoded.email).toBe(payload.email);
      expect(decoded.organisationId).toBe(payload.organisationId);
      expect(decoded.role).toBe(payload.role);
      expect(decoded.permissions).toEqual(payload.permissions);
    });

    it('stamps the access token with type: "access"', () => {
      const token = generateAccessToken(payload);
      const decoded: any = jwt.decode(token);
      expect(decoded.type).toBe('access');
    });

    it('falls back to empty permissions array if the claim is missing', () => {
      // Manually mint a token without a `permissions` claim to simulate a
      // third-party or legacy token.  verifyToken must coerce to [] rather
      // than returning `undefined` (which would crash permission checks).
      const token = jwt.sign({ userId: 'u', email: 'x', organisationId: 'o', role: 'X' }, env.JWT_SECRET);
      const decoded = verifyToken(token);
      expect(decoded.permissions).toEqual([]);
    });
  });

  describe('generateRefreshToken / verifyRefreshToken', () => {
    it('generates a refresh token with correct type', () => {
      const token = generateRefreshToken('user-123');
      expect(token).toBeTruthy();

      const decoded = verifyRefreshToken(token);
      expect(decoded.userId).toBe('user-123');
      expect(decoded.type).toBe('refresh');
    });

    it('rejects a refresh token that is missing the refresh type claim', () => {
      const token = jwt.sign({ userId: 'u', type: 'weird' }, env.JWT_SECRET);
      expect(() => verifyRefreshToken(token)).toThrow(/refresh/i);
    });

    it('rejects a refresh token that is missing userId', () => {
      const token = jwt.sign({ type: 'refresh' }, env.JWT_SECRET);
      expect(() => verifyRefreshToken(token)).toThrow(/refresh/i);
    });
  });

  describe('token type separation — access vs refresh', () => {
    it('verifyToken REJECTS a refresh token (type confusion guard)', () => {
      const refreshToken = generateRefreshToken('user-123');
      expect(() => verifyToken(refreshToken)).toThrow(/refresh/i);
    });

    it('verifyRefreshToken REJECTS an access token', () => {
      const access = generateAccessToken(payload);
      expect(() => verifyRefreshToken(access)).toThrow(/refresh/i);
    });
  });

  describe('verifyToken with invalid token', () => {
    it('throws for a tampered token', () => {
      expect(() => verifyToken('invalid.token.here')).toThrow();
    });

    it('throws for empty string', () => {
      expect(() => verifyToken('')).toThrow();
    });
  });
});
