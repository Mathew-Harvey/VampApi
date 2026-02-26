import crypto from 'crypto';

export interface AuditHashInput {
  sequence: number;
  actorId: string | null;
  entityType: string;
  entityId: string;
  action: string;
  description: string;
  previousHash: string | null;
  createdAt: Date;
}

export function computeAuditHash(entry: AuditHashInput): string {
  const payload = JSON.stringify({
    seq: entry.sequence,
    actor: entry.actorId,
    entity: `${entry.entityType}:${entry.entityId}`,
    action: entry.action,
    desc: entry.description,
    prev: entry.previousHash,
    ts: entry.createdAt.toISOString(),
  });
  return crypto.createHash('sha256').update(payload).digest('hex');
}

export function verifyAuditChain(
  entries: Array<{ sequence: number; hash: string; previousHash: string | null } & AuditHashInput>
): { valid: boolean; brokenAt?: number } {
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const computed = computeAuditHash(entry);
    if (computed !== entry.hash) {
      return { valid: false, brokenAt: entry.sequence };
    }
    if (i > 0 && entry.previousHash !== entries[i - 1].hash) {
      return { valid: false, brokenAt: entry.sequence };
    }
  }
  return { valid: true };
}
