import rawModel from '../assets/hdb-3d/hdb_4room_boxes.json';

export type Vec3 = [number, number, number];
export interface Room { name: string; min: Vec3; max: Vec3; area_m2: number }
export interface ModelBox {
  name: string; type: string; min: Vec3; max: Vec3;
  exterior?: boolean; wall_axis?: string; wall?: string;
  hinge_point?: Vec3; openable?: boolean;
}
export interface Model { rooms: Room[]; boxes: ModelBox[]; ceiling_height: number; bounds: { min: Vec3; max: Vec3 }; total_floor_area_m2: number }
export const model = rawModel as unknown as Model;
export const MODEL_SCALE = 65;
export const roomLabel = (id: string): string => ({ bedroom2: 'Bedroom 2', bedroom3: 'Bedroom 3', corridor_lobby: 'Entrance lobby' }[id] ?? id.replaceAll('_', ' ').replace(/^./, c => c.toUpperCase()));

export interface Conditions {
  scenarioId?: string;
  portableFan?: { on: boolean; slot: number; angleDeg: number; speed: number };
  purifier?: { on: boolean; slot: number };
  outdoorTemperature: number;
  outdoorPm25: number;
  humidity: number;
  windSpeed: number;
  timeOfDay: number;
  acSetpoint: number;
  doors: Record<string, boolean>;
  windows: Record<string, boolean>;
  devices: Record<string, boolean>;
}
export interface RoomReading {
  room: string;
  temperature: number;
  feelsLike: number;
  airflow: number;
  pm25: number;
}
export interface SimulationResult {
  field?: PlanField;
  elapsedSeconds: number;
  rooms: RoomReading[];
  averageTemperature: number;
  averageFeelsLike: number;
  averagePm25: number;
  powerWatts: number;
  energyKwh: number;
}
export interface PlanField {
  nx: number; nz: number; dx: number; origin: [number, number];
  temperature: Float32Array; pm25: Float32Array;
  ux: Float32Array; uz: Float32Array; cellType: Uint8Array;
  pressure?: Float32Array;
}
export type ViewMode = 'temperature' | 'airflow' | 'pm25' | 'pressure' | 'model';
export interface ViewOptions {
  mode: ViewMode;
  cutaway: boolean;
  roofOpacity: number;
  labels: boolean;
  dimensions: boolean;
  selectedRoom: string | null;
}
export const defaultView: ViewOptions = { mode: 'model', cutaway: true, roofOpacity: 0, labels: true, dimensions: false, selectedRoom: null };
export const deviceRoom: Record<string, string> = {
  fan_living: 'living', fan_dining: 'dining', fan_master: 'master_bedroom', fan_bedroom2: 'bedroom2', fan_bedroom3: 'bedroom3',
  ac_living: 'living', ac_master: 'master_bedroom', ac_bedroom2: 'bedroom2', ac_bedroom3: 'bedroom3',
  purifier_living: 'living', purifier_master: 'master_bedroom'
};
export function defaultConditions(): Conditions {
  return {
    scenarioId: 'baseline',
    portableFan: { on: false, slot: 0, angleDeg: 90, speed: 2 },
    purifier: { on: false, slot: 0 },
    outdoorTemperature: 30, outdoorPm25: 20, humidity: 70, windSpeed: 1.8, timeOfDay: 12, acSetpoint: 25,
    doors: Object.fromEntries(model.boxes.filter(b => b.type === 'door').map(b => [b.name, false])),
    windows: Object.fromEntries(model.boxes.filter(b => b.type === 'window').map(b => [b.name, false])),
    devices: Object.fromEntries(Object.keys(deviceRoom).map(name => [name, false]))
  };
}
