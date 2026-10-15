import { model, type Conditions, type StandingFan } from './domain';
import { FAN_SLOTS, PURIFIER_SLOTS } from './config/slots';

export const PRIMARY_STANDING_FAN_ID = 'primary';
export const MAX_STANDING_FANS = 8;
export const MAX_ADDITIONAL_STANDING_FANS = MAX_STANDING_FANS - 1;
export const STANDING_FAN_CLEARANCE_M = 0.27;
export const PORTABLE_PURIFIER_CLEARANCE_M = 0.2;
export interface ResolvedStandingFan extends StandingFan { room: string; isPrimary: boolean }
export interface StandingFanPlacement { valid: boolean; room: string | null; reason: string }

const finite = (value: number | undefined, fallback: number) => Number.isFinite(value) ? value! : fallback;
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const heading = (value: number) => ((value % 360) + 360) % 360;
const roomAt = (x: number, z: number) => model.rooms.find(room => x >= room.min[0] && x <= room.max[0] && z >= room.min[2] && z <= room.max[2]);
const obstacles = model.boxes.filter(box => ['wall', 'furniture', 'door', 'window', 'device'].includes(box.type)
  && box.min[1] < 1.34 && box.max[1] > 0.04);

function geometryPlacement(x: number, z: number): StandingFanPlacement {
  const room = Number.isFinite(x) && Number.isFinite(z) ? roomAt(x, z) : undefined;
  if (!room) return { valid: false, room: null, reason: 'Place the fan on an indoor floor.' };
  for (let direction = 0; direction < 16; direction++) {
    const angle = direction * Math.PI / 8;
    if (!roomAt(x + STANDING_FAN_CLEARANCE_M * Math.cos(angle), z + STANDING_FAN_CLEARANCE_M * Math.sin(angle))) {
      return { valid: false, room: room.name, reason: 'Keep the entire fan inside the floorplan.' };
    }
  }
  // Doorways stay clear even when open, so a later switch change cannot trap a fan in a wall.
  for (const box of obstacles) {
    const nearX = clamp(x, box.min[0], box.max[0]), nearZ = clamp(z, box.min[2], box.max[2]);
    if (Math.hypot(x - nearX, z - nearZ) < STANDING_FAN_CLEARANCE_M - 1e-8) {
      return { valid: false, room: room.name, reason: 'Keep the fan clear of walls, furniture and doorways.' };
    }
  }
  return { valid: true, room: room.name, reason: '' };
}

function purifierCollision(x: number, z: number, conditions: Conditions): boolean {
  if (!conditions.purifier) return false;
  const index = clamp(Math.round(finite(conditions.purifier.slot, 0)), 0, PURIFIER_SLOTS.length - 1);
  const purifier = PURIFIER_SLOTS[index];
  return Math.hypot(x - purifier.x, z - purifier.z) < STANDING_FAN_CLEARANCE_M + PORTABLE_PURIFIER_CLEARANCE_M - 1e-8;
}

export function resolveStandingFans(conditions: Conditions): ResolvedStandingFan[] {
  const fans: ResolvedStandingFan[] = [], used = new Set([PRIMARY_STANDING_FAN_ID]);
  const primary = conditions.portableFan;
  if (primary) {
    const slot = FAN_SLOTS[clamp(Math.round(finite(primary.slot, 0)), 0, FAN_SLOTS.length - 1)];
    const position = primary.position;
    const placement = position ? geometryPlacement(position.x, position.z) : undefined;
    const custom = position && placement?.valid;
    // Original authored slots retain their established placement and numerical behavior.
    const point = custom ? position : slot;
    const legacyYaw = slot.baseYaw + clamp(finite(primary.angleDeg, 90), 0, 180) - 90;
    fans.push({ id: PRIMARY_STANDING_FAN_ID, x: point.x, z: point.z,
      angleDeg: heading(finite(primary.headingDeg, 180 - legacyYaw)), speed: clamp(finite(primary.speed, 0), 0, 3),
      on: primary.on === true, room: custom ? placement!.room! : slot.room, isPrimary: true });
  }
  if (!Array.isArray(conditions.standingFans)) return fans;
  for (const fan of conditions.standingFans.slice(0, MAX_ADDITIONAL_STANDING_FANS)) {
    if (!fan || typeof fan.id !== 'string' || !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(fan.id)
      || Object.hasOwn(Object.prototype, fan.id) || used.has(fan.id)) continue;
    used.add(fan.id);
    const placement = geometryPlacement(fan.x, fan.z);
    // Inter-device clearance belongs to editing validation, never to source activation.
    if (!placement.valid) continue;
    fans.push({ id: fan.id, x: fan.x, z: fan.z, angleDeg: heading(finite(fan.angleDeg, 0)),
      speed: clamp(finite(fan.speed, 0), 0, 3), on: fan.on === true, room: placement.room!, isPrimary: false });
  }
  return fans;
}

export function validateStandingFanPosition(x: number, z: number, conditions?: Conditions, excludeId?: string): StandingFanPlacement {
  const placement = geometryPlacement(x, z);
  if (!placement.valid || !conditions) return placement;
  if (purifierCollision(x, z, conditions)) return { ...placement, valid: false, reason: 'Leave space around the portable purifier.' };
  if (resolveStandingFans(conditions).some(fan => fan.id !== excludeId && Math.hypot(fan.x - x, fan.z - z) < 2 * STANDING_FAN_CLEARANCE_M - 1e-8)) {
    return { ...placement, valid: false, reason: 'Leave space between the standing fans.' };
  }
  return placement;
}

export function findStandingFanPosition(roomId: string, conditions: Conditions, excludeId?: string, near?: { x: number; z: number }): { x: number; z: number } | null {
  const room = model.rooms.find(room => room.name === roomId);
  if (!room) return null;
  const target = near && Number.isFinite(near.x) && Number.isFinite(near.z) ? near
    : { x: (room.min[0] + room.max[0]) / 2, z: (room.min[2] + room.max[2]) / 2 };
  const candidates = [target];
  for (let z = room.min[2] + STANDING_FAN_CLEARANCE_M; z <= room.max[2] - STANDING_FAN_CLEARANCE_M; z += 0.2) {
    for (let x = room.min[0] + STANDING_FAN_CLEARANCE_M; x <= room.max[0] - STANDING_FAN_CLEARANCE_M; x += 0.2) candidates.push({ x, z });
  }
  candidates.sort((a, b) => Math.hypot(a.x - target.x, a.z - target.z) - Math.hypot(b.x - target.x, b.z - target.z));
  return candidates.find(point => {
    const placement = validateStandingFanPosition(point.x, point.z, conditions, excludeId);
    return placement.valid && placement.room === roomId;
  }) ?? null;
}
