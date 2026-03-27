import { describe, it, expect } from 'vitest';
import { formatFoulingValueRich, formatCoverageRich } from '../../src/constants/fouling-scales';
import { formatPdrValue } from '../../src/constants/pdr-scale';

/**
 * Unit tests for Record Book report context formatting and aggregation logic.
 *
 * These validate the formatting pipeline and aggregation helpers used by
 * generateRecordBookReport in report.service.ts. The actual service method
 * requires DB access, so we test the pure logic in isolation.
 */

// ── Form Entry Formatting ────────────────────────────────────────────────────

describe('Record Book Report: Form entry formatting', () => {
  // Mirrors the formatPdr + formatEntry logic inside generateRecordBookReport
  const LEGACY_PDR: Record<string, number> = {
    'intact': 10, 'minor damage': 20, 'moderate damage': 40,
    'severe damage': 70, 'failed': 90,
  };

  function formatPdr(value: unknown): string | null {
    if (value == null) return null;
    if (typeof value === 'number') return formatPdrValue(value);
    if (typeof value === 'string' && value.length > 0) {
      const num = parseInt(value, 10);
      if (!isNaN(num) && num >= 0 && num <= 100) return formatPdrValue(num);
      const mapped = LEGACY_PDR[value.toLowerCase().trim()];
      if (mapped != null) return formatPdrValue(mapped);
      return value;
    }
    return null;
  }

  function formatEntry(fe: any) {
    return {
      foulingRatingFormatted: fe.foulingRating != null
        ? formatFoulingValueRich(fe.foulingRating, 'FR') : null,
      coverageFormatted: fe.coverage != null ? formatCoverageRich(fe.coverage) : null,
      pdrFormatted: formatPdr(fe.coatingCondition),
    };
  }

  it('formats a typical inspection entry with FR rating, coverage, and PDR', () => {
    const result = formatEntry({ foulingRating: 40, coverage: 15, coatingCondition: 30 });
    expect(result.foulingRatingFormatted).toContain('FR: 40');
    expect(result.foulingRatingFormatted).toContain('HARD');
    expect(result.coverageFormatted).toContain('Moderate');
    expect(result.pdrFormatted).toContain('PDR: 30');
  });

  it('handles null values — returns null for each field', () => {
    const result = formatEntry({ foulingRating: null, coverage: null, coatingCondition: null });
    expect(result.foulingRatingFormatted).toBeNull();
    expect(result.coverageFormatted).toBeNull();
    expect(result.pdrFormatted).toBeNull();
  });

  it('handles zero values — zero is valid data, not null', () => {
    const result = formatEntry({ foulingRating: 0, coverage: 0, coatingCondition: 10 });
    expect(result.foulingRatingFormatted).toContain('FR: 0');
    expect(result.coverageFormatted).toContain('None');
    expect(result.pdrFormatted).toContain('PDR: 10');
  });

  it('maps legacy text "Intact" to PDR 10', () => {
    expect(formatPdr('Intact')).toContain('PDR: 10');
  });

  it('maps legacy text "Failed" to PDR 90', () => {
    expect(formatPdr('Failed')).toContain('PDR: 90');
  });

  it('passes through unknown text values unchanged', () => {
    expect(formatPdr('Custom condition')).toBe('Custom condition');
  });

  it('handles numeric string PDR values', () => {
    expect(formatPdr('50')).toContain('PDR: 50');
  });
});

// ── Activity Log Building ────────────────────────────────────────────────────

