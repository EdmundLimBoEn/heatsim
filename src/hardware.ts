import { openingForKey, keyForOpening } from './config/mapping';
import { parseLine, formatLine, MAX_LINE_LENGTH, type ProtocolMessage } from './io/protocol';

export interface HardwareEvent { kind: 'window' | 'door'; id: string; open: boolean }
export interface HardwareStatus {
  state: 'unsupported' | 'disconnected' | 'connecting' | 'connected' | 'error';
  message: string;
}
interface HardwareCallbacks {
  onState: (event: HardwareEvent) => void;
  onStatus: (status: HardwareStatus) => void;
  onMessage?: (message: ProtocolMessage) => void;
  onLog?: (line: string) => void;
  onBatch?: (apply: () => void) => void;
}
interface SerialPort {
  readable: ReadableStream<Uint8Array> | null;
  writable: WritableStream<Uint8Array> | null;
  open(options: { baudRate: number }): Promise<void>;
  close(): Promise<void>;
}
interface SerialAPI { requestPort(): Promise<SerialPort>; getPorts?(): Promise<SerialPort[]> }

function serialAPI(): SerialAPI | undefined {
  return typeof navigator === 'undefined' ? undefined : (navigator as Navigator & { serial?: SerialAPI }).serial;
}

export function hardwareSupported(): boolean {
  return globalThis.isSecureContext !== false && typeof serialAPI()?.requestPort === 'function';
}

export function parseHardwareLine(line: string): HardwareEvent | null {
  const message = parseLine(line);
  if (message?.type !== 'opening') return null;
  const opening = openingForKey(message.key);
  return opening ? { ...opening, open: message.value } : null;
}

export class HardwareLineParser {
  private line = '';
  private oversized = false;

  push(chunk: string): string[] {
    const lines: string[] = [];
    for (const character of chunk) {
      if (character === '\n') {
        if (!this.oversized) lines.push(this.line.replace(/\r$/, ''));
        this.line = '';
        this.oversized = false;
      } else if (!this.oversized) {
        this.line += character;
        if (this.line.length > MAX_LINE_LENGTH && !(this.line.length === MAX_LINE_LENGTH + 1 && character === '\r')) {
          this.line = '';
          this.oversized = true;
        }
      }
    }
    return lines;
  }
}

// Deadlines bound logical cleanup even when the driver retains the physical port.
async function withDeadline<T>(task: Promise<T>, ms = 1000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([task, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('USB operation timed out')), ms);
    })]);
  } finally { clearTimeout(timer); }
}

export class HardwareConnection {
  private port: SerialPort | null = null;
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private writer: WritableStreamDefaultWriter<Uint8Array> | null = null;
  private connecting = false;
  private closing = false;
  private attempt = 0;
  private startupTimer: ReturnType<typeof setTimeout> | undefined;
  private handshakeTimer: ReturnType<typeof setTimeout> | undefined;
  private heartbeat: ReturnType<typeof setInterval> | undefined;
  private fanAngleTimer: ReturnType<typeof setTimeout> | undefined;
  private pendingFanAngle: string | null = null;
  private lastFanAngle = -Infinity;
  private lastPong = 0;
  private handshaken = false;

  constructor(private callbacks: HardwareCallbacks) {}

  get connected(): boolean { return this.port !== null && !this.closing; }

  async connect(): Promise<void> {
    await this.open(false);
  }

  async reconnectKnown(): Promise<void> {
    await this.open(true);
  }

