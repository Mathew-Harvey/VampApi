import { Router, Request, Response } from 'express';
import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import { S3Client, ListBucketsCommand, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { authenticate } from '../middleware/auth';
import { requirePermission } from '../middleware/permissions';
import { storageConfigService, StorageConfig } from '../services/storage-config.service';
import { asyncHandler } from '../utils/async-handler';

const router = Router();

const canManageStorage = requirePermission('USER_MANAGE');

// ---------------------------------------------------------------------------
// GET /config — full configuration status with per-field guidance
// Accessible to any authenticated user so the frontend can check storage
// status without triggering a 403 loop. Write operations remain admin-only.
// ---------------------------------------------------------------------------
router.get('/config', authenticate, asyncHandler(async (_req, res) => {
  const status = storageConfigService.getStatus();
  res.json({ success: true, data: status });
}));

// ---------------------------------------------------------------------------
// GET /config/local-path-guide — guidance for choosing the local media folder
// ---------------------------------------------------------------------------
router.get('/config/local-path-guide', authenticate, asyncHandler(async (_req, res) => {
  const guide = storageConfigService.getLocalPathGuide();
  res.json({ success: true, data: guide });
}));

// ---------------------------------------------------------------------------
// GET /config/hosting — tell the frontend what environment the API runs in
// ---------------------------------------------------------------------------
router.get('/config/hosting', authenticate, asyncHandler(async (_req, res) => {
  const isRender = Boolean(process.env.RENDER);
  const isDocker = fs.existsSync('/.dockerenv');
  const isEphemeral = isRender || Boolean(process.env.DYNO) || Boolean(process.env.RAILWAY_ENVIRONMENT);

  res.json({
    success: true,
    data: {
      platform: process.platform,
      isEphemeral,
      provider: isRender ? 'render' : process.env.DYNO ? 'heroku' : process.env.RAILWAY_ENVIRONMENT ? 'railway' : isDocker ? 'docker' : 'self-hosted',
      localStorageWarning: isEphemeral
        ? 'This server uses ephemeral storage — files are lost on every deploy. Use cloud storage (S3) for persistent photo storage.'
        : null,
    },
  });
}));

// ---------------------------------------------------------------------------
// PUT /config — update storage configuration
// ---------------------------------------------------------------------------
router.put('/config', authenticate, canManageStorage, asyncHandler(async (req, res) => {
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
}));

// ---------------------------------------------------------------------------
// POST /config/test-s3 — test S3 connectivity with current or supplied creds
// ---------------------------------------------------------------------------
router.post('/config/test-s3', authenticate, canManageStorage, asyncHandler(async (req, res) => {
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
}));

// ---------------------------------------------------------------------------
// POST /config/test-local — validate a local path is writable
// ---------------------------------------------------------------------------
router.post('/config/test-local', authenticate, canManageStorage, asyncHandler(async (req, res) => {
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
}));

// ---------------------------------------------------------------------------
// GET /stats — storage usage overview
// Accessible to any authenticated user (read-only, no secrets exposed).
// ---------------------------------------------------------------------------
router.get('/stats', authenticate, asyncHandler(async (_req, res) => {
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
      localFileCount: localFiles,
      totalSizeMB: Math.round((localSizeBytes / (1024 * 1024)) * 100) / 100,
      diskFreeBytes: diskFreeBytes ?? 0,
      diskTotalBytes: diskTotalBytes ?? 0,
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
}));

// ---------------------------------------------------------------------------
// GET /browse — list directories on the API server's disk.
//
// Intended for SELF-HOSTED deployments where the server admin needs to pick
// a local media path. On Render, Heroku, Railway etc. the filesystem is
// ephemeral AND wiped on every deploy, so this endpoint is pointless and
// would just leak the platform's container paths. We 404 on those hosts.
//
// End users who want to save photos to THEIR OWN laptop use the File System
// Access API in the browser (see localPhotoStorage.ts) — not this endpoint.
// ---------------------------------------------------------------------------
router.get('/browse', authenticate, canManageStorage, asyncHandler(async (req, res) => {
  const isEphemeral = Boolean(process.env.RENDER) || Boolean(process.env.DYNO) || Boolean(process.env.RAILWAY_ENVIRONMENT);
  if (isEphemeral) {
    res.status(404).json({
      success: false,
      error: {
        code: 'NOT_AVAILABLE',
        message: 'Server-side folder browsing is disabled on ephemeral hosting. Use the browser folder picker to save photos to your own device instead.',
      },
    });
    return;
  }

  const isWindows = process.platform === 'win32';
  const home = isWindows ? (process.env.USERPROFILE || 'C:\\Users') : (process.env.HOME || '/');
  let target = (req.query.path as string) || home;

  target = path.resolve(target);

  // On Windows, handle drive root listing
  if (isWindows && target === path.parse(target).root && !fs.existsSync(target)) {
    target = home;
  }

  let parentPath: string | null = null;
  const parsed = path.parse(target);
  if (target !== parsed.root) {
    parentPath = path.dirname(target);
  }

  const dirs: { name: string; path: string }[] = [];
  try {
    const entries = await fsp.readdir(target, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name.startsWith('.') || entry.name.startsWith('$')) continue;
      dirs.push({ name: entry.name, path: path.join(target, entry.name) });
    }
    dirs.sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    // Can't read the directory — return empty list
  }

  // Quick-access locations
  const quickAccess: { label: string; path: string }[] = [];
  if (isWindows) {
    const userProfile = process.env.USERPROFILE;
    if (userProfile) {
      quickAccess.push(
        { label: 'Desktop', path: path.join(userProfile, 'Desktop') },
        { label: 'Documents', path: path.join(userProfile, 'Documents') },
      );
      const oneDrive = process.env.OneDrive || process.env.OneDriveConsumer || process.env.OneDriveCommercial;
      if (oneDrive) {
        quickAccess.push({ label: 'OneDrive', path: oneDrive });
      }
    }
    for (const drive of ['C', 'D', 'E', 'F']) {
      const drivePath = `${drive}:\\`;
      if (fs.existsSync(drivePath)) {
        quickAccess.push({ label: `${drive}: Drive`, path: drivePath });
      }
    }
  } else {
    quickAccess.push(
      { label: 'Home', path: home },
      { label: 'Root', path: '/' },
    );
  }

  res.json({
    success: true,
    data: {
      currentPath: target,
      parentPath,
      directories: dirs,
      quickAccess,
    },
  });
}));

interface TestCheck {
  name: string;
  passed: boolean;
  detail: string;
}

export default router;
