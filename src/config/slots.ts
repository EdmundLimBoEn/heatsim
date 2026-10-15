export interface DeviceSlot { room: string; x: number; z: number }
export interface FanSlot extends DeviceSlot { baseYaw: number }

export const FAN_SLOTS: FanSlot[] = [
  { room: 'bedroom3', x: 10, z: 1.6, baseYaw: 180 },
  { room: 'corridor', x: 8, z: 3.9, baseYaw: 90 },
  { room: 'living', x: 11.3, z: 5, baseYaw: 270 },
  { room: 'dining', x: 6.9, z: 6.9, baseYaw: 180 },
  { room: 'master_bedroom', x: 3.2, z: 1.8, baseYaw: 270 },
];

export const PURIFIER_SLOTS: DeviceSlot[] = [
  { room: 'living', x: 7.6, z: 4.75 },
  { room: 'master_bedroom', x: 3.4, z: 0.4 },
  { room: 'bedroom3', x: 11.5, z: 2.8 },
  { room: 'bedroom2', x: 8.3, z: 1.5 },
  { room: 'living', x: 11.5, z: 7 },
  { room: 'dining', x: 4.7, z: 7.1 },
];
