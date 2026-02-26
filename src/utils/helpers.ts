import prisma from '../config/database';

export async function generateWorkOrderReference(): Promise<string> {
  const today = new Date();
  const dateStr = today.toISOString().slice(0, 10).replace(/-/g, '');
  const prefix = `WO-${dateStr}-`;

  const lastWO = await prisma.workOrder.findFirst({
    where: { referenceNumber: { startsWith: prefix } },
    orderBy: { referenceNumber: 'desc' },
  });

  let nextNum = 1;
  if (lastWO) {
    const lastNum = parseInt(lastWO.referenceNumber.split('-').pop() || '0');
    nextNum = lastNum + 1;
  }

  return `${prefix}${String(nextNum).padStart(4, '0')}`;
}

export function daysBetween(date1: Date, date2: Date): number {
  const diff = Math.abs(date2.getTime() - date1.getTime());
  return Math.floor(diff / (1000 * 60 * 60 * 24));
}
