import { model } from './domain';
import type { ThermalComparisonResult } from './thermal-comparison';
import { THERMAL_ASSUMPTIONS, THERMAL_MODEL_ID, THERMAL_MODEL_PARAMETERS } from './thermal-model';
import type { ThermalConfig, ThermalHeatBudget, ThermalSnapshot } from './thermal-types';

const COLUMNS = [
  'record', 'run_id', 'elapsed_s', 'room', 'parameter', 'value', 'unit',
  'air_temperature_c', 'lower_temperature_c', 'upper_temperature_c', 'surface_temperature_c',
  'pm25_ug_m3', 'upper_pm25_ug_m3', 'vent_flow_m3_h', 'interlayer_mixing_m3_h', 'wall_to_air_w',
  'boundary_air_changes_per_h', 'outdoor_inflow_m3_h', 'corridor_inflow_m3_h',
  'sensible_heat_removed_w', 'ventilation_heat_removed_j',
  'fan_power_w', 'fan_energy_wh', 'power_w', 'energy_wh', 'stored_energy_j', 'energy_residual_j',
  'mass_residual_m3_s', 'pm_exposure_ug_h_m3', 'solar_w', 'people_w', 'conduction_w',
  'radiation_w', 'ventilation_heat_w', 'ac_w', 'fan_heat_w', 'appliances_w', 'net_heat_w',
] as const;
type Column = typeof COLUMNS[number];
type CsvRow = Partial<Record<Column, string | number>>;

