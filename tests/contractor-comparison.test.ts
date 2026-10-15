import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { defaultConditions } from '../src/domain';
import { parseContractorPlan } from '../src/contractor-plan';
import * as thermalModel from '../src/thermal-model';
import {
  compareContractorPlans, createContractorComparisonRunner, recommendContractorPlans,
  type ContractorComparisonProgress, type ContractorStudyConfig, type ContractorWorkerResponse,
} from '../src/contractor-comparison';

function plan(id: string, widthM: number) {
  return parseContractorPlan({
    version: 1, id, name: `Plan ${id}`, heightM: 2.6,
    rooms: [{ id: 'room', label: 'Room', x: 0, z: 0, widthM, depthM: 4 }],
    openings: [
      { id: 'north_window', kind: 'window', roomA: 'room', roomB: null, side: 'N', offsetM: 1, widthM: 1, sillM: 0.8, heightM: 1.2, open: true },
      { id: 'south_window', kind: 'window', roomA: 'room', roomB: null, side: 'S', offsetM: 1, widthM: 1, sillM: 0.8, heightM: 1.2, open: true },
    ],
    devices: [{ id: 'fan', kind: 'fan', roomId: 'room', on: id === 'a' }],
  });
}

function study(durationSeconds = 25.5): ContractorStudyConfig {
  const weather = defaultConditions();
  Object.assign(weather, { outdoorTemperature: 27, outdoorPm25: 15, windSpeed: 1.2, windFrom: 'N' });
  return { plans: [plan('a', 4), plan('b', 5), plan('c', 6)], weather, durationSeconds, initialTemperature: 31, initialPm25: 40 };
}

afterEach(() => vi.restoreAllMocks());

