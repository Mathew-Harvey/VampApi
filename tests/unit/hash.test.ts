import { describe, it, expect } from 'vitest';
import { computeAuditHash, verifyAuditChain, AuditHashInput } from '../../src/utils/hash';

describe('computeAuditHash', () => {
  const baseInput: AuditHashInput = {
    sequence: 1,
    actorId: 'user-1',
    entityType: 'Vessel',
    entityId: 'vessel-1',
    action: 'CREATE',
    description: 'Created vessel',
    previousHash: null,
    createdAt: new Date('2024-01-01T00:00:00.000Z'),
  };

  it('returns a 64-char hex string (SHA-256)', () => {
    const hash = computeAuditHash(baseInput);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('is deterministic for the same input', () => {
    const a = computeAuditHash(baseInput);
    const b = computeAuditHash(baseInput);
    expect(a).toBe(b);
  });

  it('produces different hashes for different inputs', () => {
    const a = computeAuditHash(baseInput);
    const b = computeAuditHash({ ...baseInput, sequence: 2 });
    expect(a).not.toBe(b);
  });

  it('produces different hash when previousHash changes', () => {
    const a = computeAuditHash(baseInput);
    const b = computeAuditHash({ ...baseInput, previousHash: 'abc123' });
    expect(a).not.toBe(b);
  });

  it('handles null actorId', () => {
    const hash = computeAuditHash({ ...baseInput, actorId: null });
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe('verifyAuditChain', () => {
  it('returns valid for an empty chain', () => {
    const result = verifyAuditChain([]);
    expect(result.valid).toBe(true);
  });

  it('returns valid for a single correct entry', () => {
    const input: AuditHashInput = {
      sequence: 1,
      actorId: 'user-1',
      entityType: 'Vessel',
      entityId: 'v1',
      action: 'CREATE',
      description: 'test',
      previousHash: null,
      createdAt: new Date('2024-01-01T00:00:00Z'),
    };
    const hash = computeAuditHash(input);
    const result = verifyAuditChain([{ ...input, hash, previousHash: null }]);
    expect(result.valid).toBe(true);
  });

  it('detects a tampered hash', () => {
    const input: AuditHashInput = {
      sequence: 1,
      actorId: 'user-1',
      entityType: 'Vessel',
      entityId: 'v1',
      action: 'CREATE',
      description: 'test',
      previousHash: null,
      createdAt: new Date('2024-01-01T00:00:00Z'),
    };
    const result = verifyAuditChain([{ ...input, hash: 'tampered', previousHash: null }]);
    expect(result.valid).toBe(false);
    expect(result.brokenAt).toBe(1);
  });

  it('validates a two-entry chain', () => {
    const ts1 = new Date('2024-01-01T00:00:00Z');
    const ts2 = new Date('2024-01-02T00:00:00Z');

    const entry1Input: AuditHashInput = {
      sequence: 1, actorId: 'u1', entityType: 'V', entityId: 'v1',
      action: 'CREATE', description: 'first', previousHash: null, createdAt: ts1,
    };
    const hash1 = computeAuditHash(entry1Input);

    const entry2Input: AuditHashInput = {
      sequence: 2, actorId: 'u1', entityType: 'V', entityId: 'v2',
      action: 'UPDATE', description: 'second', previousHash: hash1, createdAt: ts2,
    };
    const hash2 = computeAuditHash(entry2Input);

    const chain = [
      { ...entry1Input, hash: hash1, previousHash: null },
      { ...entry2Input, hash: hash2, previousHash: hash1 },
    ];

    expect(verifyAuditChain(chain).valid).toBe(true);
  });

  it('detects broken chain link', () => {
    const ts1 = new Date('2024-01-01T00:00:00Z');
    const ts2 = new Date('2024-01-02T00:00:00Z');

    const entry1Input: AuditHashInput = {
      sequence: 1, actorId: 'u1', entityType: 'V', entityId: 'v1',
      action: 'CREATE', description: 'first', previousHash: null, createdAt: ts1,
    };
    const hash1 = computeAuditHash(entry1Input);

    const entry2Input: AuditHashInput = {
      sequence: 2, actorId: 'u1', entityType: 'V', entityId: 'v2',
      action: 'UPDATE', description: 'second', previousHash: hash1, createdAt: ts2,
    };
    const hash2 = computeAuditHash(entry2Input);

    // Break the chain by setting wrong previousHash
    const chain = [
      { ...entry1Input, hash: hash1, previousHash: null },
      { ...entry2Input, hash: hash2, previousHash: 'wrong' },
    ];

    const result = verifyAuditChain(chain);
    expect(result.valid).toBe(false);
    expect(result.brokenAt).toBe(2);
  });
});
