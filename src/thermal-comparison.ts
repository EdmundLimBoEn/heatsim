import { createThermalState, stepThermalState, thermalSnapshot } from './thermal-model';
import type { ThermalConfig, ThermalHeatBudget, ThermalSnapshot, ThermalState } from './thermal-types';

export type ThermalComparisonConfig = ThermalConfig;
export interface ThermalComparisonProgress {
  done: number;
  total: number;
  elapsedSeconds: number;
  durationSeconds: number;
}
export interface ThermalComparisonCase {
  initial: ThermalSnapshot;
  final: ThermalSnapshot;
  samples: ThermalSnapshot[];
  pmExposureUgHoursM3: number;
}
export interface ThermalComparisonResult {
  config: ThermalConfig;
  initialState: ThermalState;
  durationSeconds: number;
  runtimeMs: number;
  off: ThermalComparisonCase;
  on: ThermalComparisonCase;
  difference: {
    averageTemperature: number;
    averageUpperTemperature: number;
    averagePm25: number;
    storedEnergyJ: number;
    energyWh: number;
    pmExposureUgHoursM3: number;
    heatBudgetW: ThermalHeatBudget;
  };
}
export type ThermalWorkerRequest = { type: 'run'; config: ThermalComparisonConfig };
export type ThermalWorkerResponse =
  | { type: 'progress'; progress: ThermalComparisonProgress }
  | { type: 'result'; result: ThermalComparisonResult }
  | { type: 'error'; message: string };

const MAX_DURATION_SECONDS = 7_200;
const MAX_SAMPLES = 121;
const TIMEOUT_MS = 30_000;

function validateDuration(durationSeconds: number): void {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0 || durationSeconds > MAX_DURATION_SECONDS) {
    throw new Error('Choose a comparison duration greater than zero and no longer than 120 minutes.');
  }
}

function checkSnapshot(snapshot: ThermalSnapshot): void {
  const numbers = [
    ...Object.values(snapshot).filter((value): value is number => typeof value === 'number'),
    ...Object.values(snapshot.heatBudgetW),
    ...snapshot.rooms.flatMap(room => Object.values(room).filter((value): value is number => typeof value === 'number')),
  ];
  if (snapshot.rooms.length === 0 || !numbers.every(Number.isFinite)) {
    throw new Error('The thermal model returned invalid readings. The comparison was stopped.');
  }
}

export function compareThermalCases(
  input: ThermalComparisonConfig,
  options: { onProgress?: (progress: ThermalComparisonProgress) => void; signal?: AbortSignal } = {},
): ThermalComparisonResult {
  validateDuration(input.durationSeconds);
  const started = performance.now();
  const checkCancelled = () => {
    if (options.signal?.aborted) throw new DOMException('Thermal comparison cancelled.', 'AbortError');
  };
  checkCancelled();
  const config = structuredClone(input);
  const offConfig = structuredClone(config), onConfig = structuredClone(config);
  offConfig.vent.on = false;
  onConfig.vent.on = true;
  const initialState = createThermalState(offConfig);
  let offState = structuredClone(initialState), onState = structuredClone(initialState);
  const offInitial = thermalSnapshot(offState, offConfig), onInitial = thermalSnapshot(onState, onConfig);
  checkSnapshot(offInitial);
  checkSnapshot(onInitial);
  const off: ThermalComparisonCase = { initial: offInitial, final: offInitial, samples: [offInitial], pmExposureUgHoursM3: 0 };
  const on: ThermalComparisonCase = { initial: onInitial, final: onInitial, samples: [onInitial], pmExposureUgHoursM3: 0 };
  const total = Math.ceil(config.durationSeconds / 10);
  const sampleEvery = Math.ceil(total / (MAX_SAMPLES - 1));
  options.onProgress?.({ done: 0, total, elapsedSeconds: 0, durationSeconds: config.durationSeconds });
  for (let step = 1; step <= total; step++) {
    checkCancelled();
    const dt = Math.min(10, config.durationSeconds - (step - 1) * 10);
    offState = stepThermalState(offState, offConfig, dt);
    onState = stepThermalState(onState, onConfig, dt);
    const offNext = thermalSnapshot(offState, offConfig), onNext = thermalSnapshot(onState, onConfig);
    checkSnapshot(offNext);
    checkSnapshot(onNext);
    const offDt = offNext.elapsedSeconds - off.final.elapsedSeconds;
    const onDt = onNext.elapsedSeconds - on.final.elapsedSeconds;
    const elapsed = Math.min(step * 10, config.durationSeconds);
    if (Math.abs(offNext.elapsedSeconds - elapsed) > 1e-7 || Math.abs(onNext.elapsedSeconds - elapsed) > 1e-7 || offDt <= 0 || onDt <= 0) {
      throw new Error('The comparison arms did not advance to the same simulated time.');
    }
    off.pmExposureUgHoursM3 += (off.final.averagePm25 + offNext.averagePm25) / 2 * offDt / 3_600;
    on.pmExposureUgHoursM3 += (on.final.averagePm25 + onNext.averagePm25) / 2 * onDt / 3_600;
    off.final = offNext;
    on.final = onNext;
    if (step % sampleEvery === 0 || step === total) {
      off.samples.push(offNext);
      on.samples.push(onNext);
      options.onProgress?.({ done: step, total, elapsedSeconds: elapsed, durationSeconds: config.durationSeconds });
    }
  }
  checkCancelled();
  const heatBudgetW = { ...on.final.heatBudgetW };
  for (const key of Object.keys(heatBudgetW) as (keyof ThermalHeatBudget)[]) heatBudgetW[key] -= off.final.heatBudgetW[key];
  return {
    config, initialState, durationSeconds: config.durationSeconds, runtimeMs: performance.now() - started, off, on,
    difference: {
      averageTemperature: on.final.averageTemperature - off.final.averageTemperature,
      averageUpperTemperature: on.final.averageUpperTemperature - off.final.averageUpperTemperature,
      averagePm25: on.final.averagePm25 - off.final.averagePm25,
      storedEnergyJ: on.final.storedEnergyJ - off.final.storedEnergyJ,
      energyWh: on.final.energyWh - off.final.energyWh,
      pmExposureUgHoursM3: on.pmExposureUgHoursM3 - off.pmExposureUgHoursM3,
      heatBudgetW,
    },
  };
}

