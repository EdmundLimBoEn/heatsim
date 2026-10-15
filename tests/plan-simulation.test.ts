import { describe, expect, test } from 'vitest';
import { defaultConditions, model, type Conditions, type SimulationResult } from '../src/domain';
import { createSimulation, PLAN_GRID, stepSimulation } from '../src/plan-simulation';
import { PRESETS } from '../src/simulation';

function closed(scenarioId = 'baseline'): Conditions {
  const preset = PRESETS.find(preset => preset.id === scenarioId)!;
  return { ...structuredClone(preset.conditions), doors: Object.fromEntries(model.boxes.filter(box => box.type === 'door').map(box => [box.name, false])) };
}
const room = (result: SimulationResult, name: string) => result.rooms.find(reading => reading.room === name)!;
const mass = (result: SimulationResult) => result.field!.pm25.reduce((sum, value, index) => sum + (result.field!.cellType[index] === 0 ? value : 0), 0);
function run(conditions: Conditions, seconds: number) {
  let state = createSimulation(conditions);
  for (let time = 0; time < seconds; time += 1) state = stepSimulation(state, conditions, Math.min(1, seconds - time));
  return state;
}

describe('plan-view geometry and conservative scalar transport', () => {
  test('the exact 1.2 m slice has sealed walls and no unintentional reservoir contacts', () => {
    const { field } = createSimulation(closed());
    expect(field!.nx).toBe(64); expect(field!.nz).toBe(48);
    expect(field!.cellType.filter(type => type === 0).length).toBe(1948);
    expect(field!.cellType.filter(type => type === 1).length).toBe(429);
    const { nx, nz } = PLAN_GRID;
    for (let z = 1; z < nz - 1; z++) for (let x = 1; x < nx - 1; x++) {
      const cell = x + nx * z;
      if (field!.cellType[cell] === 0) for (const next of [cell - 1, cell + 1, cell - nx, cell + nx]) expect(field!.cellType[next]).not.toBe(2);
    }
  });
  test('opening traverses host-wall thickness and newly opened cells receive finite neighbour fields', () => {
    const conditions = closed(), initial = createSimulation(conditions);
    conditions.windows.window_bedroom3_1 = true;
    const opened = stepSimulation(initial, conditions, 0);
    expect(opened.field!.cellType.filter(type => type === 0).length).toBe(1948 + 7);
    conditions.doors.door_bedroom3 = true;
    const door = stepSimulation(opened, conditions, 0);
    expect(door.field!.cellType.filter(type => type === 0).length).toBe(1948 + 7 + 4);
    for (const array of [door.field!.temperature, door.field!.pm25]) expect(Array.from(array).every(Number.isFinite)).toBe(true);
    conditions.windows.window_master_bath = true;
    expect(stepSimulation(door, conditions, 0).field!.cellType).toEqual(door.field!.cellType);
  });
  test.each([1e30, -1e30])('newly opened cells clamp corrupted finite neighbours at zero elapsed time (%s)', corrupted => {
    const conditions = closed(), initial = createSimulation(conditions);
    initial.field!.temperature.fill(corrupted); initial.field!.pm25.fill(corrupted);
    conditions.doors.door_bedroom3 = true;
    const after = stepSimulation(initial, conditions, 0), field = after.field!;
    const opened = Array.from(field.cellType.keys()).filter(cell => initial.field!.cellType[cell] !== 0 && field.cellType[cell] === 0);
    expect(opened).toHaveLength(4);
    for (const cell of opened) {
      expect(field.temperature[cell]).toBe(corrupted > 0 ? 60 : 10);
      expect(field.pm25[cell]).toBe(corrupted > 0 ? 1000 : 0);
    }
    expect(field.temperature.every(value => Number.isFinite(value) && value >= 10 && value <= 60)).toBe(true);
    expect(field.pm25.every(value => Number.isFinite(value) && value >= 0 && value <= 1000)).toBe(true);
  });
  test('closed baseline is still and preserves uniform temperature and pollutant mass', () => {
    const conditions = closed(), initial = createSimulation(conditions), after = stepSimulation(initial, conditions, 60);
    expect(after.averageTemperature).toBeCloseTo(30, 5);
    expect(after.averagePm25).toBeCloseTo(15, 5);
    expect(mass(after)).toBeCloseTo(mass(initial), 5);
    expect(Math.max(...after.field!.ux.map(Math.abs), ...after.field!.uz.map(Math.abs))).toBe(0);
    expect(after.elapsedSeconds).toBe(60); expect(after.energyKwh).toBe(0);
  });
  test('pressure is zero for unforced sealed rooms and a single constant-pressure opening', () => {
    const conditions = closed();
    expect(createSimulation(conditions).field!.pressure!.every(value => value === 0)).toBe(true);
    conditions.windows.window_living_1 = true;
    expect(createSimulation(conditions).field!.pressure!.every(value => value === 0)).toBe(true);
  });
  test('open cross-flow exposes finite nonuniform relative pressure with nonfluid cells masked', () => {
    const conditions = closed('validation');
    conditions.windows.window_bedroom3_1 = true;
    conditions.doors.door_bedroom3 = true; conditions.doors.main_door = true;
    const state = createSimulation(conditions), field = state.field!;
    expect(field.pressure).toBeInstanceOf(Float32Array);
    expect(field.pressure!.length).toBe(PLAN_GRID.nx * PLAN_GRID.nz);
    const values = Array.from(field.pressure!).filter((_, cell) => field.cellType[cell] === 0);
    expect(values.every(value => Number.isFinite(value) && value >= -1 && value <= 1)).toBe(true);
    expect(Math.max(...values)).toBeCloseTo(1, 5);
    expect(Math.max(...values) - Math.min(...values)).toBeGreaterThan(0.5);
    for (let cell = 0; cell < field.pressure!.length; cell++) if (field.cellType[cell] !== 0) expect(field.pressure![cell]).toBe(0);
    expect(stepSimulation(state, conditions, 1).field!.pressure).toEqual(field.pressure);
  });
  test('a fan in a sealed room has relative positive and negative pressure without arbitrary room offsets', () => {
    const conditions = closed(); conditions.portableFan = { on: true, slot: 0, angleDeg: 90, speed: 3 };
    const field = createSimulation(conditions).field!;
    expect(Math.min(...field.pressure!)).toBeLessThan(-0.1);
    expect(Math.max(...field.pressure!)).toBeGreaterThan(0.1);
    const at = (x: number, z: number) => Math.floor((x - PLAN_GRID.origin[0]) / PLAN_GRID.dx) + PLAN_GRID.nx * Math.floor((z - PLAN_GRID.origin[1]) / PLAN_GRID.dx);
    expect(field.pressure![at(2, 2)]).toBe(0);
    expect(field.pressure!.every(Number.isFinite)).toBe(true);
  });
  test('nonuniform scalar mass is conserved across internal transport in a sealed flat', () => {
    const conditions = closed(), initial = createSimulation(conditions);
    for (let cell = 0; cell < initial.field!.pm25.length; cell++) if (initial.field!.cellType[cell] === 0) initial.field!.pm25[cell] = cell % 100;
    const after = stepSimulation(initial, conditions, 10);
    expect(Math.abs(mass(after) - mass(initial)) / mass(initial)).toBeLessThan(1e-6);
  });
  test('cross ventilation enters the north window and carries outdoor haze to bedroom 3', () => {
    const conditions = closed('validation');
    conditions.windows.window_bedroom3_1 = true;
    for (const door of Object.keys(conditions.doors)) conditions.doors[door] = true;
    const after = run(conditions, 12);
    expect(room(after, 'bedroom3').pm25).toBeGreaterThan(1);
    expect(room(after, 'bedroom3').airflow).toBeGreaterThan(0.005);
    const index = Math.floor((10.6 + 0.3) / 0.2) + PLAN_GRID.nx * Math.floor(0.3 / 0.2);
    expect(after.field!.uz[index]).toBeGreaterThan(0);
    expect(Math.max(...after.field!.pm25)).toBeLessThanOrEqual(100.001);
  });
  test('purifier placement removes haze locally without cooling the air', () => {
    const off = closed('haze_outside'), on = structuredClone(off);
    on.purifier = { on: true, slot: 2 };
    const before = run(off, 12), after = run(on, 12);
    expect(room(after, 'bedroom3').pm25).toBeLessThan(room(before, 'bedroom3').pm25 - 1);
    expect(after.averageTemperature).toBeCloseTo(before.averageTemperature, 5);
    expect(after.powerWatts).toBe(40);
    expect(after.energyKwh).toBeCloseTo(40 * 12 / 3_600_000, 9);
  });
  test('fan moves air and improves comfort without refrigerating it', () => {
    const conditions = closed();
    const before = run(conditions, 12);
    conditions.portableFan = { on: true, slot: 0, angleDeg: 90, speed: 3 };
    const after = run(conditions, 12);
    expect(room(after, 'bedroom3').airflow).toBeGreaterThan(0.01);
    expect(after.averageTemperature).toBeCloseTo(30, 4);
    expect(room(after, 'bedroom3').feelsLike).toBeLessThan(room(before, 'bedroom3').feelsLike);
    expect(after.averagePm25).toBeCloseTo(15, 4);
  });
  test('time of day gates scenario sunlight, including a live change to midnight', () => {
    const afternoon = closed('hot_afternoon'), midnight = structuredClone(afternoon);
    afternoon.timeOfDay = 14; midnight.timeOfDay = 0;
    const day = run(afternoon, 12), night = run(midnight, 12);
    expect(room(day, 'master_bedroom').temperature).toBeGreaterThan(room(night, 'master_bedroom').temperature + 0.01);
    expect(room(day, 'bedroom3').temperature).toBeCloseTo(room(night, 'bedroom3').temperature, 5);
    const initial = createSimulation(afternoon);
    const changed = stepSimulation(initial, midnight, 12);
    expect(changed.averageTemperature).toBeCloseTo(night.averageTemperature, 4);
    const normal = closed(); normal.timeOfDay = 14;
    expect(run(normal, 12).averageTemperature).toBeCloseTo(30, 5);
  });
  test('humidity changes only illustrative comfort and updates without resetting the fields', () => {
    const dry = closed(), humid = structuredClone(dry);
    dry.humidity = 40; humid.humidity = 90;
    const dryState = run(dry, 12), humidState = run(humid, 12);
    expect(humidState.averageFeelsLike).toBeCloseTo(dryState.averageFeelsLike + 3, 5);
    expect(humidState.field!.temperature).toEqual(dryState.field!.temperature);
    expect(humidState.field!.pm25).toEqual(dryState.field!.pm25);
    const changed = stepSimulation(dryState, humid, 0);
    expect(changed.averageFeelsLike).toBeCloseTo(humidState.averageFeelsLike, 5);
    expect(changed.field!.temperature).toEqual(dryState.field!.temperature);
  });
  test('AC creates a local cool region and consumes illustrative power', () => {
    const conditions = closed(); conditions.devices.ac_bedroom3 = true;
    const after = run(conditions, 12);
    expect(room(after, 'bedroom3').temperature).toBeLessThan(29.8);
    expect(room(after, 'master_bedroom').temperature).toBeCloseTo(30, 4);
    expect(after.powerWatts).toBe(1000);
  });
  test('invalid state and conditions recover to finite bounded values, including cloned worker state', () => {
    const conditions = defaultConditions(), state = createSimulation(conditions);
    state.field!.temperature[100] = NaN; state.field!.pm25[200] = Infinity;
    conditions.windSpeed = NaN; conditions.outdoorTemperature = Infinity; conditions.outdoorPm25 = NaN;
    conditions.portableFan = { on: true, slot: NaN, angleDeg: Infinity, speed: 3 };
    const after = stepSimulation(structuredClone(state), conditions, 2);
    for (const array of [after.field!.temperature, after.field!.pm25, after.field!.ux, after.field!.uz]) expect(Array.from(array).every(Number.isFinite)).toBe(true);
    expect(after.averagePm25).toBeGreaterThanOrEqual(0);
  });
});
