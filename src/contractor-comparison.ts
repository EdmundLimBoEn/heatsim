import type { Conditions } from './domain';
import { parseContractorPlan, contractorPlanGeometryId, type ContractorPlan } from './contractor-plan';
import { createThermalModel, THERMAL_MODEL_PARAMETERS } from './thermal-model';
import type { ThermalConfig, ThermalSnapshot, ThermalState } from './thermal-types';

export interface ContractorStudyBrief {
  projectName: string; locationLabel: string; latitude: number | null; longitude: number | null;
  sourceType: 'assumption' | 'forecast' | 'observation'; sourceName: string; sourceModel: string;
  sourceUrl: string; validTime: string; timeZone: string; referenceHeightM: number; enteredAt: string;
}
export interface ContractorStudyConfig {
  plans: ContractorPlan[];
  weather: Conditions;
  durationSeconds: number;
  initialTemperature: number;
  initialPm25: number;
  occupancyPeople?: number;
  brief?: ContractorStudyBrief;
}
export interface ContractorComparisonProgress {
  done: number; total: number; planIndex: number; planName: string;
  elapsedSeconds: number; durationSeconds: number;
}
export interface ContractorPlanCase {
  plan: ContractorPlan;
  /** Full plan input fingerprint; not a geometry-equivalence or security guarantee. */
  geometryId: string;
  config: ThermalConfig;
  areaM2: number;
  initialState: ThermalState;
  initial: ThermalSnapshot;
  final: ThermalSnapshot;
  samples: ThermalSnapshot[];
  pmExposureUgHoursM3: number;
  energyWhPerM2: number;
  fanEnergyWh: number;
  enabledEquipment: { fans: number; purifiers: number; ac: number };
}
export interface ContractorRecommendation {
  metric: 'temperature' | 'pm25' | 'electricity';
  label: string; planIds: string[]; value: number; unit: string; tolerance: number; reason: string;
}
export interface ContractorComparisonResult {
  config: ContractorStudyConfig;
  cases: ContractorPlanCase[];
  recommendations: ContractorRecommendation[];
  shortlistPlanIds: string[];
  warnings: string[];
  scope: 'single-weather-case';
  runtimeMs: number;
}
export type ContractorWorkerRequest = { type: 'run'; config: ContractorStudyConfig };
export type ContractorWorkerResponse =
  | { type: 'progress'; progress: ContractorComparisonProgress }
  | { type: 'result'; result: ContractorComparisonResult }
  | { type: 'error'; message: string };

function range(value: number, label: string, low: number, high: number): void {
  if (!Number.isFinite(value) || value < low || value > high) throw new Error(`${label} must be between ${low} and ${high}.`);
}

function prepareStudy(input: ContractorStudyConfig): ContractorStudyConfig {
  if (!Array.isArray(input.plans) || input.plans.length !== 3) throw new Error('A contractor study needs exactly three plans.');
  const config = structuredClone(input);
  config.plans = config.plans.map(plan => parseContractorPlan(plan));
  if (new Set(config.plans.map(plan => plan.id)).size !== 3) throw new Error('Each study plan needs a different ID.');
  if (!Number.isFinite(config.durationSeconds) || config.durationSeconds <= 0 || config.durationSeconds > 7_200) {
    throw new Error('Study duration must be greater than zero and no longer than 120 minutes.');
  }
  range(config.initialTemperature, 'Initial temperature', 10, 60);
  range(config.initialPm25, 'Initial PM2.5', 0, 1_000);
  config.occupancyPeople ??= 4;
  range(config.occupancyPeople, 'Total occupants', 0, 100);
  range(config.weather.outdoorTemperature, 'Outdoor temperature', 10, 60);
  range(config.weather.outdoorPm25, 'Outdoor PM2.5', 0, 1_000);
  range(config.weather.humidity, 'Humidity', 0, 100);
  range(config.weather.windSpeed, 'Wind speed', 0, 10);
  range(config.weather.timeOfDay, 'Time of day', 0, 24);
  range(config.weather.acSetpoint, 'AC setpoint', 16, 32);
  if (config.weather.windFrom !== undefined && !['N', 'E', 'S', 'W'].includes(config.weather.windFrom)) throw new Error('Wind direction must be N, E, S or W.');
  if (config.brief) {
    const brief = config.brief;
    if (!['assumption', 'forecast', 'observation'].includes(brief.sourceType)) throw new Error('Choose an assumption, forecast or observation source.');
    for (const value of [brief.projectName, brief.locationLabel, brief.sourceName, brief.sourceModel, brief.sourceUrl, brief.validTime, brief.timeZone, brief.enteredAt]) {
      if (typeof value !== 'string' || value.length > 2_000) throw new Error('Study provenance fields must be text no longer than 2,000 characters.');
    }
    if (brief.latitude !== null) range(brief.latitude, 'Latitude', -90, 90);
    if (brief.longitude !== null) range(brief.longitude, 'Longitude', -180, 180);
    range(brief.referenceHeightM, 'Wind reference height', 0.1, 1_000);
  }
  return config;
}