  private async open(known: boolean): Promise<void> {
    if (this.connecting || this.closing || this.port) return;
    if (!hardwareSupported()) {
      if (!known) this.report('unsupported', 'Use desktop Chrome or Edge on HTTPS or localhost to connect USB.');
      return;
    }
    this.connecting = true;
    const attempt = ++this.attempt;
    if (!known) this.report('connecting', 'Choose the SSTuino USB serial port.');
    let port: SerialPort | null = null;
    let opened = false;
    try {
      if (known) {
        const ports = await serialAPI()!.getPorts?.();
        if (ports?.length !== 1) return;
        port = ports[0];
        this.report('connecting', 'Reconnecting the previously permitted board.');
      } else {
        port = await serialAPI()!.requestPort();
      }
      if (attempt !== this.attempt) return;
      await port.open({ baudRate: 115200 });
      opened = true;
      if (attempt !== this.attempt) {
        await withDeadline(port.close());
        return;
      }
      if (!port.readable || !port.writable) throw new Error('Serial streams unavailable.');
      this.writer = port.writable.getWriter();
      this.reader = port.readable.getReader();
      this.port = port;
      this.handshaken = false;
      this.report('connected', 'USB connected · waiting for the board handshake.');
      void this.read(port, this.reader, attempt);
      this.startupTimer = setTimeout(() => {
        void this.send('HELLO');
        void this.send('GET:ALL');
        this.lastPong = Date.now();
        let lastPing = this.lastPong;
        this.heartbeat = setInterval(() => {
          const now = Date.now();
          if (now - this.lastPong >= 5000) {
            void this.disconnect('Board stopped responding. Check USB and reconnect.');
          } else if (now - lastPing >= 2000) {
            lastPing = now;
            void this.send('PING');
          }
        }, 1000);
        this.handshakeTimer = setTimeout(() => {
          if (!this.handshaken && this.connected) this.report('connected', 'USB connected (no handshake) · check the sketch.');
        }, 3000);
      }, 1500);
    } catch (error) {
      if (attempt === this.attempt) {
        this.writer?.releaseLock();
        this.writer = null;
      }
      if (opened && port) await withDeadline(port.close()).catch(() => {});
      if (attempt !== this.attempt) return;
      const cancelled = error instanceof DOMException && error.name === 'NotFoundError';
      this.report(cancelled ? 'disconnected' : 'error', cancelled
        ? 'No port selected. The on-screen controls still work.'
        : 'Could not open USB. Close the Arduino Serial Monitor, check the cable, and reconnect.');
    } finally {
      if (attempt === this.attempt) this.connecting = false;
    }
  }

  async sendOpening(kind: HardwareEvent['kind'], id: string, open: boolean): Promise<boolean> {
    const key = keyForOpening(id);
    if (!key || openingForKey(key)?.kind !== kind) return false;
    return this.send(`${key}:${open ? 1 : 0}`);
  }

  async send(line: string): Promise<boolean> {
    const encoded = formatLine(line);
    if (!encoded || !this.connected || !this.writer) return false;
    if (encoded.startsWith('FANANG:')) {
      const wait = 100 - (Date.now() - this.lastFanAngle);
      if (wait > 0) {
        this.pendingFanAngle = line;
        if (!this.fanAngleTimer) this.fanAngleTimer = setTimeout(() => {
          this.fanAngleTimer = undefined;
          const pending = this.pendingFanAngle;
          this.pendingFanAngle = null;
          if (pending) void this.send(pending);
        }, wait);
        return true;
      }
      clearTimeout(this.fanAngleTimer);
      this.fanAngleTimer = undefined;
      this.pendingFanAngle = null;
      this.lastFanAngle = Date.now();
    }
    const attempt = this.attempt;
    const writer = this.writer;
    try {
      await withDeadline(writer.write(new TextEncoder().encode(encoded)));
      return true;
    } catch {
      if (attempt === this.attempt) void this.disconnect('USB write failed or timed out. Check the board and reconnect.');
      return false;
    }
  }

