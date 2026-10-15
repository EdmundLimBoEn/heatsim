import { model, type Conditions, type SimulationResult } from './domain';
import { createPlanGpu, type PlanGpu } from './plan-gpu';
import { createSimulation, stepSimulation } from './plan-simulation';
import { PRESETS } from './simulation';

const status = document.querySelector<HTMLParagraphElement>('#status')!;
const results = document.querySelector<HTMLPreElement>('#results')!;
const button = document.querySelector<HTMLButtonElement>('#run')!;
const T_TOLERANCE = 0.005, C_TOLERANCE = 0.05;

function log(message: string): void { results.textContent += `${message}\n`; }
function assert(valid: boolean, message: string): asserts valid { if (!valid) throw new Error(message); }
function conditions(scenarioId: string, opened: boolean): Conditions {
  const preset = PRESETS.find(item => item.id === scenarioId)!;
  return { ...structuredClone(preset.conditions),
    doors: Object.fromEntries(model.boxes.filter(box => box.type === 'door').map(box => [box.name, opened])),
    windows: Object.fromEntries(model.boxes.filter(box => box.type === 'window').map(box => [box.name, opened])),
  };
}
function seeded(settings: Conditions): SimulationResult {
  const result = createSimulation(settings), field = result.field!;
  for (let cell = 0; cell < field.temperature.length; cell++) if (field.cellType[cell] === 0) {
    field.temperature[cell] = 25 + 8 * (0.5 + 0.5 * Math.sin(cell * 0.37));
    field.pm25[cell] = 20 + 130 * (0.5 + 0.5 * Math.cos(cell * 0.19));
  }
  return result;
}
function compare(cpu: SimulationResult, gpu: SimulationResult, label: string): void {
  const a = cpu.field!, b = gpu.field!;
  let tError = 0, cError = 0;
  assert(a.temperature.length === b.temperature.length, `${label}: field length mismatch`);
  for (let cell = 0; cell < a.temperature.length; cell++) {
    assert(Number.isFinite(b.temperature[cell]) && Number.isFinite(b.pm25[cell]), `${label}: nonfinite GPU cell ${cell}`);
    assert(a.cellType[cell] === b.cellType[cell], `${label}: mask mismatch at ${cell}`);
    tError = Math.max(tError, Math.abs(a.temperature[cell] - b.temperature[cell]));
    cError = Math.max(cError, Math.abs(a.pm25[cell] - b.pm25[cell]));
  }
  assert(cpu.elapsedSeconds === gpu.elapsedSeconds, `${label}: elapsed time mismatch`);
  assert(Math.abs(cpu.energyKwh - gpu.energyKwh) < 1e-12, `${label}: energy mismatch`);
  log(`${label}: max ΔT ${tError.toExponential(3)} °C; max ΔPM ${cError.toExponential(3)} µg/m³; time ${gpu.elapsedSeconds}s`);
  assert(tError < T_TOLERANCE && cError < C_TOLERANCE, `${label}: parity tolerance exceeded`);
}

async function run(): Promise<void> {
  let backend: PlanGpu | null = null;
  button.disabled = true; status.className = ''; status.textContent = 'RUNNING — actual GPU checks'; results.textContent = '';
  try {
    log(`Secure context: ${isSecureContext}; navigator.gpu: ${Boolean(navigator.gpu)}`);
    log(`Browser: ${navigator.userAgent}`);
    log(`Tolerances: temperature <${T_TOLERANCE} °C; PM <${C_TOLERANCE} µg/m³ (float32 GPU).`);
    backend = await createPlanGpu();
    log(`Acquired GPU device and compiled WGSL: ${backend.label}`);
    const westOnly = new URLSearchParams(location.search).get('case') === 'west';
    const cases = [conditions('baseline', false), conditions('haze_outside', true), conditions('haze_outside', true)];
    cases[1].portableFan = { on: true, slot: 0, angleDeg: 90, speed: 3 };
    cases[1].purifier = { on: true, slot: 2 };
    cases[2].windFrom = 'W';
    cases[2].windSpeed = 4;
    for (let index = 0; index < cases.length; index++) {
      if (westOnly && index !== 2) continue;
      const settings = cases[index], label = ['Sealed diffusion', 'Openings, wind, fan and purifier', 'West wind 4 m/s, all openings'][index];
      let cpu = seeded(settings), gpu = seeded(settings);
      cpu = stepSimulation(cpu, settings, 0.2); gpu = await backend.step(gpu, settings, 0.2);
      compare(cpu, gpu, `${label}, first step`);
      for (let step = 0; step < 10; step++) {
        cpu = stepSimulation(cpu, settings, 6); gpu = await backend.step(gpu, settings, 6);
      }
      compare(cpu, gpu, `${label}, 60 seconds`);
    }
    if (westOnly) {
      status.className = 'pass'; status.textContent = 'PASS — west-wind WebGPU and CPU parity';
      log('PASS: explicit west wind checked on the real GPU; lifecycle checks were not rerun.');
      return;
    }
    const settings = conditions('baseline', false), initial = seeded(settings);
    const expected = stepSimulation(initial, settings, 0.5);
    const pending = backend.step(initial, settings, 0.5);
    settings.windows.window_bedroom3_1 = true;
    settings.doors.door_bedroom3 = true;
    compare(expected, await pending, 'Control snapshot while readback is pending');
    compare(stepSimulation(initial, settings, 0), await backend.step(initial, settings, 0), 'Opening change at zero elapsed time');
    const reset = createSimulation(settings);
    compare(stepSimulation(reset, settings, 0.5), await backend.step(reset, settings, 0.5), 'Fresh reset starts at zero, not previous GPU state');
    const disposed = backend.step(reset, settings, 1);
    backend.dispose(); backend.dispose();
    let rejected = false;
    try { await disposed; } catch { rejected = true; }
    assert(rejected, 'Disposal did not reject an in-flight step');
    log('PASS: disposal rejects pending readback; repeated disposal is safe.');
    backend = await createPlanGpu();
    compare(stepSimulation(reset, settings, 0.5), await backend.step(reset, settings, 0.5), 'New GPU device after cleanup');
    status.className = 'pass'; status.textContent = 'PASS — real WebGPU transport and CPU parity';
    log('PASS. App-level stale-result handling and CPU fallback are checked separately. Physical accuracy is not established.');
  } catch (error) {
    status.className = 'fail'; status.textContent = 'FAIL — GPU verification did not complete';
    log(error instanceof Error ? error.stack ?? error.message : String(error));
  } finally {
    backend?.dispose(); button.disabled = false;
  }
}
button.addEventListener('click', () => { void run(); });
void run();
