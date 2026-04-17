import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getAllowedOrigins, isOriginAllowed } from '../../src/config/cors';

describe('getAllowedOrigins', () => {
  const original = process.env.APP_URL;

  afterEach(() => {
    if (original !== undefined) {
      process.env.APP_URL = original;
    } else {
      delete process.env.APP_URL;
    }
  });

  it('defaults to localhost:5173 when APP_URL not set', () => {
    delete process.env.APP_URL;
    expect(getAllowedOrigins()).toEqual(['http://localhost:5173']);
  });

  it('parses a single origin', () => {
    process.env.APP_URL = 'https://vamp-web.onrender.com';
    expect(getAllowedOrigins()).toEqual(['https://vamp-web.onrender.com']);
  });

  it('parses comma-separated origins', () => {
    process.env.APP_URL = 'https://a.com, https://b.com';
    expect(getAllowedOrigins()).toEqual(['https://a.com', 'https://b.com']);
  });

  it('filters empty segments', () => {
    process.env.APP_URL = 'https://a.com,,https://b.com,';
    const origins = getAllowedOrigins();
    expect(origins).toEqual(['https://a.com', 'https://b.com']);
  });
});

describe('isOriginAllowed', () => {
  it('allows undefined origin (same-origin / Postman)', () => {
    expect(isOriginAllowed(undefined)).toBe(true);
  });

  it('allows explicitly listed origin', () => {
    expect(isOriginAllowed('http://localhost:5173', ['http://localhost:5173'])).toBe(true);
  });

  it('rejects unlisted origin in production', () => {
    const oldEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    expect(isOriginAllowed('https://evil.com', ['https://good.com'])).toBe(false);
    process.env.NODE_ENV = oldEnv;
  });

  it('allows localhost in development', () => {
    const oldEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';
    expect(isOriginAllowed('http://localhost:5174', ['https://prod.com'])).toBe(true);
    process.env.NODE_ENV = oldEnv;
  });

  it('treats trailing slashes as equivalent', () => {
    expect(isOriginAllowed('https://app.example.com/', ['https://app.example.com'])).toBe(true);
    expect(isOriginAllowed('https://app.example.com', ['https://app.example.com/'])).toBe(true);
  });
});
