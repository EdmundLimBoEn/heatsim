import { afterEach, describe, expect, test, vi } from 'vitest';
import { HardwareConnection, HardwareLineParser, parseHardwareLine, type HardwareEvent, type HardwareStatus } from '../src/hardware';

const navigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
const connections: HardwareConnection[] = [];

afterEach(async () => {
  await Promise.all(connections.splice(0).map(connection => connection.disconnect()));
  vi.useRealTimers();
  if (navigatorDescriptor) Object.defineProperty(globalThis, 'navigator', navigatorDescriptor);
  else Reflect.deleteProperty(globalThis, 'navigator');
});

describe('hardware messages', () => {
  test('maps hardware IDs to exact model names and preserves false', () => {
    expect(parseHardwareLine('DOOR1:1')).toEqual({ kind: 'door', id: 'main_door', open: true });
    expect(parseHardwareLine('WIN1:0')).toEqual({ kind: 'window', id: 'window_bedroom3_1', open: false });
    expect(parseHardwareLine('WIN2:1')).toEqual({ kind: 'window', id: 'window_living_1', open: true });
    expect(parseHardwareLine('WIN4:1')).toEqual({ kind: 'window', id: 'window_bedroom3_2', open: true });
  });

  test('ignores invalid, unknown, and unmapped input', () => {
    for (const line of ['', 'booting...', 'WIN1:true', 'WIN1:2', 'WIN12:1', 'DOOR10:1',
      '{"type":"opening","target":"main_door","open":true}', 'FAN:ON']) {
      expect(parseHardwareLine(line)).toBeNull();
    }
  });

  test('joins split reads and accepts CRLF without applying incomplete input', () => {
    const parser = new HardwareLineParser();
    expect(parser.push('WIN')).toEqual([]);
    expect(parser.push('1:1\r\nDOOR1:0')).toEqual(['WIN1:1']);
    expect(parser.push('\n')).toEqual(['DOOR1:0']);
  });

  test('discards oversized lines until newline and then recovers', () => {
    const parser = new HardwareLineParser();
    expect(parser.push('x'.repeat(100_000))).toEqual([]);
    expect(parser.push('WIN1:1\nDOOR1:0\n')).toEqual(['DOOR1:0']);
    expect(parser.push('#' + 'x'.repeat(31) + '\r\n')).toEqual(['#' + 'x'.repeat(31)]);
  });
});

function fakeBoard() {
  let stream!: ReadableStreamDefaultController<Uint8Array>;
  let closes = 0;
  let baudRate = 0;
  const sent: string[] = [];
  const port = {
    readable: new ReadableStream<Uint8Array>({ start(controller) { stream = controller; } }),
    writable: new WritableStream<Uint8Array>({ write(bytes) { sent.push(new TextDecoder().decode(bytes)); } }),
    async open(options: { baudRate: number }) { baudRate = options.baudRate; },
    async close() { closes++; }
  };
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { serial: {
    async requestPort() { return port; }, async getPorts() { return [port]; }
  } } });
  const events: HardwareEvent[] = [];
  const statuses: HardwareStatus[] = [];
  const connection = new HardwareConnection({ onState: event => events.push(event), onStatus: status => statuses.push(status) });
  connections.push(connection);
  return { connection, stream, port, events, statuses, sent, get closes() { return closes; }, get baudRate() { return baudRate; } };
}

