import { deviceRoom, model, roomLabel, type Conditions, type SimulationResult } from './domain';
import { FAN_SLOTS, PURIFIER_SLOTS } from './config/slots';

function openingName(id: string): string {
  if (id === 'main_door') return 'the main entrance door';
  if (id.startsWith('door_')) return `the ${roomLabel(id.slice(5)).toLowerCase()} door`;
  const box = model.boxes.find(item => item.name === id);
  const room = id.startsWith('window_master_bath') ? 'master_bath' : id.startsWith('window_master_') ? 'master_bedroom' : id.replace(/^window_/, '').replace(/_\d+$/, '');
  const side = box?.wall?.replace('wall_ext_', '').toLowerCase() ?? '';
  return `the ${roomLabel(room)} ${side ? `${side} ` : ''}window${/\d$/.test(id) ? ` ${id.slice(-1)}` : ''}`;
}

/** Describe only meaningful control changes; inactive device positions are not actions. */
export function describeAdviceChanges(before: Conditions, after: Conditions): string[] {
  const actions: string[] = [];
  const fan = after.portableFan;
  const previousFan = before.portableFan;
  if (fan?.on) {
    const place = roomLabel(FAN_SLOTS[fan.slot]?.room ?? 'living');
    const speed = ['stopped', 'low', 'medium', 'high'][fan.speed] ?? String(fan.speed);
    if (!previousFan?.on) actions.push(`Turn on the fan in ${place} (${speed})`);
    else if (previousFan.slot !== fan.slot) actions.push(`Move the fan to ${place} (${speed})`);
    else if (previousFan.speed !== fan.speed) actions.push(`Set the fan in ${place} to ${speed}`);
    if (previousFan?.on && previousFan.angleDeg !== fan.angleDeg) actions.push(`Turn the fan to ${fan.angleDeg}°`);
  } else if (previousFan?.on) actions.push('Turn off the portable fan');
  const purifier = after.purifier;
  if (purifier?.on) {
    const place = roomLabel(PURIFIER_SLOTS[purifier.slot]?.room ?? 'living');
    if (!before.purifier?.on) actions.push(`Turn on the purifier in ${place}`);
    else if (before.purifier.slot !== purifier.slot) actions.push(`Move the purifier to ${place}`);
  } else if (before.purifier?.on) actions.push('Turn off the portable purifier');
  for (const [id, on] of Object.entries(after.devices)) {
    if (on === Boolean(before.devices[id])) continue;
    const name = id.startsWith('ac_') ? 'air conditioning' : id.startsWith('fan_') ? 'ceiling fan' : 'fixed purifier';
    actions.push(`Turn ${on ? 'on' : 'off'} the ${name} in ${roomLabel(deviceRoom[id] ?? id)}`);
  }
  if (after.acSetpoint !== before.acSetpoint && Object.entries(after.devices).some(([id, on]) => id.startsWith('ac_') && on)) actions.push(`Set air conditioning to ${after.acSetpoint}°C`);
  for (const group of ['windows', 'doors'] as const) {
    for (const [id, open] of Object.entries(after[group])) if (open !== before[group][id]) actions.push(`${open ? 'Open' : 'Close'} ${openingName(id)}`);
  }
  return actions;
}

export function describeAdviceOutcome(before: SimulationResult, after: SimulationResult): string {
  const temperature = after.averageTemperature - before.averageTemperature;
  const particles = after.averagePm25 - before.averagePm25;
  const watts = after.powerWatts - before.powerWatts;
  const heat = Math.abs(temperature) < 0.05 ? 'about the same air temperature' : `${Math.abs(temperature).toFixed(1)}°C ${temperature < 0 ? 'cooler' : 'warmer'} air on average`;
  const haze = Math.abs(particles) <= Math.max(0.1, before.averagePm25 * 0.03) ? 'about the same haze' : `${Math.abs(particles).toFixed(1)} µg/m³ ${particles < 0 ? 'less' : 'more'} PM2.5`;
  const power = Math.abs(watts) < 0.5 ? 'the same device power' : `${Math.abs(watts).toFixed(0)} W ${watts < 0 ? 'less' : 'more'} device power`;
  return `${heat}; ${haze}; ${power}.`;
}

export function purifierMatches(a: Conditions, b: Conditions): boolean {
  return (a.purifier?.on ?? false) === (b.purifier?.on ?? false) && (a.purifier?.slot ?? 0) === (b.purifier?.slot ?? 0);
}
