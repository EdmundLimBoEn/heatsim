// Run on a fresh Vite page; emulates v2 serial responses, not physical wiring.
(async () => {
  const appUrl = performance.getEntriesByType('resource').filter(entry => /\/src\/app\.ts(?:\?|$)/.test(entry.name)).at(-1)?.name;
  const app = await import(appUrl);
  const { HARDWARE_OPENINGS } = await import('/src/config/mapping.ts');
  const checks = [], writes = [];
  window.heatSimHardwareV2Result = { status: 'running', checks };
  const assert = (value, text) => { if (!value) throw new Error(text); checks.push(text); };
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const states = Object.fromEntries(Object.keys(HARDWARE_OPENINGS).map(key => [key, false]));
  let fanOn = false, stream;
  const send = line => stream.enqueue(new TextEncoder().encode(line + '\n'));
  const port = {
    readable: new ReadableStream({ start(controller) { stream = controller; } }),
    writable: new WritableStream({ write(bytes) {
      const line = new TextDecoder().decode(bytes).trim(); writes.push(line);
      if (line === 'HELLO') send('HELLO:HEATSIM/2');
      else if (line === 'PING') send('PONG');
      else if (line === 'GET:ALL') {
        for (const [key, value] of Object.entries(states)) send(`${key}:${Number(value)}`);
        send(`FAN:${fanOn ? 'ON' : 'OFF'}`); send('END');
      } else if (line.startsWith('FAN:')) {
        if (line !== `FAN:${fanOn ? 'ON' : 'OFF'}`) send('ERR:BUSY');
        send(`FAN:${fanOn ? 'ON' : 'OFF'}`);
      } else { const [key, value] = line.split(':'); if (key in states) states[key] = value === '1'; send(line); }
    } }),
    async open() {}, async close() {},
  };
  const saved = app.readConditions();
  const descriptor = Object.getOwnPropertyDescriptor(navigator, 'serial');
  const button = document.querySelector('#connect-hardware');
  try {
    Object.defineProperty(navigator, 'serial', { configurable: true, value: { requestPort: async () => port, getPorts: async () => [] } });
    const start = app.readConditions();
    start.portableFan = { on: true, slot: 0, angleDeg: 90, speed: 2, position: {x: 9.9, z: 1.5}, headingDeg: 247 };
    start.purifier = {on:true, slot:2};
    app.replaceConditions(start);
    button.disabled = false; button.click(); await wait(1800);
    assert(document.querySelector('#hardware-status').textContent.includes('v2'), 'v2 handshake visible');
    assert(!app.readConditions().portableFan.on, 'Startup samples D5 OFF');
    assert(JSON.stringify(app.readConditions().portableFan.position) === JSON.stringify(start.portableFan.position), 'Startup keeps dragged fan position');
    for (const prefix of ['WIN', 'DOOR']) {
      for (const value of [true, false]) {
        for (const key of Object.keys(states).filter(key => key.startsWith(prefix))) { states[key] = value; send(`${key}:${Number(value)}`); }
        await wait(100);
        assert(Object.values(app.readConditions()[prefix === 'WIN' ? 'windows' : 'doors']).every(v => v === value), `${prefix} group sets every opening ${value}`);
      }
    }
    const count = writes.length;
    fanOn = true; send('FAN:ON'); await wait(100);
    const powered = app.readConditions();
    assert(powered.portableFan.on && powered.portableFan.headingDeg === 247, 'D5 powers fan without resetting heading');
    assert(JSON.stringify(powered.portableFan.position) === JSON.stringify(start.portableFan.position), 'D5 keeps dragged position');
    assert(powered.purifier.on && writes.length === count, 'D5 preserves purifier and never echoes');
    // Software doors remain available when the D3 button has not been fitted.
    const next = app.readConditions(); next.doors.door_shelter = true; app.replaceConditions(next);
    window.dispatchEvent(new CustomEvent('heatsim:control', {detail:{conditions:app.readConditions()}})); await wait(100);
    assert(writes.includes('DOOR9:1') && app.readConditions().doors.door_shelter, 'Unwired D3 allows individual software door command and echo');
    const conflict = app.readConditions(); conflict.portableFan.on = false; app.replaceConditions(conflict);
    window.dispatchEvent(new CustomEvent('heatsim:control', {detail:{conditions:app.readConditions()}})); await wait(100);
    assert(app.readConditions().portableFan.on, 'D5 physical authority restores rejected software power');
    fanOn = false; send('FAN:OFF'); await wait(100);
    assert(!app.readConditions().portableFan.on && app.readConditions().portableFan.headingDeg === 247, 'D5 release stops fan without resetting rotation');
    stream.close(); await wait(100);
    assert(document.querySelector('#hardware-controls').dataset.connection === 'disconnected', 'USB removal returns to standalone controls');
    window.heatSimHardwareV2Result = {status:'passed',checks};
  } finally {
    if (document.querySelector('#hardware-controls').dataset.connection === 'connected') { button.click(); await wait(100); }
    if (descriptor) Object.defineProperty(navigator, 'serial', descriptor); else delete navigator.serial;
    app.replaceConditions(saved, true);
  }
})().catch(error => { window.heatSimHardwareV2Result = {...window.heatSimHardwareV2Result, status:'failed', error:error.message}; });
