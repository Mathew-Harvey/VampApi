import { describe, it, expect } from 'vitest';
import { daysBetween } from '../../src/utils/helpers';

describe('daysBetween', () => {
  it('returns 0 for the same date', () => {
    const date = new Date('2024-06-15');
    expect(daysBetween(date, date)).toBe(0);
  });

  it('returns correct days between two dates', () => {
    const a = new Date('2024-01-01');
    const b = new Date('2024-01-11');
    expect(daysBetween(a, b)).toBe(10);
  });

  it('returns positive regardless of argument order', () => {
    const a = new Date('2024-01-01');
    const b = new Date('2024-01-11');
    expect(daysBetween(b, a)).toBe(10);
  });

  it('handles cross-month spans', () => {
    const a = new Date('2024-01-28');
    const b = new Date('2024-02-04');
    expect(daysBetween(a, b)).toBe(7);
  });

  it('handles cross-year spans', () => {
    const a = new Date('2023-12-30');
    const b = new Date('2024-01-02');
    expect(daysBetween(a, b)).toBe(3);
  });
});
