import { describe, expect, test } from 'vitest';
import { defaultConditions, model } from '../src/domain';
import { thermalComparisonCsv } from '../src/thermal-export';
import { THERMAL_MODEL_ID } from '../src/thermal-model';
import type { ThermalComparisonResult } from '../src/thermal-comparison';
import type { ThermalConfig, ThermalSnapshot } from '../src/thermal-types';

function fixture(): ThermalComparisonResult {
  const initial: ThermalSnapshot = {
    elapsedSeconds: 0, averageTemperature: 30, averageUpperTemperature: 32, averageSurfaceTemperature: 31, averagePm25: 20,
    actualVentM3h: 0, fanPowerWatts: 0, powerWatts: 0, energyWh: 0, storedEnergyJ: 123456, energyResidualJ: 0, maxMassResidualM3s: 0,
    airChangesPerHour: 0, sensibleHeatRemovedWatts: 0, fanEnergyWh: 0, ventilationHeatRemovedJ: 0, outdoorInflowM3h: 0, corridorInflowM3h: 0,
    heatBudgetW: { solar: 10, people: 20, conduction: -5, radiation: 0, ventilation: 0, ac: 0, fan: 0, appliances: 0, net: 25 },
    rooms: model.rooms.map(room => ({ room: room.name, lowerTemperature: 30, upperTemperature: 32, surfaceTemperature: 31, pm25: 20, ventilationM3h: 0, buoyancyExchangeM3h: 10, wallToAirWatts: 5,
      boundaryAirChangesPerHour: 0, outdoorInflowM3h: 0, corridorInflowM3h: 0 })),
  };
  const offFinal = { ...structuredClone(initial), elapsedSeconds: 600 };
  const onFinal = { ...structuredClone(initial), elapsedSeconds: 600, averageTemperature: 29.75, actualVentM3h: 120, fanPowerWatts: 10, powerWatts: 10, energyWh: 10 / 6,
    airChangesPerHour: 0.5, sensibleHeatRemovedWatts: 150, fanEnergyWh: 10 / 6, ventilationHeatRemovedJ: 90_000, outdoorInflowM3h: 90, corridorInflowM3h: 30 };
  const config: ThermalConfig = { base: defaultConditions(), vent: { opening: 'window_bedroom3_1', on: true, mode: 'exhaust', ratedM3h: 200 }, envelope: { uValue: 2, solarAbsorptance: 0.5, shadeFraction: 0.25 }, durationSeconds: 600 };
  const baselineConfig = structuredClone(config);
  baselineConfig.vent.on = false;
  return {
    config, baselineConfig, candidateConfig: config, comparisonMode: 'fan-toggle', variedSettings: [{ label: 'Ventilation fan', baseline: 'Off', candidate: 'On' }],
    initialState: {
      elapsedSeconds: 0, lowerT: new Float64Array(model.rooms.length).fill(30), upperT: new Float64Array(model.rooms.length).fill(32), wallT: new Float64Array(model.rooms.length).fill(31),
      lowerPm25: new Float64Array(model.rooms.length).fill(20), upperPm25: new Float64Array(model.rooms.length).fill(21),
      initialEnergyJ: 123456, netHeatJ: 0, electricalEnergyWh: 0, fanEnergyWh: 0, ventilationHeatRemovedJ: 0,
    },
    durationSeconds: 600, runtimeMs: 8,
    off: { initial, final: offFinal, samples: [initial, offFinal], pmExposureUgHoursM3: 20 / 6 },
    on: { initial: structuredClone(initial), final: onFinal, samples: [structuredClone(initial), onFinal], pmExposureUgHoursM3: 20 / 6 },
    difference: { averageTemperature: -0.25, averageUpperTemperature: 0, averagePm25: 0, storedEnergyJ: 0, energyWh: 10 / 6, pmExposureUgHoursM3: 0,
      actualVentM3h: 120, airChangesPerHour: 0.5, sensibleHeatRemovedWatts: 150, fanEnergyWh: 10 / 6, ventilationHeatRemovedJ: 90_000,
      heatBudgetW: { solar: 0, people: 0, conduction: 0, radiation: 0, ventilation: 0, ac: 0, fan: 0, appliances: 0, net: 0 } },
  };
}

function readCsv(csv: string): Record<string, string>[] {
  const rows: string[][] = [[]];
  for (const match of csv.matchAll(/"((?:[^"]|"")*)"(,|\r\n|$)/g)) {
    rows.at(-1)!.push(match[1].replaceAll('""', '"'));
    if (match[2] !== ',') rows.push([]);
  }
  rows.pop();
  const header = rows.shift()!;
  expect(new Set(header).size).toBe(header.length);
  for (const row of rows) expect(row).toHaveLength(header.length);
  return rows.map(row => Object.fromEntries(header.map((column, index) => [column, row[index]])));
}

