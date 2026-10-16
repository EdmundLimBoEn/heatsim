export const HARDWARE_OPENINGS = {
  WIN1: 'window_bedroom3_1',
  WIN2: 'window_living_1',
  WIN3: 'window_living_3',
  WIN4: 'window_bedroom3_2',
  WIN5: 'window_master_1',
  WIN6: 'window_master_bath',
  WIN7: 'window_bedroom2_1',
  WIN8: 'window_service_yard',
  WIN9: 'window_living_2',
  WIN10: 'window_master_2',
  WIN11: 'window_kitchen',
  DOOR1: 'main_door',
  DOOR2: 'door_bedroom3',
  DOOR3: 'door_master_bedroom',
  DOOR4: 'door_common_bath',
  DOOR5: 'door_bedroom2',
  DOOR6: 'door_master_bath',
  DOOR7: 'door_kitchen',
  DOOR8: 'door_service_yard',
  DOOR9: 'door_shelter',
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
