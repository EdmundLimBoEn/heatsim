import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createPlanFieldView, fieldColor, roomPressure } from './scene-field';
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
  setCamera(view: 'perspective' | 'top'): void;
  resetCamera(): void;
  dispose(): void;
  screenshot(): string;
}

const DOOR_SWING: Record<string, number> = {
  main_door: 1, door_master_bedroom: 1, door_common_bath: 1, door_bedroom2: 1,
  door_bedroom3: 1, door_master_bath: 1, door_kitchen: -1, door_service_yard: -1, door_shelter: 1,
};
const ROOM_ANCHORS: Record<string, [number, number]> = {
  master_bedroom: [1.9, 2.45], master_bath: [4.7, 1.55], common_bath: [4.7, 2.95],
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
}

export async function createScene(container: HTMLElement, onSelectRoom: (room: string | null) => void): Promise<SceneController> {
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
  renderer.domElement.setAttribute('aria-label', 'Interactive 3D flat. Drag to rotate, scroll to zoom. Select a room to inspect it.');
  renderer.domElement.setAttribute('role', 'img');
  renderer.domElement.tabIndex = 0;
  container.appendChild(renderer.domElement);
  const labelLayer = document.createElement('div');
  labelLayer.style.cssText = 'position:absolute;inset:0;overflow:hidden;pointer-events:none;font-family:inherit;';
  container.appendChild(labelLayer);

  const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 120);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
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
  direction.rotation.x = Math.PI / 2;
  direction.position.set(0, 0.07, 0.78);
  portableFan.add(direction);
  fanRotor.traverse(child => { if (child instanceof THREE.Mesh) child.castShadow = false; });
  scene.add(portableFan);
  const portablePurifier = new THREE.Group();
  cylinder(0.17, 0.6, 0, 0.3, 0, palette.white, portablePurifier);
  const purifierLed = material('#b3b9ae');
  cylinder(0.173, 0.02, 0, 0.55, 0, purifierLed, portablePurifier);
  cylinder(0.125, 0.02, 0, 0.605, 0, palette.slate, portablePurifier);
  scene.add(portablePurifier);

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

  const labels: { room: string; element: HTMLButtonElement; value: HTMLSpanElement; anchor: THREE.Vector3 }[] = [];
  for (const room of model.rooms) {
    const element = document.createElement('button');
    element.type = 'button';
    element.setAttribute('aria-label', `Select ${roomLabel(room.name)}`);
    element.style.cssText = 'position:absolute;transform:translate(-50%,-50%);border:1px solid rgba(255,255,255,.8);border-radius:5px;background:rgba(251,252,248,.88);color:#344940;padding:4px 7px;box-shadow:0 1px 6px rgba(29,48,36,.05);font:600 10px/1.25 inherit;white-space:nowrap;pointer-events:auto;cursor:pointer;backdrop-filter:blur(3px);';
    const name = document.createElement('span');
    name.textContent = roomLabel(room.name).replace('Household shelter', 'Shelter').replace('Entrance lobby', 'Lobby');
    name.style.cssText = 'display:block;font-size:10px;font-weight:600;letter-spacing:-.1px;';
    const value = document.createElement('span');
    value.style.cssText = 'display:block;font-size:12px;font-weight:700;margin-top:2px;font-variant-numeric:tabular-nums;';
    element.append(name, value);
    element.addEventListener('click', () => onSelectRoom(room.name));
    labelLayer.appendChild(element);
    const anchor = ROOM_ANCHORS[room.name];
    labels.push({ room: room.name, element, value, anchor: new THREE.Vector3(anchor[0], 0.4, anchor[1]) });
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
  let currentView = { ...defaultView };
  let lastViewSignature = '';
  let lastShadowSignature = '';
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
  function onPointerDown(event: PointerEvent): void { pointerDown = { x: event.clientX, y: event.clientY }; }
  function onPointerUp(event: PointerEvent): void {
    if (!pointerDown || Math.hypot(pointerDown.x - event.clientX, pointerDown.y - event.clientY) > 6) { pointerDown = null; return; }
    pointerDown = null;
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    if (!raycaster.ray.intersectPlane(floorPlane, worldHit)) return;
    const room = model.rooms.find(r => worldHit.x >= r.min[0] && worldHit.x <= r.max[0] && worldHit.z >= r.min[2] && worldHit.z <= r.max[2]);
    onSelectRoom(room?.name ?? null);
  }
  renderer.domElement.addEventListener('pointerdown', onPointerDown);
  renderer.domElement.addEventListener('pointerup', onPointerUp);
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
  const resizeObserver = new ResizeObserver(() => {
    const newWidth = Math.max(container.clientWidth, 1);
    const newHeight = Math.max(container.clientHeight, 1);
    const aspectChanged = Math.abs(newWidth / newHeight - width / height) > 0.4;
    width = newWidth;
    height = newHeight;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    if (aspectChanged) cameraPosition(cameraMode);
  });
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
    fieldView.update(result.field, view.mode);
    const shadowSignature = JSON.stringify([conditions.doors, conditions.windows, conditions.portableFan?.slot, conditions.portableFan?.angleDeg, conditions.purifier?.slot, view.cutaway]);
    if (shadowSignature !== lastShadowSignature) { renderer.shadowMap.needsUpdate = true; lastShadowSignature = shadowSignature; }
    const signature = JSON.stringify([view.cutaway, view.roofOpacity, view.dimensions, view.selectedRoom]);
    if (signature !== lastViewSignature) { updateView(); lastViewSignature = signature; }
    for (const opening of openings) {
      const { source } = opening;
      const open = source.type === 'door' ? conditions.doors[source.name] : conditions.windows[source.name];
      opening.targetRotation = opening.baseRotation + (source.type === 'door' && open ? DOOR_SWING[source.name] * Math.PI / 2 : 0);
      opening.targetSlide = source.type === 'window' && open ? opening.travel : 0;
    }
    const fanState = conditions.portableFan;
    portableFan.visible = Boolean(fanState);
    if (fanState) {
      const slot = FAN_SLOTS[fanState.slot] ?? FAN_SLOTS[0];
      portableFan.position.set(slot.x, 0, slot.z);
      portableFan.rotation.y = THREE.MathUtils.degToRad(slot.baseYaw + fanState.angleDeg - 90);
      direction.visible = fanState.on;
    }
    const purifierState = conditions.purifier;
    portablePurifier.visible = Boolean(purifierState);
    if (purifierState) {
      const slot = PURIFIER_SLOTS[purifierState.slot] ?? PURIFIER_SLOTS[0];
      portablePurifier.position.set(slot.x, 0, slot.z);
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
    for (const label of labels) {
      const reading = result.rooms.find(r => r.room === label.room);
      const pressure = view.mode === 'pressure' ? roomPressure(result.field, model.rooms.find(room => room.name === label.room)!) : 0;
      const pressureLabel = `${Math.abs(pressure) < 0.005 ? '0.00' : `${pressure > 0 ? '+' : ''}${pressure.toFixed(2)}`} rel.`;
      label.value.textContent = view.mode === 'pressure' ? pressureLabel : !reading || view.mode === 'model' ? '' : view.mode === 'temperature' ? `${reading.temperature.toFixed(1)}°` : view.mode === 'airflow' ? `${reading.airflow.toFixed(2)} m/s` : `${Math.round(reading.pm25)} µg/m³`;
      label.value.style.display = label.value.textContent ? 'block' : 'none';
      const selected = view.selectedRoom === label.room;
      label.element.style.background = selected ? '#245b47' : 'rgba(251,252,248,.88)';
      label.element.style.color = selected ? '#fff' : '#344940';
      label.element.style.borderColor = selected ? '#245b47' : 'rgba(255,255,255,.8)';
      label.element.setAttribute('aria-pressed', String(selected));
    }
  }
  updateView();
  let frame = 0;
  let lastTime = performance.now();
  function render(now: number): void {
    if (disposed) return;
    const dt = Math.min((now - lastTime) / 1000, 0.05);
    lastTime = now;
    if (thermalVentConfig?.on) ventRotor.rotation.z += dt * 10;
    if (currentConditions.portableFan?.on) fanRotor.rotation.z += dt * 8 * currentConditions.portableFan.speed;
    for (const [name, rotor] of fans) if (currentConditions.devices[name]) rotor.rotation.y += dt * 12;
    for (const opening of openings) {
      if (Math.abs(opening.group.rotation.y - opening.targetRotation) > 0.005 || opening.slider && Math.abs(opening.slider.position.x - opening.targetSlide) > 0.005) renderer.shadowMap.needsUpdate = true;
      opening.group.rotation.y = THREE.MathUtils.damp(opening.group.rotation.y, opening.targetRotation, 9, dt);
      if (opening.slider) opening.slider.position.x = THREE.MathUtils.damp(opening.slider.position.x, opening.targetSlide, 9, dt);
    }
    fieldView.animate(dt);
    controls.update();
    camera.updateMatrixWorld();
    for (const label of labels) {
      projected.copy(label.anchor).project(camera);
      const show = currentView.labels && currentView.roofOpacity < 0.65 && projected.z < 1 && projected.z > -1 && Math.abs(projected.x) < 1 && Math.abs(projected.y) < 1;
      label.element.style.display = show ? 'block' : 'none';
      label.element.style.left = `${(projected.x + 1) / 2 * width}px`;
      label.element.style.top = `${(1 - projected.y) / 2 * height}px`;
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
    frame = requestAnimationFrame(render);
  }
  frame = requestAnimationFrame(render);
  function screenshot(): string {
    renderer.render(scene, camera);
    const canvas = document.createElement('canvas');
    const pixelRatio = renderer.domElement.width / width;
    const footerHeight = currentView.mode === 'model' ? 52 : 104;
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
      for (const label of labels) badge(label.anchor, [label.element.firstElementChild!.textContent!, label.value.textContent!].filter(Boolean), currentView.selectedRoom === label.room);
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
    const footerY = height + footerHeight - 31;
    context.fillText(currentView.mode === 'model' ? 'HeatSim · 1:65 scale model' : 'HeatSim · SIMULATED', 20, footerY, Math.max(1, width - 40));
    const detail = currentView.mode === 'model' ? 'Footprint 187.69 × 118.46 mm · walls 40 mm' : currentView.mode === 'pressure' ? 'Normalised within this layout · not Pa' : 'Qualitative toy CFD · not calibrated';
    context.fillText(detail, 20, footerY + 16, Math.max(1, width - 40));
    return canvas.toDataURL('image/png');
  }
  return {
    update,
    setThermalVent,
    setCamera: cameraPosition,
    resetCamera: () => cameraPosition('perspective'),
    screenshot,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      controls.dispose();
      renderer.domElement.removeEventListener('pointerdown', onPointerDown);
      renderer.domElement.removeEventListener('pointerup', onPointerUp);
      fieldView.dispose();
      geometries.forEach(g => g.dispose());
      materials.forEach(m => m.dispose());
      renderer.dispose();
      renderer.domElement.remove();
      labelLayer.remove();
    },
  };
}
