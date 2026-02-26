import { env } from './env';

// For now, local file storage. S3 integration can be added later.
export const storageConfig = {
  bucket: env.S3_BUCKET,
  region: env.S3_REGION,
  accessKey: env.S3_ACCESS_KEY,
  secretKey: env.S3_SECRET_KEY,
  endpoint: env.S3_ENDPOINT || undefined,
};

export function getStorageKey(orgId: string, vesselId?: string, workOrderId?: string, filename?: string): string {
  const parts = [orgId];
  if (vesselId) parts.push(vesselId);
  if (workOrderId) parts.push(workOrderId);
  if (filename) parts.push(filename);
  return parts.join('/');
}