function checkSnapshot(snapshot: ThermalSnapshot, roomCount: number): void {
  const values = [
    ...Object.values(snapshot).filter((value): value is number => typeof value === 'number'),
    ...Object.values(snapshot.heatBudgetW),
    ...snapshot.rooms.flatMap(room => Object.values(room).filter((value): value is number => typeof value === 'number')),
    ...(snapshot.openingFlows ?? []).flatMap(flow => [flow.lowerM3h, flow.upperM3h, flow.netM3h, flow.grossM3h]),
  ];
  if (snapshot.rooms.length !== roomCount || !values.every(Number.isFinite) || snapshot.energyWh < 0) {
    throw new Error('A plan returned invalid simulation readings. The study was stopped.');
  }
}

export function recommendContractorPlans(cases: readonly ContractorPlanCase[]): Pick<ContractorComparisonResult, 'recommendations' | 'shortlistPlanIds'> {
  if (!cases.length) throw new Error('No completed plans are available to compare.');
  const leastEnergy = Math.min(...cases.map(option => option.final.energyWh));
  const metrics = [
    { metric: 'temperature', key: 'averageTemperature', label: 'Lowest mean indoor air temperature', unit: '°C', tolerance: 0.1 },
    { metric: 'pm25', key: 'averagePm25', label: 'Lowest final mean PM2.5', unit: 'µg/m³', tolerance: 1 },
    { metric: 'electricity', key: 'energyWh', label: 'Lowest total electricity', unit: 'Wh', tolerance: Math.max(0.1, leastEnergy * 0.01) },
  ] as const;
  const recommendations = metrics.map(metric => {
    const value = Math.min(...cases.map(option => option.final[metric.key]));
    const planIds = cases.filter(option => option.final[metric.key] - value <= metric.tolerance + 1e-9).map(option => option.plan.id).sort();
    return { metric: metric.metric, label: metric.label, planIds, value, unit: metric.unit, tolerance: metric.tolerance,
      reason: `This weather case only. Results within ${metric.tolerance.toFixed(2)} ${metric.unit} of the lowest value are tied; other outcomes can favour another plan.` };
  });
  const shortlistPlanIds = cases.filter(option => !cases.some(other => other !== option
    && metrics.every(metric => other.final[metric.key] <= option.final[metric.key] + 1e-9)
    && metrics.some(metric => other.final[metric.key] < option.final[metric.key] - metric.tolerance - 1e-9)))
    .map(option => option.plan.id).sort();
  return { recommendations, shortlistPlanIds };
}

