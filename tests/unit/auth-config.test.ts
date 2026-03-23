import { describe, it, expect } from 'vitest';
import { generateAccessToken, generateRefreshToken, verifyToken, verifyRefreshToken } from '../../src/config/auth';

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
  });

  describe('generateRefreshToken / verifyRefreshToken', () => {
    it('generates a refresh token with correct type', () => {
      const token = generateRefreshToken('user-123');
      expect(token).toBeTruthy();

      const decoded = verifyRefreshToken(token);
      expect(decoded.userId).toBe('user-123');
      expect(decoded.type).toBe('refresh');
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
