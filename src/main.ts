import { applyHardwareControl, loadScenario, readConditions, replaceConditions } from './app';
import { HardwareConnection, hardwareSupported } from './hardware';
import { FAN_SLOTS, PURIFIER_SLOTS } from './config/slots';
import { HARDWARE_OPENINGS, openingForKey } from './config/mapping';
import { PRESETS } from './simulation';
import type { Conditions } from './domain';

const button = document.querySelector<HTMLButtonElement>('#connect-hardware')!;
const status = document.querySelector<HTMLElement>('#hardware-status')!;
const indicator = document.querySelector<HTMLElement>('.hardware-state strong')!;
const controls = document.querySelector<HTMLElement>('#hardware-controls')!;
const log = document.createElement('pre');
log.className = 'hardware-log';
log.setAttribute('aria-label', 'Last five USB messages');
const guide = document.createElement('a');
guide.href = 'https://github.com/EdmundLimBoEn/heatsim/blob/main/docs/hardware.md';
guide.target = '_blank'; guide.rel = 'noopener';
guide.textContent = 'Wiring and firmware guide';
guide.className = 'text-link';
controls.append(guide, log);
const messages: string[] = [];
let observed = readConditions();
const appendLog = (line: string) => {
  messages.push(line);
  if (messages.length > 5) messages.shift();
  log.textContent = messages.join('\n');
};

const connection = new HardwareConnection({
  onState({ kind, id, open }) {
    const current = readConditions();
    if (current[kind === 'window' ? 'windows' : 'doors'][id] !== open) applyHardwareControl(kind, id, open);
    observed = readConditions();
  },
  onStatus(next) {
    status.textContent = next.message;
    indicator.textContent = next.state === 'connected' ? 'SSTuino connected' : next.state === 'connecting' ? 'Connecting SSTuino' : 'SSTuino not connected';
    controls.dataset.connection = next.state;
    button.textContent = next.state === 'connected' ? 'Disconnect SSTuino' : 'Connect SSTuino';
    button.disabled = next.state === 'connecting' || next.state === 'unsupported';
    observed = readConditions();
  },
  onLog: appendLog,
  onMessage(message) {
    if (message.type !== 'device' && message.type !== 'number') return;
    const next = readConditions();
    const previous = JSON.stringify(next);
    const fan = next.portableFan ??= { on: false, slot: 0, angleDeg: 90, speed: 2 };
    const purifier = next.purifier ??= { on: false, slot: 0 };
    if (message.type === 'device') {
      // Keep the uploaded D5 sketch: its legacy PUR channel now owns the Bedroom 3 fan.
      if (message.key === 'PUR') {
        fan.on = message.value; fan.slot = 0; delete fan.removed;
        delete fan.position; delete fan.headingDeg;
        if (fan.on && fan.speed === 0) fan.speed = 2;
      }
      if (message.key === 'FAN') { fan.on = message.value; delete fan.removed; }
      if (message.key === 'AC') {
        const selected = document.querySelector<HTMLSelectElement>('#ac-unit')?.value ?? 'ac_living';
        for (const id of Object.keys(next.devices)) if (id.startsWith('ac_')) next.devices[id] = id === selected && message.value;
      }
    } else {
      switch (message.key) {
        case 'SCN':
          const preset = PRESETS[message.value - 1];
          const fields = ['outdoorTemperature', 'outdoorPm25', 'humidity', 'windSpeed', 'timeOfDay'] as const;
          if (next.scenarioId !== preset.id || next.windFrom !== undefined || fields.some(key => next[key] !== preset.conditions[key])) loadScenario(preset.id, 'hardware');
          observed = readConditions();
          return;
        case 'FANPOS':
          if (message.value >= FAN_SLOTS.length) return;
          delete fan.removed; fan.slot = message.value; delete fan.position; delete fan.headingDeg;
          break;
        case 'PURPOS': if (message.value >= PURIFIER_SLOTS.length) return; purifier.slot = message.value; break;
        case 'FANANG': fan.angleDeg = message.value; delete fan.headingDeg; break;
        case 'FANSPD': fan.speed = message.value; break;
      }
    }
    if (JSON.stringify(next) !== previous) replaceConditions(next);
    observed = readConditions();
  },
});

button.addEventListener('click', () => {
  if (connection.connected) void connection.disconnect();
  else void connection.connect();
});

window.addEventListener('heatsim:control', ((event: CustomEvent<{ conditions: Conditions }>) => {
  const next = event.detail.conditions;
  if (connection.connected) {
    for (const key of Object.keys(HARDWARE_OPENINGS)) {
      const opening = openingForKey(key)!;
      const group = opening.kind === 'window' ? 'windows' : 'doors';
      if (next[group][opening.id] !== observed[group][opening.id]) void connection.sendOpening(opening.kind, opening.id, next[group][opening.id]);
    }
    const changes: [string, unknown, unknown][] = [
      ['PUR', next.portableFan?.on, observed.portableFan?.on],
      ['FANPOS', next.portableFan?.slot, observed.portableFan?.slot],
      ['FANANG', next.portableFan?.angleDeg, observed.portableFan?.angleDeg],
      ['FANSPD', next.portableFan?.speed, observed.portableFan?.speed],
      ['PURPOS', next.purifier?.slot, observed.purifier?.slot],
      ['AC', Object.entries(next.devices).some(([id, on]) => id.startsWith('ac_') && on), Object.entries(observed.devices).some(([id, on]) => id.startsWith('ac_') && on)],
    ];
    for (const [key, value, old] of changes) if (value !== old && value !== undefined) void connection.send(`${key}:${typeof value === 'boolean' ? value ? 'ON' : 'OFF' : value}`);
    if (next.scenarioId !== observed.scenarioId) {
      const index = PRESETS.findIndex(preset => preset.id === next.scenarioId);
      if (index >= 0) void connection.send(`SCN:${index + 1}`);
    }
  }
  observed = structuredClone(next);
}) as EventListener);

if (!hardwareSupported()) {
  button.disabled = true;
  status.textContent = 'USB needs desktop Chrome or Edge on localhost. All on-screen and keyboard controls remain available.';
} else {
  void connection.reconnectKnown();
}
