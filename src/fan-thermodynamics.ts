export const FAN_THERMODYNAMICS_DEFAULTS = {
  temperatureK: 303,
  absolutePressurePa: 101325,
  gamma: 1.4,
  densityKgM3: 1.17,
  specificHeatJKgK: 1005,
  flowM3s: 0,
  efficiency: 1,
} as const;

export interface FanThermodynamicsInput {
  pressureDifferencePa: number;
  temperatureK?: number;
  absolutePressurePa?: number;
  gamma?: number;
  densityKgM3?: number;
  specificHeatJKgK?: number;
  flowM3s?: number;
  efficiency?: number;
}

export interface FanThermodynamicsResult {
  idealOutletTemperatureK: number;
  idealStaticTemperatureDropK: number;
  airPowerW: number;
  electricalPowerW: number;
  heatToAirW: number;
  fanTemperatureRiseK: number | null;
}

/** Separate ideal-expansion and fan-energy examples; never a room-cooling correction.
 * Fan heating assumes all electrical input ultimately enters the air; zero flow has no outlet-temperature result.
 */
export function calculateFanThermodynamics(input: FanThermodynamicsInput): FanThermodynamicsResult {
  const {
    pressureDifferencePa,
    temperatureK = FAN_THERMODYNAMICS_DEFAULTS.temperatureK,
    absolutePressurePa = FAN_THERMODYNAMICS_DEFAULTS.absolutePressurePa,
    gamma = FAN_THERMODYNAMICS_DEFAULTS.gamma,
    densityKgM3 = FAN_THERMODYNAMICS_DEFAULTS.densityKgM3,
    specificHeatJKgK = FAN_THERMODYNAMICS_DEFAULTS.specificHeatJKgK,
    flowM3s = FAN_THERMODYNAMICS_DEFAULTS.flowM3s,
    efficiency = FAN_THERMODYNAMICS_DEFAULTS.efficiency,
  } = input;
  const values = { pressureDifferencePa, temperatureK, absolutePressurePa, gamma, densityKgM3, specificHeatJKgK, flowM3s, efficiency };
  for (const [name, value] of Object.entries(values)) {
    if (!Number.isFinite(value)) throw new RangeError(`${name} must be finite.`);
  }
  if (temperatureK <= 0 || absolutePressurePa <= 0 || densityKgM3 <= 0 || specificHeatJKgK <= 0) {
    throw new RangeError('Absolute temperature, absolute pressure, density and specific heat must be positive.');
  }
  if (gamma <= 1) throw new RangeError('The specific-heat ratio must exceed 1.');
  if (pressureDifferencePa < 0 || pressureDifferencePa >= absolutePressurePa) {
    throw new RangeError('Pressure difference must be nonnegative and below the starting absolute pressure.');
  }
  if (flowM3s < 0) throw new RangeError('Volume flow must be nonnegative.');
  if (efficiency <= 0 || efficiency > 1) throw new RangeError('Efficiency must be greater than 0 and at most 1.');

  const exponent = ((gamma - 1) / gamma) * Math.log1p(-pressureDifferencePa / absolutePressurePa);
  // log1p/expm1 preserve the very small temperature changes at ventilation pressures.
  const idealStaticTemperatureDropK = -temperatureK * Math.expm1(exponent);
  const airPowerW = flowM3s * pressureDifferencePa;
  const electricalPowerW = airPowerW / efficiency;
  const result: FanThermodynamicsResult = {
    idealOutletTemperatureK: temperatureK * Math.exp(exponent),
    idealStaticTemperatureDropK,
    airPowerW,
    electricalPowerW,
    heatToAirW: electricalPowerW,
    fanTemperatureRiseK: flowM3s === 0 ? null : pressureDifferencePa / densityKgM3 / specificHeatJKgK / efficiency,
  };
  if (Object.values(result).some(value => value !== null && !Number.isFinite(value)) || result.idealOutletTemperatureK <= 0) {
    throw new RangeError('These inputs exceed the numerical range of the calculator.');
  }
  return result;
}
