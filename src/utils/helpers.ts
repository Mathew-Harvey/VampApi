import prisma from '../config/database';
import type { Prisma } from '@prisma/client';

const MAX_REFERENCE_ATTEMPTS = 8;

function todayPrefix(date: Date = new Date()): string {
  const dateStr = date.toISOString().slice(0, 10).replace(/-/g, '');
  return `WO-${dateStr}-`;
}

function nextReferenceFromLast(lastReference: string | null, prefix: string): string {
  if (!lastReference) return `${prefix}0001`;
  const tail = lastReference.slice(prefix.length);
  const n = parseInt(tail, 10);
  const next = Number.isFinite(n) ? n + 1 : 1;
  return `${prefix}${String(next).padStart(4, '0')}`;
}

/**
 * Generate a unique work-order reference for today.
 *
 * Wraps the read + probe loop in a short transaction so two concurrent
 * callers can't both land on the same candidate.  If the unique constraint
 * on `referenceNumber` still races, we retry with the next number.
 */
export async function generateWorkOrderReference(date: Date = new Date()): Promise<string> {
  const prefix = todayPrefix(date);

  for (let attempt = 0; attempt < MAX_REFERENCE_ATTEMPTS; attempt++) {
    const candidate = await prisma.$transaction(async (tx) => {
      const last = await tx.workOrder.findFirst({
        where: { referenceNumber: { startsWith: prefix } },
        orderBy: { referenceNumber: 'desc' },
        select: { referenceNumber: true },
      });
      return nextReferenceFromLast(last?.referenceNumber ?? null, prefix);
    });

    // Probe — if the candidate already exists (concurrent writer) we retry.
    const clash = await prisma.workOrder.findUnique({ where: { referenceNumber: candidate }, select: { id: true } });
    if (!clash) return candidate;
  }

  // Extremely unlikely; surface as an explicit error so callers can retry.
  throw new Error(`Could not generate a unique work order reference after ${MAX_REFERENCE_ATTEMPTS} attempts`);
}

// Exposed for unit tests.
export const __internals = { todayPrefix, nextReferenceFromLast };

// Keep ignoring `Prisma` import — imported for type compatibility if callers
// want to pass a Prisma TransactionClient.  (Intentional re-export only.)
export type TxClient = Prisma.TransactionClient;

export function daysBetween(date1: Date, date2: Date): number {
  const diff = Math.abs(date2.getTime() - date1.getTime());
  return Math.floor(diff / (1000 * 60 * 60 * 24));
}
