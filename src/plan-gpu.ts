import type { Conditions, SimulationResult } from './domain';
import { completePlanStep, PLAN_GRID, preparePlanStep, type PreparedPlanStep } from './plan-simulation';

export const PLAN_GPU_LABEL = 'WebGPU heat + haze · CPU airflow · 2D';
const CELL_BYTES = 48;
const CELL_COUNT = PLAN_GRID.nx * PLAN_GRID.nz;
const STATE_BYTES = CELL_COUNT * 2 * 4;
const packedFlows = new WeakMap<PreparedPlanStep['flow'], ArrayBuffer>();

/** Four outward face fluxes let each GPU invocation gather without float atomics. */
export function packPlanCells(prepared: PreparedPlanStep): ArrayBuffer {
  const { flow } = prepared;
  const existing = packedFlows.get(flow);
  if (existing) return existing;
  const buffer = new ArrayBuffer(CELL_COUNT * CELL_BYTES), view = new DataView(buffer);
  for (let cell = 0; cell < CELL_COUNT; cell++) {
    for (let face = 0; face < 4; face++) view.setInt32(cell * CELL_BYTES + face * 4, -1, true);
    view.setFloat32(cell * CELL_BYTES + 32, flow.heat[cell], true);
    view.setFloat32(cell * CELL_BYTES + 36, flow.cooling[cell], true);
    view.setFloat32(cell * CELL_BYTES + 40, flow.cleaning[cell], true);
    view.setFloat32(cell * CELL_BYTES + 44, flow.mask[cell], true);
  }
  const assign = (cell: number, next: number, velocity: number) => {
    const delta = next - cell;
    const face = delta === -1 ? 0 : delta === 1 ? 1 : delta === -PLAN_GRID.nx ? 2 : 3;
    view.setInt32(cell * CELL_BYTES + face * 4, next, true);
    view.setFloat32(cell * CELL_BYTES + 16 + face * 4, velocity, true);
  };
  for (let edge = 0; edge < flow.a.length; edge++) {
    assign(flow.a[edge], flow.b[edge], flow.velocity[edge]);
    if (flow.mask[flow.b[edge]] === 0) assign(flow.b[edge], flow.a[edge], -flow.velocity[edge]);
  }
  packedFlows.set(flow, buffer);
  return buffer;
}

export const PLAN_TRANSPORT_WGSL = /* wgsl */ `
struct Cell {
  adjacent: vec4<i32>,
  outward: vec4<f32>,
  sources: vec4<f32>,
}
struct Params {
  step: vec4<f32>, // dt, dx, AC setpoint, cell count
  initial: vec4<f32>,
}
@group(0) @binding(0) var<storage, read> before: array<vec2<f32>>;
@group(0) @binding(1) var<storage, read_write> after: array<vec2<f32>>;
@group(0) @binding(2) var<storage, read> cells: array<Cell>;
@group(0) @binding(3) var<uniform> params: Params;

@compute @workgroup_size(64)
fn transport(@builtin(global_invocation_id) id: vec3<u32>) {
  let i = id.x;
  if (i >= u32(params.step.w)) { return; }
  let own = before[i];
  let cell = cells[i];
  if (cell.sources.w != 0.0) { after[i] = own; return; }
  let dt = params.step.x;
  let dx = params.step.y;
  var change = vec2<f32>(0.0);
  for (var face = 0u; face < 4u; face++) {
    let adjacent = cell.adjacent[face];
    if (adjacent < 0) { continue; }
    let other = before[u32(adjacent)];
    let velocity = cell.outward[face];
    let upstream = select(other, own, velocity >= 0.0);
    change -= dt * (velocity / dx * upstream + vec2<f32>(0.025, 0.012) / (dx * dx) * (own - other));
  }
  let heated = own.x + change.x + cell.sources.x * dt;
  let cooled = heated - max(0.0, heated - params.step.z) * (1.0 - exp(-cell.sources.y * dt));
  let cleaned = (own.y + change.y) * exp(-cell.sources.z * dt);
  var result = clamp(vec2<f32>(cooled, cleaned), vec2<f32>(10.0, 0.0), vec2<f32>(60.0, 1000.0));
  if (result.x != result.x) { result.x = params.initial.x; }
  if (result.y != result.y) { result.y = params.initial.y; }
  after[i] = result;
}
`;

