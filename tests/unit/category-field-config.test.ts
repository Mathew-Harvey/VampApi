import { describe, it, expect } from 'vitest';
import { CATEGORY_FIELD_CONFIG, getCategoryConfig, getCategoryConfigForScale } from '../../src/config/category-field-config';

describe('CATEGORY_FIELD_CONFIG', () => {
  it('has configs for all expected categories', () => {
    const expected = ['HULL', 'ANODES', 'PROPELLER', 'RUDDER', 'THRUSTER', 'SEA_CHEST', 'KEEL', 'INTAKE'];
    for (const cat of expected) {
      expect(CATEGORY_FIELD_CONFIG).toHaveProperty(cat);
    }
  });

  it('all categories have inspectionFields and componentFields', () => {
    for (const [key, config] of Object.entries(CATEGORY_FIELD_CONFIG)) {
      expect(config.inspectionFields).toBeDefined();
      expect(Array.isArray(config.inspectionFields)).toBe(true);
      expect(config.inspectionFields.length).toBeGreaterThan(0);
      expect(config.componentFields).toBeDefined();
      expect(Array.isArray(config.componentFields)).toBe(true);
    }
  });

  describe('PDR rating field', () => {
    it('HULL has PDR rating field as numeric rating type', () => {
      const hull = CATEGORY_FIELD_CONFIG.HULL;
      const pdrField = hull.inspectionFields.find((f) => f.key === 'coatingCondition');
      expect(pdrField).toBeDefined();
      expect(pdrField!.type).toBe('rating');
      expect(pdrField!.label).toContain('PDR');
      expect(pdrField!.min).toBe(0);
      expect(pdrField!.max).toBe(100);
      expect(pdrField!.step).toBe(10);
    });

    it('PROPELLER has PDR rating field', () => {
      const propeller = CATEGORY_FIELD_CONFIG.PROPELLER;
      const pdrField = propeller.inspectionFields.find((f) => f.key === 'coatingCondition');
      expect(pdrField).toBeDefined();
      expect(pdrField!.type).toBe('rating');
    });

    it('SEA_CHEST has PDR rating field', () => {
      const seaChest = CATEGORY_FIELD_CONFIG.SEA_CHEST;
      const pdrField = seaChest.inspectionFields.find((f) => f.key === 'coatingCondition');
      expect(pdrField).toBeDefined();
      expect(pdrField!.type).toBe('rating');
    });
  });

  describe('Fouling fields', () => {
    it('HULL has fouling fields', () => {
      const hull = CATEGORY_FIELD_CONFIG.HULL;
      expect(hull.inspectionFields.find((f) => f.key === 'foulingRating')).toBeDefined();
      expect(hull.inspectionFields.find((f) => f.key === 'foulingType')).toBeDefined();
      expect(hull.inspectionFields.find((f) => f.key === 'coverage')).toBeDefined();
    });

    it('PROPELLER now has fouling fields', () => {
      const propeller = CATEGORY_FIELD_CONFIG.PROPELLER;
      expect(propeller.inspectionFields.find((f) => f.key === 'foulingRating')).toBeDefined();
      expect(propeller.inspectionFields.find((f) => f.key === 'foulingType')).toBeDefined();
      expect(propeller.inspectionFields.find((f) => f.key === 'coverage')).toBeDefined();
    });

    it('ANODES now has fouling fields', () => {
      const anodes = CATEGORY_FIELD_CONFIG.ANODES;
      expect(anodes.inspectionFields.find((f) => f.key === 'foulingRating')).toBeDefined();
      expect(anodes.inspectionFields.find((f) => f.key === 'foulingType')).toBeDefined();
      expect(anodes.inspectionFields.find((f) => f.key === 'coverage')).toBeDefined();
    });

    it('ANODES has PDR rating field', () => {
      const anodes = CATEGORY_FIELD_CONFIG.ANODES;
      const pdrField = anodes.inspectionFields.find((f) => f.key === 'coatingCondition');
      expect(pdrField).toBeDefined();
      expect(pdrField!.type).toBe('rating');
    });

    it('ANODES still has wastage field', () => {
      const anodes = CATEGORY_FIELD_CONFIG.ANODES;
      expect(anodes.inspectionFields.find((f) => f.key === 'measurementValue')).toBeDefined();
    });
  });
});

describe('getCategoryConfig', () => {
  it('returns config for known category', () => {
    const config = getCategoryConfig('HULL');
    expect(config.label).toBe('Hull Section');
  });

  it('returns default config for unknown category', () => {
    const config = getCategoryConfig('UNKNOWN');
    expect(config.label).toBe('Component');
  });
});

describe('getCategoryConfigForScale', () => {
  it('returns LoF-adapted fields for LOF scale', () => {
    const config = getCategoryConfigForScale('HULL', 'LOF');
    const frField = config.inspectionFields.find((f) => f.key === 'foulingRating');
    expect(frField).toBeDefined();
    expect(frField!.label).toContain('LoF');
    expect(frField!.min).toBe(0);
    expect(frField!.max).toBe(5);
    expect(frField!.step).toBe(1);
  });

  it('returns FR-adapted fields for FR scale', () => {
    const config = getCategoryConfigForScale('HULL', 'FR');
    const frField = config.inspectionFields.find((f) => f.key === 'foulingRating');
    expect(frField).toBeDefined();
    expect(frField!.label).toContain('FR');
    expect(frField!.min).toBe(0);
    expect(frField!.max).toBe(100);
    expect(frField!.step).toBe(10);
  });

  it('LOF scale includes foulingType and coverage fields', () => {
    const config = getCategoryConfigForScale('HULL', 'LOF');
    expect(config.inspectionFields.find((f) => f.key === 'foulingType')).toBeDefined();
    expect(config.inspectionFields.find((f) => f.key === 'coverage')).toBeDefined();
  });

  it('FR scale includes foulingType and coverage fields', () => {
    const config = getCategoryConfigForScale('HULL', 'FR');
    expect(config.inspectionFields.find((f) => f.key === 'foulingType')).toBeDefined();
    expect(config.inspectionFields.find((f) => f.key === 'coverage')).toBeDefined();
  });

  it('PDR field is preserved regardless of fouling scale', () => {
    const lofConfig = getCategoryConfigForScale('HULL', 'LOF');
    const frConfig = getCategoryConfigForScale('HULL', 'FR');
    expect(lofConfig.inspectionFields.find((f) => f.key === 'coatingCondition')).toBeDefined();
    expect(frConfig.inspectionFields.find((f) => f.key === 'coatingCondition')).toBeDefined();
  });
});
