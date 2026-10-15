import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPlanGpu } from '../src/plan-gpu';
import { createSimulation, stepSimulation } from '../src/plan-simulation';
import { PRESETS } from '../src/simulation';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

class FakeBuffer {
  bytes: Uint8Array;
  mapState = 'unmapped';
  destroyed = false;
  constructor(readonly label: string, size: number, private readonly gate?: Promise<void>) { this.bytes = new Uint8Array(size); }
  async mapAsync() { this.mapState = 'pending'; await this.gate; if (this.destroyed) throw new Error('Buffer destroyed'); this.mapState = 'mapped'; }
  getMappedRange() { return this.bytes.buffer; }
  unmap() { this.mapState = 'unmapped'; this.bytes.fill(0); }
  destroy() { this.destroyed = true; this.mapState = 'unmapped'; }
}

function installGpu(options: { pendingMap?: Promise<void>; compileErrors?: boolean; pendingCompile?: Promise<{ messages: [] }>; alreadyLost?: boolean } = {}) {
  const lost = deferred<{ reason: string; message: string }>();
  const buffers: FakeBuffer[] = [];
  const listeners = new Set<(event: { error: { message: string } }) => void>();
  let destroyed = 0, scopes = 0;
  const device = {
    lost: lost.promise,
    createShaderModule: () => ({ getCompilationInfo: () => options.pendingCompile ?? Promise.resolve({ messages: options.compileErrors ? [{ type: 'error', lineNum: 2, linePos: 1, message: 'bad shader' }] : [] }) }),
    createComputePipelineAsync: async () => ({ getBindGroupLayout: () => ({}) }),
    pushErrorScope: () => { scopes++; },
    popErrorScope: async () => { scopes--; return null; },
    createBuffer: (descriptor: { label: string; size: number }) => {
      const buffer = new FakeBuffer(descriptor.label, descriptor.size, descriptor.label.includes('readback') ? options.pendingMap : undefined);
      buffers.push(buffer); return buffer;
    },
    createBindGroup: (descriptor: { entries: { resource: { buffer: FakeBuffer } }[] }) => descriptor.entries.map(entry => entry.resource.buffer),
    addEventListener: (_name: string, listener: (event: { error: { message: string } }) => void) => listeners.add(listener),
    removeEventListener: (_name: string, listener: (event: { error: { message: string } }) => void) => listeners.delete(listener),
    createCommandEncoder: () => ({
      beginComputePass: () => {
        let bindings: FakeBuffer[] = [];
        return { setPipeline: () => {}, setBindGroup: (_index: number, group: FakeBuffer[]) => { bindings = group; },
          dispatchWorkgroups: () => { bindings[1].bytes.set(bindings[0].bytes); }, end: () => {} };
      },
      copyBufferToBuffer: (source: FakeBuffer, _sourceOffset: number, target: FakeBuffer) => target.bytes.set(source.bytes),
      finish: () => ({}),
    }),
    queue: {
      writeBuffer: (buffer: FakeBuffer, _offset: number, source: ArrayBuffer | ArrayBufferView) => {
        const bytes = ArrayBuffer.isView(source) ? new Uint8Array(source.buffer, source.byteOffset, source.byteLength) : new Uint8Array(source);
        buffer.bytes.set(bytes);
      },
      submit: () => {},
    },
    destroy: () => { destroyed++; lost.resolve({ reason: 'destroyed', message: 'test device destroyed' }); },
  };
  if (options.alreadyLost) lost.resolve({ reason: 'unknown', message: 'lost before initialization' });
  vi.stubGlobal('navigator', { gpu: { requestAdapter: async () => ({ requestDevice: async () => device }) } });
  return { buffers, lost, device, get destroyed() { return destroyed; }, get scopes() { return scopes; },
    error(message: string) { for (const listener of listeners) listener({ error: { message } }); } };
}

const settings = () => structuredClone(PRESETS.find(preset => preset.id === 'baseline')!.conditions);

