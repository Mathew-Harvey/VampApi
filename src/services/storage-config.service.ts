import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import { env } from '../config/env';

const CONFIG_PATH = path.join(process.cwd(), 'storage-config.json');

export interface StorageConfig {
  backend: 'auto' | 'local' | 's3';
  localMediaPath: string;
  s3: {
    bucket: string;
    region: string;
    accessKey: string;
    secretKey: string;
    endpoint: string;
    publicUrl: string;
  };
}

interface PersistedConfig {
  backend?: string;
  localMediaPath?: string;
  s3?: Partial<StorageConfig['s3']>;
}

function loadPersistedConfig(): PersistedConfig {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
    }
  } catch {
    // Corrupt file — ignore and fall back to env defaults
  }
  return {};
}

function mergeWithEnv(persisted: PersistedConfig): StorageConfig {
  return {
    backend: (['auto', 'local', 's3'].includes(persisted.backend ?? '')
      ? persisted.backend
      : env.STORAGE_BACKEND) as StorageConfig['backend'],
    localMediaPath: persisted.localMediaPath || path.join(process.cwd(), 'uploads'),
    s3: {
      bucket: persisted.s3?.bucket ?? env.S3_BUCKET,
      region: persisted.s3?.region ?? env.S3_REGION,
      accessKey: persisted.s3?.accessKey ?? env.S3_ACCESS_KEY,
      secretKey: persisted.s3?.secretKey ?? env.S3_SECRET_KEY,
      endpoint: persisted.s3?.endpoint ?? env.S3_ENDPOINT,
      publicUrl: persisted.s3?.publicUrl ?? env.S3_PUBLIC_URL,
    },
  };
}

let cached: StorageConfig | null = null;

