import * as THREE from 'three';
import { PRIMARY_STANDING_FAN_ID } from './standing-fans';
import type { ResolvedStandingFan } from './standing-fans';

export interface StandingFanVisual {
  group: THREE.Group;
  rotor: THREE.Object3D;
  direction: THREE.Object3D;
  on: boolean;
  speed: number;
}

export function createStandingFanVisuals(scene: THREE.Scene, template: THREE.Group) {
  const visuals = new Map<string, StandingFanVisual>();
  // A solid invisible target keeps the thin grille and moving blades easy to grab.
  const hitGeometry = new THREE.BoxGeometry(0.6, 1.4, 0.6);
  const hitMaterial = new THREE.MeshBasicMaterial({ visible: false });
  const hitTarget = new THREE.Mesh(hitGeometry, hitMaterial);
  hitTarget.name = 'standing-fan-hit-target';
  hitTarget.position.y = 0.7;
  template.add(hitTarget);
  function add(id: string): StandingFanVisual {
    const group = id === PRIMARY_STANDING_FAN_ID ? template : template.clone(true);
    group.name = `standing-fan:${id}`;
    group.userData.standingFanId = id;
    const rotor = group.getObjectByName('standing-fan-rotor');
    const direction = group.getObjectByName('standing-fan-direction');
    if (!rotor || !direction) throw new Error('Standing fan visual is missing its rotor or direction indicator.');
    const visual = { group, rotor, direction, on: false, speed: 0 };
    visuals.set(id, visual);
    scene.add(group);
    return visual;
  }
  add(PRIMARY_STANDING_FAN_ID);
  return {
    get: (id: string) => visuals.get(id),
    groups: () => [...visuals.values()].filter(visual => visual.group.visible).map(visual => visual.group),
    sync(fans: ResolvedStandingFan[]): void {
      const ids = new Set(fans.map(fan => fan.id));
      for (const [id, visual] of visuals) {
        if (ids.has(id)) continue;
        if (id === PRIMARY_STANDING_FAN_ID) visual.group.visible = false;
        else {
          visual.group.removeFromParent();
          // Clones share geometry and materials with the retained template.
          visual.group.clear();
          visuals.delete(id);
        }
      }
      for (const fan of fans) {
        const visual = visuals.get(fan.id) ?? add(fan.id);
        visual.group.visible = true;
        visual.group.position.set(fan.x, 0, fan.z);
        visual.group.rotation.set(0, THREE.MathUtils.degToRad(180 - fan.angleDeg), 0);
        visual.direction.visible = fan.on;
        visual.on = fan.on;
        visual.speed = fan.speed;
      }
    },
    animate(dt: number): void {
      for (const visual of visuals.values()) if (visual.group.visible && visual.on) visual.rotor.rotation.z += dt * 8 * visual.speed;
    },
    dispose(): void {
      for (const visual of visuals.values()) { visual.group.removeFromParent(); visual.group.clear(); }
      visuals.clear();
      hitGeometry.dispose(); hitMaterial.dispose();
    },
  };
}