describe('Cooling Lab CSV', () => {
  test('exports reproducible inputs, one exact shared initial state, paired traces and final room readings with units', () => {
    const report = fixture();
    report.initialState.lowerT[0] = 30.1234567890123;
    const before = structuredClone(report);
    const csv = thermalComparisonCsv(report);
    const rows = readCsv(csv);
    expect(thermalComparisonCsv(report)).toBe(csv);
    expect(report).toEqual(before);
    const metadata = Object.fromEntries(rows.filter(row => row.record === 'metadata').map(row => [row.parameter, row.value]));
    expect(JSON.parse(metadata.base_conditions_json)).toEqual(report.config.base);
    expect(metadata.exterior_face_to_interior_surface_conductance).toBe('2');
    expect(metadata.model_id).toBe(THERMAL_MODEL_ID);
    expect(JSON.parse(metadata.model_parameters_json).densityKgM3).toBe(1.2);
    expect(JSON.parse(metadata.model_assumptions_json).length).toBeGreaterThan(0);
    expect(metadata.vent_rated_flow).toBe('200');
    expect(metadata.requested_duration).toBe(metadata.actual_comparison_duration);
    expect(metadata.disclaimer).toContain('SIMULATED');
    expect(metadata.disclaimer).toContain('not 3D CFD');
    expect(metadata.flow).toContain('negative means backflow');
    expect(rows.filter(row => row.record === 'initial_state')).toHaveLength(model.rooms.length);
    expect(rows.find(row => row.record === 'initial_state')!.lower_temperature_c).toBe('30.1234567890123');
    const traces = rows.filter(row => row.record === 'trace');
    expect(traces.map(row => [row.run_id, row.elapsed_s])).toEqual([['fan_off', '0'], ['fan_on', '0'], ['fan_off', '600'], ['fan_on', '600']]);
    expect(traces[3].vent_flow_m3_h).toBe('120');
    expect(traces[3].sensible_heat_removed_w).toBe('150');
    expect(traces[3].ventilation_heat_removed_j).toBe('90000');
    expect(traces[3].boundary_air_changes_per_h).toBe('0.5');
    expect(rows.filter(row => row.record === 'final_room')).toHaveLength(model.rooms.length * 2);
    expect(rows.find(row => row.record === 'difference')!.air_temperature_c).toBe('-0.25');
    expect(rows.filter(row => row.record === 'final_summary')[1].energy_wh).toBe(String(10 / 6));
    expect(rows.filter(row => row.record === 'final_summary')[1].fan_energy_wh).toBe(String(10 / 6));
    expect(rows.find(row => row.record === 'final_room')!.interlayer_mixing_m3_h).toBe('10');
    expect(csv).not.toContain('buoyancy_exchange_m3_h');
  });

  test('quotes commas and embedded quotes in model names and configuration', () => {
    const report = fixture();
    report.config.base.scenarioId = 'Team "A", cool\r\nsecond line';
    report.baselineConfig.base.scenarioId = report.config.base.scenarioId;
    report.on.final.rooms[0].room = 'Room "A", east';
    const rows = readCsv(thermalComparisonCsv(report));
    expect(rows.find(row => row.parameter === 'scenario')!.value).toBe('Team "A", cool\r\nsecond line');
    expect(rows.find(row => row.record === 'final_room' && row.run_id === 'fan_on')!.room).toBe('Room "A", east');
    expect(JSON.parse(rows.find(row => row.parameter === 'base_conditions_json')!.value).scenarioId).toBe('Team "A", cool\r\nsecond line');
  });

  test('exports actual baseline/candidate interventions under one current environment with correct identifiers and signs', () => {
    const report = fixture();
    report.comparisonMode = 'configuration';
    report.baselineConfig.vent.on = true;
    report.candidateConfig.envelope.shadeFraction = 0.8;
    report.variedSettings = [{ label: 'Shading fraction', baseline: '0.25', candidate: '0.8' }];
    for (const config of [report.baselineConfig, report.candidateConfig]) {
      config.base.windFrom = 'W';
      config.corridor = { enabled: true, temperature: 28, pm25: 55 };
    }
    report.on.final.sensibleHeatRemovedWatts = -150;
    report.on.final.ventilationHeatRemovedJ = -90_000;
    report.difference.sensibleHeatRemovedWatts = -150;
    report.difference.ventilationHeatRemovedJ = -90_000;
    const rows = readCsv(thermalComparisonCsv(report));
    const shared = Object.fromEntries(rows.filter(row => row.record === 'metadata' && row.run_id === 'shared').map(row => [row.parameter, row.value]));
    expect(shared.comparison).toContain('captured baseline weather is not reused');
    expect(shared.comparison).not.toContain('Only the selected ventilation fan');
    expect(shared.difference_sign).toContain('candidate minus baseline');
    expect(shared.wind_from).toBe('W');
    expect(shared.corridor_boundary).toContain('Prescribed main-door reservoir');
    expect(JSON.parse(shared.shared_environment_json).corridor).toEqual(report.candidateConfig.corridor);
    expect(JSON.parse(shared.varied_settings_json)).toEqual(report.variedSettings);
    expect(JSON.parse(rows.find(row => row.parameter === 'actual_config_json' && row.run_id === 'baseline')!.value)).toEqual(report.baselineConfig);
    expect(JSON.parse(rows.find(row => row.parameter === 'actual_config_json' && row.run_id === 'candidate')!.value)).toEqual(report.candidateConfig);
    expect(new Set(rows.map(row => row.run_id))).toEqual(new Set(['shared', 'baseline', 'candidate', 'candidate_minus_baseline']));
    const difference = rows.find(row => row.record === 'difference')!;
    expect(difference.sensible_heat_removed_w).toBe('-150');
    expect(difference.ventilation_heat_removed_j).toBe('-90000');
  });

  test('rejects different environment or duration instead of claiming a controlled comparison', () => {
    let report = fixture();
    report.baselineConfig.base.outdoorTemperature += 1;
    expect(() => thermalComparisonCsv(report)).toThrow('environments or durations differ');
    report = fixture();
    report.baselineConfig.durationSeconds += 1;
    expect(() => thermalComparisonCsv(report)).toThrow('environments or durations differ');
    report = fixture();
    report.baselineConfig.corridor = { enabled: true, temperature: 28, pm25: 10 };
    expect(() => thermalComparisonCsv(report)).toThrow('environments or durations differ');
  });

  test('serializes each actual fan array and primary placement override without replacing captured settings', () => {
    const report = fixture(); report.comparisonMode = 'configuration';
    report.baselineConfig.base.portableFan!.position = { x: 8, z: 3.9 };
    report.baselineConfig.base.portableFan!.headingDeg = 25;
    report.baselineConfig.base.standingFans = [{ id: 'fan_baseline', x: 10, z: 6, angleDeg: 90, speed: 2, on: true }];
    report.candidateConfig.base.portableFan!.position = { x: 6.9, z: 6.9 };
    report.candidateConfig.base.portableFan!.headingDeg = 230;
    report.candidateConfig.base.standingFans = [{ id: 'fan_candidate', x: 9, z: 5, angleDeg: 270, speed: 1, on: false }];
    const original = structuredClone(report), rows = readCsv(thermalComparisonCsv(report));
    for (const [runId, settings] of [['baseline', report.baselineConfig], ['candidate', report.candidateConfig]] as const) {
      expect(JSON.parse(rows.find(row => row.parameter === 'base_conditions_json' && row.run_id === runId)!.value)).toEqual(settings.base);
      expect(JSON.parse(rows.find(row => row.parameter === 'actual_config_json' && row.run_id === runId)!.value)).toEqual(settings);
    }
    expect(report).toEqual(original);
    report.candidateConfig.base.standingFans![0].x = NaN;
    expect(() => thermalComparisonCsv(report)).toThrow('non-finite');
  });

  test('rejects nonfinite values in results, initial fields and source configuration', () => {
    for (const bad of [NaN, Infinity, -Infinity]) {
      let report = fixture();
      report.on.final.averageTemperature = bad;
      expect(() => thermalComparisonCsv(report)).toThrow('non-finite');
      report = fixture();
      report.initialState.upperPm25[0] = bad;
      expect(() => thermalComparisonCsv(report)).toThrow('non-finite');
      report = fixture();
      report.config.base.humidity = bad;
      expect(() => thermalComparisonCsv(report)).toThrow('non-finite');
    }
  });

  test('rejects unmatched paired traces or incomplete initial state', () => {
    let report = fixture();
    report.on.samples = report.on.samples.slice(1);
    expect(() => thermalComparisonCsv(report)).toThrow('matching samples');
    report = fixture();
    report.on.samples[1].elapsedSeconds = 599;
    expect(() => thermalComparisonCsv(report)).toThrow('matching timestamps');
    report = fixture();
    report.initialState.lowerT = new Float64Array(1);
    expect(() => thermalComparisonCsv(report)).toThrow('model rooms');
  });
});
