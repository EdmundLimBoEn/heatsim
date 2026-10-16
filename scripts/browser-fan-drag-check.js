// Run on a Vite page; read window.heatSimFanDragCheck. Pointer capture is stubbed for synthetic events.
window.heatSimFanDragCheck = { status: 'running' };
(async () => {
  const checks = [];
  const assert = (value, name) => { if (!value) throw new Error(name); checks.push(name); };
  const wait = () => new Promise(resolve => setTimeout(resolve, 300));
  const appUrl = performance.getEntriesByType('resource').filter(entry => /\/src\/app\.ts(?:\?|$)/.test(entry.name)).at(-1).name;
  const app = await import(appUrl);
  const THREE = await import('/node_modules/.vite/deps/three.js');
  const { resolveStandingFans, findStandingFanPosition } = await import('/src/standing-fans.ts');
  const canvas = document.querySelector('#scene canvas');
  const capture = canvas.setPointerCapture, release = canvas.releasePointerCapture, hasCapture = canvas.hasPointerCapture;
  canvas.setPointerCapture = () => {}; canvas.releasePointerCapture = () => {}; canvas.hasPointerCapture = () => false;
  try {
    document.querySelector('[data-camera="top"]').click();
    await wait();
    const rect = canvas.getBoundingClientRect(), aspect = rect.width / rect.height;
    const camera = new THREE.PerspectiveCamera(34, aspect, 0.1, 120);
    camera.position.set(6, Math.max(19.5, 25 / Math.max(aspect, 0.6)), 3.751);
    camera.lookAt(6, 0, 3.75); camera.updateMatrixWorld();
    const screen = (x, z, y = 1.3) => {
      const point = new THREE.Vector3(x, y, z).project(camera);
      return { clientX: rect.left + (point.x + 1) / 2 * rect.width, clientY: rect.top + (1 - point.y) / 2 * rect.height };
    };
    const pointer = (type, point) => canvas.dispatchEvent(new PointerEvent(type, { ...point, pointerId: 1, isPrimary: true, button: 0, buttons: type === 'pointerup' ? 0 : 1, bubbles: true }));
    let fan = resolveStandingFans(app.readConditions()).find(item => item.id === 'primary');
    const start = screen(fan.x, fan.z);
    pointer('pointerdown', start); pointer('pointerup', start);
    assert(!document.querySelector('#panel-devices').hidden, 'Clicking a fan keeps its Devices controls open');
    const destination = findStandingFanPosition(fan.room === 'living' ? 'bedroom2' : 'living', app.readConditions(), fan.id);
    assert(destination, 'A clear destination exists');
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2((start.clientX - rect.left) / rect.width * 2 - 1, 1 - (start.clientY - rect.top) / rect.height * 2), camera);
    const floorHit = ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), new THREE.Vector3());
    const drop = screen(destination.x + floorHit.x - fan.x, destination.z + floorHit.z - fan.z, 0);
    pointer('pointerdown', start);
    pointer('pointermove', drop);
    pointer('pointerup', drop);
    const moved = resolveStandingFans(app.readConditions()).find(item => item.id === fan.id);
    assert(Math.hypot(moved.x - fan.x, moved.z - fan.z) > 0.5, 'Dragging commits a new fan position');
    assert(!document.querySelector('#panel-devices').hidden, 'Dragging leaves fan controls accessible');
    await wait();
    const movedScreen = screen(moved.x, moved.z);
    pointer('pointerdown', movedScreen);
    pointer('pointermove', start);
    canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    pointer('pointerup', start);
    const cancelled = resolveStandingFans(app.readConditions()).find(item => item.id === fan.id);
    assert(cancelled.x === moved.x && cancelled.z === moved.z, 'Escape cancels a drag without changing position');
    canvas.dispatchEvent(new MouseEvent('contextmenu', { ...movedScreen, button: 2, bubbles: true }));
    const menu = document.querySelector('.device-context-menu');
    assert(!menu.hidden, 'Right-click opens quick controls on the moved fan');
    menu.querySelector('[data-device-action="right"]').click();
    const rotated = resolveStandingFans(app.readConditions()).find(item => item.id === fan.id);
    assert(rotated.angleDeg === (cancelled.angleDeg + 45) % 360, 'Quick controls rotate the selected fan');
    window.heatSimFanDragCheck = { status: 'passed', checks };
  } catch (error) {
    window.heatSimFanDragCheck = { status: 'failed', checks, error: String(error), stack: error.stack };
  } finally {
    canvas.setPointerCapture = capture; canvas.releasePointerCapture = release; canvas.hasPointerCapture = hasCapture;
  }
})();
