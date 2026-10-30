import * as THREE from 'three';

/** A small camera-facing gauge that stays readable above a shootable house. */
export class HouseHealthBar extends THREE.Sprite {
  constructor() {
    const pixels = new Uint8Array(128 * 16 * 4);
    const map = new THREE.DataTexture(pixels, 128, 16, THREE.RGBAFormat);
    map.magFilter = THREE.NearestFilter;
    map.minFilter = THREE.NearestFilter;
    super(new THREE.SpriteMaterial({ map, depthWrite: false, fog: false, toneMapped: false }));
    this.name = 'HouseHealthBar';
    this.scale.set(3.6, .45, 1);
    this.updateHealth(100, 100, true);
  }

  updateHealth(health, maximum, alive) {
    this.visible = alive && health > 0;
    const fraction = THREE.MathUtils.clamp(health / Math.max(1, maximum), 0, 1);
    if (this.fraction === fraction) return;
    this.fraction = fraction;
    const pixels = this.material.map.image.data;
    const fill = Math.round(fraction * 120);
    for (let y = 0; y < 16; y++) for (let x = 0; x < 128; x++) {
      const border = x < 2 || x >= 126 || y < 2 || y >= 14;
      const filled = x >= 4 && x < 4 + fill && y >= 4 && y < 12;
      const color = border ? [236, 214, 168] : filled
        ? (fraction <= .3 ? [232, 84, 61] : [229, 178, 70]) : [30, 24, 20];
      pixels.set([...color, 255], (y * 128 + x) * 4);
    }
    this.material.map.needsUpdate = true;
  }

  dispose() {
    this.removeFromParent();
    this.material.map.dispose(); this.material.dispose();
  }
}
