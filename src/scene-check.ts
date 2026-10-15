import * as THREE from 'three';
import { checkSceneModel } from './scene';
import { buildFlowArrows, createPlanFieldView, fieldColor, roomPressure } from './scene-field';
import type { PlanField, ViewMode } from './domain';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

checkSceneModel();
const field: PlanField = {
  nx: 2, nz: 2, dx: 0.2, origin: [-0.3, -0.3],
  pressure: new Float32Array([-1, 100, -50, 1]),
  temperature: new Float32Array([24, 30, 35, 40]), pm25: new Float32Array([0, 50, 150, 250]),
  ux: new Float32Array([0.3, 0, 0, -0.2]), uz: new Float32Array([0.2, 0, 0, -0.3]), cellType: new Uint8Array([0, 1, 2, 0]),
};
const scene = new THREE.Scene();
const renderer = createPlanFieldView(scene);
const slice = scene.children.find(child => child instanceof THREE.Mesh) as THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
renderer.update(field, 'model');
assert(!slice.visible && slice.material.map === null, 'Model view must not allocate a hidden scalar texture.');
renderer.update(field, 'airflow');
for (let frame = 0; frame < 180; frame++) renderer.animate(1 / 60);
const particles = scene.children.find(child => child instanceof THREE.Points) as THREE.Points;
const positions = particles.geometry.getAttribute('position');
for (let i = 0; i < positions.count; i++) {
  const x = Math.floor((positions.getX(i) - field.origin[0]) / field.dx);
  const z = Math.floor((positions.getZ(i) - field.origin[1]) / field.dx);
  assert(x >= 0 && x < field.nx && z >= 0 && z < field.nz && field.cellType[x + field.nx * z] === 0, 'A tracer escaped the fluid mask.');
}
const pixels = slice.material.map!.image.data as Uint8Array;
assert(Array.from(pixels).filter((_, i) => i % 4 === 3).filter(alpha => alpha > 0).length === 2, 'Slice must hide both solid and outside cells.');
assert(slice.position.y === 1.2, 'Slice height must match the spatial solver.');
assert(fieldColor('temperature', 24).equals(fieldColor('temperature', -100)), 'Temperature legend must clamp low values.');
assert(fieldColor('pm25', 250).equals(fieldColor('pm25', 900)), 'Haze legend must clamp high values.');
renderer.update(field, 'pressure');
assert(!particles.visible && slice.visible, 'Pressure view should show the masked slice without haze particles.');
assert(fieldColor('pressure', -1).equals(fieldColor('pressure', -20)), 'Pressure legend must clamp negative values.');
assert(fieldColor('pressure', 1).equals(fieldColor('pressure', 20)), 'Pressure legend must clamp positive values.');
assert(!fieldColor('pressure', -1).equals(fieldColor('pressure', 1)), 'Pressure colors must distinguish both signs.');
const room = { name: 'test', min: [-0.3, 0, -0.3] as [number, number, number], max: [0.1, 2.6, 0.1] as [number, number, number], area_m2: 0.16 };
assert(roomPressure(field, room) === 0, 'Room pressure must exclude solid and outside cells.');
assert(roomPressure({ ...field, pressure: undefined }, room) === 0, 'Missing pressure must default to zero.');
const channel: PlanField = {
  nx: 9, nz: 7, dx: 0.2, origin: [0, 0], cellType: new Uint8Array(63),
  ux: new Float32Array(63).fill(0.5), uz: new Float32Array(63),
  temperature: new Float32Array(63).fill(30), pm25: new Float32Array(63).fill(20),
};
for (let z = 0; z < channel.nz; z++) channel.cellType[2 + channel.nx * z] = 1;
const arrows = buildFlowArrows(channel);
assert(arrows.length > 0, 'Moving fluid must have visible direction arrows.');
const arrowMeshes = scene.children.filter(child => child instanceof THREE.InstancedMesh) as THREE.InstancedMesh[];
for (const mode of ['model', 'temperature', 'pm25', 'pressure', 'airflow'] as ViewMode[]) {
  renderer.update(channel, mode);
  assert(arrowMeshes.length === 2 && arrowMeshes.every(mesh => mesh.visible && mesh.count === arrows.length), `Actual flow arrows must remain visible in ${mode} mode.`);
}
renderer.setMotionEnabled(false);
const beforeStill = new Float32Array(positions.array);
renderer.animate(1);
assert(!particles.visible && arrowMeshes.every(mesh => mesh.visible && mesh.count > 0), 'Reduced motion must hide animated tracers but retain static flow arrows.');
assert(beforeStill.every((value, index) => value === positions.array[index]), 'Reduced motion must stop tracer position updates.');
renderer.update(channel, 'pm25');
assert(!particles.visible && slice.visible, 'Changing scalar mode must preserve reduced-motion preference.');
renderer.setMotionEnabled(true);
assert(particles.visible, 'Re-enabling motion must restore tracers for the current Haze view.');
const textureVersion = slice.material.map!.version;
renderer.update(channel, 'model');
assert(!slice.visible && slice.material.map!.version === textureVersion, 'Model view must retain arrows without uploading a hidden scalar texture.');
const shiftedChannel = { ...channel, origin: [2, 3] as [number, number] };
renderer.update(shiftedChannel, 'model');
renderer.update(shiftedChannel, 'temperature');
assert(slice.position.x === 2 + channel.nx * channel.dx / 2 && slice.position.z === 3 + channel.nz * channel.dx / 2, 'Returning from Model must position the texture on the current grid, including a changed origin.');
for (const arrow of arrows) {
  assert(arrow.end[0] > arrow.start[0] && arrow.end[1] === arrow.start[1], 'Arrow direction must match the actual eastward velocity.');
  for (let sample = 0; sample <= 20; sample++) {
    const x = arrow.start[0] + (arrow.end[0] - arrow.start[0]) * sample / 20;
    const z = arrow.start[1];
    for (const [ox, oz] of [[0.036, 0], [-0.036, 0], [0, 0.036], [0, -0.036]]) {
      const ix = Math.floor((x + ox) / channel.dx);
      const iz = Math.floor((z + oz) / channel.dx);
      assert(ix >= 0 && ix < channel.nx && iz >= 0 && iz < channel.nz && channel.cellType[ix + channel.nx * iz] === 0, 'Arrow geometry must stay out of walls and outside cells.');
    }
  }
}
channel.ux.fill(0);
assert(buildFlowArrows(channel).length === 0, 'Still air must not invent a flow direction.');
renderer.update(channel, 'temperature');
assert(arrowMeshes.every(mesh => mesh.count === 0), 'All-mode arrows must disappear when the actual field becomes still.');
renderer.update(undefined, 'airflow');
assert(!slice.visible && !particles.visible && arrowMeshes.every(mesh => !mesh.visible), 'Missing field must hide all spatial rendering.');
renderer.dispose();
assert(scene.children.length === 0, 'Field renderer must dispose its objects.');
console.info('PASS: scene bounds, opening/device mappings, furniture bounds, masked field texture, tracer wall rejection, pressure masking/means, actual velocity arrows in all five modes, reduced motion, hidden texture skip/resume, legend limits and disposal.');
