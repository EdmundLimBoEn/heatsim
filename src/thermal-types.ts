import type { Conditions } from './domain';

export interface ThermalConfig {
  base: Conditions;
  vent: { opening: string; on: boolean; mode: 'exhaust' | 'supply'; ratedM3h: number };
  envelope: { uValue: number; solarAbsorptance: number; shadeFraction: number };
  durationSeconds: number;
}
export interface ThermalState {
  elapsedSeconds: number;
  lowerT: Float64Array; upperT: Float64Array; wallT: Float64Array;
  lowerPm25: Float64Array; upperPm25: Float64Array;
  initialEnergyJ: number; netHeatJ: number; electricalEnergyWh: number;
}
export interface ThermalHeatBudget {
  solar: number; people: number; conduction: number; radiation: number;
  ventilation: number; ac: number; fan: number; appliances: number; net: number;
}
export interface ThermalRoomReading {
  room: string; lowerTemperature: number; upperTemperature: number; surfaceTemperature: number;
  pm25: number; ventilationM3h: number; buoyancyExchangeM3h: number; wallToAirWatts: number;
}
export interface ThermalSnapshot {
  elapsedSeconds: number; rooms: ThermalRoomReading[];
  averageTemperature: number; averageUpperTemperature: number; averageSurfaceTemperature: number; averagePm25: number;
  actualVentM3h: number; fanPowerWatts: number; powerWatts: number; energyWh: number;
  heatBudgetW: ThermalHeatBudget;
  storedEnergyJ: number; energyResidualJ: number; maxMassResidualM3s: number;
}