export interface PlanGpu {
  readonly label: string;
  onLost: ((reason: string) => void) | null;
  step(previous: SimulationResult, conditions: Conditions, deltaSeconds: number): Promise<SimulationResult>;
  dispose(): void;
}

class GpuTransport implements PlanGpu {
  readonly label = PLAN_GPU_LABEL;
  onLost: ((reason: string) => void) | null = null;
  private readonly buffers: GPUBuffer[] = [];
  private readonly states: [GPUBuffer, GPUBuffer];
  private readonly cells: GPUBuffer;
  private readonly params: GPUBuffer;
  private readonly staging: GPUBuffer;
  private readonly bindings: [GPUBindGroup, GPUBindGroup];
  private readonly failure: Promise<never>;
  private rejectFailure!: (reason: Error) => void;
  private disposed = false;
  private failed: string | null = null;
  private busy = false;

  constructor(private readonly device: GPUDevice, private readonly pipeline: GPUComputePipeline) {
    this.failure = new Promise<never>((_, reject) => { this.rejectFailure = reject; });
    void this.failure.catch(() => {});
    const buffer = (label: string, size: number, usage: GPUBufferUsageFlags) => {
      const created = device.createBuffer({ label, size, usage });
      this.buffers.push(created);
      return created;
    };
    this.states = [0, 1].map(index => buffer(`HeatSim scalar state ${index}`, STATE_BYTES,
      GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC)) as [GPUBuffer, GPUBuffer];
    this.cells = buffer('HeatSim CPU airflow and sources', CELL_COUNT * CELL_BYTES, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST);
    this.params = buffer('HeatSim timestep', 32, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST);
    this.staging = buffer('HeatSim async scalar readback', STATE_BYTES, GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ);
    this.bindings = [0, 1].map(index => device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0), entries: [
        { binding: 0, resource: { buffer: this.states[index] } },
        { binding: 1, resource: { buffer: this.states[1 - index] } },
        { binding: 2, resource: { buffer: this.cells } },
        { binding: 3, resource: { buffer: this.params } },
      ],
    })) as [GPUBindGroup, GPUBindGroup];
    device.addEventListener('uncapturederror', this.onError);
    void device.lost.then(info => this.fail(`WebGPU device unavailable: ${info.message || info.reason}`));
  }

  private readonly onError = (event: GPUUncapturedErrorEvent) => this.fail(`WebGPU error: ${event.error.message}`);

  private fail(reason: string): void {
    if (this.disposed || this.failed) return;
    this.failed = reason;
    this.rejectFailure(new Error(reason));
    this.onLost?.(reason);
  }

  async step(previous: SimulationResult, conditions: Conditions, deltaSeconds: number): Promise<SimulationResult> {
    if (this.disposed || this.failed) throw new Error(this.failed ?? 'WebGPU backend disposed');
    if (this.busy) throw new Error('A WebGPU step is already in flight');
    const prepared = preparePlanStep(previous, conditions, deltaSeconds);
    if (prepared.count === 0) return completePlanStep(prepared, prepared.temperature, prepared.pm25);
    this.busy = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let scopeOpen = false;
    try {
      this.device.pushErrorScope('validation');
      scopeOpen = true;
      const initial = new Float32Array(CELL_COUNT * 2);
      for (let cell = 0; cell < CELL_COUNT; cell++) {
        initial[cell * 2] = prepared.temperature[cell]; initial[cell * 2 + 1] = prepared.pm25[cell];
      }
      this.device.queue.writeBuffer(this.states[0], 0, initial);
      this.device.queue.writeBuffer(this.cells, 0, packPlanCells(prepared));
      this.device.queue.writeBuffer(this.params, 0, new Float32Array([
        prepared.dt, PLAN_GRID.dx, prepared.env.setpoint, CELL_COUNT,
        prepared.env.scenario.initialTemperature, prepared.env.scenario.initialPm25, 0, 0,
      ]));
      const encoder = this.device.createCommandEncoder({ label: 'HeatSim heat and haze transport' });
      const pass = encoder.beginComputePass();
      pass.setPipeline(this.pipeline);
      for (let step = 0; step < prepared.count; step++) {
        pass.setBindGroup(0, this.bindings[step % 2]);
        pass.dispatchWorkgroups(Math.ceil(CELL_COUNT / 64));
      }
      pass.end();
      encoder.copyBufferToBuffer(this.states[prepared.count % 2], 0, this.staging, 0, STATE_BYTES);
      this.device.queue.submit([encoder.finish()]);
      const validation = this.device.popErrorScope();
      scopeOpen = false;
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('WebGPU readback timed out; CPU fallback required')), 5_000);
      });
      const ready = Promise.all([this.staging.mapAsync(GPUMapMode.READ), validation]);
      const [, error] = await Promise.race([ready, this.failure, timeout]);
      if (error) throw new Error(`WebGPU validation: ${error.message}`);
      if (this.disposed || this.failed) throw new Error(this.failed ?? 'WebGPU backend disposed');
      const values = new Float32Array(this.staging.getMappedRange()).slice();
      this.staging.unmap();
      const temperature = new Float32Array(CELL_COUNT), pm25 = new Float32Array(CELL_COUNT);
      for (let cell = 0; cell < CELL_COUNT; cell++) {
        const t = values[cell * 2], c = values[cell * 2 + 1];
        if (!Number.isFinite(t) || !Number.isFinite(c) || t < 10 || t > 60 || c < 0 || c > 1000) {
          throw new Error('WebGPU produced an invalid scalar field; CPU fallback required');
        }
        temperature[cell] = t; pm25[cell] = c;
      }
      return completePlanStep(prepared, temperature, pm25);
    } catch (error) {
      this.fail(error instanceof Error ? error.message : 'WebGPU compute failed');
      throw error;
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      if (scopeOpen) void this.device.popErrorScope().catch(() => {});
      if (this.staging.mapState !== 'unmapped') this.staging.unmap();
      this.busy = false;
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.rejectFailure(new Error('WebGPU backend disposed'));
    this.device.removeEventListener('uncapturederror', this.onError);
    for (const buffer of this.buffers) buffer.destroy();
    this.device.destroy();
  }
}

