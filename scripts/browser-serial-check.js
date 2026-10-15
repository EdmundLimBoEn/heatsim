// Run with gstack browse eval scripts/browser-serial-check.js against a fresh Vite page.
return await (async () => {
  const appUrl = performance.getEntriesByType('resource').filter(entry => /\/src\/app\.ts(?:\?|$)/.test(entry.name)).at(-1)?.name;
  if (!appUrl) throw new Error('Run against the Vite development server');
  const app = await import(appUrl);
  const checks = [], writes = [];
  const assert = (condition, label) => { if (!condition) throw new Error(label); checks.push(label); };
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const key = () => document.body.dispatchEvent(new KeyboardEvent('keydown', { key: '1', code: 'Digit1', bubbles: true }));
  let stream;
  const encoder = new TextEncoder(), decoder = new TextDecoder();
  const send = line => stream.enqueue(encoder.encode(`${line}\n`));
  const port = {
    readable: new ReadableStream({ start(controller) { stream = controller; } }),
    writable: new WritableStream({ write(bytes) {
      const line = decoder.decode(bytes).trim(); writes.push(line);
      if (line === 'HELLO') send('HELLO:HEATSIM/1');
      else if (line === 'PING') send('PONG');
      else if (line === 'GET:ALL') { send('WIN1:0'); send('DOOR2:0'); send('SCN:6'); send('END'); }
      else send(line);
    } }),
    async open(options) { assert(options.baudRate === 115200, 'Uses protocol baud rate'); },
    async close() {},
  };
  const descriptor = Object.getOwnPropertyDescriptor(navigator, 'serial');
  const saved = app.readConditions();
  const wasPlaying = document.querySelector('#play-status').textContent.includes('running');
  const setPlaying = value => { if (document.querySelector('#play-status').textContent.includes('running') !== value) document.querySelector('[data-action="play"]').click(); };
  const button = document.querySelector('#connect-hardware');
  try {
    Object.defineProperty(navigator, 'serial', { configurable: true, value: { requestPort: async () => port, getPorts: async () => [] } });
    app.loadScenario('haze_outside');
    button.disabled = false; button.click();
    await wait(1800);
    assert(writes.includes('HELLO') && writes.includes('GET:ALL'), 'Handshake requests board state');
    assert(app.readConditions().scenarioId === 'validation' && !app.readConditions().doors.door_bedroom3, 'Hardware scenario preserves authoritative closed door');
    assert(document.querySelector('#hardware-status').textContent.includes('protocol v1'), 'Mock handshake reaches connected state');
    const count = writes.filter(line => line.startsWith('WIN1:')).length;
    key(); await wait(100);
    assert(app.readConditions().windows.window_bedroom3_1 && writes.filter(line => line.startsWith('WIN1:')).length === count + 1, 'Keyboard sends one command and echo does not loop');
    const beforeIncoming = writes.length;
    send('WIN1:0'); await wait(100);
    assert(!app.readConditions().windows.window_bedroom3_1 && writes.length === beforeIncoming, 'Incoming switch changes app without an outgoing echo');
    const beforeBadInput = JSON.stringify(app.readConditions());
    send('WIN1:<script>'); send('FANANG:999'); send('FANPOS:9'); send('SCN:99');
    await wait(100);
    assert(JSON.stringify(app.readConditions()) === beforeBadInput, 'Invalid or unmapped ranges cannot alter model');
    const windy = app.readConditions();
    windy.windFrom = 'E'; windy.portableFan.on = true;
    app.replaceConditions(windy);
    const controlsBeforeScenario = JSON.stringify([windy.windows, windy.doors, windy.devices, windy.portableFan]);
    const scenarioWrites = writes.filter(line => line.startsWith('SCN:')).length;
    send('SCN:6'); await wait(100);
    const restored = app.readConditions();
    assert(restored.windFrom === undefined, 'Same hardware scenario clears a manual wind direction');
    assert(JSON.stringify([restored.windows, restored.doors, restored.devices, restored.portableFan]) === controlsBeforeScenario, 'Hardware weather reset preserves openings and devices');
    setPlaying(true); await wait(500); setPlaying(false); await wait(300);
    const clock = document.querySelector('#elapsed-time').textContent;
    const energy = document.querySelector('#energy').textContent;
    send('SCN:6'); await wait(300);
    assert(clock !== '00:00:00' && document.querySelector('#elapsed-time').textContent === clock && document.querySelector('#energy').textContent === energy, 'Repeated hardware scenario preserves completed time and energy');
    assert(writes.filter(line => line.startsWith('SCN:')).length === scenarioWrites, 'Hardware scenario reset and duplicate do not echo');
    setPlaying(wasPlaying);
    stream.close(); await wait(100);
    assert(document.querySelector('#hardware-controls').dataset.connection === 'disconnected', 'USB removal is handled');
    key();
    assert(app.readConditions().windows.window_bedroom3_1, 'Standalone controls work after disconnect');
  } finally {
    if (document.querySelector('#hardware-controls').dataset.connection === 'connected') { button.click(); await wait(100); }
    if (descriptor) Object.defineProperty(navigator, 'serial', descriptor); else delete navigator.serial;
    app.replaceConditions(saved, true);
    setPlaying(wasPlaying);
  }
  return { checks, writes };
})()