  async disconnect(message = 'USB disconnected. The on-screen controls still work.'): Promise<void> {
    if (this.closing) return;
    ++this.attempt;
    this.closing = true;
    this.clearTimers();
    const port = this.port;
    const reader = this.reader;
    const writer = this.writer;
    this.port = null;
    this.reader = null;
    this.writer = null;
    this.connecting = false;
    // Capture resources before awaiting: late cleanup must never touch a new connection.
    const cleanup = (async () => {
      await Promise.all([
        (async () => {
          try { await reader?.cancel(); } catch { /* Device removed. */ }
          try { reader?.releaseLock(); } catch { /* read() also releases its lock. */ }
        })(),
        (async () => {
          try { await writer?.abort(); } catch { /* Device removed. */ }
          writer?.releaseLock();
        })(),
      ]);
      await port?.close();
    })();
    try {
      await withDeadline(cleanup);
    } catch {
      message += ' USB cleanup did not finish; the OS may still hold the port. Unplug the board before retrying that port.';
    } finally {
      this.closing = false;
      this.report('disconnected', message);
    }
  }

  private clearTimers(): void {
    clearTimeout(this.startupTimer);
    clearTimeout(this.handshakeTimer);
    clearInterval(this.heartbeat);
    clearTimeout(this.fanAngleTimer);
    this.fanAngleTimer = undefined;
    this.pendingFanAngle = null;
  }

  private report(state: HardwareStatus['state'], message: string): void {
    this.callbacks.onStatus({ state, message });
  }

  private receive(line: string): void {
    this.callbacks.onLog?.(line);
    const message = parseLine(line);
    if (!message) return;
    if (message.type === 'hello') {
      this.handshaken = true;
      this.report('connected', message.version === 2 ? 'Model connected · v2 · D4 windows / D3 doors / D5 fan.' : 'Model connected · protocol v1 (old sketch). Upload v2 for all openings.');
    } else if (message.type === 'pong') {
      this.lastPong = Date.now();
    } else if (message.type === 'opening') {
      const opening = openingForKey(message.key);
      if (opening) this.callbacks.onState({ ...opening, open: message.value });
    }
    this.callbacks.onMessage?.(message);
  }

  private async read(port: SerialPort, reader: ReadableStreamDefaultReader<Uint8Array>, attempt: number): Promise<void> {
    const decoder = new TextDecoder();
    const parser = new HardwareLineParser();
    let sliceStart = performance.now();
    let sliceBytes = 0;
    let windowStart = Date.now();
    let receivedBytes = 0;
    try {
      while (attempt === this.attempt) {
        const { value, done } = await reader.read();
        if (done || attempt !== this.attempt) break;
        if (Date.now() - windowStart >= 1000) { windowStart = Date.now(); receivedBytes = 0; }
        receivedBytes += value.byteLength;
        // Allow full state dumps and button bursts, but reject sustained/oversized floods.
        if (value.byteLength > 8192 || receivedBytes > 16384) {
          void this.disconnect('USB input rate exceeded. Check the board and reconnect.');
          break;
        }
        for (let offset = 0; offset < value.byteLength; offset += 256) {
          if (sliceBytes >= 256 || performance.now() - sliceStart >= 4) {
            await new Promise(resolve => setTimeout(resolve, 0));
            sliceStart = performance.now();
            sliceBytes = 0;
          }
          if (attempt !== this.attempt) return;
          const bytes = value.subarray(offset, offset + 256);
          sliceBytes += bytes.byteLength;
          const lines = parser.push(decoder.decode(bytes, { stream: true }));
          let index = 0;
          while (index < lines.length && attempt === this.attempt) {
            const apply = () => {
              do { this.receive(lines[index++]); }
              while (index < lines.length && performance.now() - sliceStart < 4 && attempt === this.attempt);
            };
            if (this.callbacks.onBatch) this.callbacks.onBatch(apply);
            else apply();
            if (index < lines.length) {
              await new Promise(resolve => setTimeout(resolve, 0));
              sliceStart = performance.now();
              sliceBytes = 0;
            }
          }
        }
      }
    } catch {
      // Removal and serial errors follow the same cleanup and reconnect path.
    } finally {
      reader.releaseLock();
      if (attempt === this.attempt && this.port === port) {
        void this.disconnect('USB connection ended. Check the board and reconnect.');
      }
    }
  }
}
