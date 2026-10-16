import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createPlanFieldView, fieldColor, roomPressure } from './scene-field';
import { createStandingFanVisuals } from './scene-fans';
import { resolveStandingFans, validateStandingFanPosition } from './standing-fans';
import type { ResolvedStandingFan } from './standing-fans';
import type { DeviceTarget } from './device-actions';
import { FAN_SLOTS, PURIFIER_SLOTS } from './config/slots';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { defaultConditions, defaultView, deviceRoom, model, MODEL_SCALE, roomLabel } from './domain';
import type { Conditions, ModelBox, SimulationResult, ViewOptions } from './domain';

export interface ThermalVentConfig {
  opening: string;
  on: boolean;
  mode: 'exhaust' | 'supply';
  ratedM3h: number;
}

export interface SceneController {
  update(conditions: Conditions, result: SimulationResult, view: ViewOptions): void;
  setThermalVent(config: ThermalVentConfig | null): void;
  setPortableDraggingEnabled(enabled: boolean): void;
  setSelectedStandingFan(id: string | null): void;
  setCamera(view: 'perspective' | 'top'): void;
  resetCamera(): void;
  rotateCamera(direction: 'left' | 'right'): void;
  dispose(): void;
  screenshot(): string;
}

export type PortableDeviceKind = 'fan' | 'purifier';
export interface StandingFanEvents {
  onMove(id: string, x: number, z: number): void;
  onSelect?(id: string): void;
  onContext?(target: DeviceTarget, x: number, y: number): void;
}

interface DragBase { pointerId: number; startX: number; startY: number; moved: boolean; controlsEnabled: boolean }
type DeviceDrag = DragBase & (
  { kind: 'fan'; startFan: ResolvedStandingFan; position: { x: number; z: number } | null; offsetX: number; offsetZ: number }
  | { kind: 'purifier'; startSlot: number; slot: number | null }
);

export function nearestPortableSlot(kind: PortableDeviceKind, x: number, z: number): number | null {
  if (!Number.isFinite(x) || !Number.isFinite(z) || !model.rooms.some(room => x >= room.min[0] && x <= room.max[0] && z >= room.min[2] && z <= room.max[2])) return null;
  if (model.boxes.some(box => box.type === 'wall' && box.min[1] < 0.2 && box.max[1] > 0.2 && x >= box.min[0] && x <= box.max[0] && z >= box.min[2] && z <= box.max[2])) return null;
  const slots = kind === 'fan' ? FAN_SLOTS : PURIFIER_SLOTS;
  let nearest = 0;
  for (let index = 1; index < slots.length; index++) {
    if (Math.hypot(slots[index].x - x, slots[index].z - z) < Math.hypot(slots[nearest].x - x, slots[nearest].z - z)) nearest = index;
  }
  return nearest;
}

const DOOR_SWING: Record<string, number> = {
  main_door: 1, door_master_bedroom: 1, door_common_bath: 1, door_bedroom2: 1,
  door_bedroom3: 1, door_master_bath: 1, door_kitchen: -1, door_service_yard: -1, door_shelter: 1,
};
const ROOM_ANCHORS: Record<string, [number, number]> = {
  master_bedroom: [1.9, 2.45], master_bath: [5.25, 0.65], common_bath: [4.7, 2.95],
  bedroom2: [7.25, 2.45], bedroom3: [10.4, 2.45], kitchen: [1.65, 4.65],
  service_yard: [1.45, 6.3], household_shelter: [3.6, 6.75], corridor: [8.4, 3.92],
  corridor_lobby: [3.6, 5.1], dining: [5.8, 6.65], living: [10, 6.65],
};

// shortcut: fixture adjustments preserve the supplied shell, reconcile these with a surveyed plan before fabrication at full scale.
function furnishingBounds(source: ModelBox): { min: number[]; max: number[] } {
  const min = [...source.min];
  const max = [...source.max];
  if (source.name.startsWith('dining_')) { min[2] -= 0.25; max[2] -= 0.25; }
  if (source.name === 'study_desk_bedroom3') { min[0] += 1; max[0] += 1; }
  if (source.name === 'kitchen_counter_2') max[0] = 1.95;
  if (source.name === 'kitchen_counter_1') { min[2] = 3.46; max[2] = 5.54; }
  return { min, max };
}

function thermalVentPlacement(name: string): { position: THREE.Vector3; size: number; yaw: number } | null {
  const opening = model.boxes.find(box => box.name === name && box.type === 'window' && box.exterior);
  if (!opening) return null;
  const alongX = opening.wall_axis === 'x';
  const width = opening.max[alongX ? 0 : 2] - opening.min[alongX ? 0 : 2];
  const size = Math.min(0.56, width - 0.12, opening.max[1] - opening.min[1] - 0.12);
  if (size <= 0) return null;
  const position = new THREE.Vector3((opening.min[0] + opening.max[0]) / 2, opening.max[1] - size / 2 - 0.05, (opening.min[2] + opening.max[2]) / 2);
  const yaw = alongX ? (position.z < 3.75 ? Math.PI : 0) : (position.x < 6 ? -Math.PI / 2 : Math.PI / 2);
  return { position, size, yaw };
}

export function checkSceneModel(): void {
  const width = model.bounds.max[0] - model.bounds.min[0];
  const depth = model.bounds.max[2] - model.bounds.min[2];
  if (Math.abs(width - 12.2) > 1e-6 || Math.abs(depth - 7.7) > 1e-6) throw new Error('The model envelope must match the 12.2 × 7.7 m fabrication plan.');
  if (width * 1000 / MODEL_SCALE > 200 || depth * 1000 / MODEL_SCALE > 150) throw new Error('The physical model exceeds the 200 × 150 mm build envelope.');
  for (const box of model.boxes) {
    if (box.type === 'door' && !DOOR_SWING[box.name]) throw new Error(`Missing door swing: ${box.name}`);
    if ((box.type === 'window' || box.type === 'door') && (!box.hinge_point || !['x', 'z'].includes(box.wall_axis ?? ''))) throw new Error(`Missing opening geometry: ${box.name}`);
    if (box.type === 'furniture') {
      const { min, max } = furnishingBounds(box);
      if (min[0] < 0 || min[2] < 0 || max[0] > 12 || max[2] > 7.5 || max.some((v, i) => v <= min[i])) throw new Error(`Furniture exceeds the shell: ${box.name}`);
    }
  }
  for (const opening of model.boxes.filter(box => box.type === 'window' && box.exterior)) {
    const placement = thermalVentPlacement(opening.name);
    if (!placement || placement.position.y - placement.size / 2 < opening.min[1] || placement.position.y + placement.size / 2 > opening.max[1]) throw new Error(`Vent concept exceeds its aperture: ${opening.name}`);
    const outward = new THREE.Vector3(Math.sin(placement.yaw), 0, Math.cos(placement.yaw));
    const facadeNormal = opening.wall?.includes('north') ? new THREE.Vector3(0, 0, -1) : opening.wall?.includes('south') ? new THREE.Vector3(0, 0, 1) : opening.wall?.includes('west') ? new THREE.Vector3(-1, 0, 0) : new THREE.Vector3(1, 0, 0);
    if (outward.dot(facadeNormal) < 0.999) throw new Error(`Vent concept faces the wrong facade: ${opening.name}`);
  }
  if (thermalVentPlacement('main_door') || thermalVentPlacement('unknown')) throw new Error('Vent concepts must attach only to existing exterior windows.');
  for (const name of Object.keys(deviceRoom)) {
    if (!model.boxes.some(box => box.name === name && box.type === 'device')) throw new Error(`Missing controlled device: ${name}`);
  }
  for (const kind of ['fan', 'purifier'] as const) {
    const slots = kind === 'fan' ? FAN_SLOTS : PURIFIER_SLOTS;
    slots.forEach((slot, index) => {
      if (nearestPortableSlot(kind, slot.x, slot.z) !== index) throw new Error(`Invalid portable ${kind} slot ${index}`);
    });
    if (nearestPortableSlot(kind, -1, 4) !== null || nearestPortableSlot(kind, Number.NaN, 1) !== null || nearestPortableSlot(kind, 0, -0.05) !== null) throw new Error('Portable drops must reject outside, non-finite and wall positions.');
  }
}

