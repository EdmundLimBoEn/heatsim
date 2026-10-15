import { describe, expect, test } from 'vitest';
import { defaultConditions, type StandingFan } from '../src/domain';
import { FAN_SLOTS, PURIFIER_SLOTS } from '../src/config/slots';
import { findStandingFanPosition, MAX_ADDITIONAL_STANDING_FANS, resolveStandingFans, validateStandingFanPosition } from '../src/standing-fans';
import { createSimulation, preparePlanStep, stepSimulation } from '../src/plan-simulation';
import { packPlanCells } from '../src/plan-gpu';
import { createSimulation as createRoomSimulation, stepSimulation as stepRoomSimulation } from '../src/simulation';

function extra(id: string, x = 8, z = 3.9): StandingFan { return { id, x, z, angleDeg: 90, speed: 2, on: true }; }

describe('standing fan state and placement', () => {
  test('keeps all original main-fan slots and relative directions compatible', () => {
    for (const [index, slot] of FAN_SLOTS.entries()) {
      const config = defaultConditions(); config.portableFan = { slot: index, angleDeg: 45, speed: 2, on: true };
      expect(resolveStandingFans(config)).toEqual([{ id: 'primary', x: slot.x, z: slot.z, room: slot.room,
        angleDeg: ((180 - (slot.baseYaw + 45 - 90)) % 360 + 360) % 360, speed: 2, on: true, isPrimary: true }]);
      expect(validateStandingFanPosition(slot.x, slot.z, config, 'primary').valid).toBe(true);
    }
  });

  test('resolves continuous main position and absolute heading without changing legacy fields', () => {
    const config = defaultConditions(), original = structuredClone(config.portableFan!);
    config.portableFan!.position = { x: 8, z: 3.9 }; config.portableFan!.headingDeg = 450;
    const fan = resolveStandingFans(config)[0];
    expect(fan).toMatchObject({ x: 8, z: 3.9, room: 'corridor', angleDeg: 90 });
    expect(config.portableFan!.slot).toBe(original.slot); expect(config.portableFan!.angleDeg).toBe(original.angleDeg);
    config.portableFan!.position = { x: NaN, z: Infinity };
    expect(resolveStandingFans(config)[0]).toMatchObject({ x: FAN_SLOTS[0].x, z: FAN_SLOTS[0].z, room: 'bedroom3' });
  });

  test('rejects outside, wall, furniture, doorway and occupied placements with a reason', () => {
    const config = defaultConditions(); config.standingFans = [extra('second')];
    for (const [x, z] of [[NaN, 2], [30, 30], [0.05, 1], [11.3, 1], [9.3, 3.4], [8, 3.9], [11.5, 2.8]]) {
      if (x === 11.5) config.purifier = { on: false, slot: 2 };
      const placement = validateStandingFanPosition(x, z, config);
      expect(placement.valid).toBe(false); expect(placement.reason.length).toBeGreaterThan(0);
    }
    expect(validateStandingFanPosition(8, 3.9, config, 'second').valid).toBe(true);
  });

  test('finds separate valid default positions without mutating state', () => {
    const config = defaultConditions();
    for (const [index, room] of ['bedroom3', 'living', 'living', 'dining', 'bedroom2', 'master_bedroom', 'corridor'].entries()) {
      const before = structuredClone(config), position = findStandingFanPosition(room, config);
      expect(config).toEqual(before); expect(position).not.toBeNull();
      expect(validateStandingFanPosition(position!.x, position!.z, config)).toMatchObject({ valid: true, room });
      config.standingFans!.push(extra(`fan${index}`, position!.x, position!.z));
    }
    expect(resolveStandingFans(config)).toHaveLength(8);
    expect(findStandingFanPosition('missing-room', config)).toBeNull();
  });

  test('normalizes finite controls, rejects invalid IDs and positions, and caps total fan sources', () => {
    const config = defaultConditions();
    config.standingFans = [extra('second'), { ...extra('second'), x: 7.4 }, extra('primary'), extra('bad', Infinity, 2),
      { ...extra('third', 7.4), angleDeg: -90, speed: Infinity }, extra('constructor'), { ...extra('fourth', 6.8), speed: 20, angleDeg: NaN }];
    const fans = resolveStandingFans(config);
    expect(fans.map(fan => fan.id)).toEqual(['primary', 'second', 'third', 'fourth']);
    expect(fans.find(fan => fan.id === 'third')).toMatchObject({ angleDeg: 270, speed: 0 });
    expect(fans.find(fan => fan.id === 'fourth')).toMatchObject({ angleDeg: 0, speed: 3 });
    config.standingFans = Array.from({ length: 30 }, (_, index) => extra(`fan${index}`));
    expect(resolveStandingFans(config)).toHaveLength(1 + MAX_ADDITIONAL_STANDING_FANS);
  });

  test('existing source identity survives authoritative main-fan and purifier overlap', () => {
    const config = defaultConditions(); config.standingFans = [extra('second')];
    const original = resolveStandingFans(config).find(fan => fan.id === 'second');
    config.portableFan!.slot = 1;
    expect(resolveStandingFans(config).find(fan => fan.id === 'second')).toEqual(original);
    expect(validateStandingFanPosition(8, 3.9, config, 'primary').valid).toBe(false);
    const purifier = PURIFIER_SLOTS[2]; config.standingFans = [extra('corner', purifier.x, purifier.z)];
    const corner = resolveStandingFans(config).find(fan => fan.id === 'corner');
    expect(corner).toBeDefined(); config.purifier!.slot = 2;
    expect(resolveStandingFans(config).find(fan => fan.id === 'corner')).toEqual(corner);
    expect(validateStandingFanPosition(purifier.x, purifier.z, config, 'corner').valid).toBe(false);
  });
});

