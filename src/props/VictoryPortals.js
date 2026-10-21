import * as THREE from 'three';
import { RoomExitPortal } from './RoomExitPortal.js';

/** Preloaded portals open only after Shaun has physically collected the degree. */
export class VictoryPortals {
  constructor(parent) {
    this.root = new THREE.Group(); this.root.name = 'VictoryPortals'; parent.add(this.root); this.root.visible = false;
    this.portals = [new RoomExitPortal(this.root, new THREE.Vector3(-7, 0, -37), { red: true }),
      new RoomExitPortal(this.root, new THREE.Vector3(7, 0, -37), { blue: true })];
    this.portals[0].root.name = 'VictoryRedPortal'; this.portals[1].root.name = 'VictoryBluePortal';
    this.time = 0; this.started = false; this.done = false;
  }

  get obstacles() {
    // Collide with the stone uprights while keeping the opening and its approach clear.
    return this.portals.flatMap(portal => [-1, 1].map(side => ({
      x: portal.center.x + side * 2.15, z: portal.center.z, radius: 0.45,
    })));
  }

  async load() { await Promise.all(this.portals.map(portal => portal.load())); }

  async prepare(renderer, scene, camera) {
    this.root.visible = true;
    try { await renderer?.compileAsync?.(scene, camera); }
    finally { this.root.visible = false; }
  }

  start(camera) {
    if (this.started) return;
    this.started = true; this.root.visible = true;
    this.cameraStart = camera.position.clone(); this.rotationStart = camera.quaternion.clone();
    this.portals.forEach(portal => { portal.root.scale.setScalar(0.001); portal.root.visible = false; portal.light.intensity = 0; });
  }

  update(dt, camera) {
    if (!this.started || this.done) return;
    this.time += dt;
    this.portals.forEach((portal, index) => {
      const age = this.time - 0.8 - index * 0.3;
      portal.root.visible = age > 0;
      const opening = THREE.MathUtils.smootherstep(age, 0, 0.75);
      const settle = Math.sin(Math.min(1, Math.max(0, age / 0.75)) * Math.PI) * 0.06;
      portal.root.scale.setScalar(Math.max(0.001, opening + settle));
      portal.update(dt); portal.light.intensity *= opening;
    });
    const blend = THREE.MathUtils.smootherstep(this.time, 0, 1.8);
    camera.position.lerpVectors(this.cameraStart, new THREE.Vector3(0, 5.2, -18), blend);
    camera.position.y += Math.sin(blend * Math.PI) * 2;
    camera.lookAt(0, 2, -37);
    const look = camera.quaternion.clone(); camera.quaternion.slerpQuaternions(this.rotationStart, look, blend);
    camera.updateMatrixWorld(true);
    this.done = this.time >= 3.2;
  }

  dispose() {
    for (const portal of this.portals) {
      portal.mixer?.stopAllAction(); if (portal.model) portal.mixer?.uncacheRoot(portal.model);
    }
    this.root.removeFromParent();
  }
}
