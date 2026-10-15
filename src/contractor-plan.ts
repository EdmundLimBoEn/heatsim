export interface ContractorRoom {
  id: string; label: string; x: number; z: number; widthM: number; depthM: number;
}
export interface ContractorOpening {
  id: string; kind: 'door' | 'window' | 'passage'; roomA: string; roomB: string | null;
  side: 'N' | 'E' | 'S' | 'W'; offsetM: number; widthM: number; sillM: number; heightM: number; open: boolean;
}
export interface ContractorDevice { id: string; kind: 'fan' | 'purifier' | 'ac'; roomId: string; on: boolean }
export interface ContractorPlan {
  version: 1; id: string; name: string; heightM: number; northDegrees: number;
  rooms: ContractorRoom[]; openings: ContractorOpening[]; devices: ContractorDevice[];
}
export interface OpeningSegment { start: [number, number]; end: [number, number]; normal: [number, number] }
export const CONTRACTOR_PLAN_MAX_BYTES = 1_048_576;
export const CONTRACTOR_EXAMPLES = [
  { name: 'Cross-ventilation apartment · 80 m²', url: '/study-examples/cross-ventilation.json' },
  { name: 'One-sided apartment · 72 m²', url: '/study-examples/one-sided.json' },
  { name: 'Open-plan apartment · 84 m²', url: '/study-examples/open-plan.json' },
] as const;

const idSchema = { type: 'string', pattern: '^[A-Za-z][A-Za-z0-9_-]{0,63}$' };
const numberSchema = (minimum: number, maximum: number) => ({ type: 'number', minimum, maximum });
export const CONTRACTOR_PLAN_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema', title: 'HeatSim ContractorPlan v1', type: 'object', additionalProperties: false,
  description: 'Metres. Rectangular, nonoverlapping rooms; axis-aligned wall openings. The application additionally checks shared walls, aperture overlap, unique safe IDs and a 1 MiB input limit. Illustrative plans are not construction drawings.',
  required: ['version', 'id', 'name', 'heightM', 'rooms', 'openings', 'devices'],
  properties: {
    version: { const: 1 }, id: idSchema, name: { type: 'string', minLength: 1, maxLength: 120 }, heightM: numberSchema(1.5, 10),
    northDegrees: { type: 'number', minimum: 0, exclusiveMaximum: 360, default: 0,
      description: 'Clockwise bearing of the plan local north (-z) from geographic north. World facade bearing = local cardinal bearing + northDegrees; a geographic north arrow in the plan rotates by -northDegrees.' },
    rooms: { type: 'array', minItems: 1, maxItems: 24, items: { $ref: '#/$defs/room' } },
    openings: { type: 'array', maxItems: 64, items: { $ref: '#/$defs/opening' } },
    devices: { type: 'array', maxItems: 48, items: { $ref: '#/$defs/device' } },
  },
  $defs: {
    room: { type: 'object', additionalProperties: false, required: ['id', 'label', 'x', 'z', 'widthM', 'depthM'], properties: {
      id: idSchema, label: { type: 'string', minLength: 1, maxLength: 120 }, x: numberSchema(-100, 100), z: numberSchema(-100, 100),
      widthM: numberSchema(0.5, 50), depthM: numberSchema(0.5, 50),
    } },
    opening: { type: 'object', additionalProperties: false, required: ['id', 'kind', 'roomA', 'roomB', 'side', 'offsetM', 'widthM', 'sillM', 'heightM'],
      allOf: [{ if: { properties: { kind: { const: 'passage' } }, required: ['kind'] }, then: { properties: { open: { const: true } } } }], properties: {
      id: idSchema, kind: { enum: ['door', 'window', 'passage'] }, roomA: idSchema, roomB: { anyOf: [idSchema, { type: 'null' }] },
      side: { enum: ['N', 'E', 'S', 'W'] }, offsetM: numberSchema(0, 50), widthM: numberSchema(0.01, 50),
      sillM: numberSchema(0, 10), heightM: numberSchema(0.01, 10), open: { type: 'boolean', default: true },
    } },
    device: { type: 'object', additionalProperties: false, required: ['id', 'kind', 'roomId'], properties: {
      id: idSchema, kind: { enum: ['fan', 'purifier', 'ac'] }, roomId: idSchema, on: { type: 'boolean', default: false },
    } },
  },
} as const;

