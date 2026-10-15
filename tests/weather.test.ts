import { afterEach, describe, expect, test, vi } from 'vitest';
import { loadWeather, parseWeatherResponse, SINGAPORE_AREAS } from '../src/weather';
import { windToPlanDirection } from '../src/weather-orientation';
import { defaultConditions } from '../src/domain';
import { createSimulation, stepSimulation } from '../src/plan-simulation';
import { createThermalConfig, createThermalState, thermalSnapshot, createThermalModel } from '../src/thermal-model';
import type { ContractorPlan } from '../src/contractor-plan';

const now = Date.UTC(2026, 9, 15, 7);
const sample = () => ({ current_units: { time: 'unixtime', temperature_2m: '°C', relative_humidity_2m: '%', wind_speed_10m: 'm/s', wind_direction_10m: '°' },
  current: { time: now / 1000, temperature_2m: 31, relative_humidity_2m: 80, wind_speed_10m: 2.4, wind_direction_10m: 100 } });

describe('explicit regional weather import', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
  test('requests explicit units and supports request cancellation', async () => {
    vi.useFakeTimers(); vi.setSystemTime(now);
    const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => sample() });
    vi.stubGlobal('fetch', fetcher);
    const controller = new AbortController();
    const result = await loadWeather(SINGAPORE_AREAS[0], controller.signal);
    expect(result.windFrom).toBe('E');
    const [url, options] = fetcher.mock.calls[0];
    expect(new URL(url).searchParams.get('wind_speed_unit')).toBe('ms');
    expect(new URL(url).searchParams.get('timeformat')).toBe('unixtime');
    expect(options.signal).toBe(controller.signal);
  });
  test('HTTP errors do not produce weather values', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 429 }));
    await expect(loadWeather(SINGAPORE_AREAS[0], new AbortController().signal)).rejects.toThrow(/429/);
  });
  test('preserves units, time provenance and rounds geographic wind from direction', () => {
    const result = parseWeatherResponse(sample(), SINGAPORE_AREAS[0], now);
    expect(result).toMatchObject({ outdoorTemperature: 31, humidity: 80, windSpeed: 2.4, windFrom: 'E', timeOfDay: 15 });
    expect(result.provenance).toMatchObject({ area: 'Jurong West', windDegrees: 100, forecastTime: '2026-10-15T07:00:00.000Z' });
    expect(result).not.toHaveProperty('outdoorPm25');
  });
  test.each([null, {}, { current: {} }])('rejects malformed data', value => expect(() => parseWeatherResponse(value, SINGAPORE_AREAS[0], now)).toThrow());
  test('rejects wrong units, stale timestamps, nonfinite and unsupported values', () => {
    const wrong = sample(); wrong.current_units.wind_speed_10m = 'km/h';
    expect(() => parseWeatherResponse(wrong, SINGAPORE_AREAS[0], now)).toThrow(/units/);
    expect(() => parseWeatherResponse(sample(), SINGAPORE_AREAS[0], now + 4 * 3600000)).toThrow(/timestamp/);
    for (const value of [NaN, Infinity, -1, 11]) {
      const invalid = sample(); invalid.current.wind_speed_10m = value;
      expect(() => parseWeatherResponse(invalid, SINGAPORE_AREAS[0], now)).toThrow(/range/);
    }
  });
  test.each([[0, 'N'], [90, 'W'], [180, 'S'], [270, 'E']] as const)('rotates north wind to local plan at %s degrees', (bearing, result) => {
    expect(windToPlanDirection('N', bearing)).toBe(result);
  });
  test('invalid orientation cannot introduce NaN into the solver', () => {
    expect(windToPlanDirection('E', NaN)).toBe('E'); expect(windToPlanDirection('E', 45)).toBe('E');
  });
  test('rotating the house updates planar wind even while paused', () => {
    const base = defaultConditions(); base.scenarioId = 'baseline'; base.windSpeed = 2; base.windFrom = 'N';
    for (const key of Object.keys(base.windows)) base.windows[key] = true;
    const before = createSimulation(base);
    const rotated = { ...base, houseOrientationDeg: 90 as const };
    const after = stepSimulation(before, rotated, 0);
    const equivalent = createSimulation({ ...base, windFrom: 'W' });
    expect(after.field!.ux).toEqual(equivalent.field!.ux);
    expect(after.field!.uz).toEqual(equivalent.field!.uz);
    expect(after.field!.ux).not.toEqual(before.field!.ux);
  });
  test('canonical thermal wind uses house orientation', () => {
    const config = createThermalConfig(); config.base.scenarioId = 'baseline'; config.base.windSpeed = 2; config.base.windFrom = 'N'; config.base.houseOrientationDeg = 90;
    for (const key of Object.keys(config.base.windows)) config.base.windows[key] = true;
    const equivalent = structuredClone(config); equivalent.base.houseOrientationDeg = 0; equivalent.base.windFrom = 'W';
    const state = createThermalState(config);
    expect(thermalSnapshot(state, config)).toEqual(thermalSnapshot(state, equivalent));
  });
  test('imported plan ignores canonical house orientation and retains its own north', () => {
    const plan: ContractorPlan = { version: 1, id: 'test', name: 'Test', heightM: 2.6, northDegrees: 90,
      rooms: [{ id: 'room', label: 'Room', x: 0, z: 0, widthM: 3, depthM: 3 }], devices: [],
      openings: [{ id: 'window', kind: 'window', roomA: 'room', roomB: null, side: 'N', offsetM: 1, widthM: 1, sillM: 1, heightM: 1, open: true }] };
    const engine = createThermalModel(plan), base = defaultConditions(); base.houseOrientationDeg = 180;
    const config = engine.createConfig(base); expect(config.base.houseOrientationDeg).toBeUndefined();
    const state = engine.createState(config), original = engine.snapshot(state, config);
    config.base.houseOrientationDeg = 270;
    expect(engine.snapshot(state, config)).toEqual(original);
  });
});