async function deadline<T>(promise: Promise<T>, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([promise, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), 5_000);
    })]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export async function createPlanGpu(): Promise<PlanGpu> {
  if (typeof navigator === 'undefined' || !navigator.gpu) throw new Error('WebGPU is unavailable in this browser');
  const adapter = await deadline(navigator.gpu.requestAdapter({ powerPreference: 'high-performance' }), 'WebGPU adapter request timed out');
  if (!adapter) throw new Error('No WebGPU adapter is available');
  const requested = adapter.requestDevice({ label: 'HeatSim scalar simulation' });
  let device: GPUDevice;
  try {
    device = await deadline(requested, 'WebGPU device request timed out');
  } catch (error) {
    void requested.then(lateDevice => lateDevice.destroy()).catch(() => {});
    throw error;
  }
  let initializing = true;
  let backend: GpuTransport | undefined;
  const lost = device.lost.then(info => { throw new Error(`WebGPU lost during initialization: ${info.message || info.reason}`); });
  void lost.catch(() => {});
  try {
    const initialize = async () => {
      const module = device.createShaderModule({ label: 'HeatSim conservative scalar transport', code: PLAN_TRANSPORT_WGSL });
      const compilation = await module.getCompilationInfo();
      const errors = compilation.messages.filter(message => message.type === 'error');
      if (errors.length) throw new Error(errors.map(message => `${message.lineNum}:${message.linePos} ${message.message}`).join('\n'));
      const pipeline = await device.createComputePipelineAsync({ layout: 'auto', compute: { module, entryPoint: 'transport' } });
      if (!initializing) throw new Error('WebGPU initialization cancelled');
      device.pushErrorScope('validation');
      backend = new GpuTransport(device, pipeline);
      const error = await device.popErrorScope();
      if (error) throw new Error(error.message);
      return backend;
    };
    return await deadline(Promise.race([initialize(), lost]), 'WebGPU initialization timed out');
  } catch (error) {
    backend?.dispose();
    device.destroy();
    throw error;
  } finally {
    initializing = false;
  }
}
