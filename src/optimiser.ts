import { model, type Conditions, type SimulationResult } from './domain';
import { HARDWARE_OPENINGS } from './config/mapping';
import { FAN_SLOTS, PURIFIER_SLOTS } from './config/slots';
import { resolveStandingFans, validateStandingFanPosition, STANDING_FAN_CLEARANCE_M, PORTABLE_PURIFIER_CLEARANCE_M } from './standing-fans';

export type OptimiserBudget = 'fan' | 'fan+purifier' | 'fan+purifier+ac';
export interface ScoreBreakdown { heat: number; haze: number; energy: number }
export interface OptimisedLayout {
  conditions: Conditions;
  result: SimulationResult;
  J: number;
  breakdown: ScoreBreakdown;
  improvementPct: number;
}
export interface OptimiserProgress { done: number; total: number; bestJ: number }
export interface OptimiserReport {
  engine: '2d-plan';
  you: OptimisedLayout;
  layouts: OptimisedLayout[];
  evaluations: number;
  durationMs: number;
  simulatedSeconds: number;
  partial: boolean;
}
export interface SearchOptions {
  onProgress?: (progress: OptimiserProgress) => void;
  signal?: AbortSignal;
  timeBudgetMs?: number;
  now?: () => number;
  simulatedSeconds?: number;
}
export type WorkerRequest = { type: 'run'; conditions: Conditions; budget: OptimiserBudget; suggestOpenings: boolean };
export type WorkerResponse =
  | { type: 'progress'; progress: OptimiserProgress }
  | { type: 'result'; report: OptimiserReport }
  | { type: 'error'; message: string };

const roomAreas = new Map(model.rooms.map(room => [room.name, room.area_m2]));
const acUnits = model.boxes.filter(box => box.type === 'device' && /^ac_(living|master|bedroom2|bedroom3)$/.test(box.name)).map(box => box.name);
export const OPTIMISER_SECONDS = 120;

export function scoreResult(result: SimulationResult): { J: number; breakdown: ScoreBreakdown } {
  const summary = [result.averageFeelsLike, result.averageTemperature, result.averagePm25, result.powerWatts, result.energyKwh, result.elapsedSeconds];
  if (result.rooms.length === 0 || !summary.every(Number.isFinite) || result.powerWatts < 0) {
    throw new Error('The optimiser received invalid simulation readings. Your layout is unchanged.');
  }
  let area = 0, heat = 0, haze = 0;
  for (const room of result.rooms) {
    const weight = roomAreas.get(room.room);
    if (!weight || ![room.temperature, room.feelsLike, room.pm25, room.airflow].every(Number.isFinite) || room.pm25 < 0) {
      throw new Error('The optimiser received invalid room readings. Your layout is unchanged.');
    }
    area += weight;
    heat += Math.max(0, room.feelsLike - 28) * weight;
    haze += room.pm25 / 35 * weight;
  }
  const breakdown = { heat: heat / area, haze: haze / area, energy: result.powerWatts / 1_000 };
  const J = breakdown.heat + breakdown.haze + breakdown.energy;
  if (!Number.isFinite(J)) throw new Error('The optimiser score is not finite. Your layout is unchanged.');
  return { J, breakdown };
}

function layoutKey(conditions: Conditions): string {
  const sorted = (values: Record<string, boolean>) => Object.entries(values).sort(([a], [b]) => a.localeCompare(b));
  return JSON.stringify({ ...conditions, doors: sorted(conditions.doors), windows: sorted(conditions.windows), devices: sorted(conditions.devices) });
}

