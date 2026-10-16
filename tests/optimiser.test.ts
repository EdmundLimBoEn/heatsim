import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { HARDWARE_OPENINGS } from '../src/config/mapping';
import { FAN_SLOTS, PURIFIER_SLOTS } from '../src/config/slots';
import { defaultConditions, model, type Conditions, type SimulationResult } from '../src/domain';
import { createOptimiser, optimiseLayouts, scoreResult, type WorkerResponse } from '../src/optimiser';
import { findStandingFanPosition, resolveStandingFans, validateStandingFanPosition, STANDING_FAN_CLEARANCE_M, PORTABLE_PURIFIER_CLEARANCE_M } from '../src/standing-fans';

function result(feelsLike = 34, pm25 = 70, powerWatts = 0): SimulationResult {
  return {
    elapsedSeconds: 120,
    rooms: model.rooms.map(room => ({ room: room.name, temperature: feelsLike, feelsLike, airflow: 0, pm25 })),
    averageTemperature: feelsLike, averageFeelsLike: feelsLike, averagePm25: pm25,
    powerWatts, energyKwh: powerWatts * 120 / 3_600_000,
  };
}

function evaluate(conditions: Conditions): SimulationResult {
  const fan = conditions.portableFan;
  const purifier = conditions.purifier;
  const ac = Object.entries(conditions.devices).some(([name, on]) => name.startsWith('ac_') && on);
  const fanCooling = fan?.on ? 1 + fan.slot * 0.1 + (90 - Math.abs(fan.angleDeg - 90)) / 180 : 0;
  const airCleaning = purifier?.on ? 20 + purifier.slot : 0;
  const openingCooling = [...Object.values(conditions.doors), ...Object.values(conditions.windows)].filter(Boolean).length * 0.25;
  return result(34 - fanCooling - (ac ? 3 : 0) - openingCooling, 70 - airCleaning,
    (fan?.on ? 50 : 0) + (purifier?.on ? 40 : 0) + (ac ? 1000 : 0));
}

const fixedClock = { now: () => 0 };

describe('optimiser scoring', () => {
  test('uses room-area weighting, positive heat excess per room, and device power in kW', () => {
    const reading = result(28, 35, 450);
    reading.rooms.find(room => room.room === 'living')!.feelsLike = 34;
    reading.rooms.find(room => room.room === 'living')!.pm25 = 70;
    reading.rooms.find(room => room.room === 'master_bedroom')!.feelsLike = 24;
    const area = model.rooms.reduce((sum, room) => sum + room.area_m2, 0);
    const livingWeight = model.rooms.find(room => room.name === 'living')!.area_m2 / area;
    const score = scoreResult(reading);
    expect(score.breakdown.heat).toBeCloseTo(6 * livingWeight, 10);
    expect(score.breakdown.haze).toBeCloseTo(1 + livingWeight, 10);
    expect(score.breakdown.energy).toBeCloseTo(0.45, 10);
    expect(score.J).toBeCloseTo(6 * livingWeight + 1 + livingWeight + 0.45, 10);
  });

  test('rejects nonfinite scores instead of reporting a false improvement', () => {
    for (const invalid of [NaN, Infinity, -Infinity]) {
      const reading = result();
      reading.rooms[0].feelsLike = invalid;
      expect(() => scoreResult(reading)).toThrow();
    }
  });
});

