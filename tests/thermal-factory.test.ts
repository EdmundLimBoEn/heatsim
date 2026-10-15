import { describe, expect, test } from 'vitest';
import { defaultConditions } from '../src/domain';
import { createThermalModel, createThermalConfig, createThermalState, stepThermalState, thermalSnapshot, THERMAL_MODEL_PARAMETERS as P } from '../src/thermal-model';
import type { ContractorPlan } from '../src/contractor-plan';

function example(): ContractorPlan {
  return { version: 1, id: 'study', name: 'Two actual rooms', heightM: 3, northDegrees: 0,
    rooms: [{ id: 'a', label: 'West room', x: 0, z: 0, widthM: 2, depthM: 4 }, { id: 'b', label: 'East room', x: 2, z: 0, widthM: 3, depthM: 4 }],
    openings: [
      { id: 'wa', kind: 'window', roomA: 'a', roomB: null, side: 'N', offsetM: 0.5, widthM: 1, sillM: 0.5, heightM: 2, open: true },
      { id: 'wb', kind: 'window', roomA: 'b', roomB: null, side: 'S', offsetM: 1, widthM: 1, sillM: 0.5, heightM: 2, open: true },
      { id: 'door', kind: 'door', roomA: 'a', roomB: 'b', side: 'E', offsetM: 1, widthM: 1, sillM: 0, heightM: 2.4, open: true },
    ], devices: [] };
}
function isolated(plan = example()) {
  const engine = createThermalModel(plan), config = engine.createConfig();
  config.occupancyPeople = 0; config.initialTemperature = 30; config.initialPm25 = 20;
  config.base.windSpeed = 0; config.base.outdoorTemperature = 30; config.base.outdoorPm25 = 20;
  config.envelope.uValue = 0; config.envelope.shadeFraction = 1;
  for (const name of Object.keys(config.base.windows)) config.base.windows[name] = false;
  return { engine, config };
}