describe('Record Book Report: Activity log construction', () => {
  // Mirrors the activityLog mapping in generateRecordBookReport
  function buildActivityLog(workOrders: any[]) {
    return workOrders.map((wo) => ({
      date: wo.actualStart || wo.scheduledStart || wo.createdAt,
      referenceNumber: wo.referenceNumber,
      type: wo.type || 'General',
      status: wo.status,
      location: wo.location || null,
      title: wo.title,
      description: wo.description || null,
    }));
  }

  const sampleWorkOrders = [
    {
      referenceNumber: 'WO-001',
      title: 'Hull Inspection',
      description: 'Routine inspection',
      status: 'COMPLETED',
      type: 'INSPECTION',
      location: 'Sydney Harbour',
      actualStart: new Date('2025-06-15'),
      scheduledStart: new Date('2025-06-14'),
      createdAt: new Date('2025-06-01'),
    },
    {
      referenceNumber: 'WO-002',
      title: 'In-Water Cleaning',
      description: null,
      status: 'IN_PROGRESS',
      type: 'CLEANING',
      location: null,
      actualStart: null,
      scheduledStart: new Date('2025-07-01'),
      createdAt: new Date('2025-06-20'),
    },
    {
      referenceNumber: 'WO-003',
      title: 'Emergency Response',
      description: 'Heavy fouling detected',
      status: 'DRAFT',
      type: null,
      location: null,
      actualStart: null,
      scheduledStart: null,
      createdAt: new Date('2025-08-01'),
    },
  ];

  it('builds activity log entries for each work order', () => {
    const log = buildActivityLog(sampleWorkOrders);
    expect(log).toHaveLength(3);
  });

  it('prefers actualStart over scheduledStart over createdAt for the date', () => {
    const log = buildActivityLog(sampleWorkOrders);
    // WO-001: has actualStart
    expect(log[0].date).toEqual(new Date('2025-06-15'));
    // WO-002: no actualStart, falls to scheduledStart
    expect(log[1].date).toEqual(new Date('2025-07-01'));
    // WO-003: no actualStart or scheduledStart, falls to createdAt
    expect(log[2].date).toEqual(new Date('2025-08-01'));
  });

  it('defaults type to "General" when not set', () => {
    const log = buildActivityLog(sampleWorkOrders);
    expect(log[2].type).toBe('General');
  });

  it('maps null location to null, not empty string', () => {
    const log = buildActivityLog(sampleWorkOrders);
    expect(log[0].location).toBe('Sydney Harbour');
    expect(log[1].location).toBeNull();
  });

  it('preserves reference numbers and titles', () => {
    const log = buildActivityLog(sampleWorkOrders);
    expect(log[0].referenceNumber).toBe('WO-001');
    expect(log[0].title).toBe('Hull Inspection');
  });
});

// ── Summary Statistics ───────────────────────────────────────────────────────

