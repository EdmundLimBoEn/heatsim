import { model } from './domain';
import type { ThermalComparisonResult } from './thermal-comparison';
import { THERMAL_ASSUMPTIONS, THERMAL_MODEL_ID, THERMAL_MODEL_PARAMETERS } from './thermal-model';
import type { ThermalHeatBudget, ThermalSnapshot } from './thermal-types';

const COLUMNS = [
  'record', 'run_id', 'elapsed_s', 'room', 'parameter', 'value', 'unit',
  'air_temperature_c', 'lower_temperature_c', 'upper_temperature_c', 'surface_temperature_c',
  'pm25_ug_m3', 'upper_pm25_ug_m3', 'vent_flow_m3_h', 'buoyancy_exchange_m3_h', 'wall_to_air_w',
  'fan_power_w', 'power_w', 'energy_wh', 'stored_energy_j', 'energy_residual_j',
  'mass_residual_m3_s', 'pm_exposure_ug_h_m3', 'solar_w', 'people_w', 'conduction_w',
  'radiation_w', 'ventilation_heat_w', 'ac_w', 'fan_heat_w', 'appliances_w', 'net_heat_w',
] as const;
type Column = typeof COLUMNS[number];
type CsvRow = Partial<Record<Column, string | number>>;

export function thermalComparisonCsv(report: ThermalComparisonResult): string {
  const rows: CsvRow[] = [];
  const { config, initialState } = report;
  const number = (value: number): number => {
    if (!Number.isFinite(value)) throw new Error('Cooling Lab export contains a non-finite value. Run the comparison again.');
    return value;
  };
  const metadata = (parameter: string, value: string | number, unit = '') => rows.push({ record: 'metadata', run_id: 'shared', parameter, value, unit });
  const baseJson = JSON.stringify(config.base, (_key, value: unknown) => typeof value === 'number' ? number(value) : value);
  metadata('model', 'HeatSim Cooling Lab: qualitative two-layer heat-balance model');
  metadata('model_id', THERMAL_MODEL_ID);
  metadata('model_parameters_json', JSON.stringify(THERMAL_MODEL_PARAMETERS), 'JSON; units in parameter names');
  metadata('model_assumptions_json', JSON.stringify(THERMAL_ASSUMPTIONS), 'JSON');
  metadata('disclaimer', 'SIMULATED, uncalibrated educational comparison; not 3D CFD or measured performance. No latent moisture load, dehumidification or health prediction.');
  metadata('comparison', 'Identical initial state, openings, envelope, outdoor conditions and duration. Only the selected ventilation fan is switched off/on.');
  metadata('fan_adapter', 'The selected opening contains the same adapter with a sealed surround and passively open fan passage in both runs, including fan-off, regardless of its base window flag. Other openings retain their base settings.');
  metadata('difference_sign', 'fan_on minus fan_off; a negative temperature difference means the fan-on run is cooler.');
  metadata('trace_mean', 'air_temperature_c is the all-air mean, not the lower layer. Upper/surface temperatures and PM2.5 traces are model-wide means. final_room rows contain individual room values.');
  metadata('flow', 'Trace/final-summary vent_flow_m3_h is actual selected-fan flow, signed relative to the selected mode; negative means backflow. final_room flow is room exchange. Neither is the fan rating.');
  metadata('heat_budget', 'Heat-budget columns are instantaneous final rates, not integrated energy. Positive adds heat; negative removes heat.');
  metadata('pm_exposure', 'Time-integrated model-wide PM2.5 concentration, not inhaled dose or a health-risk estimate.');
  metadata('geometry', 'assets/hdb-3d/hdb_4room_boxes.json; state arrays follow this file\'s rooms order.');
  metadata('base_conditions_json', baseJson, 'JSON');
  metadata('scenario', config.base.scenarioId ?? 'baseline');
  metadata('outdoor_temperature', config.base.outdoorTemperature, 'degC');
  metadata('outdoor_pm25', config.base.outdoorPm25, 'ug/m3');
  metadata('humidity', config.base.humidity, '% RH (fixed scenario value)');
  metadata('wind_speed', config.base.windSpeed, 'm/s');
  metadata('time_of_day', config.base.timeOfDay, 'hour');
  metadata('vent_opening', config.vent.opening);
  metadata('vent_mode', config.vent.mode);
  metadata('vent_rated_flow', config.vent.ratedM3h, 'm3/h');
  metadata('exterior_face_to_interior_surface_conductance', config.envelope.uValue, 'W/(m2 K), not rated whole-wall U-value');
  metadata('solar_absorptance', config.envelope.solarAbsorptance, 'fraction');
  metadata('shade_fraction', config.envelope.shadeFraction, 'fraction');
  metadata('requested_duration', config.durationSeconds, 's');
  metadata('actual_comparison_duration', report.durationSeconds, 's');
  metadata('computation_runtime', report.runtimeMs, 'ms (wall clock)');
  metadata('initial_state_energy', initialState.initialEnergyJ, 'J');
  metadata('initial_state_net_heat', initialState.netHeatJ, 'J');
  metadata('initial_state_electrical_energy', initialState.electricalEnergyWh, 'Wh');
  for (const values of [initialState.lowerT, initialState.upperT, initialState.wallT, initialState.lowerPm25, initialState.upperPm25]) {
    if (values.length !== model.rooms.length) throw new Error('Cooling Lab initial state does not match the model rooms.');
  }
  model.rooms.forEach((room, index) => rows.push({
    record: 'initial_state', run_id: 'shared', elapsed_s: initialState.elapsedSeconds, room: room.name,
    lower_temperature_c: initialState.lowerT[index], upper_temperature_c: initialState.upperT[index],
    surface_temperature_c: initialState.wallT[index], pm25_ug_m3: initialState.lowerPm25[index], upper_pm25_ug_m3: initialState.upperPm25[index],
  }));

  function summary(snapshot: ThermalSnapshot): CsvRow {
    return {
      elapsed_s: snapshot.elapsedSeconds,
      air_temperature_c: snapshot.averageTemperature, upper_temperature_c: snapshot.averageUpperTemperature,
      surface_temperature_c: snapshot.averageSurfaceTemperature, pm25_ug_m3: snapshot.averagePm25,
      vent_flow_m3_h: snapshot.actualVentM3h, fan_power_w: snapshot.fanPowerWatts, power_w: snapshot.powerWatts,
      energy_wh: snapshot.energyWh, stored_energy_j: snapshot.storedEnergyJ,
      energy_residual_j: snapshot.energyResidualJ, mass_residual_m3_s: snapshot.maxMassResidualM3s,
    };
  }
  function heatBudget(budget: ThermalHeatBudget): CsvRow {
    return {
      solar_w: budget.solar, people_w: budget.people, conduction_w: budget.conduction, radiation_w: budget.radiation,
      ventilation_heat_w: budget.ventilation, ac_w: budget.ac, fan_heat_w: budget.fan, appliances_w: budget.appliances, net_heat_w: budget.net,
    };
  }
  if (!report.off.samples.length || report.off.samples.length !== report.on.samples.length) {
    throw new Error('Cooling Lab traces do not have matching samples.');
  }
  report.off.samples.forEach((off, index) => {
    const on = report.on.samples[index];
    if (Math.abs(off.elapsedSeconds - on.elapsedSeconds) > 1e-6) throw new Error('Cooling Lab traces do not have matching timestamps.');
    rows.push({ record: 'trace', run_id: 'fan_off', ...summary(off) }, { record: 'trace', run_id: 'fan_on', ...summary(on) });
  });
  for (const [runId, run] of [['fan_off', report.off], ['fan_on', report.on]] as const) {
    rows.push({
      record: 'final_summary', run_id: runId, ...summary(run.final), pm_exposure_ug_h_m3: run.pmExposureUgHoursM3,
      ...heatBudget(run.final.heatBudgetW),
    });
    for (const room of run.final.rooms) rows.push({
      record: 'final_room', run_id: runId, elapsed_s: run.final.elapsedSeconds, room: room.room,
      lower_temperature_c: room.lowerTemperature, upper_temperature_c: room.upperTemperature,
      surface_temperature_c: room.surfaceTemperature, pm25_ug_m3: room.pm25,
      vent_flow_m3_h: room.ventilationM3h, buoyancy_exchange_m3_h: room.buoyancyExchangeM3h, wall_to_air_w: room.wallToAirWatts,
    });
  }
  const difference = report.difference;
  rows.push({
    record: 'difference', run_id: 'on_minus_off', elapsed_s: report.on.final.elapsedSeconds,
    air_temperature_c: difference.averageTemperature, upper_temperature_c: difference.averageUpperTemperature,
    pm25_ug_m3: difference.averagePm25, stored_energy_j: difference.storedEnergyJ,
    energy_wh: difference.energyWh, pm_exposure_ug_h_m3: difference.pmExposureUgHoursM3,
    ...heatBudget(difference.heatBudgetW),
  });
  function cell(value: string | number | undefined): string {
    const text = value === undefined ? '' : String(typeof value === 'number' ? number(value) : value);
    return `"${text.replaceAll('"', '""')}"`;
  }
  return [COLUMNS.map(cell).join(','), ...rows.map(row => COLUMNS.map(column => cell(row[column])).join(','))].join('\r\n');
}
