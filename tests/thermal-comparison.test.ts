import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { defaultConditions } from '../src/domain';
import * as thermalModel from '../src/thermal-model';
import { compareThermalCases, createThermalComparisonRunner, type ThermalComparisonProgress, type ThermalWorkerResponse } from '../src/thermal-comparison';
import type { ThermalConfig, ThermalState } from '../src/thermal-types';
import { findStandingFanPosition } from '../src/standing-fans';

function config(durationSeconds = 25.5): ThermalConfig {
  const value = thermalModel.createThermalConfig(defaultConditions());
  value.durationSeconds = durationSeconds;
  value.vent = { opening: 'window_bedroom3_1', on: true, mode: 'exhaust', ratedM3h: 0 };
  return value;
}

afterEach(() => vi.restoreAllMocks());

describe('matched thermal comparison', () => {
  test('uses one shared initial state, changes only vent.on, and preserves input and exact horizon', () => {
    const input = config();
    input.vent.ratedM3h = 200;
    input.base.windows.window_living_1 = true;
    input.base.doors.door_bedroom3 = true;
    const original = structuredClone(input);
    const makeInitial = vi.spyOn(thermalModel, 'createThermalState');
    const actualStep = thermalModel.stepThermalState;
    const calls: { state: ThermalState; config: ThermalConfig; dt: number }[] = [];
    vi.spyOn(thermalModel, 'stepThermalState').mockImplementation((state, settings, dt) => {
      calls.push({ state, config: structuredClone(settings), dt });
      return actualStep(state, settings, dt);
    });
    const report = compareThermalCases(input);
    expect(makeInitial).toHaveBeenCalledTimes(1);
    expect(calls[0].state).toEqual(calls[1].state);
    expect(calls[0].state).not.toBe(calls[1].state);
    expect(calls[0].state.lowerT).not.toBe(calls[1].state.lowerT);
    expect(report.initialState).toEqual(calls[0].state);
    expect(report.initialState).not.toBe(calls[0].state);
    expect(calls.map(call => call.dt)).toEqual([10, 10, 10, 10, 5.5, 5.5]);
    for (let index = 0; index < calls.length; index += 2) {
      expect(calls[index].config).toEqual({ ...original, vent: { ...original.vent, on: false } });
      expect(calls[index + 1].config).toEqual({ ...original, vent: { ...original.vent, on: true } });
    }
    expect(report.off.final.elapsedSeconds).toBe(input.durationSeconds);
    expect(report.on.final.elapsedSeconds).toBe(input.durationSeconds);
    expect(report.difference.energyWh).toBeGreaterThan(0);
    expect(report.difference.energyWh).toBe(report.on.final.energyWh - report.off.final.energyWh);
    expect(report.difference.averageTemperature).toBe(report.on.final.averageTemperature - report.off.final.averageTemperature);
    expect(report.difference.pmExposureUgHoursM3).toBe(report.on.pmExposureUgHoursM3 - report.off.pmExposureUgHoursM3);
    expect(report.comparisonMode).toBe('fan-toggle');
    expect(report.variedSettings).toEqual([{ label: 'High-vent fan power', baseline: 'Off', candidate: 'On' }]);
    expect(input).toEqual(original);
    input.base.outdoorTemperature += 5;
    expect(report.config).toEqual(original);
  });

  test('zero-rated fan produces identical cases and zero signed differences', () => {
    const report = compareThermalCases(config(35));
    expect(report.on.samples).toEqual(report.off.samples);
    expect(report.on.final).toEqual(report.off.final);
    expect(report.on.pmExposureUgHoursM3).toBe(report.off.pmExposureUgHoursM3);
    for (const [key, value] of Object.entries(report.difference)) {
      if (key === 'heatBudgetW') for (const term of Object.values(value)) expect(term).toBe(0);
      else expect(value).toBe(0);
    }
  });

  test('compares captured interventions under current shared weather, corridor and duration', () => {
    const baseline = config(1_200), candidate = config(25.5);
    Object.assign(baseline.base, { scenarioId: 'hot_afternoon', outdoorTemperature: 40, outdoorPm25: 300, humidity: 95, windSpeed: 4, windFrom: 'W', timeOfDay: 14 });
    Object.assign(candidate.base, { scenarioId: 'night_cool', outdoorTemperature: 27, outdoorPm25: 15, humidity: 60, windSpeed: 2, windFrom: 'E', timeOfDay: 20 });
    baseline.corridor = { enabled: false, temperature: 20, pm25: 20 };
    candidate.corridor = { enabled: true, temperature: 29, pm25: 100 };
    baseline.vent = { opening: 'window_bedroom3_1', on: true, mode: 'exhaust', ratedM3h: 200 };
    candidate.vent = { opening: 'window_living_1', on: false, mode: 'supply', ratedM3h: 100 };
    baseline.base.doors.door_bedroom3 = true;
    baseline.base.portableFan = { on: true, slot: 3, angleDeg: 45, speed: 1 };
    baseline.base.acSetpoint = 23;
    candidate.base.windows.window_living_2 = true;
    candidate.base.devices.purifier_living = true;
    candidate.base.purifier = { on: true, slot: 2 };
    candidate.envelope.shadeFraction = 0.8;
    const originals = structuredClone({ baseline, candidate });
    const initialCalls: ThermalState[] = [];
    const actualStep = thermalModel.stepThermalState;
    vi.spyOn(thermalModel, 'stepThermalState').mockImplementation((state, settings, dt) => {
      if (state.elapsedSeconds === 0) initialCalls.push(state);
      return actualStep(state, settings, dt);
    });
    const report = compareThermalCases(candidate, { baselineConfig: baseline });
    expect(report.comparisonMode).toBe('configuration');
    expect(report.candidateConfig).toEqual(candidate);
    expect(report.baselineConfig).toEqual({
      ...candidate,
      base: { ...candidate.base, doors: baseline.base.doors, windows: baseline.base.windows, devices: baseline.base.devices,
        portableFan: baseline.base.portableFan, purifier: baseline.base.purifier, acSetpoint: baseline.base.acSetpoint },
      vent: baseline.vent, envelope: baseline.envelope,
    });
    expect(report.baselineConfig.vent.on).toBe(true);
    expect(report.candidateConfig.vent.on).toBe(false);
    expect(report.off.final.elapsedSeconds).toBe(25.5);
    expect(report.on.final.elapsedSeconds).toBe(25.5);
    expect(initialCalls[0]).toEqual(initialCalls[1]);
    expect(initialCalls[0].lowerT).not.toBe(initialCalls[1].lowerT);
    expect(report.initialState).toEqual(thermalModel.createThermalState(candidate));
    expect(report.variedSettings.map(change => change.label)).toEqual(expect.arrayContaining([
      'Window: Living 2', 'Door: Bedroom 3', 'Device: Purifier living',
      'High-vent fan power', 'High-vent opening', 'High-vent direction', 'High-vent rated flow (m³/h)', 'Shade fraction', 'Purifier power',
    ]));
    expect(report.variedSettings.some(change => /weather|wind direction|wind speed|corridor|duration|humidity|scenario/i.test(change.label))).toBe(false);
    for (const key of ['actualVentM3h', 'airChangesPerHour', 'fanEnergyWh', 'sensibleHeatRemovedWatts', 'ventilationHeatRemovedJ'] as const) {
      expect(Number.isFinite(report.difference[key])).toBe(true);
      expect(report.difference[key]).toBe(report.on.final[key] - report.off.final[key]);
    }
    expect({ baseline, candidate }).toEqual(originals);
    report.baselineConfig.base.windows.window_living_2 = false;
    expect(report.candidateConfig.base.windows.window_living_2).toBe(true);
  });

  test('identical configurations produce equal arms and no varied settings', () => {
    const input = config(20);
    input.vent.ratedM3h = 200;
    const report = compareThermalCases(input, { baselineConfig: structuredClone(input) });
    expect(report.off).toEqual(report.on);
    expect(report.variedSettings).toEqual([]);
    expect(report.comparisonMode).toBe('configuration');
  });

  test('captures independent standing fan arrays and primary overrides and identifies added, removed and moved fans', () => {
    const baseline = config(1200);
    baseline.base.portableFan = { on: true, slot: 0, angleDeg: 90, speed: 1,
      position: findStandingFanPosition('living', baseline.base, 'primary')!, headingDeg: 25 };
    baseline.base.standingFans = [];
    for (const [id, room, speed] of [['moved', 'bedroom3', 2], ['removed', 'dining', 1]] as const) {
      const position = findStandingFanPosition(room, baseline.base)!;
      expect(position).not.toBeNull();
      baseline.base.standingFans.push({ id, ...position, angleDeg: 90, speed, on: true });
    }
    const candidate = structuredClone(baseline);
    candidate.durationSeconds = 25.5;
    candidate.base.outdoorTemperature = 27;
    candidate.base.portableFan!.position = findStandingFanPosition('master_bedroom', candidate.base, 'primary')!;
    candidate.base.portableFan!.headingDeg = 230;
    candidate.base.standingFans = [{ id: 'moved', ...findStandingFanPosition('bedroom2', candidate.base, 'moved')!, angleDeg: 180, speed: 3, on: true }];
    candidate.base.standingFans.push({ id: 'added', ...findStandingFanPosition('dining', candidate.base)!, angleDeg: 270, speed: 1, on: true });
    const original = structuredClone({ baseline, candidate });
    const report = compareThermalCases(candidate, { baselineConfig: baseline });
    expect(report.baselineConfig.base.standingFans).toEqual(original.baseline.base.standingFans);
    expect(report.baselineConfig.base.portableFan).toEqual(original.baseline.base.portableFan);
    expect(report.candidateConfig.base.standingFans).toEqual(original.candidate.base.standingFans);
    expect(report.candidateConfig.base.portableFan).toEqual(original.candidate.base.portableFan);
    expect(report.baselineConfig.base.outdoorTemperature).toBe(27);
    const changes = new Map(report.variedSettings.map(change => [change.label, change]));
    expect(changes.get('Portable fan resolved placement')?.baseline).toContain('Living');
    expect(changes.get('Portable fan resolved placement')?.candidate).toContain('230°');
    expect(changes.get('Standing fan moved')?.baseline).toContain('Bedroom 3');
    expect(changes.get('Standing fan moved')?.candidate).toContain('Bedroom 2');
    expect(changes.get('Standing fan removed')?.candidate).toBe('Not present');
    expect(changes.get('Standing fan added')?.baseline).toBe('Not present');
    expect(report.difference.energyWh).toBeCloseTo(25 * 25.5 / 3600, 10);
    expect({ baseline, candidate }).toEqual(original);
    baseline.base.standingFans[0].x += 1;
    candidate.base.portableFan!.position!.x += 1;
    expect(report.baselineConfig.base.standingFans).toEqual(original.baseline.base.standingFans);
    expect(report.candidateConfig.base.portableFan).toEqual(original.candidate.base.portableFan);
  });

  test('integrates PM exposure over the real final partial interval and reports signed deltas', () => {
    const input = config(25.5);
    input.base.outdoorPm25 = 15;
    const report = compareThermalCases(input);
    expect(report.off.samples.map(sample => sample.elapsedSeconds)).toEqual([0, 10, 20, 25.5]);
    expect(report.on.samples.map(sample => sample.elapsedSeconds)).toEqual([0, 10, 20, 25.5]);
    const initialPm = report.off.initial.averagePm25;
    expect(report.off.final.averagePm25).toBeCloseTo(initialPm, 10);
    expect(report.off.pmExposureUgHoursM3).toBeCloseTo(initialPm * 25.5 / 3_600, 10);
    expect(report.difference.storedEnergyJ).toBe(report.on.final.storedEnergyJ - report.off.final.storedEnergyJ);
    expect(report.difference.energyWh).toBe(report.on.final.energyWh - report.off.final.energyWh);
    expect(report.difference.pmExposureUgHoursM3).toBe(report.on.pmExposureUgHoursM3 - report.off.pmExposureUgHoursM3);
    for (const key of Object.keys(report.difference.heatBudgetW) as (keyof typeof report.difference.heatBudgetW)[]) {
      expect(report.difference.heatBudgetW[key]).toBe(report.on.final.heatBudgetW[key] - report.off.final.heatBudgetW[key]);
    }
  });

  test('bounds retained samples and progress while preserving both endpoints', () => {
    const progress: ThermalComparisonProgress[] = [];
    const report = compareThermalCases(config(1_210.5), { onProgress: value => progress.push(value) });
    expect(report.off.samples.length).toBeLessThanOrEqual(121);
    expect(report.off.samples[0]).toEqual(report.off.initial);
    expect(report.off.samples.at(-1)).toEqual(report.off.final);
    expect(report.on.samples.map(sample => sample.elapsedSeconds)).toEqual(report.off.samples.map(sample => sample.elapsedSeconds));
    expect(progress.length).toBeLessThanOrEqual(121);
    expect(progress[0].done).toBe(0);
    expect(progress.at(-1)).toEqual({ done: 122, total: 122, elapsedSeconds: 1_210.5, durationSeconds: 1_210.5 });
  });

  test('cancels without mutating the supplied configuration', () => {
    const input = config(60), original = structuredClone(input), controller = new AbortController();
    expect(() => compareThermalCases(input, {
      signal: controller.signal,
      onProgress: progress => { if (progress.done > 0) controller.abort(); },
    })).toThrowError(expect.objectContaining({ name: 'AbortError' }));
    expect(input).toEqual(original);
  });

  test('rejects invalid durations and nonfinite model output instead of returning a comparison', () => {
    for (const duration of [0, -1, NaN, Infinity, 7_200.1]) expect(() => compareThermalCases(config(duration))).toThrow();
    const snapshot = thermalModel.thermalSnapshot;
    vi.spyOn(thermalModel, 'thermalSnapshot').mockImplementation((state, settings) => ({ ...snapshot(state, settings), averagePm25: NaN }));
    expect(() => compareThermalCases(config())).toThrow('invalid readings');
  });
});

