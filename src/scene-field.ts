import * as THREE from 'three';
import type { PlanField, Room, ViewMode } from './domain';

const COLOR_STOPS = {
  temperature: ['#447eb3', '#faf0db', '#c05c49'].map(c => new THREE.Color(c)),
  pm25: ['#f5f2d9', '#ddc16c', '#a47c51', '#745581'].map(c => new THREE.Color(c)),
  pressure: ['#456eaa', '#edf0e7', '#b96552'].map(c => new THREE.Color(c)),
  airflow: ['#452c6c', '#377d8b', '#70b474', '#e3d65d'].map(c => new THREE.Color(c)),
};

export function fieldColor(mode: ViewMode, value: number, target = new THREE.Color()): THREE.Color {
  const t = THREE.MathUtils.clamp(mode === 'temperature' ? (value - 24) / 16 : mode === 'pm25' ? value / 250 : mode === 'pressure' ? (value + 1) / 2 : value / 1.5, 0, 1);
  const stops = COLOR_STOPS[mode === 'model' ? 'airflow' : mode];
  const segment = Math.min(stops.length - 2, Math.floor(t * (stops.length - 1)));
  return target.copy(stops[segment]).lerp(stops[segment + 1], t * (stops.length - 1) - segment);
}

export function roomPressure(field: PlanField | undefined, room: Room): number {
  if (!field?.pressure) return 0;
  let sum = 0;
  let count = 0;
  const x0 = Math.max(0, Math.ceil((room.min[0] - field.origin[0]) / field.dx - 0.5));
  const x1 = Math.min(field.nx, Math.ceil((room.max[0] - field.origin[0]) / field.dx - 0.5));
  const z0 = Math.max(0, Math.ceil((room.min[2] - field.origin[1]) / field.dx - 0.5));
  const z1 = Math.min(field.nz, Math.ceil((room.max[2] - field.origin[1]) / field.dx - 0.5));
  for (let z = z0; z < z1; z++) for (let x = x0; x < x1; x++) {
    const cell = x + field.nx * z;
    if (field.cellType[cell] !== 0 || !Number.isFinite(field.pressure[cell])) continue;
    sum += field.pressure[cell];
    count++;
  }
  return count ? sum / count : 0;
}

export interface FlowArrow { start: [number, number]; end: [number, number] }

export function buildFlowArrows(field: PlanField): FlowArrow[] {
  const arrows: FlowArrow[] = [];
  function fluidAt(x: number, z: number): boolean {
    const ix = Math.floor((x - field.origin[0]) / field.dx);
    const iz = Math.floor((z - field.origin[1]) / field.dx);
    return ix >= 0 && ix < field.nx && iz >= 0 && iz < field.nz && field.cellType[ix + field.nx * iz] === 0;
  }
  const margin = Math.min(0.04, field.dx * 0.2);
  const offsets = [-margin, 0, margin];
  function clearAt(x: number, z: number): boolean {
    for (const ox of offsets) for (const oz of offsets) if (!fluidAt(x + ox, z + oz)) return false;
    return true;
  }
  for (let z = 1; z < field.nz; z += 3) for (let x = 1; x < field.nx; x += 3) {
    const cell = x + field.nx * z;
    const speed = Math.hypot(field.ux[cell], field.uz[cell]);
    if (field.cellType[cell] !== 0 || !Number.isFinite(speed) || speed < 0.025) continue;
    const centerX = field.origin[0] + (x + 0.5) * field.dx;
    const centerZ = field.origin[1] + (z + 0.5) * field.dx;
    const dx = field.ux[cell] / speed;
    const dz = field.uz[cell] / speed;
    const halfLength = Math.min(0.28, field.dx * 1.4);
    const step = field.dx / 4;
    let backward = 0;
    let forward = 0;
    for (let distance = step; distance <= halfLength; distance += step) {
      if (!clearAt(centerX - dx * distance, centerZ - dz * distance)) break;
      backward = distance;
    }
    for (let distance = step; distance <= halfLength; distance += step) {
      if (!clearAt(centerX + dx * distance, centerZ + dz * distance)) break;
      forward = distance;
    }
    if (backward + forward < field.dx * 0.8) continue;
    arrows.push({ start: [centerX - dx * backward, centerZ - dz * backward], end: [centerX + dx * forward, centerZ + dz * forward] });
    if (arrows.length === 512) return arrows;
  }
  return arrows;
}