export function thermalComparisonCsv(report: ThermalComparisonResult): string {
  const rows: CsvRow[] = [];
  const { initialState, baselineConfig, candidateConfig: config } = report;
  const configurationMode = report.comparisonMode === 'configuration';
  const baselineId = configurationMode ? 'baseline' : 'fan_off';
  const candidateId = configurationMode ? 'candidate' : 'fan_on';
  const number = (value: number): number => {
    if (!Number.isFinite(value)) throw new Error('Cooling Lab export contains a non-finite value. Run the comparison again.');
    return value;
  };
  const metadata = (parameter: string, value: string | number, unit = '', runId = 'shared') => rows.push({ record: 'metadata', run_id: runId, parameter, value, unit });
  const json = (value: object) => JSON.stringify(value, (_key, cell: unknown) => typeof cell === 'number' ? number(cell) : cell);
  const environment = (settings: ThermalConfig) => ({
    scenarioId: settings.base.scenarioId ?? 'baseline', outdoorTemperature: settings.base.outdoorTemperature,
    outdoorPm25: settings.base.outdoorPm25, humidity: settings.base.humidity,
    windSpeed: settings.base.windSpeed, windFrom: settings.base.windFrom ?? 'scenario default',
    timeOfDay: settings.base.timeOfDay, corridor: settings.corridor ?? { enabled: false },
  });
  if (json(environment(baselineConfig)) !== json(environment(config)) || baselineConfig.durationSeconds !== config.durationSeconds || report.durationSeconds !== config.durationSeconds) {
    throw new Error('Cooling Lab comparison environments or durations differ. Run the comparison again.');
  }
  metadata('model', 'HeatSim Cooling Lab: qualitative two-layer heat-balance model');
  metadata('model_id', THERMAL_MODEL_ID);
  metadata('model_parameters_json', json(THERMAL_MODEL_PARAMETERS), 'JSON; units in parameter names');
  metadata('model_assumptions_json', json(THERMAL_ASSUMPTIONS), 'JSON');
  metadata('disclaimer', 'SIMULATED, uncalibrated educational comparison; not 3D CFD or measured performance. No latent moisture load, dehumidification or health prediction.');
  metadata('comparison_mode', report.comparisonMode);
  metadata('comparison', configurationMode
    ? 'Captured baseline hardware/envelope versus candidate hardware/envelope. Both runs use current candidate outdoor weather, corridor boundary, time of day, identical initial state and duration; captured baseline weather is not reused.'
    : 'Identical initial state, openings, envelope, outdoor conditions, corridor boundary and duration. Only the selected ventilation fan is switched off/on.');
  metadata('fan_adapter', 'Each actual configuration identifies its fan-adapter opening. That opening has a sealed surround and passively open fan passage, including when the fan is off, regardless of its base window flag. Other openings retain that configuration\'s settings.');
  metadata('difference_sign', `${candidateId} minus ${baselineId}; a negative temperature difference means the ${candidateId} run is cooler.`);
  metadata('varied_settings_json', json(report.variedSettings), 'JSON');
  metadata('trace_mean', 'air_temperature_c is the all-air mean, not the lower layer. Upper/surface temperatures and PM2.5 traces are model-wide means. final_room rows contain individual room values.');
  metadata('flow', 'Trace/final-summary vent_flow_m3_h is actual selected-fan flow, signed relative to the selected mode; negative means backflow. final_room flow is room exchange. Neither is the fan rating.');
  metadata('heat_budget', 'Heat-budget columns are instantaneous final rates, not integrated energy. Positive adds heat; negative removes heat.');
  metadata('heat_removed', 'sensible_heat_removed_w is the signed ventilation heat-removal rate; ventilation_heat_removed_j integrates that rate across all boundary exchange: natural and fan-driven, outdoor and corridor. Positive removes indoor heat, negative adds heat. This is sensible heat only, not AC performance.');
  metadata('fan_energy', 'fan_power_w and fan_energy_wh cover only the selected high-level ventilation fan. Portable/ceiling fans and other devices are included in total power_w and energy_wh.');
  metadata('air_changes', 'Boundary air changes per hour use incoming outdoor plus corridor flow once, divided by full air volume. Inlet and outlet are not added together. Room values exclude internal-room exchange.');
  metadata('interlayer_mixing', 'interlayer_mixing_m3_h includes background, unstable-layer and circulating-fan exchange; it is not a buoyancy-only flow.');
  metadata('pm_exposure', 'Time-integrated model-wide PM2.5 concentration, not inhaled dose or a health-risk estimate.');
  metadata('geometry', 'assets/hdb-3d/hdb_4room_boxes.json; state arrays follow this file\'s rooms order.');
  metadata('shared_environment_json', json(environment(config)), 'JSON');
  metadata('scenario', config.base.scenarioId ?? 'baseline');
  metadata('outdoor_temperature', config.base.outdoorTemperature, 'degC');
  metadata('outdoor_pm25', config.base.outdoorPm25, 'ug/m3');
  metadata('humidity', config.base.humidity, '% RH (fixed scenario value)');
  metadata('wind_speed', config.base.windSpeed, 'm/s');
  metadata('wind_from', config.base.windFrom ?? 'scenario default', 'cardinal direction the wind comes FROM; N means north-to-south');
  metadata('time_of_day', config.base.timeOfDay, 'hour');
  metadata('corridor_boundary', config.corridor?.enabled
    ? 'Prescribed main-door reservoir temperature/PM2.5, shared by both runs; floor pressure is zero with hydrostatic layer offsets. Not measured data or a simulated corridor volume.'
    : 'Disabled: the main door uses the outdoor boundary.');
  if (config.corridor?.enabled) {
    metadata('corridor_temperature', config.corridor.temperature, 'degC (prescribed)');
    metadata('corridor_pm25', config.corridor.pm25, 'ug/m3 (prescribed)');
  }
  for (const [runId, settings] of [[baselineId, baselineConfig], [candidateId, config]] as const) {
    metadata('actual_config_json', json(settings), 'JSON', runId);
    metadata('base_conditions_json', json(settings.base), 'JSON', runId);
    metadata('vent_opening', settings.vent.opening, '', runId);
    metadata('vent_mode', settings.vent.mode, '', runId);
    metadata('vent_on', Number(settings.vent.on), '0 off / 1 on', runId);
    metadata('vent_rated_flow', settings.vent.ratedM3h, 'm3/h', runId);
    metadata('exterior_face_to_interior_surface_conductance', settings.envelope.uValue, 'W/(m2 K), not rated whole-wall U-value', runId);
    metadata('solar_absorptance', settings.envelope.solarAbsorptance, 'fraction', runId);
    metadata('shade_fraction', settings.envelope.shadeFraction, 'fraction', runId);
  }
  metadata('requested_duration', config.durationSeconds, 's');
  metadata('actual_comparison_duration', report.durationSeconds, 's');
  metadata('computation_runtime', report.runtimeMs, 'ms (wall clock)');
  metadata('initial_state_energy', initialState.initialEnergyJ, 'J');
  metadata('initial_state_net_heat', initialState.netHeatJ, 'J');
  metadata('initial_state_electrical_energy', initialState.electricalEnergyWh, 'Wh');
  metadata('initial_state_fan_energy', initialState.fanEnergyWh ?? 0, 'Wh');
  metadata('initial_state_ventilation_heat_removed', initialState.ventilationHeatRemovedJ ?? 0, 'J');
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
      boundary_air_changes_per_h: snapshot.airChangesPerHour, outdoor_inflow_m3_h: snapshot.outdoorInflowM3h,
      corridor_inflow_m3_h: snapshot.corridorInflowM3h, sensible_heat_removed_w: snapshot.sensibleHeatRemovedWatts,
      ventilation_heat_removed_j: snapshot.ventilationHeatRemovedJ, fan_energy_wh: snapshot.fanEnergyWh,
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
    rows.push({ record: 'trace', run_id: baselineId, ...summary(off) }, { record: 'trace', run_id: candidateId, ...summary(on) });
  });
  for (const [runId, run] of [[baselineId, report.off], [candidateId, report.on]] as const) {
    rows.push({
      record: 'final_summary', run_id: runId, ...summary(run.final), pm_exposure_ug_h_m3: run.pmExposureUgHoursM3,
      ...heatBudget(run.final.heatBudgetW),
    });
    for (const room of run.final.rooms) rows.push({
      record: 'final_room', run_id: runId, elapsed_s: run.final.elapsedSeconds, room: room.room,
      lower_temperature_c: room.lowerTemperature, upper_temperature_c: room.upperTemperature,
      surface_temperature_c: room.surfaceTemperature, pm25_ug_m3: room.pm25,
      vent_flow_m3_h: room.ventilationM3h, interlayer_mixing_m3_h: room.buoyancyExchangeM3h, wall_to_air_w: room.wallToAirWatts,
      boundary_air_changes_per_h: room.boundaryAirChangesPerHour, outdoor_inflow_m3_h: room.outdoorInflowM3h, corridor_inflow_m3_h: room.corridorInflowM3h,
    });
  }
  const difference = report.difference;
  rows.push({
    record: 'difference', run_id: configurationMode ? 'candidate_minus_baseline' : 'on_minus_off', elapsed_s: report.on.final.elapsedSeconds,
    air_temperature_c: difference.averageTemperature, upper_temperature_c: difference.averageUpperTemperature,
    pm25_ug_m3: difference.averagePm25, stored_energy_j: difference.storedEnergyJ,
    energy_wh: difference.energyWh, pm_exposure_ug_h_m3: difference.pmExposureUgHoursM3,
    vent_flow_m3_h: difference.actualVentM3h, boundary_air_changes_per_h: difference.airChangesPerHour,
    sensible_heat_removed_w: difference.sensibleHeatRemovedWatts, ventilation_heat_removed_j: difference.ventilationHeatRemovedJ,
    fan_energy_wh: difference.fanEnergyWh,
    ...heatBudget(difference.heatBudgetW),
  });
  function cell(value: string | number | undefined): string {
    const text = value === undefined ? '' : String(typeof value === 'number' ? number(value) : value);
    return `"${text.replaceAll('"', '""')}"`;
  }
  return [COLUMNS.map(cell).join(','), ...rows.map(row => COLUMNS.map(column => cell(row[column])).join(','))].join('\r\n');
}
