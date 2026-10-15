import { describe, expect, test } from 'vitest';
import { defaultConditions } from '../src/domain';
import { coolingLabDemoConfig, coolingLabScenarioBase } from '../src/cooling-lab';
import { PRESETS } from '../src/simulation';
import { createThermalConfig } from '../src/thermal-model';
import { compareThermalCases } from '../src/thermal-comparison';
import { findStandingFanPosition } from '../src/standing-fans';

describe('Cooling Lab weather changes', () => {
  test('keeps captured standing fans and primary overrides through a scenario change and matched comparison', () => {
    const captured = defaultConditions();
    captured.portableFan = { on: true, slot: 0, angleDeg: 90, speed: 1,
      position: findStandingFanPosition('living', captured, 'primary')!, headingDeg: 125 };
    captured.standingFans = [{ id: 'extra', ...findStandingFanPosition('dining', captured)!, angleDeg: 270, speed: 3, on: true }];
    captured.windows.window_living_1 = true;
    const original = structuredClone(captured), preset = PRESETS.find(item => item.id === 'hot_haze')!;
    const after = coolingLabScenarioBase(captured, preset.id);
    expect(after.standingFans).toEqual(original.standingFans);
    expect(after.portableFan).toEqual(original.portableFan);
    expect(after.windows).toEqual(original.windows);
    expect(after.outdoorTemperature).toBe(preset.conditions.outdoorTemperature);
    expect(after.outdoorPm25).toBe(preset.conditions.outdoorPm25);
    const baseline = createThermalConfig(captured), candidate = createThermalConfig(after);
    candidate.durationSeconds = 10;
    const report = compareThermalCases(candidate, { baselineConfig: baseline });
    expect(report.baselineConfig.base.standingFans).toEqual(original.standingFans);
    expect(report.candidateConfig.base.standingFans).toEqual(original.standingFans);
    expect(report.variedSettings).toEqual([]);
    expect(report.off.final.powerWatts).toBe(100);
    expect(report.on.final.powerWatts).toBe(100);
    expect(captured).toEqual(original);
    after.standingFans![0].on = false; after.portableFan!.position!.x += 1;
    expect(captured).toEqual(original);
    expect(coolingLabScenarioBase(captured, 'captured')).toEqual(original);
  });
});


test('weather changes preserve home orientation, removed fan and purifier heading', () => {
  const captured = defaultConditions();
  captured.weatherProvenance = { source: 'Open-Meteo', area: 'Bishan', latitude: 1.35, longitude: 103.85, forecastTime: '2026-10-15T10:00:00Z', loadedAt: '2026-10-15T10:01:00Z', windDegrees: 45 };
  captured.houseOrientationDeg = 270;
  captured.portableFan!.removed = true;
  captured.purifier!.headingDeg = 135;
  expect(coolingLabScenarioBase(captured, 'captured').weatherProvenance).toEqual(captured.weatherProvenance);
  for (const preset of PRESETS) {
    const after = coolingLabScenarioBase(captured, preset.id);
    expect(after.houseOrientationDeg).toBe(270);
    expect(after.weatherProvenance).toBeUndefined();
    expect(after.portableFan).toEqual(captured.portableFan);
    expect(after.purifier).toEqual(captured.purifier);
  }
});

describe('Window fan demo experiments', () => {
  test('cooler replacement air produces a visible local difference without changing model coefficients', () => {
    const config = coolingLabDemoConfig('cooler');
    const result = compareThermalCases(config);
    const off = result.off.final.rooms.find(room => room.room === 'bedroom3')!;
    const on = result.on.final.rooms.find(room => room.room === 'bedroom3')!;
    expect(on.lowerTemperature - off.lowerTemperature).toBeLessThan(-0.4);
    expect(result.difference.averageTemperature).toBeLessThan(-0.3);
    expect(result.on.final.actualVentM3h).toBeGreaterThan(200);
    expect(result.off.initial.averageTemperature).toBe(result.on.initial.averageTemperature);
    expect(result.variedSettings.map(setting => setting.label)).toEqual(['High-vent fan power']);
    expect(config.envelope).toEqual(createThermalConfig().envelope);
    expect(result.difference.energyWh).toBeCloseTo(7, 5);
  });

  test('a blocked route prevents exchange and hotter outdoor air reverses the benefit', () => {
    const blocked = compareThermalCases(coolingLabDemoConfig('blocked'));
    expect(Math.abs(blocked.on.final.actualVentM3h)).toBeLessThan(0.1);
    expect(blocked.difference.averageTemperature).toBeGreaterThan(0);
    const hotter = compareThermalCases(coolingLabDemoConfig('hotter'));
    expect(hotter.on.final.actualVentM3h).toBeGreaterThan(200);
    expect(hotter.difference.averageTemperature).toBeGreaterThan(0.2);
    expect(hotter.variedSettings.map(setting => setting.label)).toEqual(['High-vent fan power']);
  });
});
