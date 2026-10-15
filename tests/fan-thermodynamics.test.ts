import { describe, expect, test } from 'vitest';
import { calculateFanThermodynamics, type FanThermodynamicsInput } from '../src/fan-thermodynamics';

describe('educational fan thermodynamics', () => {
  test.each([
    [10, 0.00854423687627559],
    [30, 0.025634517938499357],
    [100, 0.08546948911686059],
  ])('ideal expansion at %s Pa matches the NASA relation', (pressureDifferencePa, expectedDrop) => {
    const result = calculateFanThermodynamics({ pressureDifferencePa });
    expect(result.idealStaticTemperatureDropK).toBeCloseTo(expectedDrop, 11);
    expect(result.idealOutletTemperatureK).toBeCloseTo(303 - expectedDrop, 11);
    expect(result.fanTemperatureRiseK).toBeNull();
  });

  test('fan power and heating add energy independently of the expansion comparison', () => {
    const result = calculateFanThermodynamics({ pressureDifferencePa: 30, flowM3s: 0.05, efficiency: 0.5 });
    expect(result.airPowerW).toBe(1.5);
    expect(result.electricalPowerW).toBe(3);
    expect(result.heatToAirW).toBe(3);
    expect(result.fanTemperatureRiseK).toBeCloseTo(3 / (1.17 * 0.05 * 1005), 12);
    expect(result.idealStaticTemperatureDropK).toBeCloseTo(0.025634517938499357, 11);
  });

  test('zero pressure gives no pressure work or ideal temperature change', () => {
    expect(calculateFanThermodynamics({ pressureDifferencePa: 0, flowM3s: 0.05 })).toEqual({
      idealOutletTemperatureK: 303, idealStaticTemperatureDropK: 0,
      airPowerW: 0, electricalPowerW: 0, heatToAirW: 0, fanTemperatureRiseK: 0,
    });
  });

  test('tiny pressure differences retain their first-order result', () => {
    const pressureDifferencePa = 1e-9;
    const expected = 303 * (0.4 / 1.4) * pressureDifferencePa / 101325;
    const result = calculateFanThermodynamics({ pressureDifferencePa });
    expect(result.idealStaticTemperatureDropK / expected).toBeCloseTo(1, 12);
  });

  test.each<Partial<FanThermodynamicsInput>>([
    { pressureDifferencePa: -1 }, { pressureDifferencePa: 101325 }, { pressureDifferencePa: Infinity },
    { temperatureK: 0 }, { absolutePressurePa: -1 }, { gamma: 1 }, { gamma: -1 },
    { densityKgM3: 0 }, { specificHeatJKgK: -1 }, { flowM3s: -1 },
    { efficiency: 0 }, { efficiency: 1.01 }, { flowM3s: Number.MAX_VALUE },
  ])('rejects invalid physical ranges: %j', invalid => {
    expect(() => calculateFanThermodynamics({ pressureDifferencePa: 30, ...invalid })).toThrow(RangeError);
  });

  test('rejects non-finite values for every input', () => {
    const keys: (keyof FanThermodynamicsInput)[] = [
      'pressureDifferencePa', 'temperatureK', 'absolutePressurePa', 'gamma',
      'densityKgM3', 'specificHeatJKgK', 'flowM3s', 'efficiency',
    ];
    for (const key of keys) for (const value of [NaN, Infinity, -Infinity]) {
      expect(() => calculateFanThermodynamics({ pressureDifferencePa: 30, [key]: value })).toThrow(RangeError);
    }
  });
});
