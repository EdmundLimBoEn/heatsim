import * as THREE from 'three';
import { checkSceneModel } from './scene';
import { buildFlowArrows, createPlanFieldView, fieldColor, roomPressure } from './scene-field';
import type { PlanField } from './domain';

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
renderer.update(field, 'airflow');
for (let frame = 0; frame < 180; frame++) renderer.animate(1 / 60);
const particles = scene.children.find(child => child instanceof THREE.Points) as THREE.Points;
const positions = particles.geometry.getAttribute('position');
for (let i = 0; i < positions.count; i++) {
  const x = Math.floor((positions.getX(i) - field.origin[0]) / field.dx);
  const z = Math.floor((positions.getZ(i) - field.origin[1]) / field.dx);
  assert(x >= 0 && x < field.nx && z >= 0 && z < field.nz && field.cellType[x + field.nx * z] === 0, 'A tracer escaped the fluid mask.');
}
const slice = scene.children.find(child => child instanceof THREE.Mesh) as THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
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
renderer.update(undefined, 'airflow');
assert(!slice.visible && !particles.visible, 'Missing field must hide spatial rendering.');
renderer.dispose();
assert(scene.children.length === 0, 'Field renderer must dispose its objects.');
console.info('PASS: scene bounds, opening/device mappings, furniture bounds, masked field texture, tracer wall rejection, pressure masking/means, velocity arrows, legend limits and disposal.');