describe('multiple standing-fan numerical sources', () => {
  test('adds independent sources and power, responds to heading changes and retains running fields', () => {
    const config = defaultConditions(); config.portableFan!.on = true; config.standingFans = [extra('second')];
    const initial = createSimulation(config);
    expect(initial.powerWatts).toBe(100);
    const beforeFlow = initial.field!.ux.slice(); config.standingFans[0].angleDeg = 270;
    const turned = stepSimulation(initial, config, 0);
    expect(turned.field!.ux).not.toEqual(beforeFlow); expect(turned.field!.pm25).toEqual(initial.field!.pm25);
    config.standingFans[0].on = false;
    expect(stepSimulation(turned, config, 0).powerWatts).toBe(50);
    config.portableFan!.speed = 0;
    expect(stepSimulation(turned, config, 0).powerWatts).toBe(0);
  });

  test('moves the main source continuously and places extra sources in their own rooms', () => {
    const config = defaultConditions(); config.portableFan!.on = true;
    const initial = createSimulation(config);
    config.portableFan!.position = { x: 8, z: 3.9 }; config.portableFan!.headingDeg = 90;
    const moved = stepSimulation(initial, config, 0);
    const reading = (result: typeof moved, room: string) => result.rooms.find(value => value.room === room)!.airflow;
    expect(reading(moved, 'bedroom3')).toBeLessThan(1e-7);
    expect(reading(moved, 'corridor')).toBeGreaterThan(reading(initial, 'corridor') + 0.01);
    config.standingFans = [extra('bedroom', 10, 1.6)];
    const added = stepSimulation(moved, config, 0);
    expect(reading(added, 'bedroom3')).toBeGreaterThan(0.01); expect(added.powerWatts).toBe(100);
  });

  test('eight running fans keep uniform closed-room scalars bounded and mass-conserving', () => {
    const config = defaultConditions(); config.portableFan!.on = true; config.portableFan!.speed = 3;
    for (const [index, room] of ['bedroom3', 'living', 'living', 'dining', 'bedroom2', 'master_bedroom', 'corridor'].entries()) {
      const position = findStandingFanPosition(room, config)!;
      config.standingFans!.push({ ...extra(`fan${index}`, position.x, position.z), speed: 3, angleDeg: index * 45 });
    }
    const initial = createSimulation(config), prepared = preparePlanStep(initial, config, 30), packed = new DataView(packPlanCells(prepared));
    const after = stepSimulation(initial, config, 30);
    expect(after.powerWatts).toBe(400); expect(after.energyKwh).toBeCloseTo(400 * 30 / 3_600_000, 12);
    expect(prepared.dt).toBeLessThanOrEqual(prepared.flow.maxStep);
    const divergence = new Float64Array(initial.field!.pm25.length);
    for (let edge = 0; edge < prepared.flow.a.length; edge++) {
      const a = prepared.flow.a[edge], b = prepared.flow.b[edge], flow = prepared.flow.velocity[edge];
      divergence[a] += flow; if (prepared.flow.mask[b] === 0) divergence[b] -= flow;
    }
    expect(Math.max(...divergence.map(Math.abs))).toBeLessThan(1e-7);
    for (let cell = 0; cell < after.field!.pm25.length; cell++) {
      expect(Number.isFinite(after.field!.pm25[cell])).toBe(true);
      if (after.field!.cellType[cell] === 0) {
        expect(after.field!.pm25[cell]).toBeCloseTo(15, 4); expect(after.field!.temperature[cell]).toBeCloseTo(30, 4);
      }
      for (let face = 0; face < 4; face++) expect(Number.isFinite(packed.getFloat32(cell * 48 + 16 + face * 4, true))).toBe(true);
    }
  });

  test('emergency room model counts the same active extra fans and position override', () => {
    const config = defaultConditions(); config.portableFan!.on = true; config.portableFan!.position = { x: 8, z: 3.9 };
    config.standingFans = [extra('second', 10, 1.6)];
    const initial = createRoomSimulation(config), after = stepRoomSimulation(initial, config, 0);
    expect(after.powerWatts).toBe(100);
    expect(after.rooms.find(room => room.room === 'bedroom3')!.airflow).toBeGreaterThan(0.5);
    expect(after.rooms.find(room => room.room === 'corridor')!.airflow).toBeGreaterThan(0.5);
  });
});