describe('three-plan contractor comparison', () => {
  test('runs each actual geometry with shared weather, initial fields, occupants and exact horizon without caller mutation', () => {
    const input = study(), original = structuredClone(input);
    input.weather.devices.fan_living = true;
    input.weather.windows.window_bedroom3_1 = true;
    Object.assign(original.weather, structuredClone(input.weather));
    const factory = vi.spyOn(thermalModel, 'createThermalModel');
    const report = compareContractorPlans(input);
    expect(factory).toHaveBeenCalledTimes(3);
    expect(factory.mock.calls.map(([value]) => value)).toEqual(original.plans);
    expect(report.cases.map(option => option.areaM2)).toEqual([16, 20, 24]);
    expect(new Set(report.cases.map(option => option.initialState.modelKey)).size).toBe(3);
    expect(report.config.occupancyPeople).toBe(4);
    expect(report.scope).toBe('single-weather-case');
    for (const option of report.cases) {
      for (const field of [option.initialState.lowerT, option.initialState.upperT, option.initialState.wallT]) expect([...field]).toEqual([31]);
      for (const field of [option.initialState.lowerPm25, option.initialState.upperPm25]) expect([...field]).toEqual([40]);
      expect(option.initialState.elapsedSeconds).toBe(0);
      expect(option.config.base).toEqual({ ...original.weather,
        doors: {}, windows: { north_window: true, south_window: true }, devices: { fan: option.plan.id === 'a' },
        portableFan: undefined, purifier: undefined,
      });
      expect(option.config.vent).toEqual({ opening: '', on: false, ratedM3h: 0, mode: 'exhaust' });
      expect(option.config.initialTemperature).toBe(31);
      expect(option.config.initialPm25).toBe(40);
      expect(option.config.occupancyPeople).toBe(4);
      expect(option.initial.heatBudgetW.people).toBeCloseTo(400, 8);
      expect(option.final.heatBudgetW.people).toBeCloseTo(400, 8);
      expect(option.final.elapsedSeconds).toBe(25.5);
      expect(option.samples.map(sample => sample.elapsedSeconds)).toEqual([0, 10, 20, 25.5]);
      expect(option.initial.rooms.map(room => room.room)).toEqual(['room']);
      expect(option.final.openingFlows?.map(flow => flow.opening)).toEqual(['north_window', 'south_window']);
      expect(option.energyWhPerM2).toBe(option.final.energyWh / option.areaM2);
      expect(option.fanEnergyWh).toBeCloseTo(option.enabledEquipment.fans * 50 * 25.5 / 3600, 10);
    }
    expect(report.cases[1].final.averagePm25).not.toBeCloseTo(report.cases[2].final.averagePm25, 7);
    expect(report.warnings.join(' ')).toMatch(/Floor areas differ/);
    expect(report.warnings.join(' ')).toMatch(/Enabled equipment counts differ/);
    expect(input).toEqual(original);
    input.weather.outdoorTemperature = 50;
    input.plans[0].devices[0].roomId = 'changed_after_run';
    expect(report.config.weather.outdoorTemperature).toBe(27);
    expect(report.cases[0].plan.devices[0].roomId).toBe('room');
    expect(report.cases[0].config.base).not.toBe(report.cases[1].config.base);
  });

  test('integrates exposure using actual adjacent timestamps including the final partial interval', () => {
    const report = compareContractorPlans(study());
    for (const option of report.cases) {
      const expected = option.samples.slice(1).reduce((sum, sample, index) => {
        const previous = option.samples[index];
        return sum + (previous.averagePm25 + sample.averagePm25) / 2 * (sample.elapsedSeconds - previous.elapsedSeconds) / 3600;
      }, 0);
      expect(option.pmExposureUgHoursM3).toBeCloseTo(expected, 12);
    }
  });

  test('recomputes room-level device placement after a plan edit while retaining the previous captured report', () => {
    const input = study(120);
    input.plans[0] = parseContractorPlan({
      version: 1, id: 'a', name: 'Movable purifier', heightM: 2.6,
      rooms: [
        { id: 'west', label: 'West', x: 0, z: 0, widthM: 4, depthM: 4 },
        { id: 'east', label: 'East', x: 4, z: 0, widthM: 4, depthM: 4 },
      ], openings: [], devices: [{ id: 'cleaner', kind: 'purifier', roomId: 'west', on: true }],
    });
    const before = compareContractorPlans(input).cases[0];
    input.plans[0].devices[0].roomId = 'east';
    const after = compareContractorPlans(input).cases[0];
    const westBefore = before.final.rooms.find(room => room.room === 'west')!.pm25;
    const eastBefore = before.final.rooms.find(room => room.room === 'east')!.pm25;
    const westAfter = after.final.rooms.find(room => room.room === 'west')!.pm25;
    const eastAfter = after.final.rooms.find(room => room.room === 'east')!.pm25;
    expect(westBefore).toBeLessThan(eastBefore);
    expect(eastAfter).toBeLessThan(westAfter);
    expect(before.plan.devices[0].roomId).toBe('west');
    expect(after.plan.devices[0].roomId).toBe('east');
    expect(before.initialState.modelKey).not.toBe(after.initialState.modelKey);
    expect(before.initial.rooms.map(room => room.room)).toEqual(['east', 'west']);
    expect(after.initialState.lowerT).toEqual(before.initialState.lowerT);
    expect(after.final.energyWh).toBeCloseTo(before.final.energyWh, 10);
  });

  test('retains bounded aligned samples and monotonic progress with both endpoints', () => {
    const progress: ContractorComparisonProgress[] = [];
    const report = compareContractorPlans(study(1210.5), { onProgress: value => progress.push(value) });
    for (const option of report.cases) {
      expect(option.samples.length).toBeLessThanOrEqual(121);
      expect(option.samples[0]).toEqual(option.initial);
      expect(option.samples.at(-1)).toEqual(option.final);
      expect(option.samples.map(sample => sample.elapsedSeconds)).toEqual(report.cases[0].samples.map(sample => sample.elapsedSeconds));
    }
    expect(progress.length).toBeLessThanOrEqual(363);
    expect(progress[0].done).toBe(0);
    expect(progress.every((value, index) => index === 0 || value.done >= progress[index - 1].done)).toBe(true);
    expect(progress.at(-1)).toEqual({ done: 366, total: 366, planIndex: 2, planName: 'Plan c', elapsedSeconds: 1210.5, durationSeconds: 1210.5 });
  });

  test('provides deterministic metric-specific ties and a conservative Pareto shortlist without a universal score', () => {
    const cases = compareContractorPlans(study(1)).cases;
    Object.assign(cases[0].final, { averageTemperature: 28, averagePm25: 30, energyWh: 10 });
    Object.assign(cases[1].final, { averageTemperature: 29, averagePm25: 10, energyWh: 20 });
    Object.assign(cases[2].final, { averageTemperature: 30, averagePm25: 40, energyWh: 30 });
    const ranked = recommendContractorPlans(cases);
    expect(ranked.recommendations.map(metric => metric.planIds)).toEqual([['a'], ['b'], ['a']]);
    expect(ranked.recommendations[0].label).toBe('Lowest mean indoor air temperature');
    expect(ranked.shortlistPlanIds).toEqual(['a', 'b']);
    expect(recommendContractorPlans([...cases].reverse())).toEqual(ranked);
    Object.assign(cases[1].final, { averageTemperature: 28.05, averagePm25: 30.5, energyWh: 10.05 });
    const tied = recommendContractorPlans(cases);
    expect(tied.recommendations.map(metric => metric.planIds)).toEqual([['a', 'b'], ['a', 'b'], ['a', 'b']]);
    expect(tied.shortlistPlanIds).toEqual(['a', 'b']);
    expect(tied.recommendations.map(metric => metric.tolerance)).toEqual([0.1, 1, 0.1]);
  });

  test('stops cancellation without changing any input or returning partial recommendations', () => {
    const input = study(60), original = structuredClone(input), controller = new AbortController();
    expect(() => compareContractorPlans(input, { signal: controller.signal, onProgress: progress => {
      if (progress.done > 0) controller.abort();
    } })).toThrowError(expect.objectContaining({ name: 'AbortError' }));
    expect(input).toEqual(original);
    expect(() => compareContractorPlans(input, { signal: controller.signal })).toThrowError(expect.objectContaining({ name: 'AbortError' }));
  });

  test('validates all three plans, shared conditions and duration before model creation', () => {
    const factory = vi.spyOn(thermalModel, 'createThermalModel');
    for (const duration of [0, -1, NaN, Infinity, 7200.1]) expect(() => compareContractorPlans(study(duration))).toThrow();
    const two = study(); two.plans.pop();
    expect(() => compareContractorPlans(two)).toThrow('exactly three');
    const duplicate = study(); duplicate.plans[1].id = duplicate.plans[0].id;
    expect(() => compareContractorPlans(duplicate)).toThrow('different ID');
    const invalid = study(); invalid.plans[2].rooms[0].widthM = NaN;
    expect(() => compareContractorPlans(invalid)).toThrow();
    const badWeather = study(); badWeather.weather.windSpeed = NaN;
    expect(() => compareContractorPlans(badWeather)).toThrow('Wind speed');
    const badInitial = study(); badInitial.initialTemperature = 100;
    expect(() => compareContractorPlans(badInitial)).toThrow('Initial temperature');
    const badOccupancy = study(); badOccupancy.occupancyPeople = -1;
    expect(() => compareContractorPlans(badOccupancy)).toThrow('Total occupants');
    expect(factory).not.toHaveBeenCalled();
  });

  test('rejects nonfinite model output and unequal initial fields rather than returning a recommendation', () => {
    const makeModel = thermalModel.createThermalModel;
    const spy = vi.spyOn(thermalModel, 'createThermalModel').mockImplementation(plan => {
      const instance = makeModel(plan);
      return { ...instance, snapshot: (state, settings) => ({ ...instance.snapshot(state, settings), averagePm25: NaN }) };
    });
    expect(() => compareContractorPlans(study())).toThrow('invalid simulation readings');
    spy.mockImplementation(plan => {
      const instance = makeModel(plan);
      return { ...instance, createState: settings => {
        const state = instance.createState(settings); state.lowerT[0] += 1; return state;
      } };
    });
    expect(() => compareContractorPlans(study())).toThrow('same requested temperature');
  });
});