describe('Record Book Report: Summary statistics', () => {
  // Mirrors the summary aggregation logic in generateRecordBookReport
  function buildSummary(workOrders: any[]) {
    const completedCount = workOrders.filter((wo) => wo.status === 'COMPLETED').length;
    const overdueCount = workOrders.filter((wo) =>
      wo.status !== 'COMPLETED' && wo.status !== 'CANCELLED' && wo.scheduledEnd && new Date(wo.scheduledEnd) < new Date()
    ).length;

    const allInspections = workOrders.flatMap((wo) => wo.inspections ?? []);
    const allFindings = allInspections.flatMap((insp) => insp.findings ?? []);

    const typeMap = new Map<string, { count: number; completed: number }>();
    for (const wo of workOrders) {
      const t = wo.type || 'General';
      const entry = typeMap.get(t) || { count: 0, completed: 0 };
      entry.count++;
      if (wo.status === 'COMPLETED') entry.completed++;
      typeMap.set(t, entry);
    }
    const workOrdersByType = Array.from(typeMap.entries()).map(([type, data]) => ({
      type, count: data.count, completed: data.completed,
    }));

    const statusMap = new Map<string, number>();
    for (const wo of workOrders) {
      statusMap.set(wo.status, (statusMap.get(wo.status) || 0) + 1);
    }
    const workOrdersByStatus = Array.from(statusMap.entries()).map(([status, count]) => ({
      status, count,
    }));

    return {
      totalWorkOrders: workOrders.length,
      completedWorkOrders: completedCount,
      overdueWorkOrders: overdueCount,
      totalInspections: allInspections.length,
      totalFindings: allFindings.length,
      workOrdersByType,
      workOrdersByStatus,
    };
  }

  const workOrders = [
    {
      status: 'COMPLETED', type: 'INSPECTION', scheduledEnd: '2025-01-01',
      inspections: [{ findings: [{ id: 'f1' }, { id: 'f2' }] }],
    },
    {
      status: 'COMPLETED', type: 'INSPECTION', scheduledEnd: '2025-06-01',
      inspections: [{ findings: [{ id: 'f3' }] }],
    },
    {
      status: 'IN_PROGRESS', type: 'CLEANING', scheduledEnd: '2024-01-01', // overdue
      inspections: [],
    },
    {
      status: 'DRAFT', type: 'INSPECTION', scheduledEnd: null,
      inspections: [],
    },
    {
      status: 'CANCELLED', type: 'CLEANING', scheduledEnd: '2024-01-01', // cancelled, not overdue
      inspections: [],
    },
  ];

  it('counts total work orders correctly', () => {
    const summary = buildSummary(workOrders);
    expect(summary.totalWorkOrders).toBe(5);
  });

  it('counts completed work orders correctly', () => {
    const summary = buildSummary(workOrders);
    expect(summary.completedWorkOrders).toBe(2);
  });

  it('counts overdue work orders — excludes COMPLETED and CANCELLED', () => {
    const summary = buildSummary(workOrders);
    // Only the IN_PROGRESS one with past scheduledEnd is overdue
    expect(summary.overdueWorkOrders).toBe(1);
  });

  it('counts total inspections across all work orders', () => {
    const summary = buildSummary(workOrders);
    expect(summary.totalInspections).toBe(2);
  });

  it('counts total findings across all inspections', () => {
    const summary = buildSummary(workOrders);
    expect(summary.totalFindings).toBe(3);
  });

  it('groups work orders by type with correct counts', () => {
    const summary = buildSummary(workOrders);
    const inspectionType = summary.workOrdersByType.find((t) => t.type === 'INSPECTION');
    const cleaningType = summary.workOrdersByType.find((t) => t.type === 'CLEANING');
    expect(inspectionType).toEqual({ type: 'INSPECTION', count: 3, completed: 2 });
    expect(cleaningType).toEqual({ type: 'CLEANING', count: 2, completed: 0 });
  });

  it('groups work orders by status with correct counts', () => {
    const summary = buildSummary(workOrders);
    const completedStatus = summary.workOrdersByStatus.find((s) => s.status === 'COMPLETED');
    const draftStatus = summary.workOrdersByStatus.find((s) => s.status === 'DRAFT');
    expect(completedStatus).toEqual({ status: 'COMPLETED', count: 2 });
    expect(draftStatus).toEqual({ status: 'DRAFT', count: 1 });
  });

  it('handles empty work orders array', () => {
    const summary = buildSummary([]);
    expect(summary.totalWorkOrders).toBe(0);
    expect(summary.completedWorkOrders).toBe(0);
    expect(summary.overdueWorkOrders).toBe(0);
    expect(summary.totalInspections).toBe(0);
    expect(summary.totalFindings).toBe(0);
    expect(summary.workOrdersByType).toHaveLength(0);
    expect(summary.workOrdersByStatus).toHaveLength(0);
  });
});

// ── Inspection Details: Sub-component Nesting ────────────────────────────────