export function createThermalComparisonRunner() {
  type Pending = {
    worker: Worker;
    timer?: ReturnType<typeof setTimeout>;
    resolve: (result: ThermalComparisonResult) => void;
    reject: (error: Error) => void;
  };
  let active: Pending | null = null;
  const cleanUp = (pending: Pending) => {
    clearTimeout(pending.timer);
    pending.worker.terminate();
    if (active === pending) active = null;
  };
  const fail = (pending: Pending, error: Error) => {
    if (active !== pending) return;
    cleanUp(pending);
    pending.reject(error);
  };
  const cancel = () => { if (active) fail(active, new DOMException('Thermal comparison cancelled.', 'AbortError')); };
  return {
    run(config: ThermalComparisonConfig, onProgress?: (progress: ThermalComparisonProgress) => void): Promise<ThermalComparisonResult> {
      cancel();
      return new Promise((resolve, reject) => {
        let pending: Pending | undefined;
        try {
          validateDuration(config.durationSeconds);
          const worker = new Worker(new URL('./thermal-worker.ts', import.meta.url), { type: 'module' });
          pending = { worker, resolve, reject };
          const run = pending;
          active = run;
          worker.onmessage = (event: MessageEvent<ThermalWorkerResponse>) => {
            if (active !== run) return;
            try {
              const message = event.data;
              if (message.type === 'progress') onProgress?.(message.progress);
              else if (message.type === 'result') { cleanUp(run); resolve(message.result); }
              else if (message.type === 'error') fail(run, new Error(message.message));
            } catch (error) {
              fail(run, error instanceof Error ? error : new Error('Could not read the comparison result.'));
            }
          };
          worker.onerror = event => {
            event.preventDefault();
            fail(run, new Error(event.message || 'The comparison worker failed.'));
          };
          worker.onmessageerror = () => fail(run, new Error('Could not decode the comparison result.'));
          run.timer = setTimeout(() => fail(run, new Error('Thermal comparison exceeded 30 seconds. Try a shorter duration.')), TIMEOUT_MS);
          worker.postMessage({ type: 'run', config: structuredClone(config) } satisfies ThermalWorkerRequest);
        } catch (error) {
          const failure = error instanceof Error ? error : new Error('Could not start the comparison worker.');
          if (pending) fail(pending, failure);
          else reject(failure);
        }
      });
    },
    cancel,
    dispose: cancel,
  };
}
