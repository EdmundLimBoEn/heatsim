import { describe, expect, it } from 'vitest';
import { model } from '../src/domain';
import { createSimulation, preparePlanStep, completePlanStep, stepSimulation, PLAN_GRID } from '../src/plan-simulation';
import { packPlanCells, createPlanGpu } from '../src/plan-gpu';
import { PRESETS } from '../src/simulation';

const size = PLAN_GRID.nx * PLAN_GRID.nz;
const conditions = () => structuredClone(PRESETS.find(preset => preset.id === 'validation')!.conditions);

describe('GPU transport preparation', () => {
  it('packs equal and opposite interior face velocities without opening solid walls', () => {
    const config = conditions();
    for (const name of Object.keys(config.windows)) config.windows[name] = true;
    for (const name of Object.keys(config.doors)) config.doors[name] = true;
    config.portableFan = { on: true, slot: 1, angleDeg: 45, speed: 3 };
    const prepared = preparePlanStep(createSimulation(config), config, 1);
    const data = new DataView(packPlanCells(prepared));
    let faces = 0, moving = 0;
    for (let cell = 0; cell < size; cell++) for (let face = 0; face < 4; face++) {
      const next = data.getInt32(cell * 48 + face * 4, true);
      if (next < 0) continue;
      faces++;
      expect(prepared.flow.mask[cell]).toBe(0);
      expect(prepared.flow.mask[next]).not.toBe(1);
      const velocity = data.getFloat32(cell * 48 + 16 + face * 4, true);
      if (Math.abs(velocity) > 1e-6) moving++;
      if (prepared.flow.mask[next] === 0) {
        const opposite = face ^ 1;
        expect(data.getInt32(next * 48 + opposite * 4, true)).toBe(cell);
        expect(data.getFloat32(next * 48 + 16 + opposite * 4, true)).toBe(-velocity);
      }
    }
    expect(faces).toBeGreaterThan(5000);
    expect(moving).toBeGreaterThan(100);
  });

  it('captures the caller state without mutation and preserves elapsed time and energy accounting', () => {
    const config = conditions(), original = structuredClone(config);
    const previous = createSimulation(config), before = previous.field!.temperature.slice();
    const prepared = preparePlanStep(previous, config, 1000);
    config.humidity = 1;
    config.windows.window_bedroom3_1 = !config.windows.window_bedroom3_1;
    expect(prepared.conditions).toEqual(original);
    expect(previous.field!.temperature).toEqual(before);
    expect(prepared.temperature).not.toBe(previous.field!.temperature);
    expect(prepared.duration).toBe(60);
    expect(prepared.dt).toBeLessThanOrEqual(prepared.flow.maxStep);
    const completed = completePlanStep(prepared, prepared.temperature, prepared.pm25);
    expect(completed.elapsedSeconds).toBe(previous.elapsedSeconds + 60);
    expect(completed.energyKwh).toBe(previous.energyKwh + prepared.flow.powerWatts * 60 / 3_600_000);
  });

  it('initializes changed openings and outdoor reservoirs identically for either backend', () => {
    const config = conditions();
    const previous = createSimulation(config);
    config.windows.window_bedroom3_1 = true;
    config.outdoorTemperature = 36;
    config.outdoorPm25 = 220;
    const prepared = preparePlanStep(previous, config, 0);
    const cpu = stepSimulation(previous, config, 0);
    expect(prepared.temperature).toEqual(cpu.field!.temperature);
    expect(prepared.pm25).toEqual(cpu.field!.pm25);
    expect(prepared.flow.mask).toEqual(cpu.field!.cellType);
  });

  it('gathered face transport agrees with the CPU edge update including AC and purifier sources', () => {
    const config = conditions();
    for (const name of Object.keys(config.windows)) config.windows[name] = true;
    for (const name of Object.keys(config.doors)) config.doors[name] = true;
    config.portableFan = { on: true, slot: 2, angleDeg: 115, speed: 3 };
    config.purifier = { on: true, slot: 0 };
    const ac = model.boxes.find(box => box.name.startsWith('ac_'))!;
    config.devices[ac.name] = true;
    const previous = createSimulation(config);
    for (let i = 0; i < size; i++) if (previous.field!.cellType[i] === 0) {
      previous.field!.temperature[i] = 27 + (i % 13) * 0.3;
      previous.field!.pm25[i] = 10 + i % 71;
    }
    const prepared = preparePlanStep(previous, config, 0.01), packed = new DataView(packPlanCells(prepared));
    expect(prepared.count).toBe(1);
    const expected = stepSimulation(previous, config, 0.01);
    let maxT = 0, maxC = 0;
    for (let i = 0; i < size; i++) if (prepared.flow.mask[i] === 0) {
      const ownT = prepared.temperature[i], ownC = prepared.pm25[i];
      let dT = 0, dC = 0;
      for (let face = 0; face < 4; face++) {
        const next = packed.getInt32(i * 48 + face * 4, true);
        if (next < 0) continue;
        const velocity = packed.getFloat32(i * 48 + 16 + face * 4, true), upstream = velocity >= 0 ? i : next;
        dT -= prepared.dt * (velocity / PLAN_GRID.dx * prepared.temperature[upstream] + 0.025 / PLAN_GRID.dx ** 2 * (ownT - prepared.temperature[next]));
        dC -= prepared.dt * (velocity / PLAN_GRID.dx * prepared.pm25[upstream] + 0.012 / PLAN_GRID.dx ** 2 * (ownC - prepared.pm25[next]));
      }
      const heated = ownT + dT + packed.getFloat32(i * 48 + 32, true) * prepared.dt;
      const cooled = heated - Math.max(0, heated - config.acSetpoint) * (1 - Math.exp(-packed.getFloat32(i * 48 + 36, true) * prepared.dt));
      const cleaned = (ownC + dC) * Math.exp(-packed.getFloat32(i * 48 + 40, true) * prepared.dt);
      maxT = Math.max(maxT, Math.abs(cooled - expected.field!.temperature[i]));
      maxC = Math.max(maxC, Math.abs(cleaned - expected.field!.pm25[i]));
    }
    expect(maxT).toBeLessThan(0.00001);
    expect(maxC).toBeLessThan(0.00002);
  });

  it('rejects unsupported environments without changing the CPU engine', async () => {
    if (typeof navigator === 'undefined' || !navigator.gpu) await expect(createPlanGpu()).rejects.toThrow(/unavailable/);
    const config = conditions();
    const result = stepSimulation(createSimulation(config), config, 1);
    expect(result.elapsedSeconds).toBe(1);
    expect(Number.isFinite(result.averageTemperature)).toBe(true);
  });
});
