import { model, type Conditions } from './domain';
import { PRIMARY_STANDING_FAN_ID, resolveStandingFans } from './standing-fans';

export type DeviceTarget = { kind: 'fan'; id: string } | { kind: 'purifier' };
export type DeviceAction = 'power' | 'left' | 'right' | 'remove';
export type BulkGroup = 'internal' | 'external' | 'ceiling' | 'standing';

export function changeDevice(conditions: Conditions, target: DeviceTarget, action: DeviceAction): void {
  if (target.kind === 'purifier') {
    const purifier = conditions.purifier;
    if (!purifier || action === 'remove') return;
    if (action === 'power') purifier.on = !purifier.on;
    else purifier.headingDeg = ((purifier.headingDeg ?? 0) + (action === 'left' ? 315 : 45)) % 360;
    return;
  }
  const fan = resolveStandingFans(conditions).find(item => item.id === target.id);
  if (!fan) return;
  if (action === 'remove') {
    if (fan.isPrimary) Object.assign(conditions.portableFan!, { on: false, removed: true });
    else conditions.standingFans = conditions.standingFans?.filter(item => item.id !== target.id);
  } else if (fan.id === PRIMARY_STANDING_FAN_ID) {
    if (action === 'power') { conditions.portableFan!.on = !fan.on; if (!fan.on && !fan.speed) conditions.portableFan!.speed = 2; }
    else conditions.portableFan!.headingDeg = (fan.angleDeg + (action === 'left' ? 315 : 45)) % 360;
  } else {
    const stored = conditions.standingFans!.find(item => item.id === target.id)!;
    if (action === 'power') { stored.on = !fan.on; if (!fan.on && !fan.speed) stored.speed = 2; }
    else stored.angleDeg = (fan.angleDeg + (action === 'left' ? 315 : 45)) % 360;
  }
}

export function setBulkControls(conditions: Conditions, group: BulkGroup, on: boolean): void {
  if (group === 'internal' || group === 'external') {
    for (const box of model.boxes) {
      if (box.type !== 'door' && box.type !== 'window') continue;
      if (group === 'internal' ? box.type === 'door' && !box.exterior : box.exterior) {
        conditions[box.type === 'door' ? 'doors' : 'windows'][box.name] = on;
      }
    }
  } else if (group === 'ceiling') {
    for (const id of Object.keys(conditions.devices)) if (id.startsWith('fan_')) conditions.devices[id] = on;
  } else {
    if (conditions.portableFan && !conditions.portableFan.removed) {
      conditions.portableFan.on = on;
      if (on && !conditions.portableFan.speed) conditions.portableFan.speed = 2;
    }
    for (const fan of conditions.standingFans ?? []) { fan.on = on; if (on && !fan.speed) fan.speed = 2; }
  }
}
