import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { defaultConditions, type Conditions } from '../src/domain';
import type { HardwareConnection } from '../src/hardware';
import { parseLine } from '../src/io/protocol';

type Callbacks = ConstructorParameters<typeof HardwareConnection>[0];
const harness = vi.hoisted(() => ({
  conditions: undefined as Conditions | undefined,
  callbacks: undefined as Callbacks | undefined,
  controlListener: undefined as ((event: { detail: { conditions: Conditions } }) => void) | undefined,
  replace: vi.fn(),
  send: vi.fn(),
  sendOpening: vi.fn(),
  purifier: vi.fn(),
}));

vi.mock('../src/app', () => ({
  readConditions: () => structuredClone(harness.conditions!),
  replaceConditions: (next: Conditions, reset?: boolean) => {
    harness.replace(next, reset);
    harness.conditions = structuredClone(next);
  },
  applyHardwareControl: vi.fn(),
  applyHardwarePurifier: harness.purifier,
  loadScenario: vi.fn(),
}));
vi.mock('../src/hardware', () => ({
  hardwareSupported: () => true,
  HardwareConnection: class {
    connected = true;
    constructor(callbacks: Callbacks) { harness.callbacks = callbacks; }
    send = harness.send;
    sendOpening = harness.sendOpening;
    async reconnectKnown() {}
  },
}));

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  harness.conditions = defaultConditions();
  harness.conditions.portableFan = { on: true, slot: 0, angleDeg: 90, speed: 2, position: { x: 9.9, z: 1.5 }, headingDeg: 247 };
  harness.conditions.standingFans = [
    { id: 'extra-a', x: 7.5, z: 5.3, angleDeg: 30, speed: 3, on: true },
    { id: 'extra-b', x: 2.5, z: 1.5, angleDeg: 210, speed: 1, on: false },
  ];
  harness.conditions.purifier = { on: true, slot: 2 };
  harness.conditions.windows.window_bedroom3_1 = true;
  harness.conditions.windows.window_bedroom3_2 = true;
  harness.conditions.windFrom = 'E';
  const node = () => ({ dataset: {}, setAttribute() {}, append() {}, addEventListener() {} });
  vi.stubGlobal('document', { querySelector: node, createElement: node });
  vi.stubGlobal('window', { addEventListener(_name: string, listener: typeof harness.controlListener) { harness.controlListener = listener; } });
  await import('../src/main');
});

afterEach(() => { vi.unstubAllGlobals(); });

function receive(line: string): void {
  const message = parseLine(line);
  expect(message).not.toBeNull();
  harness.callbacks!.onMessage!(message!);
}

describe('legacy hardware commands with multiple freely placed fans', () => {
  test('FANPOS restores the requested primary slot even when its saved slot number is unchanged', () => {
    const expected = structuredClone(harness.conditions!);
    delete expected.portableFan!.position;
    delete expected.portableFan!.headingDeg;
    receive('FANPOS:0');
    expect(harness.conditions).toEqual(expected);
    expect(harness.replace).toHaveBeenCalledWith(expected, undefined);
    expect(harness.send).not.toHaveBeenCalled();
  });

  test('FANANG restores slot-relative heading while retaining the primary free position and extra fans', () => {
    const expected = structuredClone(harness.conditions!);
    expected.portableFan!.angleDeg = 45;
    delete expected.portableFan!.headingDeg;
    receive('FANANG:45');
    expect(harness.conditions).toEqual(expected);
    expect(harness.replace).toHaveBeenCalledWith(expected, undefined);
  });

  test('power and speed change only the primary fan and never request a field reset', () => {
    const expected = structuredClone(harness.conditions!);
    expected.portableFan!.on = false;
    receive('FAN:OFF');
    expect(harness.conditions).toEqual(expected);
    expected.portableFan!.speed = 3;
    receive('FANSPD:3');
    expect(harness.conditions).toEqual(expected);
    expect(harness.replace.mock.calls.every(([, reset]) => reset === undefined)).toBe(true);
  });

  test('unsupported slot leaves custom position, heading, and every other input unchanged', () => {
    const before = structuredClone(harness.conditions!);
    receive('FANPOS:9');
    expect(harness.conditions).toEqual(before);
    expect(harness.replace).not.toHaveBeenCalled();
  });

  test('repeated absolute fan states are idempotent and do not produce an echo on the next control event', () => {
    receive('FANPOS:2');
    receive('FANANG:135');
    receive('FAN:OFF');
    receive('FANSPD:1');
    const writes = harness.replace.mock.calls.length;
    receive('FANPOS:2');
    receive('FANANG:135');
    receive('FAN:OFF');
    receive('FANSPD:1');
    harness.controlListener!({ detail: { conditions: structuredClone(harness.conditions!) } });
    expect(harness.replace).toHaveBeenCalledTimes(writes);
    expect(harness.send).not.toHaveBeenCalled();
    expect(harness.sendOpening).not.toHaveBeenCalled();
  });
});
