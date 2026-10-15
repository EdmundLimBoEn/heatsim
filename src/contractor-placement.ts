import { parseContractorPlan, type ContractorPlan, type ContractorRoom } from './contractor-plan';

export interface PlacementPoint { x: number; y: number }
export interface ContractorPreviewProjection {
  minX: number; minZ: number; width: number; depth: number;
  scale: number; offsetX: number; offsetY: number;
}

export function contractorPreviewProjection(plan: ContractorPlan): ContractorPreviewProjection {
  const minX = Math.min(...plan.rooms.map(room => room.x));
  const minZ = Math.min(...plan.rooms.map(room => room.z));
  const width = Math.max(...plan.rooms.map(room => room.x + room.widthM)) - minX;
  const depth = Math.max(...plan.rooms.map(room => room.z + room.depthM)) - minZ;
  return { minX, minZ, width, depth, scale: Math.min(260 / width, 165 / depth), offsetX: 24, offsetY: 34 };
}

/** Inverting the screen matrix accounts for SVG letterboxing, scrolling and CSS transforms. */
export function clientPointToSvg(svg: Pick<SVGSVGElement, 'getScreenCTM'>, clientX: number, clientY: number): PlacementPoint | null {
  try {
    const matrix = svg.getScreenCTM();
    if (!matrix) return null;
    const { a, b, c, d, e, f } = matrix;
    if (![a, b, c, d, e, f, clientX, clientY].every(Number.isFinite)) return null;
    const determinant = a * d - b * c;
    if (Math.abs(determinant) < 1e-12) return null;
    const dx = clientX - e, dy = clientY - f;
    return { x: (d * dx - c * dy) / determinant, y: (a * dy - b * dx) / determinant };
  } catch { return null; }
}

export function contractorRoomAtPoint(plan: ContractorPlan, x: number, z: number): ContractorRoom | null {
  if (!Number.isFinite(x) || !Number.isFinite(z)) return null;
  const rooms = plan.rooms.filter(room => x >= room.x && x <= room.x + room.widthM && z >= room.z && z <= room.z + room.depthM);
  // A shared wall belongs to neither room for placement; the user must choose an interior.
  return rooms.length === 1 ? rooms[0] : null;
}

export function moveContractorDevice(plan: ContractorPlan, deviceId: string, roomId: string): ContractorPlan {
  const device = plan.devices.find(item => item.id === deviceId);
  if (!device || !plan.rooms.some(room => room.id === roomId) || device.roomId === roomId) return plan;
  return parseContractorPlan({ ...plan, devices: plan.devices.map(item => item.id === deviceId ? { ...item, roomId } : item) });
}

export interface ContractorPlacementOptions {
  getPlan(slotKey: string): ContractorPlan | null | undefined;
  onMove(slotKey: string, plan: ContractorPlan, deviceId: string, roomId: string): void;
  onAnnounce?(message: string): void;
}

interface Drag {
  pointerId: number; slotKey: string; plan: ContractorPlan; deviceId: string;
  svg: SVGSVGElement; icon: SVGElement; ghost: SVGElement; start: PlacementPoint;
  transform: string; target: SVGElement | null;
}

