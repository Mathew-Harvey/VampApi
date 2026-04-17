import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/config/database', () => {
  const mockPrisma = {
    $transaction: vi.fn(async (fn: any) => {
      if (typeof fn === 'function') return fn(mockPrisma);
      return fn;
    }),
    inspection: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    inspectionFinding: {
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    workOrder: {
      findFirst: vi.fn(),
    },
    auditEntry: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: 'a1' }),
    },
  };
  return { default: mockPrisma, prisma: mockPrisma };
});

import prisma from '../../src/config/database';
import { inspectionService } from '../../src/services/inspection.service';

describe('inspection.service org scoping (IDOR fix)', () => {
  beforeEach(() => vi.clearAllMocks());

  describe('getById', () => {
    it('returns 404 when the inspection belongs to a work order outside the caller org', async () => {
      vi.mocked(prisma.inspection.findFirst).mockResolvedValue(null);
      await expect(inspectionService.getById('i1', 'user-1', 'org-mine')).rejects.toThrow(/not found/i);

      const call = vi.mocked(prisma.inspection.findFirst).mock.calls[0][0] as any;
      expect(call.where.workOrder).toBeDefined();
      expect(call.where.workOrder.OR).toEqual([
        { organisationId: 'org-mine' },
        { assignments: { some: { userId: 'user-1' } } },
      ]);
    });

    it('returns the inspection when the caller owns the parent work order', async () => {
      vi.mocked(prisma.inspection.findFirst).mockResolvedValue({ id: 'i1' } as any);
      const out = await inspectionService.getById('i1', 'user-1', 'org-mine');
      expect(out.id).toBe('i1');
    });
  });

  describe('create', () => {
    it('requires workOrderId in the body', async () => {
      await expect(
        inspectionService.create({ type: 'BIOFOULING' } as any, 'u1', 'org-1'),
      ).rejects.toThrow(/workOrderId/);
    });

    it('rejects when the parent work order is not accessible to the caller', async () => {
      vi.mocked(prisma.workOrder.findFirst).mockResolvedValue(null);
      await expect(
        inspectionService.create(
          { workOrderId: 'wo-other-org', type: 'BIOFOULING' },
          'u1',
          'org-mine',
        ),
      ).rejects.toThrow(/not found/i);
    });

    it('rejects when vesselId in the body does not match the work order', async () => {
      vi.mocked(prisma.workOrder.findFirst).mockResolvedValue({
        id: 'wo1', vesselId: 'v1', organisationId: 'org-mine',
      } as any);
      await expect(
        inspectionService.create(
          { workOrderId: 'wo1', vesselId: 'v-other', type: 'BIOFOULING' },
          'u1', 'org-mine',
        ),
      ).rejects.toThrow(/vesselId/);
    });

    it('defaults vesselId to the work order vessel when omitted', async () => {
      vi.mocked(prisma.workOrder.findFirst).mockResolvedValue({
        id: 'wo1', vesselId: 'v1', organisationId: 'org-mine',
      } as any);
      vi.mocked(prisma.inspection.create).mockResolvedValue({ id: 'i1' } as any);
      await inspectionService.create(
        { workOrderId: 'wo1', type: 'BIOFOULING', inspectorName: 'J' },
        'u1', 'org-mine',
      );
      const payload = vi.mocked(prisma.inspection.create).mock.calls[0][0] as any;
      expect(payload.data.vesselId).toBe('v1');
      expect(payload.data.workOrderId).toBe('wo1');
    });
  });

  describe('update', () => {
    it('404s when inspection is not accessible', async () => {
      vi.mocked(prisma.inspection.findFirst).mockResolvedValue(null);
      await expect(
        inspectionService.update('i1', { summary: 'no' }, 'u1', 'org-mine'),
      ).rejects.toThrow(/not found/i);
      expect(prisma.inspection.update).not.toHaveBeenCalled();
    });

    it('strips unknown fields via the allowlist', async () => {
      vi.mocked(prisma.inspection.findFirst).mockResolvedValue({ id: 'i1' } as any);
      vi.mocked(prisma.inspection.update).mockResolvedValue({ id: 'i1' } as any);
      await inspectionService.update(
        'i1',
        { summary: 'ok', workOrderId: 'wo-other', vesselId: 'v-other' },
        'u1', 'org-mine',
      );
      const call = vi.mocked(prisma.inspection.update).mock.calls[0][0] as any;
      expect(call.data).toHaveProperty('summary', 'ok');
      expect(call.data).not.toHaveProperty('workOrderId');
      expect(call.data).not.toHaveProperty('vesselId');
    });
  });

  describe('findings', () => {
    it('addFinding 404s when inspection not accessible', async () => {
      vi.mocked(prisma.inspection.findFirst).mockResolvedValue(null);
      await expect(
        inspectionService.addFinding('i1', { area: 'HULL' }, 'u1', 'org-mine'),
      ).rejects.toThrow(/not found/i);
      expect(prisma.inspectionFinding.create).not.toHaveBeenCalled();
    });

    it('updateFinding 404s when finding does not belong to caller org', async () => {
      vi.mocked(prisma.inspectionFinding.findFirst).mockResolvedValue(null);
      await expect(
        inspectionService.updateFinding('f1', { description: 'x' }, 'u1', 'org-mine'),
      ).rejects.toThrow(/not found/i);
      expect(prisma.inspectionFinding.update).not.toHaveBeenCalled();
    });

    it('addFinding enforces the "area" field from the allowlisted payload', async () => {
      vi.mocked(prisma.inspection.findFirst).mockResolvedValue({ id: 'i1' } as any);
      await expect(
        inspectionService.addFinding('i1', { description: 'no area' }, 'u1', 'org-mine'),
      ).rejects.toThrow(/area/);
    });
  });
});
