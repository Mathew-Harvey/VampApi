import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';

vi.mock('../../src/config/database', () => {
  const mockPrisma = {
    $connect: vi.fn().mockResolvedValue(undefined),
    $disconnect: vi.fn().mockResolvedValue(undefined),
    $queryRaw: vi.fn().mockResolvedValue([{ 1: 1 }]),
    $transaction: vi.fn(async (fn: any) => (typeof fn === 'function' ? fn(mockPrisma) : fn)),
    media: { findUnique: vi.fn() },
    workOrder: { findMany: vi.fn().mockResolvedValue([]), count: vi.fn().mockResolvedValue(0) },
    user: { count: vi.fn().mockResolvedValue(0) },
    organisationUser: { findMany: vi.fn().mockResolvedValue([]) },
    vessel: { findMany: vi.fn().mockResolvedValue([]), count: vi.fn().mockResolvedValue(0) },
    auditEntry: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: 'a1' }),
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
    },
    notification: { findMany: vi.fn().mockResolvedValue([]), count: vi.fn().mockResolvedValue(0) },
  };
  return { default: mockPrisma, prisma: mockPrisma };
});

vi.mock('../../src/services/storage-config.service', () => ({
  storageConfigService: {
    get: vi.fn().mockReturnValue({ backend: 'local', localMediaPath: '/tmp/t', s3: {} }),
    getLocalMediaPath: vi.fn().mockReturnValue('/tmp/t'),
    isS3Usable: vi.fn().mockReturnValue(false),
    shouldUseS3: vi.fn().mockReturnValue(false),
    getStatus: vi.fn().mockReturnValue({
      overallStatus: 'ready', summary: '', effectiveBackend: 'local',
      s3Configured: false, localPathExists: true, localMediaPath: '/tmp/t', fields: [],
    }),
  },
}));

import app from '../../src/app';
import { generateAccessToken } from '../../src/config/auth';
import { signMediaUrl, MEDIA_SIGNATURE_QUERY_PARAM, MEDIA_EXPIRY_QUERY_PARAM } from '../../src/config/media-signing';

describe('GET /uploads/* requires auth or a signed URL', () => {
  it('rejects anonymous requests with 401', async () => {
    const res = await request(app).get('/uploads/anything.jpg');
    expect(res.status).toBe(401);
    expect(res.body?.error?.code).toBe('UNAUTHORIZED');
  });

  it('accepts requests carrying a valid access token (and 404s on a missing file, proving the gate is open)', async () => {
    const token = generateAccessToken({
      userId: 'u1', email: 'a@b.com', organisationId: 'o1', role: 'X', permissions: [],
    });
    const res = await request(app)
      .get('/uploads/does-not-exist.jpg')
      .set('Authorization', `Bearer ${token}`);
    // The file doesn't exist in the ephemeral test path, but the middleware
    // should have let the static handler take over and 404.
    expect(res.status).toBe(404);
  });

  it('accepts requests carrying a valid signed URL (and 404s on missing file)', async () => {
    const signed = signMediaUrl('/uploads/does-not-exist.jpg');
    // Parse the signature + expiry back out of the signed path for the request.
    const qp = signed.split('?')[1];
    const res = await request(app).get(`/uploads/does-not-exist.jpg?${qp}`);
    expect(res.status).toBe(404);
    // Make sure the signed URL used the documented query params
    expect(qp).toContain(`${MEDIA_SIGNATURE_QUERY_PARAM}=`);
    expect(qp).toContain(`${MEDIA_EXPIRY_QUERY_PARAM}=`);
  });
});
