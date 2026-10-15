import type { Conditions, Room } from './domain';

export interface ThermalConfig {
  base: Conditions;
  vent: { opening: string; on: boolean; mode: 'exhaust' | 'supply'; ratedM3h: number };
  envelope: { uValue: number; solarAbsorptance: number; shadeFraction: number };
  corridor?: { enabled: boolean; temperature: number; pm25: number };
  occupancyPeople?: number;
  initialTemperature?: number;
  initialPm25?: number;
  durationSeconds: number;
}
export interface ThermalState {
  modelId?: string;
  modelKey?: string;
  elapsedSeconds: number;
  lowerT: Float64Array; upperT: Float64Array; wallT: Float64Array;
  lowerPm25: Float64Array; upperPm25: Float64Array;
  initialEnergyJ: number; netHeatJ: number; electricalEnergyWh: number;
  fanEnergyWh?: number; ventilationHeatRemovedJ?: number;
}
export interface ThermalModelInstance {
  readonly id: string;
  readonly rooms: readonly Room[];
  readonly openings: readonly { name: string; room: string; label: string }[];
  createConfig(base?: Conditions): ThermalConfig;
  createState(config: ThermalConfig): ThermalState;
  validateState(state: ThermalState): void;
  step(state: ThermalState, config: ThermalConfig, deltaSeconds: number): ThermalState;
  snapshot(state: ThermalState, config: ThermalConfig): ThermalSnapshot;
}
export interface ThermalHeatBudget {
  solar: number; people: number; conduction: number; radiation: number;
  ventilation: number; ac: number; fan: number; appliances: number; net: number;
}
export interface ThermalRoomReading {
  room: string; lowerTemperature: number; upperTemperature: number; surfaceTemperature: number;
  pm25: number; ventilationM3h: number; buoyancyExchangeM3h: number; wallToAirWatts: number;
  boundaryAirChangesPerHour: number; outdoorInflowM3h: number; corridorInflowM3h: number;
}
export interface ThermalSnapshot {
  openingFlows?: ThermalOpeningFlow[];
  elapsedSeconds: number; rooms: ThermalRoomReading[];
  averageTemperature: number; averageUpperTemperature: number; averageSurfaceTemperature: number; averagePm25: number;
  actualVentM3h: number; fanPowerWatts: number; powerWatts: number; energyWh: number;
  airChangesPerHour: number; sensibleHeatRemovedWatts: number;
  fanEnergyWh: number; ventilationHeatRemovedJ: number;
  outdoorInflowM3h: number; corridorInflowM3h: number;
  heatBudgetW: ThermalHeatBudget;
  storedEnergyJ: number; energyResidualJ: number; maxMassResidualM3s: number;
}
export interface ThermalOpeningFlow {
  opening: string; roomA: string; roomB: string | null;
  lowerM3h: number; upperM3h: number; netM3h: number; grossM3h: number;
}
