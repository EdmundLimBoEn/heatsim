import { describe, expect, test } from 'vitest';
import { model, type SimulationResult } from '../src/domain';
import { PURIFIER_SLOTS } from '../src/config/slots';
import { createSimulation, PLAN_GRID, preparePlanStep, stepSimulation } from '../src/plan-simulation';
import { packPlanCells } from '../src/plan-gpu';
import { PRESETS } from '../src/simulation';

const BEDROOM3_SLOT = 2;
const bedroomPm = (result: SimulationResult) => result.rooms.find(room => room.room === 'bedroom3')!.pm25;
const particleMass = (result: SimulationResult) => result.field!.pm25.reduce((sum, concentration, cell) =>
  sum + (result.field!.cellType[cell] === 0 ? concentration * PLAN_GRID.dx ** 2 * model.ceiling_height : 0), 0);
function conditions() {
  const config = structuredClone(PRESETS.find(preset => preset.id === 'haze_outside')!.conditions);
  for (const key of Object.keys(config.windows)) config.windows[key] = false;
  for (const key of Object.keys(config.doors)) config.doors[key] = false;
  for (const key of Object.keys(config.devices)) config.devices[key] = false;
  config.portableFan = { on: false, slot: 0, angleDeg: 90, speed: 2 };
  config.purifier = { on: false, slot: BEDROOM3_SLOT };
  return config;
}
function expectBounded(result: SimulationResult) {
  for (const value of result.field!.pm25) {
    expect(Number.isFinite(value)).toBe(true);
    expect(value).toBeGreaterThanOrEqual(0);
    expect(value).toBeLessThanOrEqual(1000);
  }
}

