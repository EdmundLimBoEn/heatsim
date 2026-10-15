import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CONTRACTOR_EXAMPLES, CONTRACTOR_PLAN_MAX_BYTES, ContractorPlanError, contractorPlanGeometryId, parseContractorPlan, previewOpeningSegment } from '../src/contractor-plan';

function sample() {
  return {
    version: 1, id: 'sample', name: 'Two rooms', heightM: 2.7,
    rooms: [{ id: 'west', label: 'West', x: 0, z: 0, widthM: 4, depthM: 4 }, { id: 'east', label: 'East', x: 4, z: 0, widthM: 4, depthM: 4 }],
    openings: [{ id: 'join', kind: 'door', roomA: 'west', roomB: 'east' as string | null, side: 'E', offsetM: 1, widthM: 0.9, sillM: 0, heightM: 2.1 }],
    devices: [{ id: 'fan', kind: 'fan', roomId: 'west' }],
  };
}

describe('ContractorPlan v1 validation', () => {
  it('normalizes only the documented defaults without mutating the input', () => {
    const input = sample(), saved = JSON.stringify(input), plan = parseContractorPlan(input);
    expect(plan.northDegrees).toBe(0); expect(plan.openings[0].open).toBe(true); expect(plan.devices[0].on).toBe(false);
    expect(JSON.stringify(input)).toBe(saved);
    expect(parseContractorPlan(JSON.stringify(input))).toEqual(plan);
  });
  it('rejects invalid or oversized JSON before accepting a plan', () => {
    expect(() => parseContractorPlan('{')).toThrow(ContractorPlanError);
    expect(() => parseContractorPlan(' '.repeat(CONTRACTOR_PLAN_MAX_BYTES + 1))).toThrow('1 MiB');
    expect(() => parseContractorPlan(null)).toThrow('object');
  });
  it('rejects unknown fields and unsupported versions', () => {
    expect(() => parseContractorPlan({ ...sample(), pixels: true })).toThrow('unsupported field');
    expect(() => parseContractorPlan({ ...sample(), version: 2 })).toThrow('version 1');
    const input = sample(); Object.assign(input.rooms[0], { rotation: 20 });
    expect(() => parseContractorPlan(input)).toThrow('unsupported field');
  });
  it.each(['constructor', '__proto__', 'prototype', 'toString', 'bad id', '<script>'])('rejects unsafe ID %s', id => {
    const input = sample(); input.rooms[0].id = id;
    expect(() => parseContractorPlan(input)).toThrow('safe ID');
  });
  it('rejects duplicate IDs across rooms, openings and devices', () => {
    const input = sample(); input.devices[0].id = 'west';
    expect(() => parseContractorPlan(input)).toThrow('duplicate ID');
  });
  it.each([NaN, Infinity, -Infinity, -1, 0])('rejects invalid room dimensions %s', widthM => {
    const input = sample(); input.rooms[0].widthM = widthM;
    expect(() => parseContractorPlan(input)).toThrow('finite number');
  });
  it('bounds room, opening and device counts', () => {
    const input = sample();
    expect(() => parseContractorPlan({ ...input, rooms: [] })).toThrow('1–24');
    expect(() => parseContractorPlan({ ...input, rooms: Array(25).fill(input.rooms[0]) })).toThrow('1–24');
    expect(() => parseContractorPlan({ ...input, openings: Array(65).fill(input.openings[0]) })).toThrow('0–64');
    expect(() => parseContractorPlan({ ...input, devices: Array(49).fill(input.devices[0]) })).toThrow('0–48');
  });
  it('rejects positive-area room overlap while allowing shared walls', () => {
    const input = sample(); input.rooms[1].x = 3.9;
    expect(() => parseContractorPlan(input)).toThrow('overlaps');
    expect(parseContractorPlan(sample()).rooms).toHaveLength(2);
  });
  it('requires each interior opening to fit the correct shared wall', () => {
    const input = sample(); input.openings[0].side = 'N';
    expect(() => parseContractorPlan(input)).toThrow('shared wall');
    input.openings[0].side = 'E'; input.rooms[1].z = 1.5;
    expect(() => parseContractorPlan(input)).toThrow('shared wall');
  });
  it('rejects outside openings facing even a partially occupied neighbour', () => {
    const input = sample(); input.openings[0].roomB = null;
    expect(() => parseContractorPlan(input)).toThrow('occupied neighbour');
    input.rooms[1].z = 1.5;
    expect(() => parseContractorPlan(input)).toThrow('occupied neighbour');
  });
  it('rejects apertures past the wall or above the ceiling', () => {
    const input = sample(); input.openings[0].offsetM = 3.5;
    expect(() => parseContractorPlan(input)).toThrow('beyond its wall');
    input.openings[0].offsetM = 1; input.openings[0].sillM = 1;
    expect(() => parseContractorPlan(input)).toThrow('above the ceiling');
  });
  it('rejects overlapping openings, including reversed roomA/roomB declarations', () => {
    const input = sample(); input.openings.push({ ...input.openings[0], id: 'reverse', roomA: 'east', roomB: 'west', side: 'W' });
    expect(() => parseContractorPlan(input)).toThrow('overlaps');
  });
  it('rejects unknown room references and unsupported control values', () => {
    const input = sample(); input.devices[0].roomId = 'missing';
    expect(() => parseContractorPlan(input)).toThrow('unknown room');
    input.devices[0].roomId = 'west'; Object.assign(input.openings[0], { open: 'yes' });
    expect(() => parseContractorPlan(input)).toThrow('true or false');
  });
  it('rejects closed passages and infinitesimal apertures that destabilize airflow', () => {
    const input = sample(); input.openings[0].kind = 'passage'; Object.assign(input.openings[0], { open: false });
    expect(() => parseContractorPlan(input)).toThrow('passage');
    delete (input.openings[0] as { open?: boolean }).open;
    input.openings[0].widthM = 1e-14;
    expect(() => parseContractorPlan(input)).toThrow('0.01');
    input.openings[0].widthM = 0.9; input.openings[0].heightM = 1e-14;
    expect(() => parseContractorPlan(input)).toThrow('0.01');
  });
  it('computes actual wall segments and validates north rotation', () => {
    const plan = parseContractorPlan(sample());
    expect(previewOpeningSegment(plan, 'join')).toEqual({ start: [4, 1], end: [4, 1.9], normal: [1, 0] });
    expect(() => parseContractorPlan({ ...sample(), northDegrees: 360 })).toThrow('less than 360');
    expect(parseContractorPlan({ ...sample(), northDegrees: 90 }).northDegrees).toBe(90);
  });
  it('has a stable nonsecurity input fingerprint for normalized reordered arrays', () => {
    const a = parseContractorPlan(sample()), b = structuredClone(a);
    b.rooms.reverse();
    expect(contractorPlanGeometryId(a)).toBe(contractorPlanGeometryId(b));
    b.rooms.find(room => room.id === 'east')!.widthM = 5;
    expect(contractorPlanGeometryId(a)).not.toBe(contractorPlanGeometryId(b));
  });
  it('ships three valid examples with genuinely different room geometry and 60–100m² areas', () => {
    const plans = CONTRACTOR_EXAMPLES.map(example => parseContractorPlan(readFileSync(new URL(`../public${example.url}`, import.meta.url), 'utf8')));
    expect(plans.map(plan => plan.rooms.reduce((area, room) => area + room.widthM * room.depthM, 0))).toEqual([80, 72, 84]);
    expect(new Set(plans.map(plan => JSON.stringify(plan.rooms.map(({ x, z, widthM, depthM }) => ({ x, z, widthM, depthM }))))).size).toBe(3);
    expect(plans[1].openings.filter(opening => opening.roomB === null).every(opening => opening.side === 'E')).toBe(true);
    expect(plans[2].openings.some(opening => opening.kind === 'passage')).toBe(true);
  });
});