/** Room-level placement only. The temporary pointer position never enters the thermal model. */
export function bindContractorPlacement(root: HTMLElement, options: ContractorPlacementOptions): () => void {
  const events = new AbortController();
  let drag: Drag | null = null;
  let disposed = false;

  function clear(): Drag | null {
    const previous = drag;
    drag = null;
    if (!previous) return null;
    previous.icon.classList.remove('cs-device-dragging');
    previous.target?.classList.remove('cs-drop-target');
    previous.ghost.remove();
    try { if (root.hasPointerCapture(previous.pointerId)) root.releasePointerCapture(previous.pointerId); } catch { /* Capture can already be gone after a DOM replacement. */ }
    return previous;
  }
  function current(value: Drag): boolean {
    return !disposed && root.contains(value.svg) && options.getPlan(value.slotKey) === value.plan;
  }
  function roomAt(value: Drag, point: PlacementPoint): ContractorRoom | null {
    const projection = contractorPreviewProjection(value.plan);
    return contractorRoomAtPoint(value.plan,
      projection.minX + (point.x - projection.offsetX) / projection.scale,
      projection.minZ + (point.y - projection.offsetY) / projection.scale);
  }
  function update(event: PointerEvent): void {
    const value = drag;
    if (!value || value.pointerId !== event.pointerId) return;
    if (!current(value)) { clear(); return; }
    const point = clientPointToSvg(value.svg, event.clientX, event.clientY);
    value.target?.classList.remove('cs-drop-target');
    value.target = null;
    if (!point) return;
    value.ghost.setAttribute('transform', `translate(${point.x - value.start.x} ${point.y - value.start.y}) ${value.transform}`.trim());
    const room = roomAt(value, point);
    if (room) {
      value.target = Array.from(value.svg.querySelectorAll<SVGElement>('[data-placement-room]')).find(node => node.dataset.placementRoom === room.id) ?? null;
      value.target?.classList.add('cs-drop-target');
    }
    event.preventDefault();
  }
  root.addEventListener('pointerdown', event => {
    if (disposed || drag || event.button !== 0 || event.isPrimary === false) return;
    const target = event.target as Element | null;
    const icon = typeof target?.closest === 'function' ? target.closest<SVGElement>('[data-placement-device]') : null;
    const svg = icon?.closest<SVGSVGElement>('svg[data-placement-plan]');
    if (!icon || !svg || !root.contains(svg)) return;
    const slotKey = svg.dataset.placementPlan, deviceId = icon.dataset.placementDevice;
    if (slotKey === undefined || !deviceId) return;
    const plan = options.getPlan(slotKey);
    if (!plan || !plan.devices.some(device => device.id === deviceId)) return;
    const start = clientPointToSvg(svg, event.clientX, event.clientY);
    if (!start) return;
    const ghost = icon.cloneNode(true) as SVGElement;
    ghost.removeAttribute('data-placement-device'); ghost.removeAttribute('tabindex');
    ghost.setAttribute('aria-hidden', 'true'); ghost.classList.add('cs-device-ghost');
    ghost.style.pointerEvents = 'none'; ghost.style.opacity = '0.75';
    svg.append(ghost);
    drag = { pointerId: event.pointerId, slotKey, plan, deviceId, svg, icon, ghost, start, transform: icon.getAttribute('transform') ?? '', target: null };
    icon.classList.add('cs-device-dragging');
    try { root.setPointerCapture(event.pointerId); } catch { /* A synthetic event may not own a native pointer. */ }
    update(event); event.preventDefault();
  }, { signal: events.signal });
  root.addEventListener('pointermove', update, { signal: events.signal });
  root.addEventListener('pointerup', event => {
    const value = drag;
    if (!value || value.pointerId !== event.pointerId) return;
    const point = clientPointToSvg(value.svg, event.clientX, event.clientY);
    const room = current(value) && point ? roomAt(value, point) : null;
    clear();
    if (!room) { options.onAnnounce?.('Placement cancelled. Drop inside a room.'); return; }
    const next = moveContractorDevice(value.plan, value.deviceId, room.id);
    if (next !== value.plan) {
      options.onMove(value.slotKey, next, value.deviceId, room.id);
      options.onAnnounce?.(`${value.deviceId} moved to ${room.label}. Placement snaps to a room; compare again to update results.`);
    }
    event.preventDefault();
  }, { signal: events.signal });
  const cancel = (event: PointerEvent) => { if (drag?.pointerId === event.pointerId) clear(); };
  root.addEventListener('pointercancel', cancel, { signal: events.signal });
  root.addEventListener('lostpointercapture', cancel, { signal: events.signal });
  root.ownerDocument.addEventListener('keydown', event => {
    if (event.key === 'Escape' && drag) { clear(); options.onAnnounce?.('Placement cancelled.'); event.preventDefault(); }
  }, { signal: events.signal });
  root.ownerDocument.defaultView?.addEventListener('blur', () => clear(), { signal: events.signal });
  return () => { if (disposed) return; disposed = true; clear(); events.abort(); };
}