export class ContractorPlanError extends Error {
  constructor(message: string) { super(message); this.name = 'ContractorPlanError'; }
}
const EPS = 1e-7;
function fail(path: string, message: string): never { throw new ContractorPlanError(`${path}: ${message}`); }
function object(value: unknown, path: string, allowed: readonly string[]): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) fail(path, 'expected an object');
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) fail(path, 'expected a plain JSON object');
  const result = value as Record<string, unknown>;
  for (const key of Object.keys(result)) if (!allowed.includes(key)) fail(`${path}.${key}`, 'unsupported field');
  return result;
}
function text(value: unknown, path: string): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 120) fail(path, 'expected 1–120 characters');
  return value;
}
function identifier(value: unknown, path: string): string {
  if (typeof value !== 'string' || !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(value)
    || Object.hasOwn(Object.prototype, value) || value === 'prototype') fail(path, 'expected a safe ID (letter followed by up to 63 letters, digits, underscores or hyphens)');
  return value;
}
function number(value: unknown, path: string, min: number, max: number, exclusiveMin = false): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || (exclusiveMin ? value <= min : value < min) || value > max) fail(path, `expected a finite number ${exclusiveMin ? 'greater than' : 'at least'} ${min} and at most ${max}`);
  return Object.is(value, -0) ? 0 : value;
}
function choice<T extends string>(value: unknown, path: string, choices: readonly T[]): T {
  if (typeof value !== 'string' || !choices.includes(value as T)) fail(path, `expected ${choices.join(', ')}`);
  return value as T;
}
function boolean(value: unknown, path: string, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  if (typeof value !== 'boolean') fail(path, 'expected true or false');
  return value;
}
function array(value: unknown, path: string, min: number, max: number): unknown[] {
  if (!Array.isArray(value) || value.length < min || value.length > max) fail(path, `expected ${min}–${max} items`);
  return value;
}
const overlaps = (a0: number, a1: number, b0: number, b1: number) => Math.min(a1, b1) - Math.max(a0, b0) > EPS;
const equal = (a: number, b: number) => Math.abs(a - b) <= EPS;

/** Coordinates are metres; offsets run west-to-east on N/S and north-to-south on E/W. */
export function previewOpeningSegment(plan: ContractorPlan, openingOrId: ContractorOpening | string): OpeningSegment {
  const opening = typeof openingOrId === 'string' ? plan.openings.find(item => item.id === openingOrId) : openingOrId;
  if (!opening) fail('opening', 'unknown opening ID');
  const room = plan.rooms.find(item => item.id === opening.roomA);
  if (!room) fail(`opening ${opening.id}`, 'unknown roomA');
  const { x, z, widthM: width, depthM: depth } = room;
  const { offsetM: offset, widthM: size } = opening;
  switch (opening.side) {
    case 'N': return { start: [x + offset, z], end: [x + offset + size, z], normal: [0, -1] };
    case 'S': return { start: [x + offset, z + depth], end: [x + offset + size, z + depth], normal: [0, 1] };
    case 'E': return { start: [x + width, z + offset], end: [x + width, z + offset + size], normal: [1, 0] };
    case 'W': return { start: [x, z + offset], end: [x, z + offset + size], normal: [-1, 0] };
  }
}
function wallContact(room: ContractorRoom, neighbour: ContractorRoom, side: ContractorOpening['side']): [number, number] | null {
  if (side === 'N' && equal(neighbour.z + neighbour.depthM, room.z)) return [neighbour.x, neighbour.x + neighbour.widthM];
  if (side === 'S' && equal(neighbour.z, room.z + room.depthM)) return [neighbour.x, neighbour.x + neighbour.widthM];
  if (side === 'E' && equal(neighbour.x, room.x + room.widthM)) return [neighbour.z, neighbour.z + neighbour.depthM];
  if (side === 'W' && equal(neighbour.x + neighbour.widthM, room.x)) return [neighbour.z, neighbour.z + neighbour.depthM];
  return null;
}

