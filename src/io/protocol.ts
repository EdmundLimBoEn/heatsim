export const MAX_LINE_LENGTH = 32;

type OpeningIndex = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
export type OpeningKey = `WIN${OpeningIndex}` | `DOOR${OpeningIndex}`;
export type DeviceKey = 'FAN' | 'AC' | 'PUR';
export type NumberKey = 'FANANG' | 'FANPOS' | 'FANSPD' | 'PURPOS' | 'SCN';

export type ProtocolMessage =
  | { type: 'opening'; key: OpeningKey; value: boolean }
  | { type: 'device'; key: DeviceKey; value: boolean }
  | { type: 'number'; key: NumberKey; value: number }
  | { type: 'hello' }
  | { type: 'pong' }
  | { type: 'end' }
  | { type: 'log'; message: string }
  | { type: 'error'; message: 'UNKNOWN' | 'RANGE' | 'BUSY' }
  | { type: 'button'; id: string };

const NUMBER_RANGES: Record<NumberKey, readonly [number, number]> = {
  FANANG: [0, 180],
  FANPOS: [0, 9],
  FANSPD: [0, 3],
  PURPOS: [0, 9],
  SCN: [1, 6],
};

function cleanLine(raw: string): string | null {
  const line = raw.replace(/\n$/, '').replace(/\r$/, '');
  return line.length > 0 && line.length <= MAX_LINE_LENGTH && /^[\x20-\x7e]+$/.test(line)
    ? line : null;
}

export function parseLine(raw: string): ProtocolMessage | null {
  const line = cleanLine(raw);
  if (line === null) return null;
  if (line === 'HELLO:HEATSIM/1') return { type: 'hello' };
  if (line === 'PONG') return { type: 'pong' };
  if (line === 'END') return { type: 'end' };
  if (line.startsWith('#')) return { type: 'log', message: line.slice(1).trimStart() };
  const separator = line.indexOf(':');
  if (separator < 0) return null;
  const key = line.slice(0, separator);
  const value = line.slice(separator + 1);
  if (/^(WIN|DOOR)[1-9]$/.test(key) && (value === '0' || value === '1')) {
    return { type: 'opening', key: key as OpeningKey, value: value === '1' };
  }
  if ((key === 'FAN' || key === 'AC' || key === 'PUR') && (value === 'ON' || value === 'OFF')) {
    return { type: 'device', key, value: value === 'ON' };
  }
  if (Object.hasOwn(NUMBER_RANGES, key) && /^\d+$/.test(value)) {
    const [min, max] = NUMBER_RANGES[key as NumberKey];
    const number = Number(value);
    if (number >= min && number <= max) return { type: 'number', key: key as NumberKey, value: number };
  }
  if (key === 'ERR' && (value === 'UNKNOWN' || value === 'RANGE' || value === 'BUSY')) {
    return { type: 'error', message: value };
  }
  if (key === 'BTN' && value.length > 0) return { type: 'button', id: value };
  if (key === 'MODE' && (value === 'LOCAL' || value === 'REMOTE')) {
    return { type: 'log', message: line };
  }
  return null;
}

export function formatLine(raw: string): string | null {
  const line = cleanLine(raw);
  if (line === null) return null;
  if (line === 'HELLO' || line === 'PING' || line === 'GET:ALL' || /^MODE:(LOCAL|REMOTE)$/.test(line)) {
    return `${line}\n`;
  }
  const message = parseLine(line);
  if (message?.type === 'opening' || message?.type === 'device' || message?.type === 'number') {
    return `${line}\n`;
  }
  const led = /^LED:(\d+),(\d+),(\d+)$/.exec(line);
  if (led && led.slice(1).every(value => Number(value) <= 255)) return `${line}\n`;
  return null;
}
