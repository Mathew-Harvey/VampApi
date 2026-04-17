import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/config/database', () => {
  const mockPrisma = {
    $transaction: vi.fn(async (fn: any) => {
      if (typeof fn === 'function') return fn(mockPrisma);
      return fn;
    }),
    workOrder: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
    },
  };
  return { default: mockPrisma, prisma: mockPrisma };
});

import prisma from '../../src/config/database';
import { generateWorkOrderReference, __internals, daysBetween } from '../../src/utils/helpers';

describe('__internals.todayPrefix / nextReferenceFromLast', () => {
  it('builds an ISO-date prefix', () => {
    const date = new Date('2026-04-17T05:00:00Z');
    expect(__internals.todayPrefix(date)).toBe('WO-20260417-');
  });

  it('starts a fresh day at 0001', () => {
    expect(__internals.nextReferenceFromLast(null, 'WO-20260417-')).toBe('WO-20260417-0001');
  });

  it('increments an existing reference', () => {
    expect(__internals.nextReferenceFromLast('WO-20260417-0042', 'WO-20260417-')).toBe('WO-20260417-0043');
  });

  it('treats a non-numeric tail as a fresh day (no NaN leak)', () => {
    expect(__internals.nextReferenceFromLast('WO-20260417-XXYY', 'WO-20260417-')).toBe('WO-20260417-0001');
  });
});

describe('generateWorkOrderReference', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 0001 when the DB has no rows for today', async () => {
    vi.mocked(prisma.workOrder.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.workOrder.findUnique).mockResolvedValue(null);
    const ref = await generateWorkOrderReference(new Date('2026-04-17T05:00:00Z'));
    expect(ref).toBe('WO-20260417-0001');
  });

  it('retries when the candidate clashes then succeeds', async () => {
    // First $transaction returns WO-20260417-0001; first findUnique says it
    // already exists (a concurrent writer).  On retry, findFirst returns the
    // new last (…-0001) so candidate becomes …-0002, findUnique returns null.
    let findFirstCalls = 0;
    vi.mocked(prisma.workOrder.findFirst).mockImplementation(async () => {
      findFirstCalls++;
      if (findFirstCalls === 1) return null as any;
      return { referenceNumber: 'WO-20260417-0001' } as any;
    });
    let findUniqueCalls = 0;
    vi.mocked(prisma.workOrder.findUnique).mockImplementation(async () => {
      findUniqueCalls++;
      if (findUniqueCalls === 1) return { id: 'existing' } as any;
      return null as any;
    });

    const ref = await generateWorkOrderReference(new Date('2026-04-17T05:00:00Z'));
    expect(ref).toBe('WO-20260417-0002');
    expect(findFirstCalls).toBeGreaterThanOrEqual(2);
  });

  it('wraps the read-last+increment pair in a transaction', async () => {
    vi.mocked(prisma.workOrder.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.workOrder.findUnique).mockResolvedValue(null);
    await generateWorkOrderReference(new Date('2026-04-17T05:00:00Z'));
    expect(prisma.$transaction).toHaveBeenCalled();
  });
});

describe('daysBetween (unchanged legacy helper)', () => {
  it('returns 0 for same day', () => {
    const d = new Date('2024-06-15');
    expect(daysBetween(d, d)).toBe(0);
  });
  it('returns the absolute day difference', () => {
    expect(daysBetween(new Date('2024-01-01'), new Date('2024-01-11'))).toBe(10);
    expect(daysBetween(new Date('2024-01-11'), new Date('2024-01-01'))).toBe(10);
  });
});
