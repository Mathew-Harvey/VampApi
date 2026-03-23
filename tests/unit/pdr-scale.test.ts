import { describe, it, expect } from 'vitest';
import { PDR_SCALE, getPdrLevel, formatPdrValue, formatPdrLabel, getPdrScaleRange } from '../../src/constants/pdr-scale';

describe('PDR_SCALE', () => {
  it('has 11 levels (PDR 0 through 100)', () => {
    expect(PDR_SCALE).toHaveLength(11);
  });

  it('covers values 0 to 100 in increments of 10', () => {
    const values = PDR_SCALE.map((l) => l.value);
    expect(values).toEqual([0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100]);
  });

  it('each level has required properties', () => {
    for (const level of PDR_SCALE) {
      expect(level).toHaveProperty('value');
      expect(level).toHaveProperty('label');
      expect(level).toHaveProperty('description');
      expect(level).toHaveProperty('category');
      expect(typeof level.value).toBe('number');
      expect(typeof level.label).toBe('string');
      expect(typeof level.description).toBe('string');
      expect(['GOOD', 'FAIR', 'POOR', 'CRITICAL']).toContain(level.category);
    }
  });

  it('labels follow PDR: N format', () => {
    for (const level of PDR_SCALE) {
      expect(level.label).toBe(`PDR: ${level.value}`);
    }
  });

  it('categories progress from GOOD to CRITICAL', () => {
    expect(PDR_SCALE[0].category).toBe('GOOD');     // PDR: 0
    expect(PDR_SCALE[1].category).toBe('GOOD');     // PDR: 10
    expect(PDR_SCALE[2].category).toBe('GOOD');     // PDR: 20
    expect(PDR_SCALE[3].category).toBe('FAIR');     // PDR: 30
    expect(PDR_SCALE[4].category).toBe('FAIR');     // PDR: 40
    expect(PDR_SCALE[5].category).toBe('POOR');     // PDR: 50
    expect(PDR_SCALE[6].category).toBe('POOR');     // PDR: 60
    expect(PDR_SCALE[7].category).toBe('CRITICAL'); // PDR: 70
    expect(PDR_SCALE[8].category).toBe('CRITICAL'); // PDR: 80
    expect(PDR_SCALE[9].category).toBe('CRITICAL'); // PDR: 90
    expect(PDR_SCALE[10].category).toBe('CRITICAL'); // PDR: 100
  });

  it('descriptions reference coating/paint terminology', () => {
    for (const level of PDR_SCALE) {
      expect(level.description.length).toBeGreaterThan(10);
    }
    expect(PDR_SCALE[1].description).toContain('Paint intact');
    expect(PDR_SCALE[6].description).toContain('steel substrate');
    expect(PDR_SCALE[10].description).toContain('pitting');
  });
});

describe('getPdrLevel', () => {
  it('returns correct level for valid values', () => {
    const level10 = getPdrLevel(10);
    expect(level10).toBeDefined();
    expect(level10!.label).toBe('PDR: 10');

    const level60 = getPdrLevel(60);
    expect(level60).toBeDefined();
    expect(level60!.category).toBe('POOR');
    expect(level60!.description).toContain('steel substrate');
  });

  it('returns undefined for invalid values', () => {
    expect(getPdrLevel(15)).toBeUndefined();
    expect(getPdrLevel(-10)).toBeUndefined();
    expect(getPdrLevel(110)).toBeUndefined();
  });

  it('returns correct level for edge values', () => {
    expect(getPdrLevel(0)).toBeDefined();
    expect(getPdrLevel(100)).toBeDefined();
  });
});

describe('formatPdrValue', () => {
  it('formats known PDR values with pipe-separated label and description', () => {
    const result = formatPdrValue(20);
    expect(result).toContain('PDR: 20');
    expect(result).toContain('|');
    expect(result).toContain('AF paint missing');
  });

  it('formats PDR: 10 correctly', () => {
    const result = formatPdrValue(10);
    expect(result).toBe('PDR: 10 | Anti-Foul (AF) Paint intact.');
  });

  it('formats unknown values with just the label', () => {
    expect(formatPdrValue(25)).toBe('PDR: 25');
    expect(formatPdrValue(55)).toBe('PDR: 55');
  });
});

describe('formatPdrLabel', () => {
  it('returns simple PDR: N label', () => {
    expect(formatPdrLabel(10)).toBe('PDR: 10');
    expect(formatPdrLabel(60)).toBe('PDR: 60');
    expect(formatPdrLabel(100)).toBe('PDR: 100');
  });
});

describe('getPdrScaleRange', () => {
  it('returns correct range for PDR scale', () => {
    const range = getPdrScaleRange();
    expect(range).toEqual({ min: 0, max: 100, step: 10 });
  });
});