describe('layout optimiser', () => {
  test('holds effective extra fans fixed, preserves the baseline override and skips primary/purifier collisions', async () => {
    const conditions = defaultConditions();
    conditions.purifier = { on: false, slot: 3 };
    conditions.portableFan = { on: true, slot: 0, angleDeg: 90, speed: 2,
      position: findStandingFanPosition('master_bedroom', conditions, 'primary')!, headingDeg: 37 };
    conditions.standingFans = [
      { id: 'corridor_fan', x: FAN_SLOTS[1].x, z: FAN_SLOTS[1].z, angleDeg: 180, speed: 2, on: true },
      { id: 'living_fan', x: PURIFIER_SLOTS[4].x, z: PURIFIER_SLOTS[4].z, angleDeg: 90, speed: 1, on: true },
    ];
    const original = structuredClone(conditions), extras = resolveStandingFans(original).filter(fan => !fan.isPrimary);
    expect(extras).toHaveLength(2);
    const evaluated: Conditions[] = [];
    const report = await optimiseLayouts(conditions, 'fan+purifier', false, candidate => {
      evaluated.push(structuredClone(candidate));
      return evaluate(candidate);
    }, fixedClock);
    expect(report.you.conditions).toEqual(original);
    expect(evaluated[1].portableFan?.position).toEqual(original.portableFan!.position);
    expect(evaluated[1].portableFan?.headingDeg).toBe(37);
    for (const candidate of evaluated) {
      expect(candidate.standingFans).toEqual(original.standingFans);
      expect(resolveStandingFans(candidate).filter(fan => !fan.isPrimary)).toEqual(extras);
      if (candidate.portableFan?.on && !candidate.portableFan.position) {
        const slot = FAN_SLOTS[candidate.portableFan.slot];
        expect(candidate.portableFan.headingDeg).toBeUndefined();
        expect(validateStandingFanPosition(slot.x, slot.z, candidate, 'primary').valid).toBe(true);
        expect(candidate.portableFan.slot).not.toBe(1);
      }
      if (candidate.purifier?.on) {
        const slot = PURIFIER_SLOTS[candidate.purifier.slot];
        expect(candidate.purifier.slot).not.toBe(4);
        expect(resolveStandingFans(candidate).every(fan => Math.hypot(fan.x - slot.x, fan.z - slot.z)
          >= STANDING_FAN_CLEARANCE_M + PORTABLE_PURIFIER_CLEARANCE_M - 1e-8)).toBe(true);
      }
    }
    expect(conditions).toEqual(original);
    expect(report.layouts.every(layout => JSON.stringify(layout.conditions.standingFans) === JSON.stringify(original.standingFans))).toBe(true);
  });

  test('returns three distinct deterministic layouts, sorted by score, without mutating input', async () => {
    const conditions = defaultConditions();
    const original = structuredClone(conditions);
    const first = await optimiseLayouts(conditions, 'fan+purifier', false, evaluate, fixedClock);
    const second = await optimiseLayouts(conditions, 'fan+purifier', false, evaluate, fixedClock);
    expect(first.engine).toBe('2d-plan');
    expect(first.layouts).toHaveLength(3);
    expect(new Set(first.layouts.map(layout => JSON.stringify(layout.conditions))).size).toBe(3);
    expect(first.layouts.map(layout => layout.J)).toEqual(first.layouts.map(layout => layout.J).sort((a, b) => a - b));
    expect(first.layouts).toEqual(second.layouts);
    expect(first.layouts[0].J).toBeLessThanOrEqual(first.you.J);
    expect(first.layouts[0].improvementPct).toBeGreaterThanOrEqual(0);
    expect(first.layouts[0].improvementPct).toBeCloseTo((first.you.J - first.layouts[0].J) / first.you.J * 100, 8);
    expect(first.evaluations).toBeGreaterThan(1);
    expect(first.evaluations).toBeLessThanOrEqual(33);
    expect(conditions).toEqual(original);
  });

  for (const budget of ['fan', 'fan+purifier', 'fan+purifier+ac'] as const) {
    test(`proposed layouts respect the ${budget} device budget`, async () => {
      const conditions = defaultConditions();
      for (const name of Object.keys(conditions.devices)) conditions.devices[name] = true;
      conditions.portableFan = { on: true, slot: 0, speed: 3, angleDeg: 0 };
      conditions.purifier = { on: true, slot: 0 };
      const report = await optimiseLayouts(conditions, budget, false, evaluate, fixedClock);
      const proposals = report.layouts.filter(layout => JSON.stringify(layout.conditions) !== JSON.stringify(conditions));
      expect(proposals.length).toBeGreaterThan(0);
      for (const { conditions: proposal } of proposals) {
        expect(proposal.portableFan?.on).toBe(true);
        expect(proposal.portableFan?.speed).toBe(2);
        expect(proposal.portableFan!.slot).toBeGreaterThanOrEqual(0);
        expect(proposal.portableFan!.slot).toBeLessThan(FAN_SLOTS.length);
        expect([45, 90, 135]).toContain(proposal.portableFan!.angleDeg);
        expect(proposal.purifier?.on).toBe(budget !== 'fan');
        if (proposal.purifier?.on) {
          expect(proposal.purifier.slot).toBeGreaterThanOrEqual(0);
          expect(proposal.purifier.slot).toBeLessThan(PURIFIER_SLOTS.length);
        }
        const active = Object.entries(proposal.devices).filter(([, on]) => on).map(([name]) => name);
        expect(active).toHaveLength(budget === 'fan+purifier+ac' ? 1 : 0);
        if (active.length) {
          expect(['ac_living', 'ac_master', 'ac_bedroom2', 'ac_bedroom3']).toContain(active[0]);
          expect(proposal.acSetpoint).toBe(25);
        }
      }
      expect(report.evaluations).toBeLessThanOrEqual(33);
    });
  }

  test('keeps the current layout when it already beats every proposal, even outside the selected budget', async () => {
    const conditions = defaultConditions();
    conditions.devices.ac_living = true;
    const report = await optimiseLayouts(conditions, 'fan', false,
      candidate => result(candidate.devices.ac_living ? 27 : 34, 0, 0), fixedClock);
    expect(report.you.J).toBe(0);
    expect(report.layouts[0].conditions).toEqual(conditions);
    expect(report.layouts[0].J).toBe(0);
    expect(report.layouts[0].improvementPct).toBe(0);
    for (const layout of report.layouts) expect(Number.isFinite(layout.improvementPct)).toBe(true);
  });

  test('leaves every opening unchanged when suggestions are disabled', async () => {
    const conditions = defaultConditions();
    conditions.windows.window_master_1 = true;
    conditions.doors.door_kitchen = true;
    const evaluated: Conditions[] = [];
    await optimiseLayouts(conditions, 'fan', false, candidate => {
      evaluated.push(structuredClone(candidate));
      return evaluate(candidate);
    }, fixedClock);
    for (const candidate of evaluated) {
      expect(candidate.doors).toEqual(conditions.doors);
      expect(candidate.windows).toEqual(conditions.windows);
    }
  });

  test('suggests changes only to openings mapped to physical controls', async () => {
    const conditions = defaultConditions();
    conditions.windows.window_master_1 = true;
    conditions.doors.door_kitchen = true;
    const mapped = new Set<string>(Object.values(HARDWARE_OPENINGS));
    const evaluated: Conditions[] = [];
    await optimiseLayouts(conditions, 'fan+purifier+ac', true, candidate => {
      evaluated.push(structuredClone(candidate));
      return evaluate(candidate);
    }, fixedClock);
    const changed = new Set<string>();
    for (const candidate of evaluated) {
      for (const kind of ['doors', 'windows'] as const) {
        for (const [name, open] of Object.entries(candidate[kind])) {
          if (conditions[kind][name] !== open) {
            changed.add(name);
            expect(mapped.has(name)).toBe(true);
          }
        }
      }
    }
    expect(changed.size).toBe(mapped.size);
    expect(evaluated.length).toBeLessThanOrEqual(27 + mapped.size);
  });

  test('reports finite, monotonic progress while awaiting asynchronous evaluations', async () => {
    const progress: { done: number; total: number; bestJ: number }[] = [];
    const report = await optimiseLayouts(defaultConditions(), 'fan+purifier', true,
      async conditions => evaluate(conditions), { ...fixedClock, onProgress: entry => progress.push({ ...entry }) });
    expect(progress.length).toBeGreaterThan(1);
    expect(progress.at(-1)!.done).toBe(report.evaluations);
    for (const [index, entry] of progress.entries()) {
      expect(entry.done).toBeLessThanOrEqual(entry.total);
      expect(Number.isFinite(entry.bestJ)).toBe(true);
      if (index > 0) {
        expect(entry.done).toBeGreaterThanOrEqual(progress[index - 1].done);
        expect(entry.bestJ).toBeLessThanOrEqual(progress[index - 1].bestJ);
      }
    }
  });

  test('a pre-aborted signal rejects without evaluating any layout', async () => {
    const controller = new AbortController();
    controller.abort();
    let calls = 0;
    await expect(optimiseLayouts(defaultConditions(), 'fan', false, conditions => {
      calls++;
      return evaluate(conditions);
    }, { ...fixedClock, signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(calls).toBe(0);
  });

  test('cancellation during an asynchronous evaluation rejects before more evaluations start', async () => {
    const controller = new AbortController();
    let calls = 0;
    await expect(optimiseLayouts(defaultConditions(), 'fan', false, async conditions => {
      calls++;
      await Promise.resolve();
      controller.abort();
      return evaluate(conditions);
    }, { ...fixedClock, signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(calls).toBe(1);
  });

  test('rejects an invalid baseline evaluation', async () => {
    await expect(optimiseLayouts(defaultConditions(), 'fan', false, () => result(NaN), fixedClock)).rejects.toThrow();
  });

  test('reports candidate evaluation failures rather than silently returning an incomplete search', async () => {
    let calls = 0;
    await expect(optimiseLayouts(defaultConditions(), 'fan', false, conditions => {
      if (++calls > 1) throw new Error('simulation failed');
      return evaluate(conditions);
    }, fixedClock)).rejects.toThrow('simulation failed');
  });

  test('returns the evaluated baseline as a partial result when the time budget expires', async () => {
    let clock = 0;
    let calls = 0;
    const report = await optimiseLayouts(defaultConditions(), 'fan', false, conditions => {
      calls++;
      clock = 12;
      return evaluate(conditions);
    }, { now: () => clock, timeBudgetMs: 10, simulatedSeconds: 120 });
    expect(calls).toBe(1);
    expect(report.evaluations).toBe(1);
    expect(report.partial).toBe(true);
    expect(report.layouts).toHaveLength(1);
    expect(report.layouts[0].conditions).toEqual(defaultConditions());
    expect(report.layouts[0].J).toBe(report.you.J);
    expect(report.simulatedSeconds).toBe(120);
    expect(report.durationMs).toBeGreaterThanOrEqual(10);
  });

  test('rejects unsupported runtime budgets', async () => {
    const invalidBudget = 'unlimited' as Parameters<typeof optimiseLayouts>[1];
    await expect(optimiseLayouts(defaultConditions(), invalidBudget, false, evaluate, fixedClock)).rejects.toThrow();
  });
});

describe('optimiser worker lifecycle', () => {
  const workers: StubWorker[] = [];
  class StubWorker {
    onmessage: ((event: MessageEvent<WorkerResponse>) => void) | null = null;
    onerror: ((event: ErrorEvent) => void) | null = null;
    onmessageerror: (() => void) | null = null;
    postMessage = vi.fn();
    terminate = vi.fn();
    constructor() { workers.push(this); }
    deliver(data: WorkerResponse) { this.onmessage?.(new MessageEvent('message', { data })); }
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

  test('contains worker failures and terminates a run that reaches its 29-second deadline', () => {
    const callbacks = { onProgress: vi.fn(), onResult: vi.fn(), onError: vi.fn() };
    const optimiser = createOptimiser(callbacks);
    optimiser.run(defaultConditions(), 'fan');
    expect(workers[0].fail('Worker crashed').defaultPrevented).toBe(true);
    expect(callbacks.onError).toHaveBeenCalledExactlyOnceWith('Worker crashed');
    expect(workers[0].terminate).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(29_000);
    expect(callbacks.onError).toHaveBeenCalledTimes(1);

    optimiser.run(defaultConditions(), 'fan+purifier');
    vi.advanceTimersByTime(28_999);
    expect(workers[1].terminate).not.toHaveBeenCalled();
    expect(callbacks.onError).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(workers[1].terminate).toHaveBeenCalledTimes(1);
    expect(callbacks.onError).toHaveBeenLastCalledWith(expect.stringContaining('29 seconds'));
    expect(callbacks.onError).toHaveBeenCalledTimes(2);
    expect(callbacks.onResult).not.toHaveBeenCalled();
    optimiser.dispose();
  });

  test('replaces and cancels workers safely, ignores stale replies, and accepts only the active result', async () => {
    const callbacks = { onProgress: vi.fn(), onResult: vi.fn(), onError: vi.fn() };
    const optimiser = createOptimiser(callbacks);
    const report = await optimiseLayouts(defaultConditions(), 'fan', false, evaluate, fixedClock);
    const progress = { done: 1, total: 16, bestJ: report.you.J };
    optimiser.run(defaultConditions(), 'fan');
    optimiser.run(defaultConditions(), 'fan+purifier', false);
    expect(workers[0].terminate).toHaveBeenCalledTimes(1);
    workers[0].deliver({ type: 'progress', progress });
    workers[0].deliver({ type: 'result', report });
    workers[0].fail('Stale failure');
    expect(callbacks.onProgress).not.toHaveBeenCalled();
    expect(callbacks.onResult).not.toHaveBeenCalled();
    expect(callbacks.onError).not.toHaveBeenCalled();
    expect(workers[1].terminate).not.toHaveBeenCalled();

    optimiser.cancel();
    expect(workers[1].terminate).toHaveBeenCalledTimes(1);
    workers[1].deliver({ type: 'result', report });
    vi.runAllTimers();
    expect(callbacks.onResult).not.toHaveBeenCalled();
    expect(callbacks.onError).not.toHaveBeenCalled();

    optimiser.run(defaultConditions(), 'fan');
    workers[2].deliver({ type: 'progress', progress });
    workers[2].deliver({ type: 'result', report });
    workers[2].deliver({ type: 'result', report });
    expect(workers[2].terminate).toHaveBeenCalledTimes(1);
    expect(callbacks.onProgress).toHaveBeenCalledExactlyOnceWith(progress);
    expect(callbacks.onResult).toHaveBeenCalledExactlyOnceWith(report);
    vi.runAllTimers();
    expect(callbacks.onError).not.toHaveBeenCalled();
    optimiser.dispose();
  });
});