export async function createScene(container: HTMLElement, onSelectRoom: (room: string | null) => void, onMovePortableDevice?: (kind: PortableDeviceKind, slotId: number) => void, fanEvents?: StandingFanEvents): Promise<SceneController> {
  checkSceneModel();
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#e9ede9');
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.autoUpdate = false;
  renderer.shadowMap.needsUpdate = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.18;
  renderer.domElement.style.cssText = 'display:block;width:100%;height:100%;touch-action:none;outline:none;';
  renderer.domElement.setAttribute('aria-label', 'Interactive 3D flat. Drag standing fans to clear floor areas; drag the purifier to a marked position. Drag empty space to rotate, scroll to zoom. Device controls provide keyboard access.');
  renderer.domElement.setAttribute('role', 'img');
  renderer.domElement.tabIndex = 0;
  container.appendChild(renderer.domElement);
  const labelLayer = document.createElement('div');
  labelLayer.style.cssText = 'position:absolute;inset:0;overflow:hidden;pointer-events:none;font-family:inherit;';
  container.appendChild(labelLayer);

  const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 120);
  const controls = new OrbitControls(camera, renderer.domElement);
  const motionPreference = matchMedia('(prefers-reduced-motion: reduce)');
  let reducedMotion = motionPreference.matches;
  controls.enableDamping = !reducedMotion;
  controls.dampingFactor = 0.085;
  controls.minDistance = 9;
  controls.maxDistance = 38;
  controls.maxPolarAngle = Math.PI / 2.05;
  controls.target.set(6, 0.5, 3.75);
  controls.enablePan = true;
  controls.screenSpacePanning = false;
  const hemisphere = new THREE.HemisphereLight('#f8fbff', '#b5b6a7', 2.8);
  scene.add(hemisphere);
  const sunlight = new THREE.DirectionalLight('#fff5e5', 3.6);
  sunlight.position.set(-3, 16, 10);
  sunlight.target.position.set(6, 0, 3.75);
  sunlight.castShadow = true;
  sunlight.shadow.mapSize.set(2048, 2048);
  sunlight.shadow.camera.left = -13;
  sunlight.shadow.camera.right = 13;
  sunlight.shadow.camera.top = 11;
  sunlight.shadow.camera.bottom = -11;
  sunlight.shadow.camera.near = 0.1;
  sunlight.shadow.camera.far = 45;
  sunlight.shadow.normalBias = 0.025;
  sunlight.shadow.bias = -0.00015;
  sunlight.shadow.radius = 4;
  scene.add(sunlight, sunlight.target);
  const fillLight = new THREE.DirectionalLight('#dcebf3', 1.1);
  fillLight.position.set(14, 8, -6);
  scene.add(fillLight);

  const materials = new Set<THREE.Material>();
  const geometries = new Set<THREE.BufferGeometry>();
  const material = (color: string, roughness = 0.8): THREE.MeshStandardMaterial => {
    const mat = new THREE.MeshStandardMaterial({ color, roughness });
    materials.add(mat);
    return mat;
  };
  const palette = {
    wall: material('#f1eee7'), wallTop: material('#d2d0c5'), floor: material('#e4dfd5'), wood: material('#b99b78'),
    woodLight: material('#d3bca0'), fabric: material('#e6dfd0'), teal: material('#58796f'), slate: material('#596b64'),
    white: material('#f4f2ea'), metal: material('#73817d', 0.45), dark: material('#273b35'), tile: material('#cdd6d0'),
    glass: material('#a5c4c0', 0.2), bedding: material('#faf7ee'), brass: material('#b39a6c', 0.45),
  };
  palette.glass.transparent = true;
  palette.glass.opacity = 0.35;
  palette.glass.depthWrite = false;
  const boxGeometry = new THREE.BoxGeometry(1, 1, 1);
  geometries.add(boxGeometry);
  function box(w: number, h: number, d: number, x: number, y: number, z: number, mat: THREE.Material, parent: THREE.Object3D = scene, radius = 0): THREE.Mesh {
    const geometry = radius ? new RoundedBoxGeometry(w, h, d, 2, Math.min(radius, w / 3, h / 3, d / 3)) : boxGeometry;
    if (radius) geometries.add(geometry);
    const mesh = new THREE.Mesh(geometry, mat);
    if (!radius) mesh.scale.set(w, h, d);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }
  function cylinder(radius: number, height: number, x: number, y: number, z: number, mat: THREE.Material, parent: THREE.Object3D = scene, topRadius = radius): THREE.Mesh {
    const geometry = new THREE.CylinderGeometry(topRadius, radius, height, 24);
    geometries.add(geometry);
    const mesh = new THREE.Mesh(geometry, mat);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }
  function line(points: THREE.Vector3[], color: string, parent: THREE.Object3D = scene): THREE.Line {
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    geometries.add(geometry);
    const mat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.58 });
    materials.add(mat);
    const mesh = new THREE.Line(geometry, mat);
    parent.add(mesh);
    return mesh;
  }
  function plant(x: number, z: number, size = 1): void {
    cylinder(0.18 * size, 0.3 * size, x, 0.15 * size, z, palette.fabric, scene, 0.22 * size);
    const geometry = new THREE.SphereGeometry(0.2 * size, 12, 8);
    geometries.add(geometry);
    for (let i = 0; i < 5; i++) {
      const leaf = new THREE.Mesh(geometry, palette.teal);
      const a = i * Math.PI * 2 / 5;
      leaf.position.set(x + Math.cos(a) * 0.13 * size, (0.44 + i % 2 * 0.14) * size, z + Math.sin(a) * 0.13 * size);
      leaf.scale.set(0.65, 1.7, 0.7);
      leaf.rotation.z = Math.cos(a) * 0.5;
      leaf.castShadow = true;
      scene.add(leaf);
    }
  }

  const ground = box(180, 0.05, 180, 6, -0.33, 3.75, material('#e9ede9'));
  ground.castShadow = false;
  box(13, 0.15, 9.75, 6, -0.2, 3.75, material('#c7c5b9'), scene, 0.04);
  box(13, 0.07, 9.75, 6, -0.09, 3.75, material('#f7f4ec'), scene, 0.025);
  box(12.2, 0.06, 7.7, 6, -0.025, 3.75, palette.wall);

  const fieldView = createPlanFieldView(scene);
  fieldView.setMotionEnabled(!reducedMotion);
  function onMotionPreferenceChange(): void {
    reducedMotion = motionPreference.matches;
    controls.enableDamping = !reducedMotion;
    fieldView.setMotionEnabled(!reducedMotion);
  }
  motionPreference.addEventListener('change', onMotionPreferenceChange);
  const overlays = new Map<string, THREE.Mesh>();
  const selectionLines = new Map<string, THREE.Line>();
  for (const room of model.rooms) {
    const w = room.max[0] - room.min[0];
    const d = room.max[2] - room.min[2];
    const x = (room.min[0] + room.max[0]) / 2;
    const z = (room.min[2] + room.max[2]) / 2;
    const isBedroom = room.name.includes('bedroom');
    const isWet = /bath|kitchen|yard/.test(room.name);
    const floor = box(w, 0.035, d, x, 0.012, z, isBedroom ? palette.woodLight : isWet ? palette.tile : palette.floor);
    floor.userData.room = room.name;

    const grid = new THREE.Group();
    const spacing = isBedroom ? 0.24 : 0.65;
    for (let zz = room.min[2] + spacing; zz < room.max[2]; zz += spacing) {
      line([new THREE.Vector3(room.min[0] + 0.04, 0.031, zz), new THREE.Vector3(room.max[0] - 0.04, 0.031, zz)], isBedroom ? '#bca989' : '#bfc4b9', grid);
    }
    if (!isBedroom) {
      for (let xx = room.min[0] + spacing; xx < room.max[0]; xx += spacing) {
        line([new THREE.Vector3(xx, 0.031, room.min[2] + 0.04), new THREE.Vector3(xx, 0.031, room.max[2] - 0.04)], '#bfc4b9', grid);
      }
    }
    scene.add(grid);
    const overlayMat = new THREE.MeshBasicMaterial({ color: '#b2d2c3', transparent: true, opacity: 0, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1 });
    materials.add(overlayMat);
    const overlay = box(w - 0.07, 0.004, d - 0.07, x, 0.038, z, overlayMat);
    overlay.castShadow = false;
    overlay.receiveShadow = false;
    overlays.set(room.name, overlay);
    const border = line([
      new THREE.Vector3(room.min[0] + 0.08, 0.048, room.min[2] + 0.08), new THREE.Vector3(room.max[0] - 0.08, 0.048, room.min[2] + 0.08),
      new THREE.Vector3(room.max[0] - 0.08, 0.048, room.max[2] - 0.08), new THREE.Vector3(room.min[0] + 0.08, 0.048, room.max[2] - 0.08),
      new THREE.Vector3(room.min[0] + 0.08, 0.048, room.min[2] + 0.08),
    ], '#23745d');
    border.visible = false;
    selectionLines.set(room.name, border);
  }

  const walls: { source: ModelBox; mesh: THREE.Mesh; cap: THREE.Mesh }[] = [];
  for (const source of model.boxes.filter(b => b.type === 'wall')) {
    const [x, y, z] = source.min.map((v, i) => (v + source.max[i]) / 2);
    const [w, h, d] = source.max.map((v, i) => v - source.min[i]);
    const mesh = box(w, h, d, x, y, z, palette.wall);
    const cap = box(w + 0.005, 0.016, d + 0.005, x, source.max[1], z, palette.wallTop);
    walls.push({ source, mesh, cap });
    if (source.min[1] === 0) {
      box(w + 0.012, 0.07, d + 0.012, x, 0.065, z, palette.white);
    }
  }

  const openings: { source: ModelBox; group: THREE.Group; baseRotation: number; targetRotation: number; slider?: THREE.Group; travel: number; targetSlide: number }[] = [];
  for (const source of model.boxes.filter(b => b.type === 'door' || b.type === 'window')) {
    const alongX = source.wall_axis === 'x';
    const width = source.max[alongX ? 0 : 2] - source.min[alongX ? 0 : 2];
    const height = source.max[1] - source.min[1];
    const hinge = source.hinge_point!;
    const hingeAtMax = hinge[alongX ? 0 : 2] > source.min[alongX ? 0 : 2] + width / 2;
    const group = new THREE.Group();
    group.position.fromArray(hinge);
    const baseRotation = alongX ? (hingeAtMax ? Math.PI : 0) : (hingeAtMax ? Math.PI / 2 : -Math.PI / 2);
    group.rotation.y = baseRotation;
    scene.add(group);
    const window = source.type === 'window';
    let slider: THREE.Group | undefined;
    if (window) {
      box(width, 0.045, 0.08, width / 2, 0.025, 0, palette.slate, group);
      box(width, 0.045, 0.08, width / 2, height - 0.025, 0, palette.slate, group);
      for (const xx of [0.022, width - 0.022]) box(0.04, height, 0.08, xx, height / 2, 0, palette.slate, group);
      for (let pane = 0; pane < 2; pane++) {
        const sash = new THREE.Group();
        sash.position.set(pane * width / 2, 0, pane * 0.035);
        const half = width / 2;
        box(half - 0.045, height - 0.075, 0.018, half / 2, height / 2, 0, palette.glass, sash);
        for (const xx of [0.025, half - 0.025]) box(0.03, height - 0.055, 0.035, xx, height / 2, 0, palette.slate, sash);
        box(0.025, 0.14, 0.04, pane === 0 ? half - 0.08 : 0.08, height * 0.43, 0.035, palette.metal, sash);
        group.add(sash);
        if (pane === 0) slider = sash;
      }
    } else {
      box(width - 0.035, height - 0.035, 0.045, width / 2, height / 2, 0, source.name === 'main_door' ? palette.wood : palette.woodLight, group);
      box(width - 0.16, height - 0.23, 0.008, width / 2, height / 2, 0.027, palette.fabric, group);
      box(0.11, 0.025, 0.055, width - 0.13, 1, 0.055, palette.brass, group);
      box(0.11, 0.025, 0.055, width - 0.13, 1, -0.055, palette.brass, group);
    }
    openings.push({ source, group, baseRotation, targetRotation: baseRotation, slider, travel: width / 2 - 0.04, targetSlide: 0 });
  }

  const furnitureGroup = new THREE.Group();
  scene.add(furnitureGroup);
  function legs(x: number, z: number, w: number, d: number, h: number, parent = furnitureGroup): void {
    for (const xx of [-1, 1]) for (const zz of [-1, 1]) box(0.055, h, 0.055, x + xx * (w / 2 - 0.09), h / 2, z + zz * (d / 2 - 0.09), palette.wood, parent);
  }
  for (const source of model.boxes.filter(b => b.type === 'furniture')) {
    const { min, max } = furnishingBounds(source);
    const [w, h, d] = max.map((v, i) => v - min[i]);
    const [x, y, z] = min.map((v, i) => (v + max[i]) / 2);
    const name = source.name;
    if (name.startsWith('bed_')) {
      box(w, 0.24, d, x, 0.18, z, palette.wood, furnitureGroup, 0.035);
      box(w + 0.02, 0.78, 0.075, x, 0.42, min[2] + 0.04, palette.fabric, furnitureGroup, 0.025);
      box(w - 0.04, 0.2, d - 0.07, x, 0.4, z, palette.bedding, furnitureGroup, 0.065);
      box(w - 0.02, 0.045, d * 0.55, x, 0.515, max[2] - d * 0.3, name.includes('master') ? palette.teal : palette.fabric, furnitureGroup, 0.018);
      const count = name.includes('master') ? 2 : 1;
      for (let i = 0; i < count; i++) box(w / count - 0.16, 0.11, 0.38, min[0] + (i + 0.5) * w / count, 0.56, min[2] + 0.35, palette.bedding, furnitureGroup, 0.05);
      if (name.includes('master')) {
        box(0.4, 0.42, 0.4, 0.8, 0.21, 0.62, palette.woodLight, furnitureGroup, 0.02);
        cylinder(0.1, 0.19, 0.8, 0.53, 0.62, palette.fabric, furnitureGroup, 0.065);
      }
    } else if (name === 'sofa') {
      box(w, 0.22, d, x, 0.22, z, palette.fabric, furnitureGroup, 0.06);
      box(w, 0.61, 0.18, x, 0.55, min[2] + 0.1, palette.fabric, furnitureGroup, 0.065);
      for (const xx of [min[0] + 0.09, max[0] - 0.09]) box(0.18, 0.45, d, xx, 0.46, z, palette.fabric, furnitureGroup, 0.05);
      for (let i = 0; i < 3; i++) {
        box((w - 0.4) / 3 - 0.025, 0.17, d - 0.24, min[0] + 0.2 + (i + 0.5) * (w - 0.4) / 3, 0.4, z + 0.08, palette.bedding, furnitureGroup, 0.05);
      }
      box(0.35, 0.29, 0.16, min[0] + 0.4, 0.63, min[2] + 0.28, palette.teal, furnitureGroup, 0.05).rotation.z = 0.15;
      box(0.33, 0.28, 0.16, max[0] - 0.4, 0.63, min[2] + 0.28, palette.woodLight, furnitureGroup, 0.05).rotation.z = -0.15;
      box(3.05, 0.012, 2.2, x, 0.045, 5.95, material('#cecbbc'), furnitureGroup, 0.1);
    } else if (name === 'coffee_table' || name === 'dining_table' || name.startsWith('study_desk')) {
      box(w, 0.07, d, x, h - 0.035, z, palette.woodLight, furnitureGroup, 0.025);
      legs(x, z, w, d, h - 0.07);
      if (name === 'coffee_table') {
        box(0.25, 0.04, 0.18, x - 0.18, h + 0.02, z, palette.teal, furnitureGroup);
        cylinder(0.09, 0.07, x + 0.22, h + 0.035, z, palette.white, furnitureGroup);
      } else if (name === 'dining_table') {
        cylinder(0.11, 0.13, x, h + 0.065, z, palette.white, furnitureGroup, 0.085);
        for (const xx of [-0.38, 0.38]) for (const zz of [-0.19, 0.19]) cylinder(0.115, 0.015, x + xx, h + 0.012, z + zz, palette.bedding, furnitureGroup);
      } else {
        box(0.38, 0.025, 0.25, x, h + 0.02, z, palette.slate, furnitureGroup);
        box(0.38, 0.26, 0.025, x, h + 0.14, z + 0.12, palette.dark, furnitureGroup);
        cylinder(0.18, 0.08, x, 0.46, z - 0.48, palette.teal, furnitureGroup);
        cylinder(0.035, 0.42, x, 0.22, z - 0.48, palette.metal, furnitureGroup);
      }
    } else if (name.startsWith('dining_chair')) {
      const front = Number(name.at(-1)) <= 2;
      box(w, 0.09, d, x, 0.46, z, palette.teal, furnitureGroup, 0.035);
      box(w, 0.4, 0.055, x, 0.71, z + (front ? -1 : 1) * (d / 2 - 0.04), palette.teal, furnitureGroup, 0.025);
      legs(x, z, w, d, 0.42);
    } else if (name.startsWith('wardrobe')) {
      box(w, h, d, x, y, z, palette.woodLight, furnitureGroup, 0.015);
      for (let i = 1; i < Math.round(w / 0.6); i++) box(0.012, h - 0.08, 0.012, min[0] + i * w / Math.round(w / 0.6), y, max[2] + 0.005, palette.wood, furnitureGroup);
      for (let i = 0; i < Math.round(w / 0.6); i++) box(0.02, 0.18, 0.025, min[0] + (i + 0.8) * w / Math.round(w / 0.6), 1.05, max[2] + 0.018, palette.metal, furnitureGroup);
    } else if (name.startsWith('kitchen_counter')) {
      box(w, h - 0.08, d, x, (h - 0.08) / 2, z, palette.teal, furnitureGroup);
      box(w + 0.025, 0.065, d + 0.025, x, h - 0.025, z, palette.white, furnitureGroup);
      if (name.endsWith('1')) {
        box(0.38, 0.012, 0.55, x, h + 0.012, 4.45, palette.metal, furnitureGroup, 0.06);
        box(0.29, 0.014, 0.43, x, h + 0.021, 4.45, palette.slate, furnitureGroup, 0.04);
        cylinder(0.025, 0.21, x - 0.2, h + 0.11, 4.45, palette.metal, furnitureGroup);
        box(0.12, 0.025, 0.025, x - 0.15, h + 0.22, 4.45, palette.metal, furnitureGroup);
      } else {
        box(0.48, 0.025, 0.42, x, h + 0.01, z, palette.dark, furnitureGroup, 0.02);
        for (const xx of [-0.12, 0.12]) for (const zz of [-0.11, 0.11]) cylinder(0.065, 0.012, x + xx, h + 0.03, z + zz, palette.metal, furnitureGroup);
      }
    } else if (name === 'washing_machine') {
      box(w, h, d, x, y, z, palette.white, furnitureGroup, 0.035);
      const drum = cylinder(0.21, 0.035, x, 0.4, min[2] - 0.012, palette.slate, furnitureGroup);
      drum.rotation.x = Math.PI / 2;
      const inset = cylinder(0.16, 0.04, x, 0.4, min[2] - 0.035, palette.glass, furnitureGroup);
      inset.rotation.x = Math.PI / 2;
      box(w - 0.08, 0.085, 0.025, x, h - 0.1, min[2] - 0.015, palette.fabric, furnitureGroup);
    } else if (name === 'fridge') {
      box(w, h, d, x, y, z, palette.white, furnitureGroup, 0.035);
      box(w - 0.07, 0.015, 0.015, x, h * 0.68, min[2] - 0.01, palette.metal, furnitureGroup);
      box(0.025, 0.28, 0.04, min[0] + 0.1, 1.05, min[2] - 0.035, palette.metal, furnitureGroup);
    } else if (name === 'tv_console') {
      box(w, h, d, x, y, z, palette.woodLight, furnitureGroup, 0.02);
      box(1.35, 0.78, 0.045, x, 1.03, z, palette.dark, furnitureGroup, 0.015);
      box(0.5, 0.035, 0.2, x, h + 0.02, z, palette.dark, furnitureGroup);
      box(0.06, 0.18, 0.05, x, h + 0.1, z, palette.dark, furnitureGroup);
    } else box(w, h, d, x, y, z, palette.woodLight, furnitureGroup);
  }
  plant(11.45, 4.85, 1.25);
  plant(7.65, 6.95, 0.8);
  // Bathrooms remain accessible around the inward door swings.
  for (const [x, z] of [[5.12, 0.6], [5.12, 2.48]]) {
    cylinder(0.22, 0.34, x, 0.21, z, palette.white);
    box(0.45, 0.42, 0.17, x, 0.4, z - 0.25, palette.white, scene, 0.04);
    cylinder(0.23, 0.04, x, 0.4, z + 0.02, palette.bedding, scene, 0.2);
  }
  box(0.42, 0.8, 0.45, 4.12, 0.4, 2.34, palette.woodLight);
  box(0.45, 0.1, 0.48, 4.12, 0.84, 2.34, palette.white, scene, 0.03);
  box(0.68, 0.04, 0.68, 4.3, 0.055, 0.45, palette.bedding);
  box(0.015, 1.7, 0.68, 4.64, 0.9, 0.45, palette.glass);
  box(0.8, 1.5, 0.3, 3.6, 0.75, 7.18, palette.woodLight);
  for (const yy of [0.5, 1, 1.4]) box(0.83, 0.035, 0.32, 3.6, yy, 7.18, palette.fabric);

  const fans = new Map<string, THREE.Group>();
  const indicators = new Map<string, THREE.MeshStandardMaterial>();
  for (const source of model.boxes.filter(b => b.type === 'device')) {
    const [w, h, d] = source.max.map((v, i) => v - source.min[i]);
    const [x, y, z] = source.min.map((v, i) => (v + source.max[i]) / 2);
    if (source.name.startsWith('fan_')) {
      cylinder(0.08, 0.22, x, 2.46, z, palette.white);
      const rotor = new THREE.Group();
      rotor.position.set(x, 2.29, z);
      for (let i = 0; i < 3; i++) {
        const blade = new THREE.Group();
        blade.rotation.y = i * Math.PI * 2 / 3;
        box(0.5, 0.035, 0.14, 0.29, 0, 0.02, palette.wood, blade, 0.02);
        rotor.add(blade);
      }
      cylinder(0.13, 0.08, 0, 0, 0, palette.white, rotor);
      scene.add(rotor);
      rotor.traverse(child => { if (child instanceof THREE.Mesh) child.castShadow = false; });
      fans.set(source.name, rotor);
    } else if (source.name.startsWith('ac_') && source.name !== 'ac_condenser_yard') {
      box(w, h, d, x, y, z, palette.white, scene, 0.045);
      if (w > d) {
        for (let i = 0; i < 3; i++) box(w - 0.12, 0.016, 0.02, x, source.min[1] + 0.035 + i * 0.025, source.min[2] - 0.008, palette.metal);
      } else {
        for (let i = 0; i < 3; i++) box(0.02, 0.016, d - 0.12, x < 6 ? source.max[0] + 0.008 : source.min[0] - 0.008, source.min[1] + 0.035 + i * 0.025, z, palette.metal);
      }
      const led = material('#acb6a8');
      indicators.set(source.name, led);
      box(0.055, 0.02, 0.055, x, source.max[1] + 0.008, z, led);
    } else if (source.name.startsWith('purifier_')) {
      continue;
    } else {
      box(w, h, d, x, y, z, palette.white, scene, 0.025);
      const vent = cylinder(0.23, 0.02, x, y, source.min[2] - 0.02, palette.metal);
      vent.rotation.x = Math.PI / 2;
    }
  }

  const portableFan = new THREE.Group();
  cylinder(0.2, 0.045, 0, 0.05, 0, palette.slate, portableFan);
  cylinder(0.025, 0.9, 0, 0.5, 0, palette.metal, portableFan);
  const fanRotor = new THREE.Group();
  fanRotor.name = 'standing-fan-rotor';
  fanRotor.position.y = 1.06;
  portableFan.add(fanRotor);
  const guardGeometry = new THREE.TorusGeometry(0.25, 0.014, 6, 28);
  geometries.add(guardGeometry);
  const guard = new THREE.Mesh(guardGeometry, palette.slate);
  guard.position.y = 1.06;
  portableFan.add(guard);
  for (let i = 0; i < 3; i++) {
    const pivot = new THREE.Group();
    box(0.23, 0.075, 0.025, 0.115, 0, 0, palette.teal, pivot, 0.025);
    pivot.rotation.z = i * Math.PI * 2 / 3;
    fanRotor.add(pivot);
  }
  const fanHub = cylinder(0.045, 0.075, 0, 0, 0, palette.white, fanRotor);
  fanHub.rotation.x = Math.PI / 2;
  line([new THREE.Vector3(0, 0.07, 0.27), new THREE.Vector3(0, 0.07, 0.75)], '#429477', portableFan);
  const directionGeometry = new THREE.ConeGeometry(0.075, 0.17, 8);
  geometries.add(directionGeometry);
  const direction = new THREE.Mesh(directionGeometry, palette.teal);
  direction.name = 'standing-fan-direction';
  direction.rotation.x = Math.PI / 2;
  direction.position.set(0, 0.07, 0.78);
  portableFan.add(direction);
  fanRotor.traverse(child => { if (child instanceof THREE.Mesh) child.castShadow = false; });
  const standingFanVisuals = createStandingFanVisuals(scene, portableFan);
  const portablePurifier = new THREE.Group();
  cylinder(0.17, 0.6, 0, 0.3, 0, palette.white, portablePurifier);
  const purifierLed = material('#b3b9ae');
  const purifierFront = new THREE.Mesh(directionGeometry, palette.teal);
  purifierFront.rotation.x = Math.PI / 2;
  purifierFront.position.set(0, 0.07, 0.4);
  portablePurifier.add(purifierFront);
  cylinder(0.173, 0.02, 0, 0.55, 0, purifierLed, portablePurifier);
  cylinder(0.125, 0.02, 0, 0.605, 0, palette.slate, portablePurifier);
  scene.add(portablePurifier);
  const slotMarkers = new THREE.Group();
  slotMarkers.visible = false;
  scene.add(slotMarkers);
  const slotRingGeometry = new THREE.RingGeometry(0.27, 0.35, 32);
  geometries.add(slotRingGeometry);
  const slotIdleMaterial = new THREE.MeshBasicMaterial({ color: '#377d79', transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthTest: false, depthWrite: false });
  const slotSelectedMaterial = new THREE.MeshBasicMaterial({ color: '#83cf4e', transparent: true, opacity: 0.95, side: THREE.DoubleSide, depthTest: false, depthWrite: false });
  materials.add(slotIdleMaterial); materials.add(slotSelectedMaterial);
  const slotRings = Array.from({ length: Math.max(FAN_SLOTS.length, PURIFIER_SLOTS.length) }, () => {
    const ring = new THREE.Mesh(slotRingGeometry, slotIdleMaterial);
    ring.rotation.x = -Math.PI / 2;
    ring.renderOrder = 20;
    slotMarkers.add(ring);
    return ring;
  });
  const fanSelection = new THREE.Mesh(slotRingGeometry, slotSelectedMaterial);
  fanSelection.rotation.x = -Math.PI / 2;
  fanSelection.renderOrder = 20;
  fanSelection.visible = false;
  scene.add(fanSelection);
  const fanGhost = portableFan.clone(true);
  const ghostMaterial = new THREE.MeshBasicMaterial({ color: '#328b79', transparent: true, opacity: 0.42, depthWrite: false });
  const ghostLineMaterial = new THREE.LineBasicMaterial({ color: '#328b79', transparent: true, opacity: 0.6, depthWrite: false });
  materials.add(ghostMaterial); materials.add(ghostLineMaterial);
  fanGhost.traverse(child => {
    if (child instanceof THREE.Mesh) { child.material = ghostMaterial; child.castShadow = false; }
    if (child instanceof THREE.Line) child.material = ghostLineMaterial;
  });
  fanGhost.visible = false;
  scene.add(fanGhost);
  const dragHint = document.createElement('div');
  dragHint.style.cssText = 'position:absolute;display:none;left:50%;top:58px;transform:translateX(-50%);z-index:3000;max-width:90%;padding:8px 12px;border-radius:6px;background:#214d40;color:#fff;text-align:center;font:600 12px/1.4 system-ui,sans-serif;pointer-events:none;';
  dragHint.setAttribute('role', 'status');
  dragHint.setAttribute('aria-live', 'polite');
  labelLayer.appendChild(dragHint);

  const thermalVent = new THREE.Group();
  thermalVent.visible = false;
  for (const side of [-1, 1]) {
    box(1, 0.1, 0.12, 0, side * 0.45, 0, palette.white, thermalVent, 0.035);
    box(0.1, 0.8, 0.12, side * 0.45, 0, 0, palette.white, thermalVent, 0.035);
  }
  const ventRotor = new THREE.Group();
  for (let i = 0; i < 4; i++) {
    const pivot = new THREE.Group();
    pivot.rotation.z = i * Math.PI / 2;
    box(0.3, 0.13, 0.025, 0.19, 0, 0, palette.teal, pivot, 0.035);
    ventRotor.add(pivot);
  }
  thermalVent.add(ventRotor);
  const ventGuardGeometry = new THREE.TorusGeometry(0.4, 0.018, 6, 28);
  geometries.add(ventGuardGeometry);
  const ventGuard = new THREE.Mesh(ventGuardGeometry, palette.metal);
  ventGuard.position.z = 0.14;
  thermalVent.add(ventGuard);
  for (const x of [-0.18, 0, 0.18]) box(0.018, 0.68, 0.02, x, 0, 0.15, palette.metal, thermalVent);
  const ventArrow = new THREE.Group();
  ventArrow.position.y = -0.66;
  line([new THREE.Vector3(0, 0, -0.75), new THREE.Vector3(0, 0, 0.7)], '#315f53', ventArrow);
  const ventArrowGeometry = new THREE.ConeGeometry(0.09, 0.22, 8);
  geometries.add(ventArrowGeometry);
  const ventArrowHead = new THREE.Mesh(ventArrowGeometry, palette.teal);
  ventArrowHead.rotation.x = Math.PI / 2;
  ventArrowHead.position.z = 0.76;
  ventArrow.add(ventArrowHead);
  thermalVent.add(ventArrow);
  thermalVent.traverse(child => { if (child instanceof THREE.Mesh) child.castShadow = false; });
  scene.add(thermalVent);
  const ventLabel = document.createElement('div');
  ventLabel.style.cssText = 'position:absolute;display:none;z-index:2001;transform:translate(0,-100%);padding:5px 7px;border:1px solid #a4bbae;border-radius:5px;background:rgba(244,249,242,.96);color:#315747;text-align:center;font:500 10px/1.35 system-ui,sans-serif;white-space:pre-line;pointer-events:none;';
  labelLayer.appendChild(ventLabel);
  const ventLabelAnchor = new THREE.Vector3();
  let thermalVentConfig: ThermalVentConfig | null = null;

  const roofMat = material('#f2f3ed');
  roofMat.transparent = true;
  roofMat.opacity = 0;
  roofMat.depthWrite = false;
  const roof = box(12.2, 0.05, 7.7, 6, 2.625, 3.75, roofMat);
  roof.visible = false;
  roof.castShadow = false;

  const labels: { room: string; element: HTMLButtonElement; value: HTMLSpanElement; anchor: THREE.Vector3; flag: string; styleKey: string }[] = [];
  for (const room of model.rooms) {
    const element = document.createElement('button');
    element.type = 'button';
    element.setAttribute('aria-label', `Select ${roomLabel(room.name)}`);
    element.style.cssText = 'position:absolute;transform:translate(-50%,-50%);border:1px solid #ccd4cc;border-radius:5px;background:rgba(251,252,248,.94);color:#344940;padding:4px 7px;box-shadow:0 1px 6px rgba(29,48,36,.05);font:600 10px/1.25 inherit;white-space:nowrap;pointer-events:auto;cursor:pointer;backdrop-filter:blur(3px);';
    const name = document.createElement('span');
    name.textContent = roomLabel(room.name).replace('Household shelter', 'Shelter').replace('Entrance lobby', 'Lobby');
    name.style.cssText = 'display:block;font-size:10px;font-weight:600;letter-spacing:-.1px;';
    const value = document.createElement('span');
    value.style.cssText = 'display:none;font-size:12px;font-weight:700;margin-top:2px;font-variant-numeric:tabular-nums;';
    element.append(name, value);
    element.addEventListener('click', () => onSelectRoom(room.name));
    labelLayer.appendChild(element);
    const anchor = ROOM_ANCHORS[room.name];
    labels.push({ room: room.name, element, value, anchor: new THREE.Vector3(anchor[0], 0.4, anchor[1]), flag: '', styleKey: '' });
  }
  const dimensionGroup = new THREE.Group();
  dimensionGroup.visible = false;
  scene.add(dimensionGroup);
  const dimensions: { element: HTMLDivElement; anchor: THREE.Vector3 }[] = [];
  function dimension(start: THREE.Vector3, end: THREE.Vector3, text: string): void {
    line([start, end], '#4b675a', dimensionGroup);
    const perpendicular = new THREE.Vector3().subVectors(end, start).normalize().cross(new THREE.Vector3(0, 1, 0)).multiplyScalar(0.09);
    if (perpendicular.lengthSq() === 0) perpendicular.set(0.09, 0, 0);
    for (const point of [start, end]) line([point.clone().sub(perpendicular), point.clone().add(perpendicular)], '#4b675a', dimensionGroup);
    const element = document.createElement('div');
    element.textContent = text;
    element.style.cssText = 'position:absolute;transform:translate(-50%,-50%);padding:3px 7px;border-radius:4px;background:#eff3ed;color:#3e6553;font:600 10px/1.4 ui-monospace,monospace;white-space:nowrap;';
    labelLayer.appendChild(element);
    dimensions.push({ element, anchor: start.clone().lerp(end, 0.5) });
  }
  dimension(new THREE.Vector3(-0.1, 0, 8.23), new THREE.Vector3(12.1, 0, 8.23), `${(12.2 * 1000 / MODEL_SCALE).toFixed(1)} mm`);
  dimension(new THREE.Vector3(12.48, 0, -0.1), new THREE.Vector3(12.48, 0, 7.6), `${(7.7 * 1000 / MODEL_SCALE).toFixed(1)} mm`);
  dimension(new THREE.Vector3(-0.4, 0, -0.25), new THREE.Vector3(-0.4, 2.6, -0.25), `${(2.6 * 1000 / MODEL_SCALE).toFixed(0)} mm`);

  let currentConditions = defaultConditions();
  let standingFans = resolveStandingFans(currentConditions);
  standingFanVisuals.sync(standingFans);
  let selectedStandingFanId: string | null = null;
  let currentView = { ...defaultView };
  let lastViewSignature = '';
  let lastShadowSignature = '';
  let lastLabelUpdate = -Infinity;
  let lastLabelMode = '';
  let lastLabelElapsed = -1;
  let width = Math.max(container.clientWidth, 1);
  let height = Math.max(container.clientHeight, 1);
  let disposed = false;
  let cameraMode: 'perspective' | 'top' = 'perspective';
  const projected = new THREE.Vector3();
  const floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const worldHit = new THREE.Vector3();
  let pointerDown: { x: number; y: number } | null = null;
  let portableDraggingEnabled = Boolean(onMovePortableDevice || fanEvents);
  let drag: DeviceDrag | null = null;
  let pendingUpdate: { conditions: Conditions; result: SimulationResult; view: ViewOptions } | null = null;
  const labelObstacles = container.parentElement?.querySelectorAll<HTMLElement>('.model-legend, .view-tools, .view-disclosure');
  let labelLayoutDirty = true;
  let maxLabelY = Infinity;
  function sceneVisible(): boolean {
    return !document.hidden && container.getClientRects().length > 0 && container.clientWidth > 0 && container.clientHeight > 0;
  }
  function pointRay(event: Pick<MouseEvent, 'clientX' | 'clientY'>): boolean {
    const rect = renderer.domElement.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0 || event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) return false;
    pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    return true;
  }
  function placePurifier(slotId: number): void {
    const slot = PURIFIER_SLOTS[slotId] ?? PURIFIER_SLOTS[0];
    portablePurifier.position.set(slot.x, 0, slot.z);
    renderer.shadowMap.needsUpdate = true;
  }
  function updateFanSelection(): void {
    const visual = selectedStandingFanId ? standingFanVisuals.get(selectedStandingFanId) : undefined;
    fanSelection.visible = Boolean(portableDraggingEnabled && !thermalVentConfig && currentView.roofOpacity < 0.65 && visual?.group.visible);
    if (visual) fanSelection.position.set(visual.group.position.x, 0.075, visual.group.position.z);
  }
  function setSelectedStandingFan(id: string | null): void {
    selectedStandingFanId = id;
    updateFanSelection();
  }
  function endDrag(commit: boolean): void {
    if (!drag) return;
    const finished = drag;
    drag = null;
    pointerDown = null;
    controls.enabled = finished.controlsEnabled;
    slotMarkers.visible = false;
    fanGhost.visible = false;
    dragHint.style.display = 'none';
    renderer.domElement.style.cursor = '';
    if (renderer.domElement.hasPointerCapture(finished.pointerId)) renderer.domElement.releasePointerCapture(finished.pointerId);
    if (finished.kind === 'fan') {
      const next = finished.position;
      if (commit && finished.moved && next && Math.hypot(next.x - finished.startFan.x, next.z - finished.startFan.z) > 1e-5 && validateStandingFanPosition(next.x, next.z, currentConditions, finished.startFan.id).valid) fanEvents?.onMove(finished.startFan.id, next.x, next.z);
    } else {
      const currentSlot = currentConditions.purifier?.slot;
      placePurifier(currentSlot ?? finished.startSlot);
      if (commit && finished.moved && finished.slot !== null && finished.slot !== currentSlot) onMovePortableDevice?.('purifier', finished.slot);
    }
  }
  function onPointerDown(event: PointerEvent): void {
    if (drag) { event.stopImmediatePropagation(); return; }
    if (event.button === 2 && contextTarget(event)) { event.stopImmediatePropagation(); return; }
    pointerDown = { x: event.clientX, y: event.clientY };
    if (!portableDraggingEnabled || thermalVentConfig || !event.isPrimary || event.button !== 0 || currentView.roofOpacity >= 0.65 || !sceneVisible() || !pointRay(event)) return;
    const candidates = fanEvents ? standingFanVisuals.groups() : [];
    if (onMovePortableDevice && portablePurifier.visible) candidates.push(portablePurifier);
    const hit = raycaster.intersectObjects(candidates, true)[0];
    if (!hit) return;
    let root = hit.object;
    while (root.parent && typeof root.userData.standingFanId !== 'string' && root !== portablePurifier) root = root.parent;
    const base: DragBase = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, moved: false, controlsEnabled: controls.enabled };
    if (root !== portablePurifier) {
      const fan = standingFans.find(item => item.id === root.userData.standingFanId);
      if (!fan || !fanEvents || !raycaster.ray.intersectPlane(floorPlane, worldHit)) return;
      drag = { ...base, kind: 'fan', startFan: fan, position: null, offsetX: fan.x - worldHit.x, offsetZ: fan.z - worldHit.z };
      fanGhost.rotation.set(0, THREE.MathUtils.degToRad(180 - fan.angleDeg), 0);
      setSelectedStandingFan(fan.id);
      dragHint.textContent = 'Drag fan to clear floor · Green preview is valid · Esc to cancel';
    } else {
      const startSlot = currentConditions.purifier?.slot;
      if (startSlot === undefined) return;
      drag = { ...base, kind: 'purifier', startSlot, slot: startSlot };
      slotRings.forEach((ring, index) => {
        ring.visible = index < PURIFIER_SLOTS.length;
        if (PURIFIER_SLOTS[index]) ring.position.set(PURIFIER_SLOTS[index].x, 0.08, PURIFIER_SLOTS[index].z);
        ring.material = index === startSlot ? slotSelectedMaterial : slotIdleMaterial;
      });
      slotMarkers.visible = true;
      dragHint.textContent = 'Drag purifier to a marked position · Esc to cancel';
    }
    controls.enabled = false;
    renderer.domElement.focus({ preventScroll: true });
    renderer.domElement.setPointerCapture(event.pointerId);
    renderer.domElement.style.cursor = 'grabbing';
    dragHint.style.display = 'block';
    event.preventDefault(); event.stopImmediatePropagation();
    if (drag.kind === 'fan') fanEvents?.onSelect?.(drag.startFan.id);
  }
  function onPointerMove(event: PointerEvent): void {
    if (!drag || event.pointerId !== drag.pointerId) return;
    event.preventDefault(); event.stopImmediatePropagation();
    if (!drag.moved && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 6) return;
    drag.moved = true;
    const onFloor = pointRay(event) && Boolean(raycaster.ray.intersectPlane(floorPlane, worldHit));
    if (drag.kind === 'fan') {
      fanGhost.visible = onFloor;
      if (!onFloor) { drag.position = null; dragHint.textContent = 'Keep the fan over a clear room floor · Esc to cancel'; return; }
      const x = worldHit.x + drag.offsetX;
      const z = worldHit.z + drag.offsetZ;
      const placement = validateStandingFanPosition(x, z, currentConditions, drag.startFan.id);
      drag.position = placement.valid ? { x, z } : null;
      fanGhost.position.set(x, 0, z);
      ghostMaterial.color.set(placement.valid ? '#328b79' : '#c4503d');
      ghostLineMaterial.color.copy(ghostMaterial.color);
      dragHint.textContent = placement.valid ? `${roomLabel(placement.room!)} · ${x.toFixed(2)}, ${z.toFixed(2)} m · Release to place` : `${placement.reason} · Release to cancel`;
      return;
    }
    const next = onFloor ? nearestPortableSlot('purifier', worldHit.x, worldHit.z) : null;
    if (next === drag.slot) return;
    drag.slot = next;
    slotRings.forEach((ring, index) => { ring.material = index === next ? slotSelectedMaterial : slotIdleMaterial; });
    if (next === null) {
      dragHint.textContent = 'Drop on a room floor to choose a marked position · Esc to cancel';
      return;
    }
    placePurifier(next);
    const slot = PURIFIER_SLOTS[next];
    dragHint.textContent = `Purifier → ${next + 1}. ${roomLabel(slot.room)} · Release to place`;
  }
  function onPointerUp(event: PointerEvent): void {
    if (event.button !== 0) { pointerDown = null; return; }
    if (drag) {
      if (event.pointerId !== drag.pointerId) return;
      event.preventDefault(); event.stopImmediatePropagation();
      const room = drag.kind === 'fan' ? drag.startFan.room : PURIFIER_SLOTS[drag.startSlot].room;
      const moved = drag.moved;
      if (moved) onPointerMove(event);
      endDrag(true);
      if (!moved) onSelectRoom(room);
      return;
    }
    if (!pointerDown || Math.hypot(pointerDown.x - event.clientX, pointerDown.y - event.clientY) > 6) { pointerDown = null; return; }
    pointerDown = null;
    if (!pointRay(event)) return;
    if (!raycaster.ray.intersectPlane(floorPlane, worldHit)) return;
    const room = model.rooms.find(r => worldHit.x >= r.min[0] && worldHit.x <= r.max[0] && worldHit.z >= r.min[2] && worldHit.z <= r.max[2]);
    onSelectRoom(room?.name ?? null);
  }
  function cancelDrag(): void { endDrag(false); }
  function contextTarget(event: MouseEvent): DeviceTarget | null {
    if (!portableDraggingEnabled || thermalVentConfig || currentView.roofOpacity >= 0.65 || !pointRay(event)) return null;
    const candidates = standingFanVisuals.groups();
    if (portablePurifier.visible) candidates.push(portablePurifier);
    let hit: THREE.Object3D | undefined = raycaster.intersectObjects(candidates, true)[0]?.object;
    while (hit && hit !== portablePurifier && typeof hit.userData.standingFanId !== 'string') hit = hit.parent ?? undefined;
    return hit === portablePurifier ? { kind: 'purifier' } : hit ? { kind: 'fan', id: hit.userData.standingFanId as string } : null;
  }
  function onContextMenu(event: MouseEvent): void {
    const target = contextTarget(event);
    if (!target) return;
    event.preventDefault(); event.stopImmediatePropagation(); endDrag(false);
    renderer.domElement.focus({ preventScroll: true });
    fanEvents?.onContext?.(target, event.clientX, event.clientY);
  }
  function onDragKey(event: KeyboardEvent): void { if (drag && event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); endDrag(false); } }
  function onVisibilityChange(): void {
    if (document.hidden) cancelDrag();
    else resize();
  }
  renderer.domElement.addEventListener('pointerdown', onPointerDown, true);
  renderer.domElement.addEventListener('contextmenu', onContextMenu, true);
  renderer.domElement.addEventListener('pointermove', onPointerMove, true);
  renderer.domElement.addEventListener('pointerup', onPointerUp, true);
  renderer.domElement.addEventListener('pointercancel', cancelDrag);
  renderer.domElement.addEventListener('lostpointercapture', cancelDrag);
  renderer.domElement.addEventListener('keydown', onDragKey);
  window.addEventListener('blur', cancelDrag);
  document.addEventListener('visibilitychange', onVisibilityChange);
  function cameraPosition(mode: 'perspective' | 'top'): void {
    cameraMode = mode;
    const aspect = width / height;
    const distance = mode === 'top' ? Math.max(19.5, 25 / Math.max(aspect, 0.6)) : Math.max(22.8, 25 / Math.max(aspect, 0.6));
    controls.target.set(6, mode === 'top' ? 0 : 0.5, 3.75);
    if (mode === 'top') camera.position.set(6, distance, 3.751);
    else camera.position.copy(controls.target).add(new THREE.Vector3(0.51, 0.79, 0.67).normalize().multiplyScalar(distance));
    camera.lookAt(controls.target);
    controls.update();
  }
  function resize(): void {
    if (!sceneVisible()) return;
    const newWidth = Math.max(container.clientWidth, 1);
    const newHeight = Math.max(container.clientHeight, 1);
    const aspectChanged = Math.abs(newWidth / newHeight - width / height) > 0.4;
    width = newWidth;
    height = newHeight;
    labelLayoutDirty = true;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    if (aspectChanged) cameraPosition(cameraMode);
  }
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(container);
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  cameraPosition('perspective');

  function setThermalVent(config: ThermalVentConfig | null): void {
    if (disposed) return;
    const placement = config && typeof config.on === 'boolean' && (config.mode === 'exhaust' || config.mode === 'supply') && Number.isFinite(config.ratedM3h) && config.ratedM3h >= 0 ? thermalVentPlacement(config.opening) : null;
    thermalVentConfig = placement && config ? { ...config } : null;
    thermalVent.visible = Boolean(thermalVentConfig);
    updateFanSelection();
    ventLabel.style.display = 'none';
    if (!placement || !thermalVentConfig) return;
    thermalVent.position.copy(placement.position);
    thermalVent.rotation.y = placement.yaw;
    thermalVent.scale.setScalar(placement.size);
    ventArrow.rotation.y = thermalVentConfig.mode === 'exhaust' ? 0 : Math.PI;
    ventLabelAnchor.copy(placement.position).add(new THREE.Vector3(0, placement.size * 0.7, 0));
    ventLabel.textContent = `Cooling Lab · concept\n${thermalVentConfig.mode === 'exhaust' ? 'Exhaust → outside' : 'Supply → inside'} · ${thermalVentConfig.on ? 'ON' : 'OFF'}\n${Math.round(thermalVentConfig.ratedM3h)} m³/h rated`;
  }
  function wallHeight(source: ModelBox): number {
    if (!currentView.cutaway) return 2.6;
    return source.name.startsWith('wall_ext_north') || source.name.startsWith('wall_ext_west') ? 2.6 : 0.92;
  }
  function updateView(): void {
    for (const { source, mesh, cap } of walls) {
      const top = Math.min(source.max[1], wallHeight(source));
      const h = top - source.min[1];
      mesh.visible = cap.visible = h > 0;
      if (h <= 0) continue;
      mesh.scale.y = h;
      mesh.position.y = source.min[1] + h / 2;
      cap.position.y = top + 0.008;
    }
    for (const { source, group } of openings) {
      const cap = !currentView.cutaway || source.wall?.startsWith('wall_ext_north') || source.wall?.startsWith('wall_ext_west') ? 2.6 : 0.92;
      group.visible = source.min[1] < cap;
      group.scale.y = Math.max(0.001, Math.min(source.max[1], cap) - source.min[1]) / (source.max[1] - source.min[1]);
    }
    roof.visible = currentView.roofOpacity > 0;
    roofMat.opacity = Math.max(0, Math.min(1, currentView.roofOpacity));
    dimensionGroup.visible = currentView.dimensions;
    for (const [name, border] of selectionLines) border.visible = currentView.selectedRoom === name;
  }
  function update(conditions: Conditions, result: SimulationResult, view: ViewOptions): void {
    if (disposed) return;
    currentConditions = conditions;
    currentView = view;
    if (!sceneVisible()) { pendingUpdate = { conditions, result, view }; return; }
    pendingUpdate = null;
    labelLayoutDirty = true;
    standingFans = resolveStandingFans(conditions);
    if (drag?.kind === 'fan') {
      const start = drag.startFan;
      const current = standingFans.find(fan => fan.id === start.id);
      if (!current || current.x !== start.x || current.z !== start.z || current.angleDeg !== start.angleDeg) endDrag(false);
    } else if (drag && conditions.purifier?.slot !== drag.startSlot) endDrag(false);
    fieldView.update(thermalVentConfig ? undefined : result.field, view.mode);
    const shadowSignature = JSON.stringify([conditions.doors, conditions.windows, standingFans.map(fan => [fan.id, fan.x, fan.z, fan.angleDeg]), conditions.purifier?.slot, view.cutaway]);
    if (shadowSignature !== lastShadowSignature) { renderer.shadowMap.needsUpdate = true; lastShadowSignature = shadowSignature; }
    const signature = JSON.stringify([view.cutaway, view.roofOpacity, view.dimensions, view.selectedRoom]);
    if (signature !== lastViewSignature) { updateView(); lastViewSignature = signature; }
    for (const opening of openings) {
      const { source } = opening;
      const open = source.type === 'door' ? conditions.doors[source.name] : conditions.windows[source.name];
      opening.targetRotation = opening.baseRotation + (source.type === 'door' && open ? DOOR_SWING[source.name] * Math.PI / 2 : 0);
      opening.targetSlide = source.type === 'window' && open ? opening.travel : 0;
    }
    standingFanVisuals.sync(standingFans);
    updateFanSelection();
    const purifierState = conditions.purifier;
    portablePurifier.visible = Boolean(purifierState);
    if (purifierState) {
      const slot = PURIFIER_SLOTS[purifierState.slot] ?? PURIFIER_SLOTS[0];
      if (drag?.kind !== 'purifier') portablePurifier.position.set(slot.x, 0, slot.z);
      portablePurifier.rotation.y = THREE.MathUtils.degToRad(180 - (Number.isFinite(purifierState.headingDeg) ? purifierState.headingDeg! : 0));
      purifierLed.color.set(purifierState.on ? '#45ae80' : '#b3b9ae');
      purifierLed.emissive.set(purifierState.on ? '#24754c' : '#000000');
      purifierLed.emissiveIntensity = 0.2;
    }
    for (const [name, led] of indicators) {
      led.color.set(conditions.devices[name] ? '#45ae80' : '#b3b9ae');
      led.emissive.set(conditions.devices[name] ? '#24754c' : '#000000');
      led.emissiveIntensity = 0.2;
    }
    for (const [name, mesh] of overlays) {
      const reading = result.rooms.find(r => r.room === name);
      const mat = mesh.material as THREE.MeshBasicMaterial;
      if (result.field || !reading || view.mode === 'model') {
        mat.color.set('#68b39d');
        mat.opacity = view.selectedRoom === name ? 0.2 : 0;
      } else {
        fieldColor(view.mode, view.mode === 'temperature' ? reading.temperature : view.mode === 'pm25' ? reading.pm25 : view.mode === 'pressure' ? 0 : reading.airflow, mat.color);
        mat.opacity = view.selectedRoom === name ? 0.6 : 0.42;
      }
    }
    const now = performance.now();
    const labelMode = `${view.mode}:${Boolean(thermalVentConfig)}`;
    const sampleLabels = now - lastLabelUpdate >= 500 || labelMode !== lastLabelMode || result.elapsedSeconds < lastLabelElapsed;
    const temperatures = sampleLabels ? result.rooms.map(reading => reading.temperature).filter(Number.isFinite) : [];
    const warmest = Math.max(...temperatures);
    const differentTemperatures = warmest - Math.min(...temperatures) > 0.1;
    for (const label of labels) {
      if (sampleLabels) {
        const reading = result.rooms.find(r => r.room === label.room);
        const metric = view.mode === 'pm25' ? reading?.pm25 : view.mode === 'airflow' ? reading?.airflow : view.mode === 'pressure' ? result.field?.pressure ? roomPressure(result.field, model.rooms.find(room => room.name === label.room)!) : undefined : reading?.temperature;
        let value = '';
        label.flag = '';
        if (!thermalVentConfig && metric !== undefined && Number.isFinite(metric)) {
          value = view.mode === 'pm25' ? `${Math.round(metric)} µg/m³` : view.mode === 'airflow' ? `${metric.toFixed(2)} m/s` : view.mode === 'pressure' ? `${Math.abs(metric) < 0.005 ? '0.00' : `${metric > 0 ? '+' : ''}${metric.toFixed(2)}`} rel.` : `${metric.toFixed(1)}°C`;
          if ((view.mode === 'model' || view.mode === 'temperature') && differentTemperatures && metric >= warmest - 0.05) label.flag = 'Warmest room in this flat';
          if (view.mode === 'pm25' && Number.isFinite(result.averagePm25) && result.averagePm25 > 0 && metric > result.averagePm25 * 1.2) label.flag = 'Hazier than the flat average';
        }
        if (label.value.textContent !== value) {
          label.value.textContent = value;
          label.value.style.display = value ? 'block' : 'none';
        }
        const metricName = view.mode === 'pm25' ? 'PM2.5' : view.mode === 'airflow' ? 'air speed' : view.mode === 'pressure' ? 'relative pressure potential' : 'temperature';
        const description = `Select ${roomLabel(label.room)}${value ? `. Simulated ${metricName}: ${value}` : ''}${label.flag ? `. ${label.flag}` : ''}`;
        if (label.element.getAttribute('aria-label') !== description) {
          label.element.setAttribute('aria-label', description);
          label.element.title = description;
        }
      }
      const selected = view.selectedRoom === label.room;
      const styleKey = `${selected}:${label.flag}`;
      if (styleKey !== label.styleKey) {
        label.styleKey = styleKey;
        label.element.style.background = selected ? '#245b47' : 'rgba(251,252,248,.94)';
        label.element.style.color = selected ? '#fff' : '#344940';
        label.element.style.borderColor = selected ? '#245b47' : label.flag.startsWith('Warmest') ? '#bd854d' : label.flag ? '#648b9d' : '#ccd4cc';
        label.element.setAttribute('aria-pressed', String(selected));
      }
    }
    if (sampleLabels) { lastLabelUpdate = now; lastLabelMode = labelMode; lastLabelElapsed = result.elapsedSeconds; }
  }
  updateView();
  let frame = 0;
  let lastTime = performance.now();
  function render(now: number): void {
    if (disposed) return;
    frame = requestAnimationFrame(render);
    if (!sceneVisible()) { lastTime = now; if (drag) endDrag(false); return; }
    if (pendingUpdate) update(pendingUpdate.conditions, pendingUpdate.result, pendingUpdate.view);
    const dt = Math.min((now - lastTime) / 1000, 0.05);
    lastTime = now;
    if (!reducedMotion) {
      if (thermalVentConfig?.on) ventRotor.rotation.z += dt * 10;
      standingFanVisuals.animate(dt);
      for (const [name, rotor] of fans) if (currentConditions.devices[name]) rotor.rotation.y += dt * 12;
    }
    for (const opening of openings) {
      if (Math.abs(opening.group.rotation.y - opening.targetRotation) > 0.005 || opening.slider && Math.abs(opening.slider.position.x - opening.targetSlide) > 0.005) renderer.shadowMap.needsUpdate = true;
      opening.group.rotation.y = reducedMotion ? opening.targetRotation : THREE.MathUtils.damp(opening.group.rotation.y, opening.targetRotation, 9, dt);
      if (opening.slider) opening.slider.position.x = reducedMotion ? opening.targetSlide : THREE.MathUtils.damp(opening.slider.position.x, opening.targetSlide, 9, dt);
    }
    fieldView.animate(dt);
    if (!drag) controls.update();
    camera.updateMatrixWorld();
    if (labelLayoutDirty) {
      labelLayoutDirty = false;
      maxLabelY = Infinity;
      const selected = width < 520 && currentView.labels ? labels.find(label => label.room === currentView.selectedRoom) : undefined;
      if (selected) {
        selected.element.style.display = 'block';
        const sceneTop = container.getBoundingClientRect().top;
        const halfLabelHeight = selected.element.offsetHeight / 2;
        for (const obstacle of labelObstacles ?? []) {
          const rect = obstacle.getBoundingClientRect();
          if (rect.height > 0) maxLabelY = Math.min(maxLabelY, rect.top - sceneTop - halfLabelHeight - 8);
        }
      }
    }
    for (const label of labels) {
      projected.copy(label.anchor).project(camera);
      const show = currentView.labels && (width >= 520 || label.room === currentView.selectedRoom) && currentView.roofOpacity < 0.65 && projected.z < 1 && projected.z > -1 && Math.abs(projected.x) < 1 && Math.abs(projected.y) < 1;
      label.element.style.display = show ? 'block' : 'none';
      label.element.style.left = `${(projected.x + 1) / 2 * width}px`;
      label.element.style.top = `${Math.min((1 - projected.y) / 2 * height, maxLabelY)}px`;
      label.element.style.zIndex = String(Math.round((1 - projected.z) * 1000));
    }
    projected.copy(ventLabelAnchor).project(camera);
    const showVentLabel = thermalVentConfig && currentView.roofOpacity < 0.65 && projected.z > -1 && projected.z < 1 && Math.abs(projected.x) < 1 && Math.abs(projected.y) < 1;
    ventLabel.style.display = showVentLabel ? 'block' : 'none';
    ventLabel.style.left = `${Math.max(8, Math.min(width - ventLabel.offsetWidth - 8, (projected.x + 1) / 2 * width + 16))}px`;
    ventLabel.style.top = `${(1 - projected.y) / 2 * height}px`;
    for (const dimension of dimensions) {
      projected.copy(dimension.anchor).project(camera);
      dimension.element.style.display = currentView.dimensions && projected.z < 1 ? 'block' : 'none';
      dimension.element.style.left = `${(projected.x + 1) / 2 * width}px`;
      dimension.element.style.top = `${(1 - projected.y) / 2 * height}px`;
    }
    renderer.render(scene, camera);
  }
  frame = requestAnimationFrame(render);
  function screenshot(): string {
    renderer.render(scene, camera);
    const canvas = document.createElement('canvas');
    const pixelRatio = renderer.domElement.width / width;
    const footerHeight = currentView.mode === 'model' ? 68 : 120;
    canvas.width = renderer.domElement.width;
    canvas.height = renderer.domElement.height + Math.ceil(footerHeight * pixelRatio);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Image export is unavailable in this browser.');
    context.drawImage(renderer.domElement, 0, 0);
    context.scale(pixelRatio, pixelRatio);
    function badge(anchor: THREE.Vector3, lines: string[], selected = false, mono = false, beside = false): void {
      projected.copy(anchor).project(camera);
      if (projected.z < -1 || projected.z > 1 || Math.abs(projected.x) > 1 || Math.abs(projected.y) > 1) return;
      let x = (projected.x + 1) / 2 * width;
      let y = (1 - projected.y) / 2 * height;
      context!.font = `600 10px ${mono ? 'monospace' : 'system-ui, sans-serif'}`;
      const badgeWidth = Math.max(...lines.map(text => context!.measureText(text).width)) + 14;
      const badgeHeight = lines.length * 14 + 7;
      if (beside) {
        x = Math.max(badgeWidth / 2 + 8, Math.min(width - badgeWidth / 2 - 8, x + 16 + badgeWidth / 2));
        y -= badgeHeight / 2;
      }
      context!.fillStyle = selected ? '#245b47' : 'rgba(251,252,248,.94)';
      context!.beginPath();
      context!.roundRect(x - badgeWidth / 2, y - badgeHeight / 2, badgeWidth, badgeHeight, 4);
      context!.fill();
      context!.fillStyle = selected ? '#fff' : '#344940';
      context!.textAlign = 'center';
      context!.textBaseline = 'middle';
      lines.forEach((text, i) => context!.fillText(text, x, y + (i - (lines.length - 1) / 2) * 14));
    }
    if (currentView.labels && currentView.roofOpacity < 0.65) {
      for (const label of labels) if (width >= 520 || label.room === currentView.selectedRoom) badge(label.anchor, [label.element.firstElementChild!.textContent!, label.value.textContent!].filter(Boolean), currentView.selectedRoom === label.room);
    }
    if (thermalVentConfig && currentView.roofOpacity < 0.65) badge(ventLabelAnchor, ventLabel.textContent!.split('\n'), false, false, true);
    if (currentView.dimensions) for (const dimension of dimensions) badge(dimension.anchor, [dimension.element.textContent!], false, true);
    context.fillStyle = '#eff3ed';
    context.fillRect(0, height, width, footerHeight);
    context.fillStyle = '#d0dacd';
    context.fillRect(0, height, width, 1);
    context.textBaseline = 'alphabetic';
    if (currentView.mode !== 'model') {
      const legendWidth = Math.min(220, Math.max(50, width - 40));
      const legendX = 20;
      const legendY = height + 28;
      const range = currentView.mode === 'temperature' ? [24, 40] : currentView.mode === 'pm25' ? [0, 250] : currentView.mode === 'pressure' ? [-1, 1] : [0, 1.5];
      const gradient = context.createLinearGradient(legendX, 0, legendX + legendWidth, 0);
      for (let i = 0; i <= 20; i++) gradient.addColorStop(i / 20, `#${fieldColor(currentView.mode, range[0] + (range[1] - range[0]) * i / 20).getHexString()}`);
      context.fillStyle = gradient;
      context.fillRect(legendX, legendY, legendWidth, 7);
      context.fillStyle = '#344940';
      context.font = '600 10px system-ui, sans-serif';
      context.textAlign = 'left';
      context.fillText(currentView.mode === 'pressure' ? 'Pressure potential · relative' : currentView.mode === 'temperature' ? 'Temperature · °C' : currentView.mode === 'pm25' ? 'PM2.5 · µg/m³' : 'Air speed · m/s', legendX, legendY - 10);
      context.fillText(String(range[0]), legendX, legendY + 20);
      context.textAlign = 'right';
      context.fillText(currentView.mode === 'pressure' ? '+1' : String(range[1]), legendX + legendWidth, legendY + 20);
      if (currentView.mode === 'pressure') {
        context.textAlign = 'center';
        context.fillText('0', legendX + legendWidth / 2, legendY + 20);
      }
    }
    context.fillStyle = '#486354';
    context.font = `500 ${width < 350 ? 10 : 11}px system-ui, sans-serif`;
    context.textAlign = 'left';
    const footerY = height + footerHeight - 47;
    context.fillText(currentView.mode === 'model' ? 'HeatSim · SIMULATED · 1:65 model' : 'HeatSim · SIMULATED', 20, footerY, Math.max(1, width - 40));
    const detail = currentView.mode === 'model' ? 'Footprint 187.69 × 118.46 mm · walls 40 mm' : currentView.mode === 'pressure' ? 'Normalised within this layout · not Pa' : 'Qualitative toy CFD · not calibrated';
    context.fillText(detail, 20, footerY + 16, Math.max(1, width - 40));
    context.fillText(thermalVentConfig ? 'Cooling Lab position preview · no CFD flow overlay' : 'Arrows: simulated direction · none in still air', 20, footerY + 32, Math.max(1, width - 40));
    return canvas.toDataURL('image/png');
  }
  return {
    update,
    setThermalVent,
    setSelectedStandingFan,
    setPortableDraggingEnabled: enabled => {
      portableDraggingEnabled = enabled && Boolean(onMovePortableDevice || fanEvents);
      renderer.domElement.setAttribute('aria-label', portableDraggingEnabled
        ? 'Interactive 3D flat. Drag standing fans to clear floor areas; drag the purifier to a marked position. Drag empty space to rotate, scroll to zoom. Device controls provide keyboard access.'
        : 'Interactive 3D flat preview. Drag to rotate, scroll to zoom. Portable device dragging is unavailable in this workspace.');
      if (!portableDraggingEnabled) endDrag(false);
      updateFanSelection();
    },
    setCamera: cameraPosition,
    resetCamera: () => cameraPosition('perspective'),
    rotateCamera: direction => {
      camera.position.sub(controls.target).applyAxisAngle(new THREE.Vector3(0, 1, 0), (direction === 'left' ? -1 : 1) * Math.PI / 12).add(controls.target);
      controls.update();
    },
    screenshot,
    dispose: () => {
      if (disposed) return;
      endDrag(false);
      disposed = true;
      cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      controls.dispose();
      motionPreference.removeEventListener('change', onMotionPreferenceChange);
      renderer.domElement.removeEventListener('pointerdown', onPointerDown, true);
      renderer.domElement.removeEventListener('contextmenu', onContextMenu, true);
      renderer.domElement.removeEventListener('pointermove', onPointerMove, true);
      renderer.domElement.removeEventListener('pointerup', onPointerUp, true);
      renderer.domElement.removeEventListener('pointercancel', cancelDrag);
      renderer.domElement.removeEventListener('lostpointercapture', cancelDrag);
      renderer.domElement.removeEventListener('keydown', onDragKey);
      window.removeEventListener('blur', cancelDrag);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      fieldView.dispose();
      standingFanVisuals.dispose();
      fanGhost.clear();
      geometries.forEach(g => g.dispose());
      materials.forEach(m => m.dispose());
      sunlight.shadow.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      labelLayer.remove();
    },
  };
}