describe('contractor worker lifecycle', () => {
  const workers: StubWorker[] = [];
  class StubWorker {
    onmessage: ((event: MessageEvent<ContractorWorkerResponse>) => void) | null = null;
    onerror: ((event: ErrorEvent) => void) | null = null;
    onmessageerror: (() => void) | null = null;
    postMessage = vi.fn();
    terminate = vi.fn();
    constructor() { workers.push(this); }
    deliver(data: ContractorWorkerResponse) { this.onmessage?.(new MessageEvent('message', { data })); }
    fail(message: string) {
      const event = Object.assign(new Event('error', { cancelable: true }), { message });
      this.onerror?.(event as ErrorEvent); return event;
    }
  }
  beforeEach(() => { workers.length = 0; vi.useFakeTimers(); vi.stubGlobal('Worker', StubWorker); });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  test('settles replacement and cancellation even when the worker never responds, ignoring stale messages', async () => {
    const runner = createContractorComparisonRunner(), progress = vi.fn();
    const first = runner.run(study());
    const rejectedFirst = expect(first).rejects.toMatchObject({ name: 'AbortError' });
    const second = runner.run(study(), progress);
    await rejectedFirst;
    expect(workers[0].terminate).toHaveBeenCalledTimes(1);
    workers[0].deliver({ type: 'progress', progress: { done: 1, total: 9, planIndex: 0, planName: 'Plan a', elapsedSeconds: 10, durationSeconds: 25.5 } });
    workers[0].fail('stale');
    expect(progress).not.toHaveBeenCalled();
    expect(workers[1].terminate).not.toHaveBeenCalled();
    const rejectedSecond = expect(second).rejects.toMatchObject({ name: 'AbortError' });
    runner.cancel(); await rejectedSecond;
    expect(workers[1].terminate).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    runner.dispose();
  });

  test('isolates the submitted input and forwards only active progress and result', async () => {
    const runner = createContractorComparisonRunner(), onProgress = vi.fn(), input = study();
    const result = compareContractorPlans(input), promise = runner.run(input, onProgress);
    input.plans[0].devices[0].on = false;
    input.weather.outdoorTemperature = 50;
    const sent = workers[0].postMessage.mock.calls[0][0];
    expect(sent.config.plans[0].devices[0].on).toBe(true);
    expect(sent.config.weather.outdoorTemperature).toBe(27);
    const progress = { done: 9, total: 9, planIndex: 2, planName: 'Plan c', elapsedSeconds: 25.5, durationSeconds: 25.5 };
    workers[0].deliver({ type: 'progress', progress });
    workers[0].deliver({ type: 'result', result });
    workers[0].deliver({ type: 'error', message: 'stale after success' });
    await expect(promise).resolves.toEqual(result);
    expect(onProgress).toHaveBeenCalledExactlyOnceWith(progress);
    expect(workers[0].terminate).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    runner.dispose();
  });

  test('contains worker, decoding, reported and timeout failures with cleanup and supports reuse', async () => {
    const runner = createContractorComparisonRunner();
    const failed = runner.run(study()), rejected = expect(failed).rejects.toThrow('crashed');
    expect(workers[0].fail('crashed').defaultPrevented).toBe(true); await rejected;
    const bad = runner.run(study()), badRejected = expect(bad).rejects.toThrow('decode');
    workers[1].onmessageerror?.(); await badRejected;
    const reported = runner.run(study()), reportedRejected = expect(reported).rejects.toThrow('invalid plan');
    workers[2].deliver({ type: 'error', message: 'invalid plan' }); await reportedRejected;
    const timed = runner.run(study()), timedRejected = expect(timed).rejects.toThrow('30 seconds');
    vi.advanceTimersByTime(30_000); await timedRejected;
    expect(workers.every(worker => worker.terminate.mock.calls.length === 1)).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    const retry = runner.run(study(1)), result = compareContractorPlans(study(1));
    workers[4].deliver({ type: 'result', result }); await expect(retry).resolves.toEqual(result);
    expect(vi.getTimerCount()).toBe(0);
  });

  test('rejects constructor and callback errors without leaked timers or workers', async () => {
    const runner = createContractorComparisonRunner();
    vi.stubGlobal('Worker', class { constructor() { throw new Error('Workers unavailable'); } });
    await expect(runner.run(study())).rejects.toThrow('Workers unavailable');
    expect(vi.getTimerCount()).toBe(0);
    vi.stubGlobal('Worker', StubWorker);
    const callback = runner.run(study(), () => { throw new Error('Callback failed'); });
    const rejected = expect(callback).rejects.toThrow('Callback failed');
    workers[0].deliver({ type: 'progress', progress: { done: 1, total: 9, planIndex: 0, planName: 'Plan a', elapsedSeconds: 10, durationSeconds: 25.5 } });
    await rejected;
    expect(workers[0].terminate).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    runner.dispose();
  });

  test('cleans up a worker when structured cloning the submitted configuration fails', async () => {
    const input = study();
    Object.assign(input, { uncloneable: () => undefined });
    const runner = createContractorComparisonRunner();
    await expect(runner.run(input)).rejects.toThrow();
    expect(workers[0].terminate).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    runner.dispose();
  });
});
