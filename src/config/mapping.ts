export const HARDWARE_OPENINGS = {
  WIN1: 'window_bedroom3_1',
  WIN2: 'window_living_1',
  WIN3: 'window_living_3',
  DOOR1: 'main_door',
  DOOR2: 'door_bedroom3',
} as const;

export type HardwareOpeningKey = keyof typeof HARDWARE_OPENINGS;

export function openingForKey(key: string): { kind: 'window' | 'door'; id: string } | undefined {
  if (!Object.hasOwn(HARDWARE_OPENINGS, key)) return undefined;
  return {
    kind: key.startsWith('WIN') ? 'window' : 'door',
    id: HARDWARE_OPENINGS[key as HardwareOpeningKey],
  };
}

export function keyForOpening(id: string): HardwareOpeningKey | undefined {
  return (Object.keys(HARDWARE_OPENINGS) as HardwareOpeningKey[])
    .find(key => HARDWARE_OPENINGS[key] === id);
}