export const storageConfigService = {
  get(): StorageConfig {
    if (!cached) {
      cached = mergeWithEnv(loadPersistedConfig());
    }
    return cached;
  },

  async update(patch: Partial<StorageConfig>): Promise<StorageConfig> {
    const current = this.get();
    const next: StorageConfig = {
      backend: patch.backend ?? current.backend,
      localMediaPath: patch.localMediaPath ?? current.localMediaPath,
      s3: { ...current.s3, ...(patch.s3 ?? {}) },
    };

    if (next.localMediaPath) {
      const resolved = path.resolve(next.localMediaPath);
      next.localMediaPath = resolved;
      await fsp.mkdir(resolved, { recursive: true });
    }

    const persisted: PersistedConfig = {
      backend: next.backend,
      localMediaPath: next.localMediaPath,
      s3: next.s3,
    };
    await fsp.writeFile(CONFIG_PATH, JSON.stringify(persisted, null, 2), 'utf-8');

    cached = next;
    return next;
  },

  getStatus(): StorageConfigStatus {
    const cfg = this.get();

    const s3Configured = Boolean(cfg.s3.accessKey && cfg.s3.secretKey && cfg.s3.bucket);
    const localPathExists = fs.existsSync(cfg.localMediaPath);
    const effectiveBackend = resolveEffectiveBackend(cfg, s3Configured);

    const fields: ConfigField[] = [
      {
        key: 'backend',
        label: 'Storage Backend',
        value: cfg.backend,
        status: 'ok',
        description: cfg.backend === 'auto'
          ? 'Automatically selects S3 if configured, otherwise local storage'
          : cfg.backend === 's3'
            ? 'All uploads go directly to S3 cloud storage'
            : 'All uploads stored on this machine',
      },
      {
        key: 'localMediaPath',
        label: 'Local Media Folder',
        value: cfg.localMediaPath,
        status: localPathExists ? 'ok' : 'warning',
        description: localPathExists
          ? 'Folder exists and is ready for uploads'
          : 'Folder does not exist yet — it will be created on first upload',
      },
      {
        key: 's3.bucket',
        label: 'S3 Bucket Name',
        value: cfg.s3.bucket || null,
        status: cfg.s3.bucket ? 'ok' : (effectiveBackend === 's3' ? 'error' : 'unconfigured'),
        description: cfg.s3.bucket ? `Using bucket "${cfg.s3.bucket}"` : 'No bucket specified',
      },
      {
        key: 's3.region',
        label: 'S3 Region',
        value: cfg.s3.region || null,
        status: cfg.s3.region ? 'ok' : 'unconfigured',
        description: cfg.s3.region ? `Region: ${cfg.s3.region}` : 'Defaults to ap-southeast-2',
      },
      {
        key: 's3.accessKey',
        label: 'S3 Access Key',
        value: cfg.s3.accessKey ? '••••' + cfg.s3.accessKey.slice(-4) : null,
        status: cfg.s3.accessKey ? 'ok' : (effectiveBackend === 's3' ? 'error' : 'unconfigured'),
        description: cfg.s3.accessKey ? 'Access key is set' : 'Required for S3 uploads',
      },
      {
        key: 's3.secretKey',
        label: 'S3 Secret Key',
        value: cfg.s3.secretKey ? '••••••••' : null,
        status: cfg.s3.secretKey ? 'ok' : (effectiveBackend === 's3' ? 'error' : 'unconfigured'),
        description: cfg.s3.secretKey ? 'Secret key is set' : 'Required for S3 uploads',
      },
      {
        key: 's3.endpoint',
        label: 'S3 Endpoint (optional)',
        value: cfg.s3.endpoint || null,
        status: cfg.s3.endpoint ? 'ok' : 'unconfigured',
        description: cfg.s3.endpoint
          ? `Custom endpoint: ${cfg.s3.endpoint}`
          : 'Leave empty for standard AWS S3. Set for S3-compatible services (MinIO, DigitalOcean Spaces, etc.)',
      },
      {
        key: 's3.publicUrl',
        label: 'S3 Public URL (optional)',
        value: cfg.s3.publicUrl || null,
        status: cfg.s3.publicUrl ? 'ok' : 'unconfigured',
        description: cfg.s3.publicUrl
          ? `Public URL: ${cfg.s3.publicUrl}`
          : 'Leave empty to auto-generate URLs from bucket/region. Set if using a CDN or custom domain.',
      },
    ];

    const errors = fields.filter((f) => f.status === 'error');
    const warnings = fields.filter((f) => f.status === 'warning');

    let overallStatus: 'ready' | 'degraded' | 'misconfigured';
    let summary: string;

    if (errors.length > 0) {
      overallStatus = 'misconfigured';
      summary = `Storage backend is set to "${cfg.backend}" but ${errors.length} required field(s) are missing. Configure them below to enable cloud storage.`;
    } else if (warnings.length > 0) {
      overallStatus = 'degraded';
      summary = `Storage is functional but has ${warnings.length} warning(s). Review the items below.`;
    } else {
      overallStatus = 'ready';
      summary = effectiveBackend === 's3'
        ? 'Cloud storage (S3) is fully configured and active.'
        : 'Local storage is active. Configure S3 credentials below to enable cloud sync.';
    }

    return {
      overallStatus,
      summary,
      effectiveBackend,
      s3Configured,
      localPathExists,
      localMediaPath: cfg.localMediaPath,
      fields,
    };
  },

  getLocalMediaPath(): string {
    return this.get().localMediaPath;
  },

  getLocalPathGuide(): LocalPathGuide {
    const cfg = this.get();
    const localPath = cfg.localMediaPath;
    const exists = fs.existsSync(localPath);

    let fileCount = 0;
    let totalBytes = 0;
    if (exists) {
      try {
        const entries = fs.readdirSync(localPath);
        for (const entry of entries) {
          if (entry.startsWith('.') || entry.startsWith('_')) continue;
          try {
            const stat = fs.statSync(path.join(localPath, entry));
            if (stat.isFile()) { fileCount++; totalBytes += stat.size; }
          } catch { /* skip */ }
        }
      } catch { /* unreadable */ }
    }

    const isWindows = process.platform === 'win32';
    const cwd = process.cwd();
    const defaultPath = path.join(cwd, 'uploads');

    const suggestedPaths: SuggestedPath[] = [
      {
        path: defaultPath,
        label: 'Default (project uploads folder)',
        description: `Stores photos alongside the API server at ${defaultPath}`,
        isDefault: true,
        isCurrent: path.resolve(localPath) === path.resolve(defaultPath),
      },
    ];

    if (isWindows) {
      suggestedPaths.push(
        {
          path: 'C:\\VampMedia',
          label: 'Dedicated drive folder',
          description: 'A standalone folder on C: drive, outside the project. Easy to find and back up.',
          isDefault: false,
          isCurrent: path.resolve(localPath) === path.resolve('C:\\VampMedia'),
        },
        {
          path: path.join(process.env.USERPROFILE || 'C:\\Users\\Default', 'Documents', 'VampMedia'),
          label: 'User Documents folder',
          description: 'Inside your Documents folder. May sync with OneDrive — not recommended for large media sets.',
          isDefault: false,
          isCurrent: false,
        },
      );
    } else {
      suggestedPaths.push(
        {
          path: '/var/lib/vamp/media',
          label: 'Linux server standard',
          description: 'Standard location for application data on Linux servers.',
          isDefault: false,
          isCurrent: path.resolve(localPath) === path.resolve('/var/lib/vamp/media'),
        },
        {
          path: path.join(process.env.HOME || '/root', 'vamp-media'),
          label: 'Home directory',
          description: 'A folder in the current user\'s home directory.',
          isDefault: false,
          isCurrent: false,
        },
      );
    }

    return {
      currentPath: localPath,
      resolvedPath: path.resolve(localPath),
      exists,
      fileCount,
      totalSizeMB: Math.round((totalBytes / (1024 * 1024)) * 100) / 100,
      suggestedPaths,
      instructions: {
        title: 'Local Photo Storage',
        description:
          'VAMP stores inspection photos and media locally on this machine. ' +
          'Choose a folder with enough disk space for your inspection images. ' +
          'Once set, all new uploads and imported photos will be saved here and served directly by the API.',
        steps: [
          'Choose a folder path below, or enter a custom path.',
          'Click "Test Path" to verify the folder is writable.',
          'Click "Save" to apply. The folder will be created automatically if it doesn\'t exist.',
          'Existing photos in the old location are NOT moved automatically — only new uploads go to the new path.',
        ],
        warnings: [
          'Avoid folders that sync to cloud services (OneDrive, Dropbox) — large media sets can cause sync issues.',
          'Ensure the disk has enough free space. Inspection photo sets can be several GB each.',
          'If you change the path after importing data, existing photo URLs will break unless you move the files.',
        ],
      },
    };
  },

  isS3Usable(): boolean {
    const cfg = this.get();
    return Boolean(cfg.s3.accessKey && cfg.s3.secretKey && cfg.s3.bucket);
  },

  shouldUseS3(): boolean {
    const cfg = this.get();
    if (cfg.backend === 'local') return false;
    if (cfg.backend === 's3') return true;
    return this.isS3Usable();
  },
};

function resolveEffectiveBackend(cfg: StorageConfig, s3Configured: boolean): 'local' | 's3' {
  if (cfg.backend === 'local') return 'local';
  if (cfg.backend === 's3') return s3Configured ? 's3' : 'local';
  return s3Configured ? 's3' : 'local';
}

export interface ConfigField {
  key: string;
  label: string;
  value: string | null;
  status: 'ok' | 'warning' | 'error' | 'unconfigured';
  description: string;
}

export interface StorageConfigStatus {
  overallStatus: 'ready' | 'degraded' | 'misconfigured';
  summary: string;
  effectiveBackend: 'local' | 's3';
  s3Configured: boolean;
  localPathExists: boolean;
  localMediaPath: string;
  fields: ConfigField[];
}

export interface SuggestedPath {
  path: string;
  label: string;
  description: string;
  isDefault: boolean;
  isCurrent: boolean;
}

export interface LocalPathGuide {
  currentPath: string;
  resolvedPath: string;
  exists: boolean;
  fileCount: number;
  totalSizeMB: number;
  suggestedPaths: SuggestedPath[];
  instructions: {
    title: string;
    description: string;
    steps: string[];
    warnings: string[];
  };
}