describe('live Bedroom 3 corner purifier', () => {
  test('uses fluid cells in Bedroom 3 and sends the same local sink to the GPU', () => {
    expect(PURIFIER_SLOTS[BEDROOM3_SLOT]).toEqual({ room: 'bedroom3', x: 11.5, z: 2.8 });
    const config = conditions(); config.purifier!.on = true;
    const prepared = preparePlanStep(createSimulation(config), config, 1), packed = new DataView(packPlanCells(prepared));
    const bedroom = model.rooms.find(room => room.name === 'bedroom3')!;
    let affected = 0;
    for (let cell = 0; cell < prepared.flow.cleaning.length; cell++) {
      expect(packed.getFloat32(cell * 48 + 40, true)).toBe(prepared.flow.cleaning[cell]);
      if (prepared.flow.cleaning[cell] === 0) continue;
      affected++;
      expect(prepared.flow.mask[cell]).toBe(0);
      const x = PLAN_GRID.origin[0] + (cell % PLAN_GRID.nx + 0.5) * PLAN_GRID.dx;
      const z = PLAN_GRID.origin[1] + (Math.floor(cell / PLAN_GRID.nx) + 0.5) * PLAN_GRID.dx;
      expect(x).toBeGreaterThan(bedroom.min[0]); expect(x).toBeLessThan(bedroom.max[0]);
      expect(z).toBeGreaterThan(bedroom.min[2]); expect(z).toBeLessThan(bedroom.max[2]);
    }
    expect(affected).toBeGreaterThan(0);
  });

  test('removes particles gradually in the closed room while OFF preserves them', () => {
    const off = conditions(), on = structuredClone(off); on.purifier!.on = true;
    let control = createSimulation(off), cleaned = createSimulation(off);
    let previousMean = bedroomPm(cleaned), previousMass = particleMass(cleaned);
    for (const dt of [1, 4, 25, 30, 60]) {
      control = stepSimulation(control, off, dt); cleaned = stepSimulation(cleaned, on, dt);
      expect(bedroomPm(control)).toBe(40);
      expect(bedroomPm(cleaned)).toBeGreaterThan(0);
      expect(bedroomPm(cleaned)).toBeLessThan(previousMean);
      expect(particleMass(cleaned)).toBeLessThan(previousMass);
      expect(cleaned.rooms.find(room => room.room === 'living')!.pm25).toBe(40);
      previousMean = bedroomPm(cleaned); previousMass = particleMass(cleaned);
    }
    expect(cleaned.elapsedSeconds).toBe(120);
    expect(bedroomPm(cleaned)).toBeGreaterThan(15);
    expect(bedroomPm(cleaned)).toBeLessThan(30);
    expect(cleaned.powerWatts).toBe(40);
    expectBounded(cleaned);
  });

  test('power and opening changes preserve running fields and elapsed time', () => {
    const config = conditions();
    let running = stepSimulation(createSimulation(config), config, 10);
    config.purifier!.on = true;
    const switchedOn = stepSimulation(running, config, 0);
    expect(switchedOn.field!.pm25).toEqual(running.field!.pm25);
    expect(switchedOn.field!.temperature).toEqual(running.field!.temperature);
    expect(switchedOn.elapsedSeconds).toBe(10); expect(switchedOn.energyKwh).toBe(running.energyKwh);
    running = stepSimulation(switchedOn, config, 30);
    expect(bedroomPm(running)).toBeLessThan(40);
    config.purifier!.on = false;
    const switchedOff = stepSimulation(running, config, 0);
    expect(switchedOff.field!.pm25).toEqual(running.field!.pm25);
    expect(switchedOff.elapsedSeconds).toBe(40);
    const redistributed = stepSimulation(switchedOff, config, 30);
    expect(bedroomPm(redistributed)).toBeCloseTo(bedroomPm(switchedOff), 4);
    expect(particleMass(redistributed)).toBeCloseTo(particleMass(switchedOff), 3);
    config.windows.window_bedroom3_1 = true; config.doors.door_bedroom3 = true;
    const opened = stepSimulation(redistributed, config, 0);
    expect(opened.elapsedSeconds).toBe(70);
    for (let cell = 0; cell < opened.field!.pm25.length; cell++) {
      if (redistributed.field!.cellType[cell] !== 0 || opened.field!.cellType[cell] !== 0) continue;
      expect(opened.field!.pm25[cell]).toBe(redistributed.field!.pm25[cell]);
    }
    expectBounded(stepSimulation(opened, config, 5));
  });

  test('dirty incoming air may raise PM despite the purifier, while the purifier still helps', () => {
    const off = conditions();
    off.windows.window_bedroom3_1 = true; off.windows.window_bedroom3_2 = true;
    off.doors.door_bedroom3 = true; off.doors.main_door = true;
    off.windFrom = 'N'; off.windSpeed = 2; off.outdoorPm25 = 200;
    const on = structuredClone(off); on.purifier!.on = true;
    const initial = createSimulation(off), unfiltered = stepSimulation(initial, off, 30), filtered = stepSimulation(initial, on, 30);
    expect(bedroomPm(filtered)).toBeGreaterThan(bedroomPm(initial));
    expect(bedroomPm(filtered)).toBeLessThan(bedroomPm(unfiltered));
    expect(particleMass(filtered)).toBeLessThan(particleMass(unfiltered));
    expectBounded(filtered);
  });
});

test('turbo demo clears haze faster, stays bounded, and stops cleaning when off', () => {
  const normal = conditions(); normal.purifier!.on = true;
  const turbo = structuredClone(normal); turbo.purifier!.demoBoost = true;
  const initial = createSimulation(normal);
  const ordinary = stepSimulation(initial, normal, 30);
  const boosted = stepSimulation(initial, turbo, 30);
  expect(bedroomPm(boosted)).toBeLessThan(bedroomPm(ordinary) * 0.8);
  expectBounded(boosted);
  expect(boosted.powerWatts).toBe(ordinary.powerWatts);
  turbo.purifier!.on = false;
  const off = stepSimulation(boosted, turbo, 30);
  expect(particleMass(off)).toBeCloseTo(particleMass(boosted), 3);
});