describe('thermal comparison worker lifecycle', () => {
  const workers: StubWorker[] = [];
  class StubWorker {
    onmessage: ((event: MessageEvent<ThermalWorkerResponse>) => void) | null = null;
    onerror: ((event: ErrorEvent) => void) | null = null;
    onmessageerror: (() => void) | null = null;
    postMessage = vi.fn();
    terminate = vi.fn();
    constructor() { workers.push(this); }
    deliver(data: ThermalWorkerResponse) { this.onmessage?.(new MessageEvent('message', { data })); }
    fail(message: string) {
      const event = Object.assign(new Event('error', { cancelable: true }), { message });
      this.onerror?.(event as ErrorEvent);
      return event;
    }
  }
  beforeEach(() => {
    workers.length = 0;
    vi.useFakeTimers();
    vi.stubGlobal('Worker', StubWorker);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  test('replacement and explicit cancellation settle their promises even if the worker never responds', async () => {
    const runner = createThermalComparisonRunner(), onProgress = vi.fn();
    const first = runner.run(config());
    const firstRejected = expect(first).rejects.toMatchObject({ name: 'AbortError' });
    const second = runner.run(config(), onProgress);
    await firstRejected;
    expect(workers[0].terminate).toHaveBeenCalledTimes(1);
    workers[0].deliver({ type: 'progress', progress: { done: 1, total: 3, elapsedSeconds: 10, durationSeconds: 25.5 } });
    workers[0].fail('stale error');
    expect(onProgress).not.toHaveBeenCalled();
    expect(workers[1].terminate).not.toHaveBeenCalled();
    const secondRejected = expect(second).rejects.toMatchObject({ name: 'AbortError' });
    runner.cancel();
    await secondRejected;
    expect(workers[1].terminate).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    runner.dispose();
  });

  test('resolves only the active result, forwards progress, and clears its timer', async () => {
    const runner = createThermalComparisonRunner(), onProgress = vi.fn();
    const result = compareThermalCases(config());
    const input = config(), promise = runner.run(input, onProgress);
    input.base.outdoorTemperature = 50;
    expect(workers[0].postMessage.mock.calls[0][0].config.base.outdoorTemperature).not.toBe(50);
    const progress = { done: 3, total: 3, elapsedSeconds: 25.5, durationSeconds: 25.5 };
    workers[0].deliver({ type: 'progress', progress });
    workers[0].deliver({ type: 'result', result });
    workers[0].deliver({ type: 'error', message: 'stale after success' });
    await expect(promise).resolves.toEqual(result);
    expect(onProgress).toHaveBeenCalledExactlyOnceWith(progress);
    expect(workers[0].terminate).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    runner.dispose();
  });

  test('runs a general comparison through the same isolated worker and cancellation lifecycle', async () => {
    const runner = createThermalComparisonRunner();
    const baseline = config(1_200), candidate = config(20);
    baseline.base.windows.window_living_1 = true;
    const result = compareThermalCases(candidate, { baselineConfig: baseline });
    const promise = runner.compare(baseline, candidate);
    const sent = workers[0].postMessage.mock.calls[0][0];
    expect(sent).toEqual({ type: 'run', config: candidate, baselineConfig: baseline });
    baseline.base.windows.window_living_1 = false;
    candidate.base.outdoorTemperature = 50;
    expect(sent.baselineConfig.base.windows.window_living_1).toBe(true);
    expect(sent.config.base.outdoorTemperature).not.toBe(50);
    workers[0].deliver({ type: 'result', result });
    await expect(promise).resolves.toEqual(result);
    expect(vi.getTimerCount()).toBe(0);
    const cancelled = runner.compare(baseline, candidate);
    const rejected = expect(cancelled).rejects.toMatchObject({ name: 'AbortError' });
    runner.dispose();
    await rejected;
    expect(workers[1].terminate).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  test('contains worker failures, decoding failures and hard timeouts with complete cleanup', async () => {
    const runner = createThermalComparisonRunner();
    const failed = runner.run(config());
    const failedAssertion = expect(failed).rejects.toThrow('worker crashed');
    expect(workers[0].fail('worker crashed').defaultPrevented).toBe(true);
    await failedAssertion;
    expect(vi.getTimerCount()).toBe(0);

    const badMessage = runner.run(config());
    const decodeAssertion = expect(badMessage).rejects.toThrow('decode');
    workers[1].onmessageerror?.();
    await decodeAssertion;
    expect(vi.getTimerCount()).toBe(0);

    const timedOut = runner.run(config());
    const timeoutAssertion = expect(timedOut).rejects.toThrow('30 seconds');
    vi.advanceTimersByTime(30_000);
    await timeoutAssertion;
    expect(workers.every(worker => worker.terminate.mock.calls.length === 1)).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    runner.dispose();
  });

  test('constructor failures reject without leaving an active run or timer', async () => {
    vi.stubGlobal('Worker', class { constructor() { throw new Error('Workers unavailable'); } });
    const runner = createThermalComparisonRunner();
    await expect(runner.run(config())).rejects.toThrow('Workers unavailable');
    expect(vi.getTimerCount()).toBe(0);
    runner.dispose();
  });
});
