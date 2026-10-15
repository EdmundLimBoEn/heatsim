import { describe, expect, test } from 'vitest';
import { defaultConditions, model, type Conditions, type SimulationResult } from '../src/domain';
import { createSimulation, PRESETS, SCENARIOS, SIMULATION_NOTE, stepSimulation } from '../src/simulation';
import { FAN_SLOTS, PURIFIER_SLOTS } from '../src/config/slots';

const room = (state: SimulationResult, name: string) => state.rooms.find(reading => reading.room === name)!;
const closed = (): Conditions => {
  const conditions = defaultConditions();
  for (const name in conditions.doors) conditions.doors[name] = false;
  return conditions;
};

describe('illustrative room simulation', () => {
  test('starts with every geometry room, finite readings and zero accumulated energy', () => {
    const state = createSimulation(defaultConditions());
    expect(state.rooms.map(reading => reading.room)).toEqual(model.rooms.map(room => room.name));
    expect(state.averageTemperature).toBeCloseTo(30, 8);
    expect(state.averagePm25).toBeCloseTo(15, 8);
    expect(state.energyKwh).toBe(0);
    expect(state.elapsedSeconds).toBe(0);
    expect(SIMULATION_NOTE).toContain('not CFD');
    for (const reading of state.rooms) for (const value of Object.values(reading)) if (typeof value === 'number') expect(Number.isFinite(value)).toBe(true);
  });

  test('zero and invalid elapsed time do not advance state or energy', () => {
    const conditions = defaultConditions();
    const initial = createSimulation(conditions);
    for (const delta of [0, -10, NaN, Infinity]) expect(stepSimulation(initial, conditions, delta)).toEqual(initial);
  });

  test('large steps stay bounded and match the same 5-second substeps', () => {
    const conditions = closed(); conditions.devices.ac_living = true;
    const initial = createSimulation(conditions);
    const whole = stepSimulation(initial, conditions, 600);
    let sliced = initial;
    for (let index = 0; index < 120; index++) sliced = stepSimulation(sliced, conditions, 5);
    expect(whole).toEqual(sliced);
    expect(stepSimulation(initial, conditions, 1e9)).toEqual(stepSimulation(initial, conditions, 3_600));
  });

  test('fans improve comfort and airflow without pretending to refrigerate a room', () => {
    const conditions = defaultConditions();
    const initial = createSimulation(conditions);
    const baseline = stepSimulation(initial, conditions, 600);
    conditions.devices.fan_living = true;
    const fan = stepSimulation(initial, conditions, 600);
    expect(room(fan, 'living').temperature).toBeGreaterThanOrEqual(room(baseline, 'living').temperature);
    expect(room(fan, 'living').feelsLike).toBeLessThan(room(baseline, 'living').feelsLike);
    expect(room(fan, 'living').airflow).toBeGreaterThan(room(baseline, 'living').airflow + 0.8);
    expect(fan.powerWatts).toBe(50);
    expect(fan.energyKwh).toBeCloseTo(50 * 600 / 3_600_000, 10);
  });

  test('AC cools its room and the connected open-plan dining area', () => {
    const conditions = closed();
    const initial = createSimulation(conditions);
    const baseline = stepSimulation(initial, conditions, 1_800);
    conditions.devices.ac_living = true;
    const cooled = stepSimulation(initial, conditions, 1_800);
    expect(room(cooled, 'living').temperature).toBeLessThan(room(baseline, 'living').temperature - 3);
    expect(room(cooled, 'dining').temperature).toBeLessThan(room(baseline, 'dining').temperature - 0.3);
    expect(cooled.powerWatts).toBeGreaterThan(100);
    expect(cooled.energyKwh).toBeGreaterThan(0);
  });

  test('AC thermostat reduces electricity at a warmer setpoint', () => {
    const cold = closed(); cold.devices.ac_master = true; cold.acSetpoint = 20;
    const warm = { ...cold, acSetpoint: 28 };
    const initial = createSimulation(cold);
    const coldState = stepSimulation(initial, cold, 3_600);
    const warmState = stepSimulation(initial, warm, 3_600);
    expect(room(coldState, 'master_bedroom').temperature).toBeLessThan(room(warmState, 'master_bedroom').temperature);
    expect(coldState.energyKwh).toBeGreaterThan(warmState.energyKwh);
  });

  test('a bedroom doorway transfers heat and pollution only to its actual neighbors', () => {
    const conditions = closed();
    const initial = createSimulation(conditions);
    for (const reading of initial.rooms) { reading.temperature = 34; reading.pm25 = 100; }
    room(initial, 'master_bedroom').temperature = 20;
    room(initial, 'master_bedroom').pm25 = 0;
    const shut = stepSimulation(initial, conditions, 300);
    conditions.doors.door_master_bedroom = true;
    const open = stepSimulation(initial, conditions, 300);
    expect(room(open, 'master_bedroom').temperature).toBeGreaterThan(room(shut, 'master_bedroom').temperature + 0.5);
    expect(room(open, 'master_bedroom').pm25).toBeGreaterThan(room(shut, 'master_bedroom').pm25 + 10);
    expect(room(open, 'corridor').pm25).toBeLessThan(room(shut, 'corridor').pm25);
  });

  test('the main door connects directly to dining, as in the source plan', () => {
    const conditions = closed();
    const initial = createSimulation(conditions);
    conditions.doors.main_door = true;
    const open = stepSimulation(initial, conditions, 0);
    const diningIncrease = room(open, 'dining').airflow - room(initial, 'dining').airflow;
    const lobbyIncrease = room(open, 'corridor_lobby').airflow - room(initial, 'corridor_lobby').airflow;
    expect(diningIncrease).toBeGreaterThan(0.08);
    expect(diningIncrease).toBeGreaterThan(lobbyIncrease);
  });

  test('exterior openings mix both outdoor heat and PM2.5 into their room', () => {
    const conditions = closed();
    const initial = createSimulation(conditions);
    conditions.outdoorTemperature = 38; conditions.outdoorPm25 = 150;
    const shut = stepSimulation(initial, conditions, 600);
    conditions.windows.window_master_1 = true;
    const open = stepSimulation(initial, conditions, 600);
    expect(room(open, 'master_bedroom').temperature).toBeGreaterThan(room(shut, 'master_bedroom').temperature);
    expect(room(open, 'master_bedroom').pm25).toBeGreaterThan(room(shut, 'master_bedroom').pm25 + 50);
    expect(room(open, 'master_bedroom').airflow).toBeGreaterThan(room(shut, 'master_bedroom').airflow);
  });

  test('purifiers remove PM2.5 and open windows during haze counteract removal', () => {
    const conditions = closed(); conditions.outdoorPm25 = 150;
    const initial = createSimulation(conditions);
    const baseline = stepSimulation(initial, conditions, 1_800);
    conditions.devices.purifier_master = true;
    const purified = stepSimulation(initial, conditions, 1_800);
    expect(room(purified, 'master_bedroom').pm25).toBeLessThan(room(baseline, 'master_bedroom').pm25 / 2);
    expect(purified.powerWatts).toBe(40);
    conditions.windows.window_master_1 = true;
    const ventilated = stepSimulation(initial, conditions, 1_800);
    expect(room(ventilated, 'master_bedroom').pm25).toBeGreaterThan(room(purified, 'master_bedroom').pm25 + 30);
  });

  test('humidity changes comfort and sunlight changes heat gain', () => {
    const conditions = defaultConditions();
    const initial = createSimulation(conditions);
    const dry = stepSimulation(initial, { ...conditions, humidity: 30 }, 0);
    const humid = stepSimulation(initial, { ...conditions, humidity: 90 }, 0);
    expect(humid.averageFeelsLike).toBeGreaterThan(dry.averageFeelsLike);
    expect(humid.averageTemperature).toBe(dry.averageTemperature);
    const day = stepSimulation(initial, { ...conditions, scenarioId: 'hot_afternoon', timeOfDay: 13 }, 600);
    const night = stepSimulation(initial, { ...conditions, scenarioId: 'hot_afternoon', timeOfDay: 1 }, 600);
    expect(day.averageTemperature).toBeGreaterThan(night.averageTemperature);
  });

  test('higher wind increases ventilation through open exterior windows', () => {
    const conditions = closed(); conditions.windows.window_master_1 = true;
    const initial = createSimulation(conditions);
    const calm = stepSimulation(initial, { ...conditions, windSpeed: 0 }, 0);
    const windy = stepSimulation(initial, { ...conditions, windSpeed: 5 }, 0);
    expect(room(windy, 'master_bedroom').airflow).toBeGreaterThan(room(calm, 'master_bedroom').airflow);
  });

  test('room averages are weighted by floor area, not number of rooms', () => {
    const conditions = defaultConditions();
    const initial = createSimulation(conditions);
    room(initial, 'living').temperature += 10;
    const state = stepSimulation(initial, conditions, 0);
    expect(state.averageTemperature).toBeCloseTo(30 + 10 * 14.88 / 90, 8);
  });

  test('unknown controls are ignored and no input object is mutated', () => {
    const conditions = defaultConditions();
    const initial = createSimulation(conditions);
    const before = structuredClone({ conditions, initial });
    const normal = stepSimulation(initial, conditions, 60);
    expect({ conditions, initial }).toEqual(before);
    conditions.devices.ac_unknown = true;
    conditions.devices.ac_condenser_yard = true;
    conditions.windows.window_unknown = true;
    conditions.doors.door_unknown = true;
    expect(stepSimulation(initial, conditions, 60)).toEqual(normal);
  });

  test('all presets stay finite and nonnegative over eight simulated hours', () => {
    for (const preset of PRESETS) {
      let state = createSimulation(preset.conditions);
      for (let hour = 0; hour < 8; hour++) state = stepSimulation(state, preset.conditions, 3_600);
      expect(state.elapsedSeconds).toBe(28_800);
      expect(Number.isFinite(state.energyKwh)).toBe(true);
      expect(state.energyKwh).toBeGreaterThanOrEqual(0);
      for (const reading of state.rooms) {
        expect(reading.temperature).toBeGreaterThan(-20);
        expect(reading.temperature).toBeLessThan(65);
        expect(reading.pm25).toBeGreaterThanOrEqual(0);
        expect(reading.pm25).toBeLessThanOrEqual(preset.conditions.outdoorPm25);
      }
    }
  });

  test('nonfinite numeric conditions recover to safe defaults', () => {
    const conditions = defaultConditions();
    conditions.outdoorTemperature = NaN; conditions.outdoorPm25 = Infinity;
    conditions.humidity = NaN; conditions.windSpeed = Infinity;
    conditions.timeOfDay = NaN; conditions.acSetpoint = NaN;
    const state = stepSimulation(createSimulation(conditions), conditions, 3_600);
    for (const reading of state.rooms) for (const value of Object.values(reading)) if (typeof value === 'number') expect(Number.isFinite(value)).toBe(true);
  });

  test('all six scenarios match the documented boundary and initial values', () => {
    expect(SCENARIOS.map(scenario => [scenario.id, scenario.outdoorTemperature, scenario.outdoorPm25, scenario.initialTemperature, scenario.initialPm25])).toEqual([
      ['baseline', 30, 20, 30, 15], ['hot_afternoon', 34, 25, 31, 20],
      ['haze_outside', 31, 200, 30, 40], ['hot_haze', 34, 150, 31, 40],
      ['night_cool', 27, 20, 31, 15], ['validation', 33, 100, 28, 0],
    ]);
    for (const [index, preset] of PRESETS.entries()) {
      const state = createSimulation(preset.conditions);
      expect(state.averageTemperature).toBeCloseTo(SCENARIOS[index].initialTemperature, 8);
      expect(state.averagePm25).toBeCloseTo(SCENARIOS[index].initialPm25, 8);
      for (const [name, open] of Object.entries(preset.conditions.doors)) expect(open).toBe(preset.id === 'validation' && name !== 'main_door');
      expect(Object.values(preset.conditions.windows).every(open => open === false)).toBe(true);
      expect(state.powerWatts).toBe(0);
    }
  });

  test('normal-day baseline has no artificial sun or people heating', () => {
    const conditions = PRESETS[0].conditions;
    const state = stepSimulation(createSimulation(conditions), conditions, 3_600);
    expect(state.averageTemperature).toBeCloseTo(30, 8);
  });

  test('portable fan placement and speed affect the selected room only', () => {
    const conditions = closed();
    const initial = createSimulation(conditions);
    conditions.portableFan = { on: true, slot: 0, angleDeg: 90, speed: 1 };
    const slow = stepSimulation(initial, conditions, 0);
    conditions.portableFan.speed = 3;
    const fast = stepSimulation(initial, conditions, 0);
    expect(room(fast, 'bedroom3').airflow).toBeGreaterThan(room(slow, 'bedroom3').airflow);
    expect(room(fast, 'bedroom3').feelsLike).toBeLessThan(room(slow, 'bedroom3').feelsLike);
    expect(fast.averageTemperature).toBe(initial.averageTemperature);
    conditions.portableFan.slot = 4;
    const moved = stepSimulation(initial, conditions, 0);
    expect(room(moved, 'bedroom3').airflow).toBe(room(initial, 'bedroom3').airflow);
    expect(room(moved, 'master_bedroom').airflow).toBeGreaterThan(room(initial, 'master_bedroom').airflow);
    expect(moved.powerWatts).toBe(50);
    conditions.portableFan.speed = 0;
    expect(stepSimulation(initial, conditions, 0).powerWatts).toBe(0);
  });

  test('a movable purifier removes particles in its slot room', () => {
    const conditions = closed(); conditions.scenarioId = 'haze_outside'; conditions.outdoorPm25 = 200;
    const initial = createSimulation(conditions);
    const off = stepSimulation(initial, conditions, 600);
    conditions.purifier = { on: true, slot: 2 };
    const on = stepSimulation(initial, conditions, 600);
    expect(room(on, 'bedroom3').pm25).toBeLessThan(room(off, 'bedroom3').pm25 / 2);
    expect(on.powerWatts).toBe(40);
    conditions.purifier.slot = 99;
    expect(stepSimulation(initial, conditions, 600)).toEqual(off);
  });

  test('every documented device slot falls inside its named room', () => {
    expect(FAN_SLOTS).toHaveLength(5);
    expect(PURIFIER_SLOTS).toHaveLength(6);
    for (const slot of [...FAN_SLOTS, ...PURIFIER_SLOTS]) {
      const target = model.rooms.find(room => room.name === slot.room)!;
      expect(slot.x).toBeGreaterThan(target.min[0]); expect(slot.x).toBeLessThan(target.max[0]);
      expect(slot.z).toBeGreaterThan(target.min[2]); expect(slot.z).toBeLessThan(target.max[2]);
    }
  });
});
