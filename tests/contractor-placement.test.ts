import { describe, expect, it, vi } from 'vitest';
import { parseContractorPlan } from '../src/contractor-plan';
import { bindContractorPlacement, clientPointToSvg, contractorPreviewProjection, contractorRoomAtPoint, moveContractorDevice } from '../src/contractor-placement';

function sample() {
  return parseContractorPlan({
    version: 1, id: 'two_rooms', name: 'Two rooms', heightM: 2.7,
    rooms: [
      { id: 'west', label: 'West', x: -2, z: 3, widthM: 4, depthM: 4 },
      { id: 'east', label: 'East', x: 2, z: 3, widthM: 4, depthM: 4 },
    ], openings: [], devices: [
      { id: 'fan', kind: 'fan', roomId: 'west', on: true },
      { id: 'purifier', kind: 'purifier', roomId: 'west', on: false },
      { id: 'ac', kind: 'ac', roomId: 'west', on: true },
    ],
  });
}

describe('room-snapped contractor placement', () => {
  it('uses the same bounded projection for negative origins and tall plans', () => {
    const plan = sample(), projection = contractorPreviewProjection(plan);
    expect(projection).toEqual({ minX: -2, minZ: 3, width: 8, depth: 4, scale: 32.5, offsetX: 24, offsetY: 34 });
    plan.rooms[0].depthM = 20;
    expect(contractorPreviewProjection(plan).scale).toBe(8.25);
  });
  it('hits room interiors, rejects exterior points and ambiguous shared walls', () => {
    const plan = sample();
    expect(contractorRoomAtPoint(plan, 0, 5)?.id).toBe('west');
    expect(contractorRoomAtPoint(plan, 4, 5)?.id).toBe('east');
    expect(contractorRoomAtPoint(plan, 2, 5)).toBeNull();
    expect(contractorRoomAtPoint(plan, 7, 5)).toBeNull();
    expect(contractorRoomAtPoint(plan, NaN, 5)).toBeNull();
    expect(contractorRoomAtPoint(plan, 0, Infinity)).toBeNull();
  });
  it.each(['fan', 'purifier', 'ac'])('immutably relocates %s while preserving equipment identity and power', id => {
    const plan = sample(), before = JSON.stringify(plan);
    const moved = moveContractorDevice(plan, id, 'east');
    expect(JSON.stringify(plan)).toBe(before);
    expect(moved.devices.find(device => device.id === id)).toEqual({ ...plan.devices.find(device => device.id === id), roomId: 'east' });
    expect(moved.rooms).toEqual(plan.rooms);
    expect(moved.openings).toEqual(plan.openings);
    expect(moved.devices.filter(device => device.id !== id)).toEqual(plan.devices.filter(device => device.id !== id));
    expect(parseContractorPlan(moved)).toEqual(moved);
    expect(moved.rooms).not.toBe(plan.rooms);
  });
  it('leaves invalid IDs and unchanged assignments untouched', () => {
    const plan = sample();
    expect(moveContractorDevice(plan, 'fan', 'west')).toBe(plan);
    expect(moveContractorDevice(plan, 'missing', 'east')).toBe(plan);
    expect(moveContractorDevice(plan, 'fan', 'missing')).toBe(plan);
  });
});

function matrix(a: number, b: number, c: number, d: number, e: number, f: number) {
  return { getScreenCTM: () => ({ a, b, c, d, e, f } as DOMMatrix) };
}
describe('screen to SVG conversion', () => {
  it('handles a scaled, letterboxed and scrolled preview', () => {
    expect(clientPointToSvg(matrix(2, 0, 0, 2, 70, -30), 270, 70)).toEqual({ x: 100, y: 50 });
  });
  it('handles rotated and skewed ancestor transforms', () => {
    expect(clientPointToSvg(matrix(0, 2, -3, 1, 70, 30), 55, 55)).toEqual({ x: 10, y: 5 });
  });
  it('rejects unavailable, singular or nonfinite coordinates and matrices', () => {
    expect(clientPointToSvg({ getScreenCTM: () => null }, 0, 0)).toBeNull();
    expect(clientPointToSvg(matrix(0, 0, 0, 0, 0, 0), 0, 0)).toBeNull();
    expect(clientPointToSvg(matrix(1, 0, 0, 1, Infinity, 0), 0, 0)).toBeNull();
    expect(clientPointToSvg(matrix(1, 0, 0, 1, 0, 0), NaN, 0)).toBeNull();
  });
});

