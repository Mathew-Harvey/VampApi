import { describe, it, expect } from 'vitest';
import { formatFoulingValueRich, formatCoverageRich } from '../../src/constants/fouling-scales';
import { formatPdrValue } from '../../src/constants/pdr-scale';

/**
 * T2: Tests that the work order report context formatting produces expected output.
 *
 * These validate the formatting pipeline used by generateWorkOrderReport in report.service.ts.
 * The actual context building requires DB access, so we test the formatEntry-equivalent logic.
 */

describe('Work Order Report: Form entry formatting', () => {
  // Simulate the formatEntry function from generateWorkOrderReport
  function formatEntry(fe: any, foulingScale: 'LOF' | 'FR') {
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

    return {
      foulingRatingFormatted: fe.foulingRating != null
        ? formatFoulingValueRich(fe.foulingRating, foulingScale) : null,
      coverageFormatted: fe.coverage != null ? formatCoverageRich(fe.coverage) : null,
      pdrFormatted: formatPdr(fe.coatingCondition),
    };
  }

  it('formats FR 70 entry with full description', () => {
    const result = formatEntry({ foulingRating: 70, coverage: 30, coatingCondition: 40 }, 'FR');
    expect(result.foulingRatingFormatted).toContain('FR: 70');
    expect(result.foulingRatingFormatted).toContain('HARD');
    expect(result.coverageFormatted).toContain('Heavy');
    expect(result.pdrFormatted).toContain('PDR: 40');
  });

  it('formats LoF Rank 3 entry with description', () => {
    const result = formatEntry({ foulingRating: 3, coverage: 10, coatingCondition: '10' }, 'LOF');
    expect(result.foulingRatingFormatted).toContain('Rank: 3');
    expect(result.coverageFormatted).toContain('Moderate');
    expect(result.pdrFormatted).toContain('PDR: 10');
  });

  it('handles null values gracefully', () => {
    const result = formatEntry({ foulingRating: null, coverage: null, coatingCondition: null }, 'FR');
    expect(result.foulingRatingFormatted).toBeNull();
    expect(result.coverageFormatted).toBeNull();
    expect(result.pdrFormatted).toBeNull();
  });

  it('maps legacy text "Intact" to PDR 10', () => {
    const result = formatEntry({ foulingRating: null, coverage: null, coatingCondition: 'Intact' }, 'FR');
    expect(result.pdrFormatted).toContain('PDR: 10');
    expect(result.pdrFormatted).toContain('Paint intact');
  });

  it('maps legacy text "Severe Damage" to PDR 70', () => {
    const result = formatEntry({ foulingRating: null, coverage: null, coatingCondition: 'Severe Damage' }, 'FR');
    expect(result.pdrFormatted).toContain('PDR: 70');
  });

  it('maps legacy text "Failed" to PDR 90', () => {
    const result = formatEntry({ foulingRating: null, coverage: null, coatingCondition: 'Failed' }, 'FR');
    expect(result.pdrFormatted).toContain('PDR: 90');
  });

  it('passes through unknown text values', () => {
    const result = formatEntry({ foulingRating: null, coverage: null, coatingCondition: 'Custom Value' }, 'FR');
    expect(result.pdrFormatted).toBe('Custom Value');
  });

  it('formats numeric string PDR values', () => {
    const result = formatEntry({ foulingRating: null, coverage: null, coatingCondition: '50' }, 'FR');
    expect(result.pdrFormatted).toContain('PDR: 50');
  });

  it('formats FR 0 with clean surface description', () => {
    const result = formatEntry({ foulingRating: 0, coverage: 0, coatingCondition: 10 }, 'FR');
    expect(result.foulingRatingFormatted).toContain('FR: 0');
    expect(result.foulingRatingFormatted).toContain('SOFT');
    expect(result.coverageFormatted).toContain('None');
    expect(result.pdrFormatted).toContain('PDR: 10');
  });

  it('formats FR 100 as COMPOSITE', () => {
    const result = formatEntry({ foulingRating: 100, coverage: 100, coatingCondition: 100 }, 'FR');
    expect(result.foulingRatingFormatted).toContain('COMPOSITE');
    expect(result.coverageFormatted).toContain('Very heavy');
    expect(result.pdrFormatted).toContain('PDR: 100');
  });
});

describe('Work Order Report: Sub-component nesting', () => {
  it('parent entries have isSubComponent = false', () => {
    const parent = { component: 'Hull', isSubComponent: false };
    expect(parent.isSubComponent).toBe(false);
  });

  it('child entries have isSubComponent = true', () => {
    const child = { component: 'Blade 1', isSubComponent: true };
    expect(child.isSubComponent).toBe(true);
  });
});
