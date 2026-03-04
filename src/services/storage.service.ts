import fs from 'fs/promises';
import path from 'path';
import { DeleteObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { storageConfigService } from './storage-config.service';

/** Locally defined to avoid reliance on global Express.Multer namespace augmentation. */
export interface MulterFile {
  fieldname: string;
  originalname: string;
  encoding: string;
  mimetype: string;
  size: number;
  destination: string;
  filename: string;
  path: string;
  buffer: Buffer;
}

type StoredMedia = {
  url: string;
  storageKey: string;
  backend: 'local' | 's3';
};

let s3Client: S3Client | null = null;
let s3ConfigHash = '';

function getConfigHash(): string {
  const cfg = storageConfigService.get().s3;
  return `${cfg.accessKey}:${cfg.secretKey}:${cfg.bucket}:${cfg.region}:${cfg.endpoint}`;
}

function getS3Client(): S3Client {
  const hash = getConfigHash();
  if (!s3Client || s3ConfigHash !== hash) {
    const cfg = storageConfigService.get().s3;
    s3Client = new S3Client({
      region: cfg.region || 'ap-southeast-2',
      endpoint: cfg.endpoint || undefined,
      forcePathStyle: Boolean(cfg.endpoint),
      credentials: cfg.accessKey && cfg.secretKey
        ? { accessKeyId: cfg.accessKey, secretAccessKey: cfg.secretKey }
        : undefined,
    });
    s3ConfigHash = hash;
  }
  return s3Client;
}

function buildPublicS3Url(key: string): string {
  const cfg = storageConfigService.get().s3;
  if (cfg.publicUrl) {
    return `${cfg.publicUrl.replace(/\/+$/, '')}/${key}`;
  }
  if (cfg.endpoint) {
    return `${cfg.endpoint.replace(/\/+$/, '')}/${cfg.bucket}/${key}`;
  }
  return `https://${cfg.bucket}.s3.${cfg.region}.amazonaws.com/${key}`;
}

function extractLocalUploadsPath(fileUrl: string): string | null {
  if (!fileUrl) return null;
  const localMediaPath = storageConfigService.getLocalMediaPath();
  const relativeMatch = fileUrl.match(/\/uploads\/(.+)$/i);
  if (relativeMatch?.[1]) return path.join(localMediaPath, relativeMatch[1]);
  try {
    const parsed = new URL(fileUrl);
    const absoluteMatch = parsed.pathname.match(/\/uploads\/(.+)$/i);
    if (!absoluteMatch?.[1]) return null;
    return path.join(localMediaPath, absoluteMatch[1]);
  } catch {
    return null;
  }
}

export const storageService = {
  isRemoteSyncEnabled(): boolean {
    return storageConfigService.isS3Usable();
  },

  async saveUploadedFile(file: MulterFile): Promise<StoredMedia> {
    if (!storageConfigService.shouldUseS3()) {
      return {
        storageKey: file.filename,
        url: `/uploads/${file.filename}`,
        backend: 'local',
      };
    }

    try {
      const cfg = storageConfigService.get().s3;
      const objectKey = `uploads/${file.filename}`;
      const body = await fs.readFile(file.path);
      const client = getS3Client();
      await client.send(
        new PutObjectCommand({
          Bucket: cfg.bucket,
          Key: objectKey,
          Body: body,
          ContentType: file.mimetype,
        })
      );
      await fs.unlink(file.path).catch(() => undefined);

      return {
        storageKey: objectKey,
        url: buildPublicS3Url(objectKey),
        backend: 's3',
      };
    } catch {
      return {
        storageKey: file.filename,
        url: `/uploads/${file.filename}`,
        backend: 'local',
      };
    }
  },

  async deleteStoredMedia(media: { storageKey?: string | null; url?: string | null }) {
    if (storageConfigService.shouldUseS3() && media.storageKey) {
      const cfg = storageConfigService.get().s3;
      const client = getS3Client();
      await client
        .send(new DeleteObjectCommand({ Bucket: cfg.bucket, Key: media.storageKey }))
        .catch(() => undefined);
      return;
    }

    if (media.url) {
      const localPath = extractLocalUploadsPath(media.url);
      if (localPath) {
        await fs.unlink(localPath).catch(() => undefined);
      }
    }
  },

  async syncLocalMediaToRemote(media: { filename: string; mimeType: string; storageKey?: string | null; url: string }) {
    if (!storageConfigService.isS3Usable()) {
      throw new Error('Remote object storage is not configured');
    }

    const localPath = extractLocalUploadsPath(media.url);
    if (!localPath) throw new Error('Unable to resolve local media path');
    const body = await fs.readFile(localPath);
    const key = media.storageKey?.startsWith('uploads/') ? media.storageKey : `uploads/${media.filename}`;

    const cfg = storageConfigService.get().s3;
    const client = getS3Client();
    await client.send(
      new PutObjectCommand({
        Bucket: cfg.bucket,
        Key: key,
        Body: body,
        ContentType: media.mimeType,
      })
    );

    return {
      storageKey: key,
      url: buildPublicS3Url(key),
    };
  },
};