function tokens() {
  const values = new Set<string>();
  return { add: (value: string) => values.add(value), remove: (value: string) => values.delete(value), contains: (value: string) => values.has(value) };
}
function harness() {
  let plan = sample(), attached = true;
  const ghost = { removeAttribute: vi.fn(), setAttribute: vi.fn(), remove: vi.fn(), classList: tokens(), style: {} };
  const rectangles = plan.rooms.map(room => ({ dataset: { placementRoom: room.id }, classList: tokens() }));
  const svg = { dataset: { placementPlan: '1' }, ...matrix(2, 0, 0, 2, 100, 50), append: vi.fn(), querySelectorAll: () => rectangles };
  const icon = { dataset: { placementDevice: 'fan' }, classList: tokens(), getAttribute: () => '', cloneNode: () => ghost,
    closest: (selector: string) => selector.startsWith('svg') ? svg : icon };
  const document = Object.assign(new EventTarget(), { defaultView: new EventTarget() });
  const root = Object.assign(new EventTarget(), { ownerDocument: document, contains: () => attached,
    setPointerCapture: vi.fn(), hasPointerCapture: () => false, releasePointerCapture: vi.fn() });
  const onMove = vi.fn(), onAnnounce = vi.fn();
  const dispose = bindContractorPlacement(root as unknown as HTMLElement, { getPlan: () => plan, onMove, onAnnounce });
  const emit = (type: string, x: number, z: number, pointerId = 7) => {
    const projection = contractorPreviewProjection(plan);
    const event = new Event(type, { cancelable: true });
    const clientX = 100 + 2 * (projection.offsetX + (x - projection.minX) * projection.scale);
    const clientY = 50 + 2 * (projection.offsetY + (z - projection.minZ) * projection.scale);
    Object.defineProperties(event, {
      target: { value: icon }, button: { value: 0 }, isPrimary: { value: true },
      pointerId: { value: pointerId }, clientX: { value: clientX }, clientY: { value: clientY },
    });
    root.dispatchEvent(event);
  };
  return { emit, root, document, icon, rectangles, ghost, dispose, onMove, onAnnounce,
    replace: () => { plan = sample(); }, detach: () => { attached = false; } };
}

describe('placement pointer lifecycle', () => {
  it('previews movement and commits exactly one room change to the correct plan slot', () => {
    const h = harness();
    h.emit('pointerdown', 0, 5); h.emit('pointermove', 4, 5);
    expect(h.rectangles[1].classList.contains('cs-drop-target')).toBe(true);
    expect(h.ghost.setAttribute).toHaveBeenCalledWith('transform', 'translate(130 0)');
    expect(h.onMove).not.toHaveBeenCalled();
    h.emit('pointerup', 4, 5); h.emit('pointerup', 4, 5);
    expect(h.onMove).toHaveBeenCalledTimes(1);
    expect(h.onMove.mock.calls[0][0]).toBe('1');
    expect(h.onMove.mock.calls[0][1].devices[0].roomId).toBe('east');
    expect(h.onMove.mock.calls[0].slice(2)).toEqual(['fan', 'east']);
    expect(h.icon.classList.contains('cs-device-dragging')).toBe(false);
    expect(h.rectangles[1].classList.contains('cs-drop-target')).toBe(false);
    h.dispose();
  });
  it.each(['pointercancel', 'lostpointercapture'])('%s cancels a pending move without changing the plan', cancel => {
    const h = harness(); h.emit('pointerdown', 0, 5); h.emit(cancel, 4, 5); h.emit('pointerup', 4, 5);
    expect(h.onMove).not.toHaveBeenCalled(); expect(h.ghost.remove).toHaveBeenCalledTimes(1); h.dispose();
  });
  it('rejects outside drops, same-room drops and events from another pointer', () => {
    const h = harness(); h.emit('pointerdown', 0, 5); h.emit('pointerup', 4, 5, 8);
    expect(h.onMove).not.toHaveBeenCalled();
    h.emit('pointerup', 7, 5);
    h.emit('pointerdown', 0, 5); h.emit('pointerup', 0, 5);
    expect(h.onMove).not.toHaveBeenCalled(); h.dispose();
  });
  it.each(['replace', 'detach'] as const)('rejects stale gestures after %s', action => {
    const h = harness(); h.emit('pointerdown', 0, 5); h[action](); h.emit('pointerup', 4, 5);
    expect(h.onMove).not.toHaveBeenCalled(); h.dispose();
  });
  it('Escape and disposal remove the ghost and all later gesture effects', () => {
    const h = harness(); h.emit('pointerdown', 0, 5);
    const escape = new Event('keydown', { cancelable: true }); Object.defineProperty(escape, 'key', { value: 'Escape' });
    h.document.dispatchEvent(escape); h.emit('pointerup', 4, 5);
    expect(h.onMove).not.toHaveBeenCalled(); expect(escape.defaultPrevented).toBe(true);
    h.emit('pointerdown', 0, 5); h.dispose(); h.dispose(); h.emit('pointerup', 4, 5);
    h.emit('pointerdown', 0, 5); h.emit('pointerup', 4, 5);
    expect(h.onMove).not.toHaveBeenCalled(); expect(h.ghost.remove).toHaveBeenCalledTimes(2);
  });
});