describe('Record Book Report: Inspection details sub-component nesting', () => {
  // Mirrors the parent/child entry grouping logic in generateRecordBookReport
  function buildFormEntries(formEntries: any[]) {
    const parentEntries = formEntries.filter((fe) => !fe.parentEntryId);
    const childEntriesByParent = new Map<string, any[]>();
    for (const fe of formEntries) {
      if (fe.parentEntryId) {
        const list = childEntriesByParent.get(fe.parentEntryId) || [];
        list.push(fe);
        childEntriesByParent.set(fe.parentEntryId, list);
      }
    }

    const result: any[] = [];
    for (const parent of parentEntries) {
      result.push({
        component: parent.vesselComponent?.name || '',
        isSubComponent: false,
      });
      const children = childEntriesByParent.get(parent.id) || [];
      for (const child of children) {
        result.push({
          component: child.vesselComponent?.name || '',
          isSubComponent: true,
        });
      }
    }
    return result;
  }

  it('builds flat list with parents before their children', () => {
    const formEntries = [
      { id: 'p1', parentEntryId: null, vesselComponent: { name: 'Propeller' } },
      { id: 'c1', parentEntryId: 'p1', vesselComponent: { name: 'Blade 1' } },
      { id: 'c2', parentEntryId: 'p1', vesselComponent: { name: 'Blade 2' } },
      { id: 'p2', parentEntryId: null, vesselComponent: { name: 'Rudder' } },
    ];

    const result = buildFormEntries(formEntries);
    expect(result).toHaveLength(4);
    expect(result[0]).toEqual({ component: 'Propeller', isSubComponent: false });
    expect(result[1]).toEqual({ component: 'Blade 1', isSubComponent: true });
    expect(result[2]).toEqual({ component: 'Blade 2', isSubComponent: true });
    expect(result[3]).toEqual({ component: 'Rudder', isSubComponent: false });
  });

  it('handles entries with no children', () => {
    const formEntries = [
      { id: 'p1', parentEntryId: null, vesselComponent: { name: 'Hull' } },
    ];
    const result = buildFormEntries(formEntries);
    expect(result).toHaveLength(1);
    expect(result[0].isSubComponent).toBe(false);
  });

  it('handles empty form entries', () => {
    expect(buildFormEntries([])).toHaveLength(0);
  });

  it('orphaned children (no matching parent) are excluded', () => {
    const formEntries = [
      { id: 'c1', parentEntryId: 'nonexistent', vesselComponent: { name: 'Orphan' } },
    ];
    // No parent entries, so orphaned children won't appear
    const result = buildFormEntries(formEntries);
    expect(result).toHaveLength(0);
  });
});

// ── BFMP Document Detection ──────────────────────────────────────────────────

describe('Record Book Report: BFMP document detection', () => {
  function hasBfmpDocument(vessel: { bfmpDocumentUrl?: string | null; bfmpRevision?: string | null }) {
    return !!(vessel.bfmpDocumentUrl || vessel.bfmpRevision);
  }

  it('returns true when bfmpDocumentUrl is set', () => {
    expect(hasBfmpDocument({ bfmpDocumentUrl: 'https://example.com/bfmp.pdf', bfmpRevision: null })).toBe(true);
  });

  it('returns true when bfmpRevision is set', () => {
    expect(hasBfmpDocument({ bfmpDocumentUrl: null, bfmpRevision: 'Rev 2' })).toBe(true);
  });

  it('returns true when both are set', () => {
    expect(hasBfmpDocument({ bfmpDocumentUrl: 'url', bfmpRevision: 'v1' })).toBe(true);
  });

  it('returns false when both are null', () => {
    expect(hasBfmpDocument({ bfmpDocumentUrl: null, bfmpRevision: null })).toBe(false);
  });

  it('returns false when both are empty strings', () => {
    expect(hasBfmpDocument({ bfmpDocumentUrl: '', bfmpRevision: '' })).toBe(false);
  });
});

// ── Niche Area Mapping ───────────────────────────────────────────────────────

describe('Record Book Report: Niche area mapping', () => {
  function mapNicheAreas(nicheAreas: any[]) {
    return nicheAreas.map((na) => ({
      name: na.name,
      afsCoatingType: na.afsCoatingType,
      lastInspectedDate: na.lastInspectedDate,
      condition: na.condition,
    }));
  }

  it('maps niche area fields correctly', () => {
    const areas = [
      { name: 'Sea Chest 1', afsCoatingType: 'Epoxy', lastInspectedDate: '2025-03-01', condition: 'Good', extraField: 'ignored' },
      { name: 'Bow Thruster', afsCoatingType: null, lastInspectedDate: null, condition: null },
    ];
    const result = mapNicheAreas(areas);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      name: 'Sea Chest 1',
      afsCoatingType: 'Epoxy',
      lastInspectedDate: '2025-03-01',
      condition: 'Good',
    });
    expect(result[1]).toEqual({
      name: 'Bow Thruster',
      afsCoatingType: null,
      lastInspectedDate: null,
      condition: null,
    });
  });

  it('handles empty niche areas', () => {
    expect(mapNicheAreas([])).toHaveLength(0);
  });
});

