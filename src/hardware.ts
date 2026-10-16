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

export class HardwareConnection {
  private port: SerialPort | null = null;
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private writer: WritableStreamDefaultWriter<Uint8Array> | null = null;
  private readTask: Promise<void> | null = null;
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
    if (this.connecting || this.port) return;
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
        await port.close();
        return;
      }
      if (!port.readable || !port.writable) throw new Error('Serial streams unavailable.');
      this.writer = port.writable.getWriter();
      this.reader = port.readable.getReader();
      this.port = port;
      this.handshaken = false;
      this.report('connected', 'USB connected · waiting for the board handshake.');
      this.readTask = this.read(port, this.reader);
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
      this.writer?.releaseLock();
      this.writer = null;
      if (opened && port) await port.close().catch(() => {});
      if (attempt !== this.attempt) return;
      const cancelled = error instanceof DOMException && error.name === 'NotFoundError';
      this.report(cancelled ? 'disconnected' : 'error', cancelled
        ? 'No port selected. The on-screen controls still work.'
        : 'Could not open USB. Close the Arduino Serial Monitor, check the cable, and reconnect.');
    } finally {
      this.connecting = false;
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
    try {
      await this.writer.write(new TextEncoder().encode(encoded));
      return true;
    } catch {
      void this.disconnect('USB write failed. Check the board and reconnect.');
      return false;
    }
  }

  async disconnect(message = 'USB disconnected. The on-screen controls still work.'): Promise<void> {
    if (this.closing) return;
    ++this.attempt;
    this.closing = true;
    this.clearTimers();
    try {
      await this.reader?.cancel();
    } catch {
      // A removed USB device can reject cancellation; read() still releases its lock.
    }
    await this.readTask;
    this.closing = false;
    this.report('disconnected', message);
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

  private async read(port: SerialPort, reader: ReadableStreamDefaultReader<Uint8Array>): Promise<void> {
    const decoder = new TextDecoder();
    const parser = new HardwareLineParser();
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        for (const line of parser.push(decoder.decode(value, { stream: true }))) this.receive(line);
      }
    } catch {
      // Removal and serial errors follow the same cleanup and reconnect path.
    } finally {
      this.clearTimers();
      reader.releaseLock();
      const writer = this.writer;
      this.writer = null;
      if (writer) {
        await writer.abort().catch(() => {});
        writer.releaseLock();
      }
      await port.close().catch(() => {});
      this.reader = null;
      this.port = null;
      this.readTask = null;
      if (!this.closing) this.report('disconnected', 'USB connection ended. Check the board and reconnect.');
    }
  }
}
