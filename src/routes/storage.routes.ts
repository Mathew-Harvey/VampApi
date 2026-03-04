import { Router, Request, Response } from 'express';
import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import { S3Client, ListBucketsCommand, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { authenticate } from '../middleware/auth';
import { requirePermission } from '../middleware/permissions';
import { storageConfigService, StorageConfig } from '../services/storage-config.service';

const router = Router();

const adminOnly = requirePermission('ADMIN_FULL_ACCESS');

// ---------------------------------------------------------------------------
// GET /config — full configuration status with per-field guidance
// ---------------------------------------------------------------------------
router.get('/config', authenticate, adminOnly, async (_req: Request, res: Response) => {
  try {
    const status = storageConfigService.getStatus();
    res.json({ success: true, data: status });
  } catch (error: any) {
    res.status(500).json({ success: false, error: { code: 'STORAGE_CONFIG_ERROR', message: error.message } });
  }
});

// ---------------------------------------------------------------------------
// PUT /config — update storage configuration
// ---------------------------------------------------------------------------
router.put('/config', authenticate, adminOnly, async (req: Request, res: Response) => {
  try {
    const body = req.body as Partial<StorageConfig>;

    if (body.localMediaPath) {
      const resolved = path.resolve(body.localMediaPath);
      const parent = path.dirname(resolved);
      if (!fs.existsSync(parent)) {
        res.status(400).json({
          success: false,
          error: {
            code: 'INVALID_PATH',
            message: `Parent directory "${parent}" does not exist. Please create it first or choose an existing location.`,
          },
        });
        return;
      }
    }

    if (body.backend === 's3') {
      const current = storageConfigService.get();
      const merged = { ...current.s3, ...(body.s3 ?? {}) };
      if (!merged.accessKey || !merged.secretKey || !merged.bucket) {
        res.status(400).json({
          success: false,
          error: {
            code: 'S3_INCOMPLETE',
            message: 'Switching to S3 backend requires bucket, accessKey, and secretKey to be configured.',
            missingFields: [
              ...(!merged.bucket ? ['s3.bucket'] : []),
              ...(!merged.accessKey ? ['s3.accessKey'] : []),
              ...(!merged.secretKey ? ['s3.secretKey'] : []),
            ],
          },
        });
        return;
      }
    }

    const updated = await storageConfigService.update(body);
    const status = storageConfigService.getStatus();

    res.json({ success: true, data: { config: updated, status } });
  } catch (error: any) {
    res.status(500).json({ success: false, error: { code: 'UPDATE_FAILED', message: error.message } });
  }
});

// ---------------------------------------------------------------------------
// POST /config/test-s3 — test S3 connectivity with current or supplied creds
// ---------------------------------------------------------------------------
router.post('/config/test-s3', authenticate, adminOnly, async (req: Request, res: Response) => {
  try {
    const cfg = storageConfigService.get();
    const s3 = { ...cfg.s3, ...(req.body.s3 ?? {}) };

    if (!s3.accessKey || !s3.secretKey || !s3.bucket) {
      res.status(400).json({
        success: false,
        error: {
          code: 'S3_INCOMPLETE',
          message: 'Cannot test — bucket, accessKey, and secretKey are all required.',
          missingFields: [
            ...(!s3.bucket ? ['bucket'] : []),
            ...(!s3.accessKey ? ['accessKey'] : []),
            ...(!s3.secretKey ? ['secretKey'] : []),
          ],
        },
      });
      return;
    }

    const client = new S3Client({
      region: s3.region || 'ap-southeast-2',
      endpoint: s3.endpoint || undefined,
      forcePathStyle: Boolean(s3.endpoint),
      credentials: { accessKeyId: s3.accessKey, secretAccessKey: s3.secretKey },
    });

    const checks: TestCheck[] = [];

    // 1) List buckets
    try {
      const resp = await client.send(new ListBucketsCommand({}));
      const bucketNames = (resp.Buckets ?? []).map((b) => b.Name);
      const bucketExists = bucketNames.includes(s3.bucket);
      checks.push({
        name: 'Authentication',
        passed: true,
        detail: `Credentials valid. Found ${bucketNames.length} bucket(s).`,
      });
      checks.push({
        name: 'Bucket exists',
        passed: bucketExists,
        detail: bucketExists
          ? `Bucket "${s3.bucket}" found.`
          : `Bucket "${s3.bucket}" not found. Available: ${bucketNames.join(', ') || '(none)'}`,
      });
    } catch (err: any) {
      checks.push({
        name: 'Authentication',
        passed: false,
        detail: `Failed to authenticate: ${err.message}`,
      });
    }

    // 2) Write / read / delete test object
    if (checks.every((c) => c.passed)) {
      const testKey = `_vamp_connection_test_${Date.now()}.txt`;
      try {
        await client.send(
          new PutObjectCommand({ Bucket: s3.bucket, Key: testKey, Body: 'test', ContentType: 'text/plain' }),
        );
        await client.send(new DeleteObjectCommand({ Bucket: s3.bucket, Key: testKey }));
        checks.push({
          name: 'Write / Delete permissions',
          passed: true,
          detail: 'Successfully wrote and cleaned up a test object.',
        });
      } catch (err: any) {
        checks.push({
          name: 'Write / Delete permissions',
          passed: false,
          detail: `Permission error: ${err.message}`,
        });
      }
    }

    const allPassed = checks.every((c) => c.passed);
    res.json({
      success: true,
      data: {
        connected: allPassed,
        summary: allPassed
          ? 'All checks passed — S3 is ready to use.'
          : `${checks.filter((c) => !c.passed).length} check(s) failed. See details below.`,
        checks,
      },
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: { code: 'TEST_FAILED', message: error.message } });
  }
});

// ---------------------------------------------------------------------------
// POST /config/test-local — validate a local path is writable
// ---------------------------------------------------------------------------
router.post('/config/test-local', authenticate, adminOnly, async (req: Request, res: Response) => {
  try {
    const requestedPath = req.body.localMediaPath || storageConfigService.get().localMediaPath;
    const resolved = path.resolve(requestedPath);

    const checks: TestCheck[] = [];

    const parentExists = fs.existsSync(path.dirname(resolved));
    checks.push({
      name: 'Parent directory exists',
      passed: parentExists,
      detail: parentExists
        ? `Parent "${path.dirname(resolved)}" exists.`
        : `Parent "${path.dirname(resolved)}" does not exist.`,
    });

    if (parentExists) {
      try {
        await fsp.mkdir(resolved, { recursive: true });
        checks.push({ name: 'Directory created/accessible', passed: true, detail: `"${resolved}" is accessible.` });
      } catch (err: any) {
        checks.push({ name: 'Directory created/accessible', passed: false, detail: err.message });
      }

      try {
        const testFile = path.join(resolved, `_vamp_write_test_${Date.now()}.tmp`);
        await fsp.writeFile(testFile, 'test');
        await fsp.unlink(testFile);
        checks.push({ name: 'Write permission', passed: true, detail: 'Successfully wrote and removed a test file.' });
      } catch (err: any) {
        checks.push({ name: 'Write permission', passed: false, detail: err.message });
      }
    }

    let diskInfo: { freeBytes?: number; totalBytes?: number } = {};
    try {
      const stats = await fsp.statfs(parentExists ? resolved : path.dirname(resolved));
      diskInfo = {
        freeBytes: stats.bfree * stats.bsize,
        totalBytes: stats.blocks * stats.bsize,
      };
    } catch {
      // statfs not available on all platforms
    }

    const allPassed = checks.every((c) => c.passed);
    res.json({
      success: true,
      data: {
        valid: allPassed,
        resolvedPath: resolved,
        summary: allPassed ? 'Path is valid and writable.' : 'Some checks failed — see details.',
        checks,
        disk: diskInfo,
      },
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: { code: 'TEST_FAILED', message: error.message } });
  }
});

// ---------------------------------------------------------------------------
// GET /stats — storage usage overview
// ---------------------------------------------------------------------------
router.get('/stats', authenticate, adminOnly, async (_req: Request, res: Response) => {
  try {
    const cfg = storageConfigService.get();
    const localPath = cfg.localMediaPath;

    let localFiles = 0;
    let localSizeBytes = 0;
    if (fs.existsSync(localPath)) {
      const entries = await fsp.readdir(localPath);
      for (const entry of entries) {
        if (entry.startsWith('.') || entry.startsWith('_')) continue;
        try {
          const stat = await fsp.stat(path.join(localPath, entry));
          if (stat.isFile()) {
            localFiles++;
            localSizeBytes += stat.size;
          }
        } catch {
          // skip unreadable entries
        }
      }
    }

    let diskFreeBytes: number | null = null;
    let diskTotalBytes: number | null = null;
    try {
      const stats = await fsp.statfs(localPath.length && fs.existsSync(localPath) ? localPath : process.cwd());
      diskFreeBytes = stats.bfree * stats.bsize;
      diskTotalBytes = stats.blocks * stats.bsize;
    } catch {
      // statfs not available
    }

    const status = storageConfigService.getStatus();

    res.json({
      success: true,
      data: {
        effectiveBackend: status.effectiveBackend,
        s3Configured: status.s3Configured,
        local: {
          path: localPath,
          fileCount: localFiles,
          sizeBytes: localSizeBytes,
          sizeMB: Math.round((localSizeBytes / (1024 * 1024)) * 100) / 100,
          diskFreeBytes,
          diskTotalBytes,
          diskFreeMB: diskFreeBytes != null ? Math.round((diskFreeBytes / (1024 * 1024)) * 100) / 100 : null,
        },
      },
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: { code: 'STATS_ERROR', message: error.message } });
  }
});

interface TestCheck {
  name: string;
  passed: boolean;
  detail: string;
}

export default router;