describe('USB lifecycle', () => {
  test('reads state without echoing and releases both stream locks on disconnect', async () => {
    const board = fakeBoard();
    await board.connection.connect();
    expect(board.baudRate).toBe(115200);
    expect(board.connection.connected).toBe(true);
    board.stream.enqueue(new TextEncoder().encode('HELLO:HEATSIM/1\nDOOR1:1\n'));
    await Promise.resolve();
    expect(board.events).toEqual([parseHardwareLine('DOOR1:1')!]);
    expect(board.sent).toEqual([]);
    expect(board.statuses.at(-1)?.message).toContain('protocol v1');
    await board.connection.disconnect();
    expect(board.connection.connected).toBe(false);
    expect(board.port.readable.locked).toBe(false);
    expect(board.port.writable.locked).toBe(false);
    expect(board.closes).toBe(1);
    expect(board.statuses.at(-1)?.state).toBe('disconnected');
  });

  test('sends only valid mapped openings and preserves serial framing', async () => {
    const board = fakeBoard();
    await board.connection.connect();
    expect(await board.connection.sendOpening('window', 'window_bedroom3_1', true)).toBe(true);
    expect(await board.connection.sendOpening('window', 'window_bedroom3_2', false)).toBe(true);
    expect(await board.connection.sendOpening('door', 'main_door', false)).toBe(true);
    expect(await board.connection.sendOpening('door', 'window_bedroom3_1', true)).toBe(false);
    expect(await board.connection.sendOpening('window', 'window_missing', true)).toBe(false);
    expect(await board.connection.send('WIN1:1\nDOOR1:1')).toBe(false);
    expect(board.sent).toEqual(['WIN1:1\n', 'WIN4:0\n', 'DOOR1:0\n']);
  });

  test('delivers both Bedroom 3 window states across split reads without changing another opening or echoing', async () => {
    const board = fakeBoard();
    await board.connection.connect();
    board.stream.enqueue(new TextEncoder().encode('WIN1:0\nWIN4:0\nPUR:OFF\nEND\n'));
    await Promise.resolve();
    expect(board.events).toEqual([
      { kind: 'window', id: 'window_bedroom3_1', open: false },
      { kind: 'window', id: 'window_bedroom3_2', open: false },
    ]);
    board.stream.enqueue(new TextEncoder().encode('WIN1:1\nWIN'));
    await Promise.resolve();
    expect(board.events.at(-1)).toEqual({ kind: 'window', id: 'window_bedroom3_1', open: true });
    board.stream.enqueue(new TextEncoder().encode('4:1\nPUR:ON\nWIN4:0\n'));
    await Promise.resolve();
    expect(board.events.slice(2)).toEqual([
      { kind: 'window', id: 'window_bedroom3_1', open: true },
      { kind: 'window', id: 'window_bedroom3_2', open: true },
      { kind: 'window', id: 'window_bedroom3_2', open: false },
    ]);
    expect(board.sent).toEqual([]);
  });

  test('requests the authoritative board state after the reset delay', async () => {
    vi.useFakeTimers();
    const board = fakeBoard();
    await board.connection.connect();
    expect(board.sent).toEqual([]);
    await vi.advanceTimersByTimeAsync(1500);
    expect(board.sent).toEqual(['HELLO\n', 'GET:ALL\n']);
  });

  test('coalesces fan angle commands to ten per second', async () => {
    vi.useFakeTimers();
    const board = fakeBoard();
    await board.connection.connect();
    await board.connection.send('FANANG:45');
    await board.connection.send('FANANG:50');
    await board.connection.send('FANANG:90');
    expect(board.sent).toEqual(['FANANG:45\n']);
    await vi.advanceTimersByTimeAsync(100);
    expect(board.sent).toEqual(['FANANG:45\n', 'FANANG:90\n']);
  });

  test('a newer angle supersedes an overdue queued angle', async () => {
    vi.useFakeTimers();
    const board = fakeBoard();
    await board.connection.connect();
    await board.connection.send('FANANG:45');
    await board.connection.send('FANANG:50');
    vi.setSystemTime(Date.now() + 101);
    await board.connection.send('FANANG:90');
    await vi.advanceTimersByTimeAsync(200);
    expect(board.sent).toEqual(['FANANG:45\n', 'FANANG:90\n']);
  });

  test('pings every two seconds and disconnects after five seconds without pong', async () => {
    vi.useFakeTimers();
    const board = fakeBoard();
    await board.connection.connect();
    await vi.advanceTimersByTimeAsync(3500);
    expect(board.sent).toContain('PING\n');
    expect(board.connection.connected).toBe(true);
    await vi.advanceTimersByTimeAsync(3000);
    expect(board.connection.connected).toBe(false);
    expect(board.statuses.at(-1)?.message).toContain('stopped responding');
  });

  test('a pong renews the heartbeat deadline', async () => {
    vi.useFakeTimers();
    const board = fakeBoard();
    await board.connection.connect();
    await vi.advanceTimersByTimeAsync(3500);
    board.stream.enqueue(new TextEncoder().encode('PONG\n'));
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(4000);
    expect(board.connection.connected).toBe(true);
    await vi.advanceTimersByTimeAsync(1000);
    expect(board.connection.connected).toBe(false);
  });

  test('unplug changes status and releases the stream locks', async () => {
    const board = fakeBoard();
    await board.connection.connect();
    board.stream.error(new Error('Device removed'));
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(board.connection.connected).toBe(false);
    expect(board.port.readable.locked).toBe(false);
    expect(board.port.writable.locked).toBe(false);
    expect(board.closes).toBe(1);
    expect(board.statuses.at(-1)?.state).toBe('disconnected');
  });

  test('reconnects the one previously permitted port', async () => {
    const board = fakeBoard();
    await board.connection.reconnectKnown();
    expect(board.connection.connected).toBe(true);
    expect(board.baudRate).toBe(115200);
  });

  test('unsupported browsers keep on-screen controls available', async () => {
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {} });
    const statuses: HardwareStatus[] = [];
    const connection = new HardwareConnection({ onState() {}, onStatus: status => statuses.push(status) });
    await connection.connect();
    expect(connection.connected).toBe(false);
    expect(statuses.at(-1)?.state).toBe('unsupported');
  });
});
