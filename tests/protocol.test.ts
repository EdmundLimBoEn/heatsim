import { describe, expect, test } from 'vitest';
import { HARDWARE_OPENINGS, keyForOpening, openingForKey } from '../src/config/mapping';
import { formatLine, MAX_LINE_LENGTH, parseLine } from '../src/io/protocol';

describe('protocol v1 incoming lines', () => {
  test('parses every opening ID and binary state without requiring a hardware mapping', () => {
    for (const prefix of ['WIN', 'DOOR']) {
      for (let id = 1; id <= 9; id++) {
        for (const value of [0, 1]) {
          expect(parseLine(`${prefix}${id}:${value}`)).toEqual({ type: 'opening', key: `${prefix}${id}`, value: value === 1 });
        }
      }
    }
  });

  test('parses device states and both numeric range limits', () => {
    for (const key of ['FAN', 'AC', 'PUR']) {
      expect(parseLine(`${key}:ON`)).toEqual({ type: 'device', key, value: true });
      expect(parseLine(`${key}:OFF`)).toEqual({ type: 'device', key, value: false });
    }
    for (const [key, min, max] of [['FANANG', 0, 180], ['FANPOS', 0, 9], ['FANSPD', 0, 3], ['PURPOS', 0, 9], ['SCN', 1, 6]] as const) {
      for (const value of [min, max]) expect(parseLine(`${key}:${value}`)).toEqual({ type: 'number', key, value });
      for (const value of [min - 1, max + 1, 1.5, '1x', '', '+1', ' 1', '1 ', 'NaN', 'Infinity']) {
        expect(parseLine(`${key}:${value}`)).toBeNull();
      }
    }
  });

  test('parses handshake, state-dump completion, liveness, errors, and debug messages', () => {
    expect(parseLine('HELLO:HEATSIM/1')).toEqual({ type: 'hello' });
    expect(parseLine('PONG')).toEqual({ type: 'pong' });
    expect(parseLine('END')).toEqual({ type: 'end' });
    for (const message of ['UNKNOWN', 'RANGE', 'BUSY']) {
      expect(parseLine(`ERR:${message}`)).toEqual({ type: 'error', message });
    }
    expect(parseLine('BTN:BTN_WIN1')).toEqual({ type: 'button', id: 'BTN_WIN1' });
    expect(parseLine('# boot ready')).toEqual({ type: 'log', message: 'boot ready' });
    expect(parseLine('MODE:REMOTE')).toEqual({ type: 'log', message: 'MODE:REMOTE' });
  });

  test('accepts LF and CRLF while rejecting control characters and multiple messages', () => {
    for (const suffix of ['', '\r', '\n', '\r\n']) {
      expect(parseLine(`WIN1:0${suffix}`)).toEqual({ type: 'opening', key: 'WIN1', value: false });
    }
    for (const line of ['WIN1:1\nWIN2:1', 'WIN1:1\rWIN2:1', '\tWIN1:1', '#\0', '#\x7f', '# café', '# 🏠', 'WIN1:1\n\n']) {
      expect(parseLine(line)).toBeNull();
    }
  });

  test('enforces 32 printable ASCII characters excluding the line ending', () => {
    expect(MAX_LINE_LENGTH).toBe(32);
    expect(parseLine('#' + 'x'.repeat(31) + '\r\n')).toEqual({ type: 'log', message: 'x'.repeat(31) });
    expect(parseLine('#' + 'x'.repeat(32))).toBeNull();
    expect(parseLine('x'.repeat(100_000))).toBeNull();
  });

  test('ignores malformed, unknown, wrong-case, and invalid state messages', () => {
    for (const line of ['', 'HELLO', 'HELLO:HEATSIM/2', 'PING', 'GET:ALL', 'WIN0:1', 'WIN10:1', 'DOOR0:0', 'DOOR10:0',
      'WIN1:2', 'WIN1:true', 'DOOR1:ON', 'win1:1', ' WIN1:1', 'WIN1:1 ', 'WIN1:1:0', 'FAN:1', 'AC:on',
      'PUR:', 'BTN:', 'ERR:FAIL', 'MODE:INVALID', '__proto__:1', 'toString:1', '{"WIN1":1}', 'TEMPERATURE:30']) {
      expect(parseLine(line)).toBeNull();
    }
  });
});

describe('protocol v1 outgoing lines', () => {
  test('formats commands and all state updates with exactly one LF', () => {
    for (const line of ['HELLO', 'PING', 'GET:ALL', 'WIN1:1', 'WIN9:0', 'DOOR1:0', 'DOOR9:1', 'FAN:ON', 'AC:OFF',
      'PUR:ON', 'FANANG:180', 'FANPOS:9', 'FANSPD:3', 'PURPOS:9', 'SCN:6', 'LED:0,128,255', 'MODE:LOCAL', 'MODE:REMOTE']) {
      expect(formatLine(line)).toBe(`${line}\n`);
      expect(formatLine(`${line}\r\n`)).toBe(`${line}\n`);
    }
  });

  test('rejects board-only responses, logs, invalid commands, and injected lines', () => {
    for (const line of ['HELLO:HEATSIM/1', 'PONG', 'END', 'ERR:BUSY', 'BTN:1', '# boot', 'GET:ALL\nWIN1:1',
      'WIN0:1', 'FANANG:181', 'FANPOS:10', 'FANSPD:4', 'SCN:0', 'LED:256,0,0', 'LED:-1,0,0',
      'LED:0,0', 'LED:0,0,0,0', 'LED:0,1.5,0', 'MODE:AUTO', 'UNKNOWN:1', '# é', 'x'.repeat(33)]) {
      expect(formatLine(line)).toBeNull();
    }
  });
});

describe('physical model mapping', () => {
  test('matches doc 04 and round-trips each mapped opening', () => {
    expect(HARDWARE_OPENINGS).toEqual({
      WIN1: 'window_bedroom3_1', WIN2: 'window_living_1', WIN3: 'window_living_3', WIN4: 'window_bedroom3_2',
      DOOR1: 'main_door', DOOR2: 'door_bedroom3',
    });
    for (const [key, id] of Object.entries(HARDWARE_OPENINGS)) {
      expect(openingForKey(key)).toEqual({ kind: key.startsWith('WIN') ? 'window' : 'door', id });
      expect(keyForOpening(id)).toBe(key);
    }
  });

  test('unmapped or inherited keys never control another opening', () => {
    for (const key of ['WIN5', 'WIN9', 'DOOR3', 'WIN0', '__proto__', 'constructor', 'toString', 'win1', '']) {
      expect(openingForKey(key)).toBeUndefined();
    }
    for (const id of ['window_master_1', 'door_bedroom2', 'WIN1', '__proto__', '']) {
      expect(keyForOpening(id)).toBeUndefined();
    }
  });
});