// ── Template Resolution ──────────────────────────────────────────────────────

describe('Record Book Report: Template name constant', () => {
  it('RECORD_BOOK_TEMPLATE_NAME matches expected filename', async () => {
    const { RECORD_BOOK_TEMPLATE_NAME } = await import('../../src/services/report-templates');
    expect(RECORD_BOOK_TEMPLATE_NAME).toBe('record-book-report.hbs');
  });
});

// ── Template Compilation ─────────────────────────────────────────────────────

describe('Record Book Report: HBS template compiles and renders', () => {
  it('compiles the record-book-report.hbs template without errors', async () => {
    const { compileAndRender } = await import('../../src/services/report-templates');
    const minimalContext = {
      reportType: 'record-book',
      generatedAt: '2025-06-15T00:00:00.000Z',
      organisation: { id: 'org1', name: 'Test Corp' },
      vessel: {
        name: 'MV Test Vessel',
        imoNumber: '1234567',
        flagState: 'Australia',
        vesselType: 'Cargo',
      },
      hasBfmpDocument: false,
      nicheAreas: [],
      reportPeriod: { start: '2025-01-01', end: '2025-06-15' },
      summary: {
        totalWorkOrders: 0,
        completedWorkOrders: 0,
        overdueWorkOrders: 0,
        totalInspections: 0,
        totalFindings: 0,
        workOrdersByType: [],
        workOrdersByStatus: [],
      },
      activityLog: [],
      inspectionDetails: [],
      photoEvidence: [],
      hasPhotos: false,
      preparedBy: null,
      preparedByTitle: null,
      reviewedBy: null,
      reviewedByTitle: null,
      additionalNotes: null,
    };

    const html = compileAndRender('record-book-report.hbs', minimalContext);
    expect(html).not.toBeNull();
    expect(html).toContain('BIOFOULING');
    expect(html).toContain('RECORD BOOK');
    expect(html).toContain('MV Test Vessel');
    expect(html).toContain('1234567');
    expect(html).toContain('Test Corp');
  });

  it('renders activity log entries when provided', async () => {
    const { compileAndRender } = await import('../../src/services/report-templates');
    const context = {
      reportType: 'record-book',
      generatedAt: '2025-06-15T00:00:00.000Z',
      organisation: null,
      vessel: { name: 'MV Tester' },
      hasBfmpDocument: false,
      nicheAreas: [],
      reportPeriod: { start: null, end: null },
      summary: {
        totalWorkOrders: 1, completedWorkOrders: 1, overdueWorkOrders: 0,
        totalInspections: 0, totalFindings: 0,
        workOrdersByType: [], workOrdersByStatus: [],
      },
      activityLog: [
        {
          date: '2025-06-01T00:00:00.000Z',
          referenceNumber: 'WO-TEST-001',
          type: 'INSPECTION',
          status: 'COMPLETED',
          location: 'Port Melbourne',
          title: 'Routine Hull Inspection',
          description: 'Biennial inspection',
        },
      ],
      inspectionDetails: [],
      photoEvidence: [],
      hasPhotos: false,
    };

    const html = compileAndRender('record-book-report.hbs', context);
    expect(html).toContain('WO-TEST-001');
    expect(html).toContain('INSPECTION');
    expect(html).toContain('Routine Hull Inspection');
    expect(html).toContain('Port Melbourne');
  });

  it('renders inspection details with component tables', async () => {
    const { compileAndRender } = await import('../../src/services/report-templates');
    const context = {
      reportType: 'record-book',
      generatedAt: '2025-06-15T00:00:00.000Z',
      organisation: null,
      vessel: { name: 'MV Tester' },
      hasBfmpDocument: false,
      nicheAreas: [],
      reportPeriod: { start: null, end: null },
      summary: {
        totalWorkOrders: 1, completedWorkOrders: 0, overdueWorkOrders: 0,
        totalInspections: 1, totalFindings: 1,
        workOrdersByType: [], workOrdersByStatus: [],
      },
      activityLog: [],
      inspectionDetails: [
        {
          referenceNumber: 'WO-INS-001',
          title: 'Hull Survey',
          date: '2025-05-01T00:00:00.000Z',
          status: 'COMPLETED',
          location: 'Dry Dock',
          inspectorName: 'John Smith',
          formEntries: [
            {
              component: 'Hull Port Side',
              foulingRatingFormatted: 'FR: 30 — SOFT — Grass fouling',
              coverageFormatted: '15% — Moderate',
              coatingCondition: null,
              pdrFormatted: null,
              notes: 'Light grass growth',
              isSubComponent: false,
            },
          ],
          findings: [
            {
              component: 'Sea Chest',
              severity: 'HIGH',
              description: 'Heavy barnacle growth',
              recommendation: 'Clean immediately',
            },
          ],
        },
      ],
      photoEvidence: [],
      hasPhotos: false,
    };

    const html = compileAndRender('record-book-report.hbs', context);
    expect(html).toContain('WO-INS-001');
    expect(html).toContain('Hull Survey');
    expect(html).toContain('John Smith');
    expect(html).toContain('Hull Port Side');
    expect(html).toContain('Light grass growth');
    expect(html).toContain('Sea Chest');
    expect(html).toContain('Heavy barnacle growth');
    expect(html).toContain('Clean immediately');
  });

  it('renders niche area cards when provided', async () => {
    const { compileAndRender } = await import('../../src/services/report-templates');
    const context = {
      reportType: 'record-book',
      generatedAt: '2025-06-15T00:00:00.000Z',
      organisation: null,
      vessel: { name: 'MV Tester' },
      hasBfmpDocument: false,
      nicheAreas: [
        { name: 'Sea Chest 1', afsCoatingType: 'Epoxy', lastInspectedDate: null, condition: 'Good' },
        { name: 'Bow Thruster', afsCoatingType: null, lastInspectedDate: null, condition: null },
      ],
      reportPeriod: { start: null, end: null },
      summary: {
        totalWorkOrders: 0, completedWorkOrders: 0, overdueWorkOrders: 0,
        totalInspections: 0, totalFindings: 0,
        workOrdersByType: [], workOrdersByStatus: [],
      },
      activityLog: [],
      inspectionDetails: [],
      photoEvidence: [],
      hasPhotos: false,
    };

    const html = compileAndRender('record-book-report.hbs', context);
    expect(html).toContain('Sea Chest 1');
    expect(html).toContain('Epoxy');
    expect(html).toContain('Bow Thruster');
  });

  it('shows "No activity records" when activity log is empty', async () => {
    const { compileAndRender } = await import('../../src/services/report-templates');
    const context = {
      reportType: 'record-book',
      generatedAt: '2025-06-15T00:00:00.000Z',
      organisation: null,
      vessel: { name: 'MV Empty' },
      hasBfmpDocument: false,
      nicheAreas: [],
      reportPeriod: { start: null, end: null },
      summary: {
        totalWorkOrders: 0, completedWorkOrders: 0, overdueWorkOrders: 0,
        totalInspections: 0, totalFindings: 0,
        workOrdersByType: [], workOrdersByStatus: [],
      },
      activityLog: [],
      inspectionDetails: [],
      photoEvidence: [],
      hasPhotos: false,
    };

    const html = compileAndRender('record-book-report.hbs', context);
    expect(html).toContain('No activity records found');
  });
});