export function compareContractorPlans(
  input: ContractorStudyConfig,
  options: { onProgress?: (progress: ContractorComparisonProgress) => void; signal?: AbortSignal } = {},
): ContractorComparisonResult {
  const started = performance.now(), config = prepareStudy(input);
  const checkCancelled = () => { if (options.signal?.aborted) throw new DOMException('Contractor study cancelled.', 'AbortError'); };
  checkCancelled();
  const steps = Math.ceil(config.durationSeconds / 10), sampleEvery = Math.ceil(steps / 120);
  const cases: ContractorPlanCase[] = [];
  for (const [planIndex, plan] of config.plans.entries()) {
    checkCancelled();
    const instance = createThermalModel(plan);
    const settings = instance.createConfig(config.weather);
    settings.durationSeconds = config.durationSeconds;
    settings.initialTemperature = config.initialTemperature;
    settings.initialPm25 = config.initialPm25;
    settings.occupancyPeople = config.occupancyPeople;
    let state = instance.createState(settings);
    const initialState = structuredClone(state);
    for (const field of [state.lowerT, state.upperT, state.wallT, state.lowerPm25, state.upperPm25]) {
      const expected = field === state.lowerPm25 || field === state.upperPm25 ? config.initialPm25 : config.initialTemperature;
      if (field.length !== instance.rooms.length || !field.every(value => Number.isFinite(value) && Math.abs(value - expected) < 1e-8)) {
        throw new Error('The plans did not start from the same requested temperature and particle levels.');
      }
    }
    const initial = instance.snapshot(state, settings);
    checkSnapshot(initial, instance.rooms.length);
    let final = initial, pmExposureUgHoursM3 = 0;
    const samples = [initial];
    const progress = (step: number) => options.onProgress?.({ done: planIndex * steps + step, total: config.plans.length * steps,
      planIndex, planName: plan.name, elapsedSeconds: Math.min(step * 10, config.durationSeconds), durationSeconds: config.durationSeconds });
    progress(0);
    for (let step = 1; step <= steps; step++) {
      checkCancelled();
      const dt = Math.min(10, config.durationSeconds - (step - 1) * 10);
      state = instance.step(state, settings, dt);
      const next = instance.snapshot(state, settings);
      checkSnapshot(next, instance.rooms.length);
      const elapsed = Math.min(step * 10, config.durationSeconds), actualDt = next.elapsedSeconds - final.elapsedSeconds;
      if (Math.abs(next.elapsedSeconds - elapsed) > 1e-7 || actualDt <= 0) throw new Error('A plan did not reach the shared study horizon.');
      pmExposureUgHoursM3 += (final.averagePm25 + next.averagePm25) / 2 * actualDt / 3_600;
      final = next;
      if (step % sampleEvery === 0 || step === steps) { samples.push(next); progress(step); }
    }
    const enabledEquipment = {
      fans: plan.devices.filter(device => device.on && device.kind === 'fan').length,
      purifiers: plan.devices.filter(device => device.on && device.kind === 'purifier').length,
      ac: plan.devices.filter(device => device.on && device.kind === 'ac').length,
    };
    const areaM2 = instance.rooms.reduce((sum, room) => sum + room.area_m2, 0);
    cases.push({ plan, geometryId: contractorPlanGeometryId(plan), config: settings, areaM2, initialState, initial, final, samples,
      pmExposureUgHoursM3, energyWhPerM2: final.energyWh / areaM2,
      fanEnergyWh: final.fanEnergyWh + enabledEquipment.fans * THERMAL_MODEL_PARAMETERS.circulationFanWatts * config.durationSeconds / 3_600,
      enabledEquipment });
  }
  checkCancelled();
  const warnings = ['One weather case only. Rankings may change with weather and operating assumptions; no ranking-stability analysis was run.',
    'This is uncalibrated screening, not a prediction of construction performance or a health assessment.'];
  const areas = cases.map(option => option.areaM2);
  if (Math.max(...areas) - Math.min(...areas) > 1e-6) warnings.push('Floor areas differ. Total electricity is not a like-for-like efficiency comparison; review Wh/m² alongside Wh.');
  if (new Set(cases.map(option => JSON.stringify(option.enabledEquipment))).size > 1) warnings.push('Enabled equipment counts differ. Results reflect both the layouts and the declared devices.');
  return { config, cases, ...recommendContractorPlans(cases), warnings, scope: 'single-weather-case', runtimeMs: performance.now() - started };
}

export function createContractorComparisonRunner() {
  type Pending = { worker: Worker; timer?: ReturnType<typeof setTimeout>; resolve: (result: ContractorComparisonResult) => void; reject: (error: Error) => void };
  let active: Pending | null = null;
  const cleanUp = (run: Pending) => { clearTimeout(run.timer); run.worker.terminate(); if (active === run) active = null; };
  const fail = (run: Pending, error: Error) => { if (active === run) { cleanUp(run); run.reject(error); } };
  const cancel = () => { if (active) fail(active, new DOMException('Contractor study cancelled.', 'AbortError')); };
  return {
    run(config: ContractorStudyConfig, onProgress?: (progress: ContractorComparisonProgress) => void): Promise<ContractorComparisonResult> {
      cancel();
      return new Promise((resolve, reject) => {
        let pending: Pending | undefined;
        try {
          const worker = new Worker(new URL('./contractor-worker.ts', import.meta.url), { type: 'module' });
          pending = { worker, resolve, reject };
          const run = pending;
          active = run;
          worker.onmessage = (event: MessageEvent<ContractorWorkerResponse>) => {
            if (active !== run) return;
            try {
              const message = event.data;
              if (message.type === 'progress') onProgress?.(message.progress);
              else if (message.type === 'result') { cleanUp(run); resolve(message.result); }
              else if (message.type === 'error') fail(run, new Error(message.message));
            } catch (error) { fail(run, error instanceof Error ? error : new Error('Could not read the study result.')); }
          };
          worker.onerror = event => { event.preventDefault(); fail(run, new Error(event.message || 'The contractor study worker failed.')); };
          worker.onmessageerror = () => fail(run, new Error('Could not decode the study result.'));
          run.timer = setTimeout(() => fail(run, new Error('Contractor study exceeded 30 seconds. Try a shorter duration.')), 30_000);
          worker.postMessage({ type: 'run', config: structuredClone(config) } satisfies ContractorWorkerRequest);
        } catch (error) {
          const failure = error instanceof Error ? error : new Error('Could not start the contractor study.');
          if (pending) fail(pending, failure); else reject(failure);
        }
      });
    }, cancel, dispose: cancel,
  };
}
