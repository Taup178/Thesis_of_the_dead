import * as THREE from 'three';
import { DeanEarthWave } from './DeanEarthWave.js';

/** Longer physical ruptures; cracks appear with the front, never before it. */
export class MonsterRockWaves extends DeanEarthWave {
  constructor(root) {
    const rock = new THREE.MeshStandardMaterial({ color: 0x796149, roughness: 1, flatShading: true });
    const crack = new THREE.MeshBasicMaterial({ color: 0x30231c, side: THREE.DoubleSide, depthWrite: false });
    super(root, rock, crack, { rows: 26, spacing: 1.95, rowDelay: 0.105,
      damage: 24, poolSize: 3, warningLead: 0, lifetime: 4.8 });
    this.root.name = 'MonsterRockWaves'; this.materials = [rock, crack];
  }

  update(dt, player) {
    if (player.alive === false) { this.clear(); return; }
    super.update(dt, player);
  }

  impact(origin, radius) {
    const wave = this.pool.find(wave => !wave.active) || this.pool.reduce((a, b) => a.age > b.age ? a : b);
    // The body impact owns damage; these stones and dust show the ground breaking after contact.
    wave.active = true; wave.age = 0; wave.hit = true; wave.tiles.length = 0;
    for (let ring = 0; ring < 6; ring++) for (let sector = 0; sector < 13; sector++) {
      const angle = sector / 13 * Math.PI * 2 + ring * 0.31;
      const distance = radius * (ring + 1) / 6;
      wave.tiles.push({ position: origin.clone().add(new THREE.Vector3(Math.sin(angle) * distance, 0, Math.cos(angle) * distance)).setY(0),
        delay: ring * 0.025, height: 0.55 - ring * 0.045, yaw: angle,
        width: 0.6 + ring * 0.13, depth: 0.7 + ring * 0.08 });
    }
    this._draw(wave, null);
  }

  dispose() { super.dispose(); for (const material of this.materials) material.dispose(); }
}
