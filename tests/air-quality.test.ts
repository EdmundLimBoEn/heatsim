import { describe, expect, it } from 'vitest';
import { pm25ToUsAqiEquivalent, usAqiEquivalentToPm25 } from '../src/air-quality';

describe('manual scenario US EPA PM2.5 index equivalents', () => {
  it.each([
    [0, 0], [9, 50], [9.1, 51], [35.4, 100], [35.5, 101], [55.4, 150],
    [55.5, 151], [125.4, 200], [125.5, 201], [225.4, 300], [225.5, 301], [325.4, 500],
  ])('uses current official endpoints: %s µg/m³ maps to %s', (concentration, index) => {
    expect(pm25ToUsAqiEquivalent(concentration)).toBe(index);
    expect(usAqiEquivalentToPm25(index)).toBe(concentration);
  });
  it('truncates concentration before interpolating and rounding the index', () => {
    expect(pm25ToUsAqiEquivalent(9.099)).toBe(50);
    expect(pm25ToUsAqiEquivalent(35.499)).toBe(100);
    expect(pm25ToUsAqiEquivalent(55.499)).toBe(150);
    expect(pm25ToUsAqiEquivalent(325.499)).toBe(500);
    expect(pm25ToUsAqiEquivalent(20)).toBe(71);
    expect(pm25ToUsAqiEquivalent(200)).toBe(275);
  });
  it('provides a representative concentration that round-trips every supported integer index', () => {
    for (let index = 0; index <= 500; index++) {
      const concentration = usAqiEquivalentToPm25(index);
      expect(concentration).not.toBeNull();
      expect(pm25ToUsAqiEquivalent(concentration!)).toBe(index);
    }
  });
  it('remains monotonic across the supported concentration range', () => {
    let previous = -1;
    for (let tenth = 0; tenth <= 3254; tenth++) {
      const index = pm25ToUsAqiEquivalent(tenth / 10);
      expect(index).not.toBeNull();
      expect(index!).toBeGreaterThanOrEqual(previous);
      previous = index!;
    }
  });
  it('rejects invalid and unsupported inputs without silently clamping pollution', () => {
    for (const concentration of [-1, NaN, Infinity, -Infinity, 325.5, 1000]) expect(pm25ToUsAqiEquivalent(concentration)).toBeNull();
    for (const index of [-1, 0.5, 500.1, 501, NaN, Infinity, -Infinity]) expect(usAqiEquivalentToPm25(index)).toBeNull();
  });
});
