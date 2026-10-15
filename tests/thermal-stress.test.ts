import { expect, test } from 'vitest';
import { createThermalConfig, createThermalState, stepThermalState, thermalSnapshot } from '../src/thermal-model';

test('two-hour thermal run stays finite and conservative through extreme inputs and blocked/reopened flow', () => {
  const config = createThermalConfig();
  Object.assign(config.base, { scenarioId: 'hot_haze', outdoorTemperature: 60, outdoorPm25: 1000, windSpeed: 10, timeOfDay: 12, acSetpoint: 16 });
  for (const name of Object.keys(config.base.devices)) config.base.devices[name] = true;
  config.base.portableFan = { on: true, slot: 0, angleDeg: 180, speed: 3 };
  config.base.purifier = { on: true, slot: 2 };
  config.vent = { opening: 'window_bedroom3_1', on: true, mode: 'supply', ratedM3h: 600 };
  config.envelope = { uValue: 5, solarAbsorptance: 1, shadeFraction: 0 };
  config.durationSeconds = 7200;
  for (const group of [config.base.doors, config.base.windows]) for (const name of Object.keys(group)) group[name] = true;
  let state = createThermalState(config);
  for (let elapsed = 0; elapsed < 7200; elapsed += 300) {
    if (elapsed === 2400) {
      for (const group of [config.base.doors, config.base.windows]) for (const name of Object.keys(group)) group[name] = false;
    }
    if (elapsed === 4800) {
      config.vent.mode = 'exhaust';
      config.base.outdoorTemperature = 10;
      config.base.outdoorPm25 = 0;
      config.base.timeOfDay = 0;
      config.base.doors.door_bedroom3 = true;
      config.base.doors.main_door = true;
    }
    state = stepThermalState(state, config, 300);
    const snapshot = thermalSnapshot(state, config);
    expect(state.elapsedSeconds).toBeCloseTo(elapsed + 300, 7);
    for (const values of [state.lowerT, state.upperT, state.wallT]) {
      expect(values.every(value => Number.isFinite(value) && value > -273.15)).toBe(true);
    }
    for (const values of [state.lowerPm25, state.upperPm25]) {
      expect(values.every(value => Number.isFinite(value) && value >= 0 && value <= 1000 + 1e-6)).toBe(true);
    }
    expect(Math.abs(snapshot.energyResidualJ)).toBeLessThan(0.01);
    expect(snapshot.maxMassResidualM3s).toBeLessThan(1e-9);
    expect(Number.isFinite(snapshot.energyWh) && snapshot.energyWh >= 0).toBe(true);
    if (elapsed >= 2400 && elapsed < 4800) expect(Math.abs(snapshot.actualVentM3h)).toBeLessThan(1e-6);
  }
}, 10_000);
