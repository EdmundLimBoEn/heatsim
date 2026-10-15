import { describe, expect, test } from 'vitest';
import { defaultConditions } from '../src/domain';
import { coolingLabScenarioBase } from '../src/cooling-lab';
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
