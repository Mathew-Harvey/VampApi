/**
 * Global test setup for VampApi.
 *
 * Sets required environment variables so the zod env schema
 * validates without a real database or secrets file.
 */

// Must be set BEFORE any module imports `config/env`
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
process.env.JWT_SECRET = 'test-jwt-secret-that-is-at-least-32-chars-long!!';
process.env.JWT_EXPIRY = '15m';
process.env.REFRESH_TOKEN_EXPIRY = '7d';
process.env.PORT = '0'; // let OS pick a port
process.env.APP_URL = 'http://localhost:5173';
process.env.API_URL = 'http://localhost:3001';
