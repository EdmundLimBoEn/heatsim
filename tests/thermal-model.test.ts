import { describe, expect, test } from 'vitest';
import { defaultConditions, model } from '../src/domain';
import { createThermalConfig, createThermalState, stepThermalState, thermalSnapshot, THERMAL_MODEL_PARAMETERS, THERMAL_OPENINGS } from '../src/thermal-model';
import type { ThermalConfig, ThermalState } from '../src/thermal-types';

function sealed(): ThermalConfig {
  const config = createThermalConfig(defaultConditions());
  config.base.windSpeed = 0;
  for (const key of Object.keys(config.base.doors)) config.base.doors[key] = false;
  for (const key of Object.keys(config.base.windows)) config.base.windows[key] = false;
  return config;
}
const bedroom = model.rooms.findIndex(room => room.name === 'bedroom3');
const pmMass = (state: ThermalState) => model.rooms.reduce((sum, room, index) => sum + room.area_m2 * model.ceiling_height / 2 * (state.lowerPm25[index] + state.upperPm25[index]), 0);

describe('whole-flat conservative two-layer thermal model', () => {
  test('uses full-size JSON volumes, serializable state and exterior window adapters', () => {
    const config = sealed(), state = createThermalState(config), snapshot = thermalSnapshot(state, config);
    expect(state.lowerT.length).toBe(model.rooms.length);
    expect(snapshot.rooms).toHaveLength(12);
    expect(THERMAL_OPENINGS).toHaveLength(11);
    expect(snapshot.storedEnergyJ).toBeCloseTo(30 * (90 * 2.6 * 1.2 * 1005 + 90 * 50_000), 4);
    expect(structuredClone(state)).toEqual(state);
  });
  test('uniform equilibrium remains unchanged with zero net heat and mass flow', () => {
    const config = sealed(), initial = createThermalState(config), after = stepThermalState(initial, config, 120);
    expect(after.lowerT).toEqual(initial.lowerT); expect(after.upperT).toEqual(initial.upperT); expect(after.wallT).toEqual(initial.wallT);
    const snapshot = thermalSnapshot(after, config);
    expect(snapshot.heatBudgetW.net).toBe(0); expect(snapshot.energyResidualJ).toBe(0);
    expect(snapshot.actualVentM3h).toBe(0); expect(snapshot.maxMassResidualM3s).toBe(0);
    expect(initial.elapsedSeconds).toBe(0); expect(after.elapsedSeconds).toBe(120);
  });
  test('convection, conduction and interlayer mixing conserve total energy and pollutant mass when isolated', () => {
    const config = sealed(); config.envelope.uValue = 0; config.envelope.shadeFraction = 1;
    const initial = createThermalState(config);
    for (let room = 0; room < model.rooms.length; room++) {
      initial.lowerT[room] = 25 + room * 0.5; initial.upperT[room] = 34 - room * 0.1; initial.wallT[room] = 29 + room * 0.1;
      initial.lowerPm25[room] = 10 + room; initial.upperPm25[room] = 80 - room;
    }
    const before = thermalSnapshot(initial, config), after = stepThermalState(initial, config, 300), snapshot = thermalSnapshot(after, config);
    expect(Math.abs(snapshot.storedEnergyJ - before.storedEnergyJ)).toBeLessThan(1e-5);
    expect(Math.abs(pmMass(after) - pmMass(initial))).toBeLessThan(1e-7);
    expect(Math.abs(snapshot.heatBudgetW.net)).toBeLessThan(1e-7);
    expect(snapshot.maxMassResidualM3s).toBeLessThan(1e-10);
    expect(after.lowerT[0]).toBeGreaterThan(initial.lowerT[0]);
  });
  test('the fan has no invented makeup air in a sealed compartment, but motor heat remains', () => {
    const config = sealed(); config.vent.on = true;
    const after = stepThermalState(createThermalState(config), config, 60), snapshot = thermalSnapshot(after, config);
    expect(Math.abs(snapshot.actualVentM3h)).toBeLessThan(1e-7);
    expect(snapshot.fanPowerWatts).toBe(8);
    expect(snapshot.energyWh).toBeCloseTo(8 / 60, 8);
    expect(snapshot.rooms[bedroom].upperTemperature).toBeGreaterThan(30);
    expect(Math.abs(snapshot.energyResidualJ)).toBeLessThan(1e-5);
  });
  test('a genuine makeup opening enables both supply and exhaust and preserves network mass', () => {
    for (const mode of ['exhaust', 'supply'] as const) {
      const config = sealed(); config.vent.mode = mode; config.vent.on = true;
      config.base.windows.window_bedroom3_2 = true;
      const snapshot = thermalSnapshot(createThermalState(config), config);
      expect(snapshot.actualVentM3h).toBeGreaterThan(100);
      expect(snapshot.actualVentM3h).toBeLessThanOrEqual(config.vent.ratedM3h + 1e-6);
      expect(snapshot.maxMassResidualM3s).toBeLessThan(1e-10);
    }
  });
  test('zero-rated fan on and off are exactly equivalent', () => {
    const off = sealed(); off.vent.ratedM3h = 0; off.base.windows.window_bedroom3_2 = true;
    const on = structuredClone(off); on.vent.on = true;
    const initial = createThermalState(off), left = stepThermalState(initial, off, 60), right = stepThermalState(initial, on, 60);
    expect(right).toEqual(left);
    expect(thermalSnapshot(right, on)).toEqual(thermalSnapshot(left, off));
  });
  test('bringing in hotter outdoor air can warm the room instead of refrigerating it', () => {
    const config = sealed(); config.base.outdoorTemperature = 40; config.base.windows.window_bedroom3_2 = true; config.vent.on = true;
    const initial = createThermalState(config), after = stepThermalState(initial, config, 120), snapshot = thermalSnapshot(after, config);
    expect(snapshot.rooms[bedroom].lowerTemperature).toBeGreaterThan(initial.lowerT[bedroom] + 0.1);
    expect(snapshot.averageTemperature).toBeGreaterThan(30);
    expect(snapshot.heatBudgetW.ventilation).toBeGreaterThan(0);
    expect(Math.abs(snapshot.energyResidualJ)).toBeLessThan(1e-4);
  });
  test('warm-below stratification strengthens conservative buoyancy mixing', () => {
    const config = sealed(); config.envelope.uValue = 0;
    const unstable = createThermalState(config), stable = createThermalState(config);
    unstable.lowerT[bedroom] = 35; unstable.upperT[bedroom] = 25;
    stable.lowerT[bedroom] = 25; stable.upperT[bedroom] = 35;
    const a = thermalSnapshot(unstable, config), b = thermalSnapshot(stable, config);
    expect(a.rooms[bedroom].buoyancyExchangeM3h).toBeGreaterThan(b.rooms[bedroom].buoyancyExchangeM3h);
    const after = stepThermalState(unstable, config, 1);
    expect(after.lowerT[bedroom]).toBeLessThan(35); expect(after.upperT[bedroom]).toBeGreaterThan(25);
  });
  test('opaque solar and longwave heat cross the envelope conductance instead of bypassing insulation', () => {
    const config = sealed(); config.base.scenarioId = 'hot_afternoon'; config.base.outdoorTemperature = 40;
    config.envelope.uValue = 0; config.envelope.shadeFraction = 1;
    const snapshot = thermalSnapshot(createThermalState(config), config);
    expect(snapshot.heatBudgetW.conduction).toBe(0); expect(snapshot.heatBudgetW.radiation).toBe(0); expect(snapshot.heatBudgetW.solar).toBe(0);
    config.envelope.uValue = 1.5;
    const conducting = thermalSnapshot(createThermalState(config), config);
    expect(conducting.heatBudgetW.conduction).toBeGreaterThan(0); expect(conducting.heatBudgetW.radiation).toBeGreaterThan(0);
    config.envelope.shadeFraction = 0;
    expect(thermalSnapshot(createThermalState(config), config).heatBudgetW.solar).toBeGreaterThan(100);
  });
  test('chunked timesteps agree and accounting closes with devices, solar and outdoor exchange', () => {
    const config = sealed(); config.base.scenarioId = 'hot_haze'; config.base.outdoorTemperature = 34; config.base.outdoorPm25 = 150;
    config.vent.on = true; config.base.windows.window_bedroom3_2 = true; config.base.devices.ac_living = true;
    const initial = createThermalState(config), whole = stepThermalState(initial, config, 30);
    let chunks = structuredClone(initial);
    for (let second = 0; second < 30; second++) chunks = stepThermalState(chunks, config, 1);
    for (let room = 0; room < model.rooms.length; room++) expect(chunks.lowerT[room]).toBeCloseTo(whole.lowerT[room], 8);
    const snapshot = thermalSnapshot(whole, config);
    expect(snapshot.heatBudgetW.ac).toBeLessThan(0); expect(snapshot.energyWh).toBeGreaterThan(0);
    expect(Math.abs(snapshot.energyResidualJ)).toBeLessThan(1e-5);
    expect(snapshot.maxMassResidualM3s).toBeLessThan(1e-9);
    expect(THERMAL_MODEL_PARAMETERS.plumeUpperFraction).toBe(0.7);
  });
});
