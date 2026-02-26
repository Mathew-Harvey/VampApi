import fs from 'fs/promises';
import path from 'path';
import { DeleteObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { env } from '../config/env';

type StoredMedia = {
  url: string;
  storageKey: string;
  backend: 'local' | 's3';
};

let s3Client: S3Client | null = null;

function shouldUseS3(): boolean {
  if (env.STORAGE_BACKEND === 'local') return false;
  if (env.STORAGE_BACKEND === 's3') return true;
  return Boolean(env.S3_ACCESS_KEY && env.S3_SECRET_KEY && env.S3_BUCKET);
}

function canUseS3Sync(): boolean {
  return Boolean(env.S3_ACCESS_KEY && env.S3_SECRET_KEY && env.S3_BUCKET);
}

function getS3Client(): S3Client {
  if (!s3Client) {
    s3Client = new S3Client({
      region: env.S3_REGION,
      endpoint: env.S3_ENDPOINT || undefined,
      forcePathStyle: Boolean(env.S3_ENDPOINT),
      credentials: env.S3_ACCESS_KEY && env.S3_SECRET_KEY
        ? {
            accessKeyId: env.S3_ACCESS_KEY,
            secretAccessKey: env.S3_SECRET_KEY,
          }
        : undefined,
    });
  }
  return s3Client;
}

function buildPublicS3Url(key: string): string {
  if (env.S3_PUBLIC_URL) {
    return `${env.S3_PUBLIC_URL.replace(/\/+$/, '')}/${key}`;
  }
  if (env.S3_ENDPOINT) {
    return `${env.S3_ENDPOINT.replace(/\/+$/, '')}/${env.S3_BUCKET}/${key}`;
  }
  return `https://${env.S3_BUCKET}.s3.${env.S3_REGION}.amazonaws.com/${key}`;
}

function extractLocalUploadsPath(fileUrl: string): string | null {
  if (!fileUrl) return null;
  const relativeMatch = fileUrl.match(/\/uploads\/(.+)$/i);
  if (relativeMatch?.[1]) return path.join(process.cwd(), 'uploads', relativeMatch[1]);
  try {
    const parsed = new URL(fileUrl);
    const absoluteMatch = parsed.pathname.match(/\/uploads\/(.+)$/i);
    if (!absoluteMatch?.[1]) return null;
    return path.join(process.cwd(), 'uploads', absoluteMatch[1]);
  } catch {
    return null;
  }
}

export const storageService = {
  isRemoteSyncEnabled(): boolean {
    return canUseS3Sync();
  },

  async saveUploadedFile(file: Express.Multer.File): Promise<StoredMedia> {
    if (!shouldUseS3()) {
      return {
        storageKey: file.filename,
        url: `/uploads/${file.filename}`,
        backend: 'local',
      };
    }

    try {
      const objectKey = `uploads/${file.filename}`;
      const body = await fs.readFile(file.path);
      const client = getS3Client();
      await client.send(
        new PutObjectCommand({
          Bucket: env.S3_BUCKET,
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
      // Fallback mode for poor/no internet: keep local file and queue for later sync.
      return {
        storageKey: file.filename,
        url: `/uploads/${file.filename}`,
        backend: 'local',
      };
    }
  },

  async deleteStoredMedia(media: { storageKey?: string | null; url?: string | null }) {
    if (shouldUseS3() && media.storageKey) {
      const client = getS3Client();
      await client
        .send(
          new DeleteObjectCommand({
            Bucket: env.S3_BUCKET,
            Key: media.storageKey,
          })
        )
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
    if (!canUseS3Sync()) {
      throw new Error('Remote object storage is not configured');
    }

    const localPath = extractLocalUploadsPath(media.url);
    if (!localPath) throw new Error('Unable to resolve local media path');
    const body = await fs.readFile(localPath);
    const key = media.storageKey?.startsWith('uploads/') ? media.storageKey : `uploads/${media.filename}`;

    const client = getS3Client();
    await client.send(
      new PutObjectCommand({
        Bucket: env.S3_BUCKET,
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
