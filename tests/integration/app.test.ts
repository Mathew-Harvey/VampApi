import { describe, it, expect, vi, beforeAll } from 'vitest';
import request from 'supertest';

// Mock Prisma before importing app, so the health check and routes don't need a real DB
vi.mock('../../src/config/database', () => {
  const mockPrisma = {
    $connect: vi.fn().mockResolvedValue(undefined),
    $disconnect: vi.fn().mockResolvedValue(undefined),
    $queryRaw: vi.fn().mockResolvedValue([{ 1: 1 }]),
    user: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      count: vi.fn().mockResolvedValue(0),
    },
    organisation: {
      create: vi.fn(),
      findUnique: vi.fn(),
    },
    organisationUser: {
      create: vi.fn(),
      findUnique: vi.fn(),
    },
    vessel: {
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn(),
      count: vi.fn().mockResolvedValue(0),
      create: vi.fn(),
      update: vi.fn(),
    },
    workOrder: {
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn(),
      count: vi.fn().mockResolvedValue(0),
      create: vi.fn(),
      update: vi.fn(),
    },
    auditEntry: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: 'audit-1' }),
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
    },
    notification: {
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
    },
  };
  return { default: mockPrisma, prisma: mockPrisma };
});

// Mock storage-config-service to avoid filesystem interaction
vi.mock('../../src/services/storage-config.service', () => ({
  storageConfigService: {
    get: vi.fn().mockReturnValue({
      backend: 'local',
      localMediaPath: '/tmp/test-uploads',
      s3: { bucket: '', region: '', accessKey: '', secretKey: '', endpoint: '', publicUrl: '' },
    }),
    getLocalMediaPath: vi.fn().mockReturnValue('/tmp/test-uploads'),
    isS3Usable: vi.fn().mockReturnValue(false),
    shouldUseS3: vi.fn().mockReturnValue(false),
    getStatus: vi.fn().mockReturnValue({
      overallStatus: 'ready',
      summary: 'Local storage active',
      effectiveBackend: 'local',
      s3Configured: false,
      localPathExists: true,
      localMediaPath: '/tmp/test-uploads',
      fields: [],
    }),
  },
}));

import app from '../../src/app';

describe('App integration', () => {
  describe('GET /api/v1/health', () => {
    it('returns healthy status', async () => {
      const res = await request(app).get('/api/v1/health');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('status', 'healthy');
      expect(res.body).toHaveProperty('timestamp');
      expect(res.body).toHaveProperty('version');
    });
  });

  describe('404 handler', () => {
    it('returns 404 for unknown routes', async () => {
      const res = await request(app).get('/api/v1/nonexistent');
      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });
  });

  describe('Auth routes', () => {
    it('POST /api/v1/auth/login validates body', async () => {
      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: 'not-valid', password: '123' });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('POST /api/v1/auth/register validates body', async () => {
      const res = await request(app)
        .post('/api/v1/auth/register')
        .send({ email: 'x', password: '12' });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('POST /api/v1/auth/logout succeeds', async () => {
      const res = await request(app).post('/api/v1/auth/logout');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('GET /api/v1/auth/me requires auth', async () => {
      const res = await request(app).get('/api/v1/auth/me');
      expect(res.status).toBe(401);
    });
  });

  describe('Protected routes require auth', () => {
    it('GET /api/v1/vessels returns 401 without token', async () => {
      const res = await request(app).get('/api/v1/vessels');
      expect(res.status).toBe(401);
    });

    it('GET /api/v1/work-orders returns 401 without token', async () => {
      const res = await request(app).get('/api/v1/work-orders');
      expect(res.status).toBe(401);
    });

    it('GET /api/v1/inspections returns 401 without token', async () => {
      const res = await request(app).get('/api/v1/inspections');
      expect(res.status).toBe(401);
    });

    it('GET /api/v1/dashboard/overview returns 401 without token', async () => {
      const res = await request(app).get('/api/v1/dashboard/overview');
      expect(res.status).toBe(401);
    });

    it('GET /api/v1/audit returns 401 without token', async () => {
      const res = await request(app).get('/api/v1/audit');
      expect(res.status).toBe(401);
    });
  });

  describe('CORS', () => {
    it('allows configured origin', async () => {
      const res = await request(app)
        .get('/api/v1/health')
        .set('Origin', 'http://localhost:5173');
      expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    });
  });
});
