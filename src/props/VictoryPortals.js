import * as THREE from 'three';
import { RoomExitPortal } from './RoomExitPortal.js';
import { CheckpointMarker } from './CheckpointMarker.js';

/** Preloaded portals open only after Shaun has physically collected the degree. */
export class VictoryPortals {
  constructor(parent) {
    this.root = new THREE.Group(); this.root.name = 'VictoryPortals'; parent.add(this.root); this.root.visible = false;
    this.portals = [new RoomExitPortal(this.root, new THREE.Vector3(-7, 0, -37), { red: true }),
      new RoomExitPortal(this.root, new THREE.Vector3(7, 0, -37), { blue: true })];
    this.portals[0].root.name = 'VictoryRedPortal'; this.portals[1].root.name = 'VictoryBluePortal';
    this.time = 0; this.started = false; this.done = false;
    this.indicators = this.portals.map(() => new CheckpointMarker(this.root, { radius: 1.05, height: 3.2 }));
    this._placeApproachPoints();
  }

  _placeApproachPoints() {
    this.portals.forEach((portal, index) => {
      // Match the other exits: the marker stands beyond the entire structure,
      // including the stairs. Scripted travel handles crossing the solid portal.
      const bounds = new THREE.Box3().setFromObject(portal.root, true);
      portal.approachPoint = new THREE.Vector3(portal.root.position.x, 0, bounds.max.z + .7);
      this.indicators[index].root.position.copy(portal.approachPoint);
    });
  }

  updateIndicators(dt, visible) {
    for (const marker of this.indicators) marker.update(dt, visible);
  }

  get obstacles() {
    return this.portals.flatMap(portal => portal.obstacles);
  }

  async load() {
    await Promise.all(this.portals.map(portal => portal.load()));
    this._placeApproachPoints();
  }

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
    for (const marker of this.indicators) marker.dispose();
    for (const portal of this.portals) {
      portal.mixer?.stopAllAction(); if (portal.model) portal.mixer?.uncacheRoot(portal.model);
    }
    this.root.removeFromParent();
  }
}