export async function optimiseLayouts(
  conditions: Conditions,
  budget: OptimiserBudget,
  suggestOpenings: boolean,
  evaluate: (conditions: Conditions) => SimulationResult | Promise<SimulationResult>,
  options: SearchOptions = {},
): Promise<OptimiserReport> {
  if (!['fan', 'fan+purifier', 'fan+purifier+ac'].includes(budget)) throw new Error('Unknown optimiser budget.');
  const captured = structuredClone(conditions);
  const extraFanKey = (value: Conditions) => JSON.stringify(resolveStandingFans(value).filter(fan => !fan.isPrimary));
  const fixedExtraFans = extraFanKey(captured);
  const now = options.now ?? (() => performance.now());
  const started = now(), limit = options.timeBudgetMs ?? 25_000;
  const cache = new Map<string, OptimisedLayout>();
  const total = 2 + (suggestOpenings ? Object.keys(HARDWARE_OPENINGS).length : 0)
    + (budget.includes('ac') ? acUnits.length : 0) + (budget.includes('purifier') ? PURIFIER_SLOTS.length : 0) + FAN_SLOTS.length * 3;
  const deadline = Symbol('deadline');
  let bestJ = Infinity;
  const checkCancelled = () => {
    if (options.signal?.aborted) throw new DOMException('Optimisation cancelled.', 'AbortError');
  };
  const evaluateLayout = async (candidate: Conditions, baseline = false): Promise<OptimisedLayout> => {
    checkCancelled();
    const key = layoutKey(candidate), cached = cache.get(key);
    if (cached) return cached;
    if (!baseline && now() - started >= limit) throw deadline;
    const result = await evaluate(structuredClone(candidate));
    checkCancelled();
    const scored: OptimisedLayout = { conditions: structuredClone(candidate), result, ...scoreResult(result), improvementPct: 0 };
    cache.set(key, scored);
    bestJ = Math.min(bestJ, scored.J);
    options.onProgress?.({ done: cache.size, total, bestJ });
    return scored;
  };
  const you = await evaluateLayout(captured, true);
  let partial = false;
  try {
    const empty = structuredClone(captured);
    for (const name of Object.keys(empty.devices)) empty.devices[name] = false;
    if (empty.portableFan) empty.portableFan.on = false;
    if (empty.purifier) empty.purifier.on = false;
    let current = await evaluateLayout(empty);
    if (suggestOpenings) {
      for (const [key, name] of Object.entries(HARDWARE_OPENINGS)) {
        const candidate = structuredClone(current.conditions);
        const openings = key.startsWith('WIN') ? candidate.windows : candidate.doors;
        openings[name] = !openings[name];
        const scored = await evaluateLayout(candidate);
        if (scored.J < current.J * 0.98) current = scored;
      }
    }
    const choose = async (candidates: Conditions[], movedDevice?: 'primary' | 'purifier') => {
      let best = current;
      for (const candidate of candidates) {
        if (extraFanKey(candidate) !== fixedExtraFans) continue;
        if (movedDevice === 'primary') {
          const slot = FAN_SLOTS[candidate.portableFan!.slot];
          if (!validateStandingFanPosition(slot.x, slot.z, candidate, 'primary').valid) continue;
        } else if (movedDevice === 'purifier') {
          const slot = PURIFIER_SLOTS[candidate.purifier!.slot];
          if (resolveStandingFans(candidate).some(fan => Math.hypot(fan.x - slot.x, fan.z - slot.z)
            < STANDING_FAN_CLEARANCE_M + PORTABLE_PURIFIER_CLEARANCE_M - 1e-8)) continue;
        }
        const scored = await evaluateLayout(candidate);
        if (scored.J < best.J) best = scored;
      }
      current = best;
    };
    if (budget.includes('ac')) {
      await choose(acUnits.map(name => {
        const candidate = structuredClone(current.conditions);
        candidate.devices[name] = true;
        candidate.acSetpoint = 25;
        return candidate;
      }));
    }
    if (budget.includes('purifier')) {
      await choose(PURIFIER_SLOTS.map((_, slot) => ({ ...structuredClone(current.conditions), purifier: { ...current.conditions.purifier, on: true, slot } })), 'purifier');
    }
    // Slot proposals replace only the primary fan's manual placement; additional fans stay fixed.
    await choose(FAN_SLOTS.flatMap((_, slot) => [45, 90, 135].map(angleDeg => ({
      ...structuredClone(current.conditions), portableFan: { on: true, slot, angleDeg, speed: 2 },
    }))), 'primary');
  } catch (error) {
    if (error !== deadline) throw error;
    partial = true;
  }
  checkCancelled();
  const layouts = [...cache.values()].sort((a, b) => a.J - b.J).slice(0, 3).map(layout => ({
    ...layout, improvementPct: you.J > 0 ? (you.J - layout.J) / you.J * 100 : 0,
  }));
  options.onProgress?.({ done: cache.size, total: cache.size, bestJ });
  return {
    engine: '2d-plan', you, layouts, evaluations: cache.size, durationMs: Math.max(0, now() - started),
    simulatedSeconds: options.simulatedSeconds ?? OPTIMISER_SECONDS, partial,
  };
}

export function createOptimiser(callbacks: {
  onProgress: (progress: OptimiserProgress) => void;
  onResult: (report: OptimiserReport) => void;
  onError: (message: string) => void;
}) {
  let active: Worker | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cancel = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    active?.terminate();
    active = null;
  };
  const fail = (message: string) => { cancel(); callbacks.onError(message); };
  return {
    run(conditions: Conditions, budget: OptimiserBudget, suggestOpenings = true) {
      cancel();
      try {
        const worker = new Worker(new URL('./optimiser.worker.ts', import.meta.url), { type: 'module' });
        active = worker;
        worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
          if (active !== worker) return;
          const message = event.data;
          if (message.type === 'progress') callbacks.onProgress(message.progress);
          else if (message.type === 'result') { cancel(); callbacks.onResult(message.report); }
          else if (message.type === 'error') fail(message.message);
        };
        worker.onerror = event => {
          event.preventDefault();
          if (active === worker) fail(event.message || 'Optimiser worker failed. Your layout is unchanged.');
        };
        worker.onmessageerror = () => { if (active === worker) fail('Could not read the optimiser result. Your layout is unchanged.'); };
        timer = setTimeout(() => fail('Optimisation exceeded 29 seconds. Your layout is unchanged; try a smaller budget.'), 29_000);
        worker.postMessage({ type: 'run', conditions: structuredClone(conditions), budget, suggestOpenings } satisfies WorkerRequest);
      } catch (error) {
        fail(error instanceof Error ? error.message : 'Could not start the optimiser.');
      }
    },
    cancel,
    dispose: cancel,
  };
}
