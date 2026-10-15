import { describe, expect, test } from 'vitest';
import { defaultConditions, model } from '../src/domain';
import { thermalComparisonCsv } from '../src/thermal-export';
import type { ThermalComparisonResult } from '../src/thermal-comparison';
import type { ThermalSnapshot } from '../src/thermal-types';

function fixture(): ThermalComparisonResult {
  const initial: ThermalSnapshot = {
    elapsedSeconds: 0, averageTemperature: 30, averageUpperTemperature: 32, averageSurfaceTemperature: 31, averagePm25: 20,
    actualVentM3h: 0, fanPowerWatts: 0, powerWatts: 0, energyWh: 0, storedEnergyJ: 123456, energyResidualJ: 0, maxMassResidualM3s: 0,
    heatBudgetW: { solar: 10, people: 20, conduction: -5, radiation: 0, ventilation: 0, ac: 0, fan: 0, appliances: 0, net: 25 },
    rooms: model.rooms.map(room => ({ room: room.name, lowerTemperature: 30, upperTemperature: 32, surfaceTemperature: 31, pm25: 20, ventilationM3h: 0, buoyancyExchangeM3h: 10, wallToAirWatts: 5 })),
  };
  const offFinal = { ...structuredClone(initial), elapsedSeconds: 600 };
  const onFinal = { ...structuredClone(initial), elapsedSeconds: 600, averageTemperature: 29.75, actualVentM3h: 120, fanPowerWatts: 10, powerWatts: 10, energyWh: 10 / 6 };
  return {
    config: { base: defaultConditions(), vent: { opening: 'window_bedroom3_1', on: true, mode: 'exhaust', ratedM3h: 200 }, envelope: { uValue: 2, solarAbsorptance: 0.5, shadeFraction: 0.25 }, durationSeconds: 600 },
    initialState: {
      elapsedSeconds: 0, lowerT: new Float64Array(model.rooms.length).fill(30), upperT: new Float64Array(model.rooms.length).fill(32), wallT: new Float64Array(model.rooms.length).fill(31),
      lowerPm25: new Float64Array(model.rooms.length).fill(20), upperPm25: new Float64Array(model.rooms.length).fill(21),
      initialEnergyJ: 123456, netHeatJ: 0, electricalEnergyWh: 0,
    },
    durationSeconds: 600, runtimeMs: 8,
    off: { initial, final: offFinal, samples: [initial, offFinal], pmExposureUgHoursM3: 20 / 6 },
    on: { initial: structuredClone(initial), final: onFinal, samples: [structuredClone(initial), onFinal], pmExposureUgHoursM3: 20 / 6 },
    difference: { averageTemperature: -0.25, averageUpperTemperature: 0, averagePm25: 0, storedEnergyJ: 0, energyWh: 10 / 6, pmExposureUgHoursM3: 0,
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
    expect(metadata.model_id).toBe('two-layer-surface-v1');
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
    expect(rows.filter(row => row.record === 'final_room')).toHaveLength(model.rooms.length * 2);
    expect(rows.find(row => row.record === 'difference')!.air_temperature_c).toBe('-0.25');
    expect(rows.filter(row => row.record === 'final_summary')[1].energy_wh).toBe(String(10 / 6));
  });

  test('quotes commas and embedded quotes in model names and configuration', () => {
    const report = fixture();
    report.config.base.scenarioId = 'Team "A", cool\r\nsecond line';
    report.on.final.rooms[0].room = 'Room "A", east';
    const rows = readCsv(thermalComparisonCsv(report));
    expect(rows.find(row => row.parameter === 'scenario')!.value).toBe('Team "A", cool\r\nsecond line');
    expect(rows.find(row => row.record === 'final_room' && row.run_id === 'fan_on')!.room).toBe('Room "A", east');
    expect(JSON.parse(rows.find(row => row.parameter === 'base_conditions_json')!.value).scenarioId).toBe('Team "A", cool\r\nsecond line');
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