/** Rejects unsupported geometry rather than inferring walls, rooms or missing dimensions. */
export function parseContractorPlan(input: string | unknown): ContractorPlan {
  let value: unknown = input;
  let serialized: string;
  try { serialized = typeof input === 'string' ? input : JSON.stringify(input); }
  catch { return fail('plan', 'expected serializable JSON without cycles'); }
  if (typeof serialized !== 'string') fail('plan', 'expected a JSON object');
  if (new TextEncoder().encode(serialized).byteLength > CONTRACTOR_PLAN_MAX_BYTES) fail('plan', 'JSON exceeds the 1 MiB limit');
  if (typeof input === 'string') {
    try { value = JSON.parse(input); } catch { return fail('plan', 'invalid JSON'); }
  }
  const raw = object(value, 'plan', ['version', 'id', 'name', 'heightM', 'northDegrees', 'rooms', 'openings', 'devices']);
  if (raw.version !== 1) fail('plan.version', 'only version 1 is supported');
  const used = new Set<string>();
  const unique = (value: unknown, path: string) => {
    const id = identifier(value, path);
    if (used.has(id)) fail(path, `duplicate ID ${id}`);
    used.add(id); return id;
  };
  const plan: ContractorPlan = {
    version: 1, id: unique(raw.id, 'plan.id'), name: text(raw.name, 'plan.name'), heightM: number(raw.heightM, 'plan.heightM', 1.5, 10),
    northDegrees: raw.northDegrees === undefined ? 0 : number(raw.northDegrees, 'plan.northDegrees', 0, 360),
    rooms: [], openings: [], devices: [],
  };
  if (plan.northDegrees === 360) fail('plan.northDegrees', 'must be less than 360 degrees');
  plan.rooms = array(raw.rooms, 'plan.rooms', 1, 24).map((item, index) => {
    const path = `rooms[${index}]`, room = object(item, path, ['id', 'label', 'x', 'z', 'widthM', 'depthM']);
    return { id: unique(room.id, `${path}.id`), label: text(room.label, `${path}.label`), x: number(room.x, `${path}.x`, -100, 100), z: number(room.z, `${path}.z`, -100, 100),
      widthM: number(room.widthM, `${path}.widthM`, 0.5, 50), depthM: number(room.depthM, `${path}.depthM`, 0.5, 50) };
  });
  const rooms = new Map(plan.rooms.map(room => [room.id, room]));
  for (let i = 0; i < plan.rooms.length; i++) for (let j = i + 1; j < plan.rooms.length; j++) {
    const a = plan.rooms[i], b = plan.rooms[j];
    if (overlaps(a.x, a.x + a.widthM, b.x, b.x + b.widthM) && overlaps(a.z, a.z + a.depthM, b.z, b.z + b.depthM)) fail('rooms', `${a.id} overlaps ${b.id}`);
  }
  plan.openings = array(raw.openings, 'plan.openings', 0, 64).map((item, index) => {
    const path = `openings[${index}]`, opening = object(item, path, ['id', 'kind', 'roomA', 'roomB', 'side', 'offsetM', 'widthM', 'sillM', 'heightM', 'open']);
    const result: ContractorOpening = {
      id: unique(opening.id, `${path}.id`), kind: choice(opening.kind, `${path}.kind`, ['door', 'window', 'passage']),
      roomA: identifier(opening.roomA, `${path}.roomA`), roomB: opening.roomB === null ? null : identifier(opening.roomB, `${path}.roomB`),
      side: choice(opening.side, `${path}.side`, ['N', 'E', 'S', 'W']), offsetM: number(opening.offsetM, `${path}.offsetM`, 0, 50),
      widthM: number(opening.widthM, `${path}.widthM`, 0.01, 50), sillM: number(opening.sillM, `${path}.sillM`, 0, 10),
      heightM: number(opening.heightM, `${path}.heightM`, 0.01, 10), open: boolean(opening.open, `${path}.open`, true),
    };
    const room = rooms.get(result.roomA);
    if (result.kind === 'passage' && !result.open) fail(`${path}.open`, 'a passage has no closing leaf and must be open');
    if (!room) fail(`${path}.roomA`, 'unknown room');
    if (result.roomB === result.roomA) fail(`${path}.roomB`, 'must differ from roomA');
    if (result.roomB !== null && !rooms.has(result.roomB)) fail(`${path}.roomB`, 'unknown room');
    const horizontal = result.side === 'N' || result.side === 'S';
    if (result.offsetM + result.widthM > (horizontal ? room.widthM : room.depthM) + EPS) fail(path, 'opening extends beyond its wall');
    if (result.sillM + result.heightM > plan.heightM + EPS) fail(path, 'opening extends above the ceiling');
    const start = (horizontal ? room.x : room.z) + result.offsetM, end = start + result.widthM;
    if (result.roomB !== null) {
      const contact = wallContact(room, rooms.get(result.roomB)!, result.side);
      if (!contact || start < contact[0] - EPS || end > contact[1] + EPS) fail(path, 'opening must fit entirely on the shared wall with roomB');
    } else {
      for (const neighbour of plan.rooms) if (neighbour.id !== room.id) {
        const contact = wallContact(room, neighbour, result.side);
        if (contact && overlaps(start, end, contact[0], contact[1])) fail(path, `outside opening faces occupied neighbour ${neighbour.id}; specify roomB`);
      }
    }
    return result;
  });
  for (let i = 0; i < plan.openings.length; i++) for (let j = i + 1; j < plan.openings.length; j++) {
    const a = plan.openings[i], b = plan.openings[j];
    const sa = previewOpeningSegment(plan, a), sb = previewOpeningSegment(plan, b);
    const horizontal = a.side === 'N' || a.side === 'S', otherHorizontal = b.side === 'N' || b.side === 'S';
    const axis = horizontal ? 0 : 1, fixed = horizontal ? 1 : 0;
    if (horizontal === otherHorizontal && equal(sa.start[fixed], sb.start[fixed])
      && overlaps(sa.start[axis], sa.end[axis], sb.start[axis], sb.end[axis])
      && overlaps(a.sillM, a.sillM + a.heightM, b.sillM, b.sillM + b.heightM)) fail('openings', `${a.id} overlaps ${b.id}`);
  }
  plan.devices = array(raw.devices, 'plan.devices', 0, 48).map((item, index) => {
    const path = `devices[${index}]`, device = object(item, path, ['id', 'kind', 'roomId', 'on']);
    const result: ContractorDevice = { id: unique(device.id, `${path}.id`), kind: choice(device.kind, `${path}.kind`, ['fan', 'purifier', 'ac']),
      roomId: identifier(device.roomId, `${path}.roomId`), on: boolean(device.on, `${path}.on`, false) };
    if (!rooms.has(result.roomId)) fail(`${path}.roomId`, 'unknown room');
    return result;
  });
  return plan;
}

/** FNV-1a identifier for normalized plan content, not a security or collision-proof hash. */
export function contractorPlanGeometryId(plan: ContractorPlan): string {
  const byId = <T extends { id: string }>(values: T[]) => [...values].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const normalized = parseContractorPlan(plan);
  const canonical = JSON.stringify({ ...normalized, rooms: byId(normalized.rooms), openings: byId(normalized.openings), devices: byId(normalized.devices) });
  let hash = 0x811c9dc5;
  for (const byte of new TextEncoder().encode(canonical)) { hash ^= byte; hash = Math.imul(hash, 0x01000193); }
  return `plan-v1-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}