describe('independent imported floorplan thermal models', () => {
  test('uses imported room area, height, state length and shared initial values', () => {
    const { engine, config } = isolated(); config.initialTemperature = 27; config.initialPm25 = 75;
    const state = engine.createState(config), report = engine.snapshot(state, config);
    expect(engine.rooms.map(room => room.area_m2)).toEqual([8, 12]);
    expect(state.lowerT.length).toBe(2); expect(Array.from(state.wallT)).toEqual([27, 27]);
    expect(Array.from(state.lowerPm25)).toEqual([75, 75]);
    expect(report.storedEnergyJ).toBeCloseTo(27 * (20 * 3 * P.densityKgM3 * P.specificHeatJKgK + 20 * P.surfaceCapacityJPerM2K), 6);
  });
  test('defaults preserve declared plan controls and do not inherit canonical intervention maps or adapter', () => {
    const plan = example(); plan.openings[1].open = false;
    plan.devices.push({ id: 'filter', kind: 'purifier', roomId: 'b', on: true });
    const base = defaultConditions(); for (const key of Object.keys(base.devices)) base.devices[key] = true;
    base.portableFan!.on = true; base.purifier!.on = true;
    base.portableFan!.position = { x: 8, z: 3.9 }; base.portableFan!.headingDeg = 230;
    base.standingFans = [{ id: 'flat_extra', x: 10, z: 6, angleDeg: 90, speed: 3, on: true }];
    const config = createThermalModel(plan).createConfig(base);
    expect(config.base.windows).toEqual({ wa: true, wb: false }); expect(config.base.doors).toEqual({ door: true });
    expect(config.base.devices).toEqual({ filter: true }); expect(config.base.portableFan).toBeUndefined(); expect(config.base.purifier).toBeUndefined();
    expect(config.base.standingFans).toBeUndefined();
    expect(base.standingFans).toHaveLength(1); expect(base.portableFan!.position).toEqual({ x: 8, z: 3.9 });
    expect(config.vent).toEqual({ opening: '', on: false, mode: 'exhaust', ratedM3h: 0 }); expect(config.occupancyPeople).toBe(4);
  });
  test('isolates instances and rejects states from different geometry with the same room count', () => {
    const first = example(), other = example(); other.rooms[1].widthM = 5;
    const a = createThermalModel(first), b = createThermalModel(other), ac = a.createConfig(), bc = b.createConfig();
    const before = a.createState(ac); const snapshot = a.snapshot(before, ac);
    b.step(b.createState(bc), bc, 60);
    expect(a.snapshot(before, ac)).toEqual(snapshot);
    expect(() => b.step(before, bc, 1)).toThrow(/different floorplan/);
    first.rooms[0].widthM = 100; expect(a.rooms[0].area_m2).toBe(8);
    expect(() => thermalSnapshot(before, createThermalConfig())).toThrow(/different floorplan/);
  });
  test('stable room ordering makes equal hashed plans safe when room declarations are reordered', () => {
    const one = example(), two = example(); two.rooms.reverse();
    const a = createThermalModel(one), b = createThermalModel(two);
    const config = a.createConfig(), state = a.createState(config); state.lowerT[0] = 31;
    expect(a.id).toBe(b.id); expect(a.rooms).toEqual(b.rooms);
    expect(a.snapshot(state, config)).toEqual(b.snapshot(state, b.createConfig()));
  });
  test('exact model identity rejects different volumes even if the short display hash collides', () => {
    const make = (name: string, widthM: number): ContractorPlan => ({ version: 1, id: 'collision_test', name, heightM: 2.6, northDegrees: 0,
      rooms: [{ id: 'roomA', label: 'Room', x: 0, z: 0, widthM, depthM: 3 }], openings: [], devices: [] });
    const a = createThermalModel(make('Case 27574', 2.4)), b = createThermalModel(make('Case 35471', 2.1));
    expect(a.id).toBe(b.id);
    expect(() => b.snapshot(a.createState(a.createConfig()), b.createConfig())).toThrow(/different floorplan/);
  });
  test('distributes the same total occupancy load by room area instead of canonical names', () => {
    const { engine, config } = isolated(); config.occupancyPeople = 4;
    const state = engine.createState(config), after = engine.step(state, config, 1), report = engine.snapshot(state, config);
    expect(report.heatBudgetW.people).toBeCloseTo(400, 10);
    expect(after.lowerT[0] - state.lowerT[0]).toBeCloseTo(after.lowerT[1] - state.lowerT[1], 10);
    config.occupancyPeople = 0; expect(engine.snapshot(state, config).heatBudgetW.people).toBe(0);
  });
  test('conserves heat and PM in a closed nonuniform custom plan', () => {
    const { engine, config } = isolated(), state = engine.createState(config);
    state.lowerT.set([26, 34]); state.upperT.set([35, 28]); state.wallT.set([31, 29]);
    state.lowerPm25.set([10, 50]); state.upperPm25.set([80, 20]);
    const initial = engine.snapshot(state, config);
    const mass = (s: typeof state) => engine.rooms.reduce((sum, room, i) => sum + room.area_m2 * 1.5 * (s.lowerPm25[i] + s.upperPm25[i]), 0);
    const after = engine.step(state, config, 600), final = engine.snapshot(after, config);
    expect(Math.abs(final.storedEnergyJ - initial.storedEnergyJ)).toBeLessThan(1e-6);
    expect(mass(after)).toBeCloseTo(mass(state), 7); expect(final.maxMassResidualM3s).toBeLessThan(1e-10);
  });
  test('closed internal door blocks cross ventilation and explicit passage remains open', () => {
    const engine = createThermalModel(example()), config = engine.createConfig();
    config.occupancyPeople = 0; config.base.windFrom = 'N'; config.base.windSpeed = 2;
    const state = engine.createState(config), open = engine.snapshot(state, config);
    expect(open.airChangesPerHour).toBeGreaterThan(1);
    config.base.doors.door = false; const closed = engine.snapshot(state, config);
    expect(closed.airChangesPerHour).toBeLessThan(1e-10);
    expect(closed.openingFlows!.find(flow => flow.opening === 'door')!.grossM3h).toBe(0);
    const passagePlan = example(); passagePlan.openings[2].kind = 'passage';
    const passage = createThermalModel(passagePlan), passageConfig = passage.createConfig(config.base); passageConfig.occupancyPeople = 0;
    passageConfig.base.doors.door = false;
    expect(passage.snapshot(passage.createState(passageConfig), passageConfig).airChangesPerHour).toBeGreaterThan(1);
  });
  test('rotation follows geographic FROM direction and preserves equivalent wind cases', () => {
    const plan = example(), rotated = example(); rotated.northDegrees = 90;
    const a = createThermalModel(plan), b = createThermalModel(rotated), ca = a.createConfig(), cb = b.createConfig();
    ca.base.windFrom = 'N'; cb.base.windFrom = 'E'; ca.base.windSpeed = cb.base.windSpeed = 2;
    const ra = a.snapshot(a.createState(ca), ca), rb = b.snapshot(b.createState(cb), cb);
    expect(rb.airChangesPerHour).toBeCloseTo(ra.airChangesPerHour, 10); expect(rb.openingFlows).toEqual(ra.openingFlows);
    cb.base.windFrom = 'N'; expect(b.snapshot(b.createState(cb), cb).airChangesPerHour).toBeLessThan(1e-10);
  });
  test('shared interior walls are excluded from exterior heat exchange', () => {
    const split = example(); split.openings = [];
    const merged = example(); merged.openings = []; merged.rooms = [{ id: 'all', label: 'Whole footprint', x: 0, z: 0, widthM: 5, depthM: 4 }];
    const first = createThermalModel(split), second = createThermalModel(merged), a = first.createConfig(), b = second.createConfig();
    for (const config of [a, b]) { config.occupancyPeople = 0; config.initialTemperature = 30; config.base.outdoorTemperature = 40; config.base.windSpeed = 0; }
    const left = first.snapshot(first.createState(a), a), right = second.snapshot(second.createState(b), b);
    expect(left.heatBudgetW.conduction).toBeCloseTo(right.heatBudgetW.conduction, 10);
    expect(left.heatBudgetW.radiation).toBeCloseTo(right.heatBudgetW.radiation, 10);
  });
  test('north rotation also changes geographic west-facing solar exposure', () => {
    const plan = example(); plan.rooms.splice(1); plan.openings.splice(1); plan.openings[0].side = 'W'; plan.openings[0].open = false;
    const original = createThermalModel(plan); plan.northDegrees = 180; const rotated = createThermalModel(plan);
    const a = original.createConfig(), b = rotated.createConfig();
    for (const config of [a, b]) { config.base.scenarioId = 'hot_afternoon'; config.base.timeOfDay = 12; config.occupancyPeople = 0; }
    const before = original.snapshot(original.createState(a), a), after = rotated.snapshot(rotated.createState(b), b);
    expect(before.heatBudgetW.solar).toBeGreaterThan(after.heatBudgetW.solar);
    expect(after.heatBudgetW.solar).toBeGreaterThan(0);
  });
  test('an open exterior rectangle admits the same sunlight and air for window, door and passage kinds', () => {
    const results = (['window', 'door', 'passage'] as const).map(kind => {
      const plan = example(); plan.rooms.splice(1); plan.openings.splice(1);
      Object.assign(plan.openings[0], { kind, side: 'W', open: true });
      const engine = createThermalModel(plan), config = engine.createConfig();
      config.base.scenarioId = 'hot_afternoon'; config.base.timeOfDay = 12; config.base.windFrom = 'W'; config.occupancyPeople = 0;
      const initial = engine.createState(config), after = engine.step(initial, config, 60);
      return engine.snapshot(after, config);
    });
    for (const result of results.slice(1)) expect(result).toEqual(results[0]);
  });
  test('a closed imported opaque exterior door blocks direct solar transmission', () => {
    const plan = example(); plan.rooms.splice(1); plan.openings.splice(1);
    Object.assign(plan.openings[0], { kind: 'door', side: 'W', open: true });
    const engine = createThermalModel(plan), config = engine.createConfig();
    config.base.scenarioId = 'hot_afternoon'; config.base.timeOfDay = 12; config.occupancyPeople = 0; config.envelope.uValue = 0;
    const state = engine.createState(config), open = engine.snapshot(state, config);
    config.base.doors.wa = false;
    expect(open.heatBudgetW.solar).toBeCloseTo(2 * P.peakSolarWPerM2);
    expect(engine.snapshot(state, config).heatBudgetW.solar).toBe(0);
  });
  test('layer flow records reveal bidirectional stack exchange when net flow is zero', () => {
    const plan = example(); plan.rooms.splice(1); plan.openings.splice(1);
    const engine = createThermalModel(plan), config = engine.createConfig(); config.occupancyPeople = 0;
    config.base.windSpeed = 0; config.initialTemperature = 35; config.base.outdoorTemperature = 25;
    const report = engine.snapshot(engine.createState(config), config), flow = report.openingFlows![0];
    expect(flow.lowerM3h).toBeLessThan(0); expect(flow.upperM3h).toBeGreaterThan(0);
    expect(Math.abs(flow.netM3h)).toBeLessThan(1e-8); expect(flow.grossM3h).toBeGreaterThan(1);
    expect(flow.grossM3h).toBeCloseTo(Math.abs(flow.lowerM3h) + Math.abs(flow.upperM3h), 10);
  });
  test('declared per-room purifier and fan consume power, remove PM and add motor heat', () => {
    const plan = example(); plan.devices.push({ id: 'recirculator', kind: 'fan', roomId: 'a', on: true }, { id: 'filter', kind: 'purifier', roomId: 'b', on: true });
    const { engine, config } = isolated(plan), state = engine.createState(config), report = engine.snapshot(state, config);
    expect(report.powerWatts).toBe(P.circulationFanWatts + 40); expect(report.heatBudgetW.appliances).toBe(90); expect(report.fanEnergyWh).toBe(0);
    const after = engine.step(state, config, 60), final = engine.snapshot(after, config);
    expect(final.averagePm25).toBeLessThan(20); expect(final.storedEnergyJ - report.storedEnergyJ).toBeCloseTo(5400, 5);
    expect(final.energyWh).toBeCloseTo(1.5, 10); expect(Math.abs(final.energyResidualJ)).toBeLessThan(1e-6);
  });
  test('multiple declared air conditioners have additive capacity and electricity', () => {
    const plan = example(); plan.devices.push({ id: 'coolerOne', kind: 'ac', roomId: 'a', on: true }, { id: 'coolerTwo', kind: 'ac', roomId: 'a', on: true });
    const { engine, config } = isolated(plan); config.base.acSetpoint = 20;
    const state = engine.createState(config), both = engine.snapshot(state, config);
    config.base.devices.coolerTwo = false; const one = engine.snapshot(state, config);
    expect(both.heatBudgetW.ac).toBe(2 * one.heatBudgetW.ac); expect(both.powerWatts).toBe(2 * one.powerWatts);
  });
  test('supports plans without exterior openings and retains canonical wrapper behavior', () => {
    const plan = example(); plan.openings = [];
    const { engine, config } = isolated(plan), initial = engine.createState(config), after = engine.step(initial, config, 30);
    expect(after.lowerT).toEqual(initial.lowerT); expect(engine.snapshot(after, config).airChangesPerHour).toBe(0);
    const canonical = createThermalModel(), original = createThermalConfig(), a = createThermalState(original), b = canonical.createState(original);
    expect(canonical.step(b, original, 30)).toEqual(stepThermalState(a, original, 30));
  });
});