export function createPlanFieldView(scene: THREE.Scene): {
  update(field: PlanField | undefined, mode: ViewMode): void;
  setMotionEnabled(enabled: boolean): void;
  animate(dt: number): void;
  dispose(): void;
} {
  const count = 900;
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const lifetimes = new Float32Array(count);
  const particleGeometry = new THREE.BufferGeometry();
  particleGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
  particleGeometry.setAttribute('color', new THREE.BufferAttribute(colors, 3).setUsage(THREE.DynamicDrawUsage));
  const particleMaterial = new THREE.PointsMaterial({ size: 0.055, transparent: true, opacity: 0.85, vertexColors: true, depthWrite: false, toneMapped: false });
  particleMaterial.onBeforeCompile = shader => {
    shader.fragmentShader = shader.fragmentShader.replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\nif (length(gl_PointCoord - vec2(0.5)) > 0.5) discard;');
  };
  const particles = new THREE.Points(particleGeometry, particleMaterial);
  particles.frustumCulled = false;
  particles.renderOrder = 3;
  particles.visible = false;
  scene.add(particles);
  const sliceMaterial = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.44, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
  const slice = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), sliceMaterial);
  slice.rotation.x = -Math.PI / 2;
  slice.position.y = 1.2;
  slice.renderOrder = 2;
  slice.visible = false;
  scene.add(slice);
  const arrowMaterial = new THREE.MeshBasicMaterial({ color: '#193c43', depthWrite: false, toneMapped: false });
  const shaftGeometry = new THREE.CylinderGeometry(1, 1, 1, 5);
  const headGeometry = new THREE.ConeGeometry(1, 1, 6);
  const shafts = new THREE.InstancedMesh(shaftGeometry, arrowMaterial, 512);
  const heads = new THREE.InstancedMesh(headGeometry, arrowMaterial, 512);
  for (const mesh of [shafts, heads]) {
    mesh.count = 0;
    mesh.visible = false;
    mesh.frustumCulled = false;
    mesh.renderOrder = 4;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    scene.add(mesh);
  }
  const arrowTransform = new THREE.Object3D();
  const direction = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  let latest: PlanField | undefined;
  let mode: ViewMode = 'model';
  let motionEnabled = true;
  let renderedGridKey = '';
  let texture: THREE.DataTexture | undefined;
  let pixels = new Uint8Array();
  let fluid: number[] = [];
  let seed = 173;
  const color = new THREE.Color();
  function random(): number { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; }
  function cellAt(x: number, z: number): number {
    if (!latest) return -1;
    const ix = Math.floor((x - latest.origin[0]) / latest.dx);
    const iz = Math.floor((z - latest.origin[1]) / latest.dx);
    return ix >= 0 && ix < latest.nx && iz >= 0 && iz < latest.nz ? ix + iz * latest.nx : -1;
  }
  function respawn(index: number): void {
    if (!latest || !fluid.length) return;
    const cell = fluid[Math.floor(random() * fluid.length)];
    positions[index * 3] = latest.origin[0] + (cell % latest.nx + 0.2 + random() * 0.6) * latest.dx;
    positions[index * 3 + 1] = 1.22;
    positions[index * 3 + 2] = latest.origin[1] + (Math.floor(cell / latest.nx) + 0.2 + random() * 0.6) * latest.dx;
    lifetimes[index] = 4 + random() * 4;
  }
  function update(field: PlanField | undefined, newMode: ViewMode): void {
    latest = field;
    mode = newMode;
    slice.visible = Boolean(field && mode !== 'model');
    particles.visible = Boolean(motionEnabled && field && (mode === 'airflow' || mode === 'pm25'));
    shafts.visible = heads.visible = Boolean(field);
    if (!field) return;
    const arrows = buildFlowArrows(field);
    shafts.count = heads.count = arrows.length;
    arrows.forEach((arrow, index) => {
      direction.set(arrow.end[0] - arrow.start[0], 0, arrow.end[1] - arrow.start[1]);
      const length = direction.length();
      const headLength = Math.min(0.12, length * 0.35);
      direction.normalize();
      arrowTransform.quaternion.setFromUnitVectors(up, direction);
      arrowTransform.position.set(arrow.start[0] + direction.x * (length - headLength) / 2, 1.24, arrow.start[1] + direction.z * (length - headLength) / 2);
      arrowTransform.scale.set(0.009, length - headLength, 0.009);
      arrowTransform.updateMatrix();
      shafts.setMatrixAt(index, arrowTransform.matrix);
      arrowTransform.position.set(arrow.end[0] - direction.x * headLength / 2, 1.24, arrow.end[1] - direction.z * headLength / 2);
      arrowTransform.scale.set(Math.min(0.036, field.dx * 0.18), headLength, Math.min(0.036, field.dx * 0.18));
      arrowTransform.updateMatrix();
      heads.setMatrixAt(index, arrowTransform.matrix);
    });
    shafts.instanceMatrix.needsUpdate = true;
    heads.instanceMatrix.needsUpdate = true;
    if (mode === 'model') return;
    const gridKey = `${field.nx}:${field.nz}:${field.dx}:${field.origin[0]}:${field.origin[1]}`;
    const changedGrid = renderedGridKey !== gridKey;
    if (changedGrid || !texture) {
      renderedGridKey = gridKey;
      texture?.dispose();
      pixels = new Uint8Array(field.nx * field.nz * 4);
      texture = new THREE.DataTexture(pixels, field.nx, field.nz, THREE.RGBAFormat);
      texture.minFilter = THREE.NearestFilter;
      texture.magFilter = THREE.NearestFilter;
      texture.colorSpace = THREE.LinearSRGBColorSpace;
      sliceMaterial.map = texture;
      sliceMaterial.needsUpdate = true;
      slice.scale.set(field.nx * field.dx, field.nz * field.dx, 1);
      slice.position.x = field.origin[0] + field.nx * field.dx / 2;
      slice.position.z = field.origin[1] + field.nz * field.dx / 2;
    }
    fluid = [];
    for (let z = 0; z < field.nz; z++) for (let x = 0; x < field.nx; x++) {
      const cell = x + z * field.nx;
      const pixel = (x + (field.nz - 1 - z) * field.nx) * 4;
      const value = mode === 'temperature' ? field.temperature[cell] : mode === 'pm25' ? field.pm25[cell] : mode === 'pressure' ? field.pressure?.[cell] ?? 0 : Math.hypot(field.ux[cell], field.uz[cell]);
      const isFluid = field.cellType[cell] === 0 && Number.isFinite(value);
      if (isFluid) fluid.push(cell);
      fieldColor(mode, Number.isFinite(value) ? value : 0, color);
      pixels[pixel] = Math.round(color.r * 255);
      pixels[pixel + 1] = Math.round(color.g * 255);
      pixels[pixel + 2] = Math.round(color.b * 255);
      pixels[pixel + 3] = isFluid ? 255 : 0;
    }
    texture.needsUpdate = true;
    if (changedGrid) for (let i = 0; i < count; i++) respawn(i);
  }
  function animate(dt: number): void {
    if (!latest || !particles.visible || !fluid.length) return;
    for (let i = 0; i < count; i++) {
      let cell = cellAt(positions[i * 3], positions[i * 3 + 2]);
      lifetimes[i] -= dt;
      if (cell < 0 || latest.cellType[cell] !== 0 || lifetimes[i] <= 0) { respawn(i); cell = cellAt(positions[i * 3], positions[i * 3 + 2]); }
      if (cell < 0) continue;
      const vx = latest.ux[cell];
      const vz = latest.uz[cell];
      if (!Number.isFinite(vx) || !Number.isFinite(vz)) { respawn(i); continue; }
      const steps = Math.max(1, Math.ceil(Math.hypot(vx, vz) * dt / (latest.dx * 0.4)));
      for (let step = 0; step < steps; step++) {
        const x = positions[i * 3] + vx * dt / steps;
        const z = positions[i * 3 + 2] + vz * dt / steps;
        const next = cellAt(x, z);
        if (next < 0 || latest.cellType[next] !== 0) { respawn(i); break; }
        positions[i * 3] = x;
        positions[i * 3 + 2] = z;
      }
      const value = mode === 'pm25' ? latest.pm25[cell] : Math.hypot(vx, vz);
      fieldColor(mode, value, color);
      colors[i * 3] = color.r;
      colors[i * 3 + 1] = color.g;
      colors[i * 3 + 2] = color.b;
    }
    particleGeometry.attributes.position.needsUpdate = true;
    particleGeometry.attributes.color.needsUpdate = true;
  }
  return { update, animate, setMotionEnabled: enabled => {
    motionEnabled = enabled;
    particles.visible = Boolean(enabled && latest && (mode === 'airflow' || mode === 'pm25'));
  }, dispose: () => {
    texture?.dispose();
    particleGeometry.dispose();
    particleMaterial.dispose();
    slice.geometry.dispose();
    sliceMaterial.dispose();
    shaftGeometry.dispose();
    headGeometry.dispose();
    arrowMaterial.dispose();
    shafts.dispose();
    heads.dispose();
    scene.remove(slice, particles, shafts, heads);
  } };
}
