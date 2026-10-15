import { expect, test } from 'vitest';
import { defaultConditions, model } from '../src/domain';
import { changeDevice, setBulkControls } from '../src/device-actions';
import { resolveStandingFans } from '../src/standing-fans';
import { createSimulation, stepSimulation } from '../src/plan-simulation';

test('fan quick actions rotate, enable a stopped fan, and delete even the Main fan', () => {
  const state = defaultConditions(); state.portableFan!.speed = 0;
  changeDevice(state, { kind: 'fan', id: 'primary' }, 'power');
  expect(resolveStandingFans(state)[0]).toMatchObject({ on: true, speed: 2 });
  changeDevice(state, { kind: 'fan', id: 'primary' }, 'left');
  expect(resolveStandingFans(state)[0].angleDeg).toBe(315);
  changeDevice(state, { kind: 'fan', id: 'primary' }, 'right');
  expect(resolveStandingFans(state)[0].angleDeg).toBe(0);
  changeDevice(state, { kind: 'fan', id: 'primary' }, 'remove');
  expect(resolveStandingFans(state)).toEqual([]);
  expect(createSimulation(state).powerWatts).toBe(0);
  setBulkControls(state, 'standing', true);
  expect(resolveStandingFans(state)).toEqual([]);
});

test('internal and exterior groups preserve each other and unrelated devices', () => {
  const state = defaultConditions(); state.devices.ac_living = true;
  setBulkControls(state, 'internal', true);
  expect(state.doors.main_door).toBe(false);
  expect(Object.values(state.windows).every(value => !value)).toBe(true);
  for (const box of model.boxes.filter(box => box.type === 'door' && !box.exterior)) expect(state.doors[box.name]).toBe(true);
  setBulkControls(state, 'external', true);
  expect(state.doors.main_door).toBe(true);
  expect(Object.values(state.windows).every(Boolean)).toBe(true);
  setBulkControls(state, 'internal', false);
  expect(state.doors.main_door).toBe(true);
  setBulkControls(state, 'ceiling', true);
  expect(state.devices.ac_living).toBe(true);
  expect(Object.entries(state.devices).filter(([id]) => id.startsWith('fan_')).every(([, on]) => on)).toBe(true);
});

test('purifier rotation is visual only and power still controls cleaning', () => {
  const state = defaultConditions();
  changeDevice(state, { kind: 'purifier' }, 'power');
  const before = createSimulation(state);
  changeDevice(state, { kind: 'purifier' }, 'right');
  expect(state.purifier).toMatchObject({ on: true, headingDeg: 45 });
  const after = stepSimulation(before, state, 0);
  expect(after.field!.ux).toEqual(before.field!.ux);
  expect(after.powerWatts).toBe(40);
});
