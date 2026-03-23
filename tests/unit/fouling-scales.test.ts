import { describe, it, expect } from 'vitest';
import {
  LOF_SCALE,
  FR_SCALE,
  getScaleLevels,
  formatFoulingValue,
  formatFoulingValueRich,
  formatCoverageRich,
  getFoulingScaleRange,
  COVERAGE_RANGES,
} from '../../src/constants/fouling-scales';

describe('LOF_SCALE', () => {
  it('has 6 levels (Rank 0 through 5)', () => {
    expect(LOF_SCALE).toHaveLength(6);
  });

  it('covers values 0 to 5', () => {
    const values = LOF_SCALE.map((l) => l.value);
    expect(values).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('each level has label, description', () => {
    for (const level of LOF_SCALE) {
      expect(level.label).toMatch(/^Rank: \d$/);
      expect(level.description.length).toBeGreaterThan(10);
    }
  });
});

describe('FR_SCALE', () => {
  it('has 11 levels (FR 0 through 100)', () => {
    expect(FR_SCALE).toHaveLength(11);
  });

  it('covers values 0 to 100 in increments of 10', () => {
    const values = FR_SCALE.map((l) => l.value);
    expect(values).toEqual([0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100]);
  });

  it('has correct categories: SOFT, HARD, COMPOSITE', () => {
    expect(FR_SCALE[0].category).toBe('SOFT');
    expect(FR_SCALE[3].category).toBe('SOFT');
    expect(FR_SCALE[4].category).toBe('HARD');
    expect(FR_SCALE[9].category).toBe('HARD');
    expect(FR_SCALE[10].category).toBe('COMPOSITE');
  });
});

describe('getScaleLevels', () => {
  it('returns LOF_SCALE for LOF', () => {
    expect(getScaleLevels('LOF')).toBe(LOF_SCALE);
  });

  it('returns FR_SCALE for FR', () => {
    expect(getScaleLevels('FR')).toBe(FR_SCALE);
  });
});

describe('formatFoulingValue', () => {
  it('formats LOF as Rank: N', () => {
    expect(formatFoulingValue(3, 'LOF')).toBe('Rank: 3');
  });

  it('formats FR as FR: N', () => {
    expect(formatFoulingValue(70, 'FR')).toBe('FR: 70');
  });
});

describe('formatFoulingValueRich', () => {
  it('formats FR with category and full description', () => {
    const result = formatFoulingValueRich(70, 'FR');
    expect(result).toContain('FR: 70');
    expect(result).toContain('HARD');
    expect(result).toContain('Combination of tubeworms and barnacles');
    expect(result).toContain('greater than 1/4 inch');
  });

  it('formats FR 0 as SOFT with description', () => {
    const result = formatFoulingValueRich(0, 'FR');
    expect(result).toContain('FR: 0');
    expect(result).toContain('SOFT');
    expect(result).toContain('clean, foul-free');
  });

  it('formats FR 100 as COMPOSITE', () => {
    const result = formatFoulingValueRich(100, 'FR');
    expect(result).toContain('FR: 100');
    expect(result).toContain('COMPOSITE');
  });

  it('formats LOF with description', () => {
    const result = formatFoulingValueRich(3, 'LOF');
    expect(result).toContain('Rank: 3');
    expect(result).toContain('6-15%');
    expect(result).toContain('Considerable macrofouling');
  });

  it('formats LOF 0 with description', () => {
    const result = formatFoulingValueRich(0, 'LOF');
    expect(result).toContain('Rank: 0');
    expect(result).toContain('No slime layer');
  });

  it('falls back to simple format for unknown values', () => {
    expect(formatFoulingValueRich(15, 'FR')).toBe('FR: 15');
    expect(formatFoulingValueRich(7, 'LOF')).toBe('Rank: 7');
  });
});

describe('COVERAGE_RANGES', () => {
  it('has 5 coverage bands', () => {
    expect(COVERAGE_RANGES).toHaveLength(5);
  });

  it('covers 0% to 100% without gaps', () => {
    expect(COVERAGE_RANGES[0].min).toBe(0);
    expect(COVERAGE_RANGES[4].max).toBe(100);
  });

  it('has correct labels', () => {
    expect(COVERAGE_RANGES[0].label).toBe('None');
    expect(COVERAGE_RANGES[1].label).toBe('Light');
    expect(COVERAGE_RANGES[2].label).toBe('Moderate');
    expect(COVERAGE_RANGES[3].label).toBe('Heavy');
    expect(COVERAGE_RANGES[4].label).toBe('Very heavy');
  });
});

describe('formatCoverageRich', () => {
  it('formats 0% coverage as None', () => {
    const result = formatCoverageRich(0);
    expect(result).toContain('None');
    expect(result).toContain('0%');
  });

  it('formats 3% as Light', () => {
    const result = formatCoverageRich(3);
    expect(result).toContain('Light');
    expect(result).toContain('1% to 5%');
  });

  it('formats 10% as Moderate', () => {
    const result = formatCoverageRich(10);
    expect(result).toContain('Moderate');
    expect(result).toContain('6% to 15%');
  });

  it('formats 30% as Heavy', () => {
    const result = formatCoverageRich(30);
    expect(result).toContain('Heavy');
    expect(result).toContain('16% to 40%');
  });

  it('formats 75% as Very heavy', () => {
    const result = formatCoverageRich(75);
    expect(result).toContain('Very heavy');
    expect(result).toContain('41% to 100%');
  });

  it('formats 100% as Very heavy', () => {
    const result = formatCoverageRich(100);
    expect(result).toContain('Very heavy');
  });
});

describe('getFoulingScaleRange', () => {
  it('returns correct LOF range', () => {
    expect(getFoulingScaleRange('LOF')).toEqual({ min: 0, max: 5, step: 1 });
  });

  it('returns correct FR range', () => {
    expect(getFoulingScaleRange('FR')).toEqual({ min: 0, max: 100, step: 10 });
  });
});