beforeEach(() => {
  vi.stubGlobal('GPUBufferUsage', { STORAGE: 128, COPY_DST: 8, COPY_SRC: 4, UNIFORM: 64, MAP_READ: 1 });
  vi.stubGlobal('GPUMapMode', { READ: 1 });
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('WebGPU lifecycle and asynchronous readback', () => {
  it('fails promptly when no adapter is available', async () => {
    vi.stubGlobal('navigator', { gpu: { requestAdapter: async () => null } });
    await expect(createPlanGpu()).rejects.toThrow('No WebGPU adapter');
  });

  it('cleans up shader compilation failures', async () => {
    const fake = installGpu({ compileErrors: true });
    await expect(createPlanGpu()).rejects.toThrow('bad shader');
    expect(fake.destroyed).toBeGreaterThan(0);
  });

  it('rejects a device already lost while initialization is awaiting compilation', async () => {
    const fake = installGpu({ alreadyLost: true, pendingCompile: new Promise(() => {}) });
    await expect(createPlanGpu()).rejects.toThrow('lost before initialization');
    expect(fake.destroyed).toBeGreaterThan(0);
  });

  it('returns owned snapshot arrays that survive staging-buffer unmap', async () => {
    const fake = installGpu(), backend = await createPlanGpu(), config = settings(), initial = createSimulation(config);
    const result = await backend.step(initial, config, 0.1);
    expect(result.field!.temperature).toEqual(initial.field!.temperature);
    expect(result.field!.pm25).toEqual(initial.field!.pm25);
    expect(fake.buffers.find(buffer => buffer.label.includes('readback'))!.bytes.every(value => value === 0)).toBe(true);
    expect(fake.scopes).toBe(0);
    backend.dispose(); backend.dispose();
    expect(fake.destroyed).toBe(1);
    expect(fake.buffers.every(buffer => buffer.destroyed)).toBe(true);
  });

  it('allows one in-flight step and rejects it promptly on disposal', async () => {
    const gate = deferred<void>(), fake = installGpu({ pendingMap: gate.promise });
    const backend = await createPlanGpu(), config = settings(), initial = createSimulation(config);
    const pending = backend.step(initial, config, 0.1);
    const rejected = expect(pending).rejects.toThrow('disposed');
    await expect(backend.step(initial, config, 0.1)).rejects.toThrow('already in flight');
    backend.dispose();
    await rejected;
    expect(fake.buffers.every(buffer => buffer.destroyed)).toBe(true);
    gate.resolve();
  });

  it('reports device loss once and leaves the previous finite state usable by the CPU', async () => {
    const gate = deferred<void>(), fake = installGpu({ pendingMap: gate.promise });
    const backend = await createPlanGpu(), config = settings(), initial = createSimulation(config);
    const loss = vi.fn(); backend.onLost = loss;
    const pending = backend.step(initial, config, 1);
    const rejected = expect(pending).rejects.toThrow('test unplug');
    fake.lost.resolve({ reason: 'unknown', message: 'test unplug' });
    await rejected;
    fake.error('second error');
    expect(loss).toHaveBeenCalledTimes(1);
    const cpu = stepSimulation(initial, config, 1);
    expect(cpu.elapsedSeconds).toBe(1);
    expect(cpu.field!.temperature.every(Number.isFinite)).toBe(true);
    expect(initial.elapsedSeconds).toBe(0);
    backend.dispose(); gate.resolve();
  });

  it('invalidates the backend on uncaptured validation error', async () => {
    const fake = installGpu(), backend = await createPlanGpu(), config = settings();
    const loss = vi.fn(); backend.onLost = loss;
    fake.error('invalid command');
    await expect(backend.step(createSimulation(config), config, 1)).rejects.toThrow('invalid command');
    expect(loss).toHaveBeenCalledTimes(1);
    backend.dispose();
  });

  it('bounds a stalled GPU readback and releases its pending map', async () => {
    vi.useFakeTimers();
    const gate = deferred<void>(), fake = installGpu({ pendingMap: gate.promise });
    const backend = await createPlanGpu(), config = settings();
    const pending = backend.step(createSimulation(config), config, 1);
    const rejected = expect(pending).rejects.toThrow('readback timed out');
    await vi.advanceTimersByTimeAsync(5_001);
    await rejected;
    expect(fake.buffers.find(buffer => buffer.label.includes('readback'))!.mapState).toBe('unmapped');
    backend.dispose(); gate.resolve();
  });
});
