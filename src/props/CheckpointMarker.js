import * as THREE from 'three';

function texture(width, height, alpha) {
  const pixels = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 4;
    pixels.set([255, 255, 255, Math.round(255 * THREE.MathUtils.clamp(alpha(x / Math.max(1, width - 1), y / (height - 1)), 0, 1))], i);
  }
  const map = new THREE.DataTexture(pixels, width, height, THREE.RGBAFormat);
  map.magFilter = THREE.LinearFilter; map.minFilter = THREE.LinearFilter; map.needsUpdate = true;
  return map;
}

/** A world-anchored objective glow. Visual guidance only; it never changes checkpoints. */
export class CheckpointMarker {
  constructor(parent, { radius = 1.4, height = 3.6, color = 0x88d2b5 } = {}) {
    this.root = new THREE.Group(); this.root.name = 'CheckpointIndicator';
    this.root.visible = false; parent.add(this.root);
    this.time = 0; this.fade = 0; this.height = height; this.radius = radius;
    this.resources = new Set();
    const own = resource => { this.resources.add(resource); return resource; };
    const ringMap = own(texture(128, 128, (u, v) => {
      const r = Math.hypot(u - 0.5, v - 0.5) * 2;
      return 0.8 * Math.exp(-Math.pow((r - 0.72) / 0.065, 2)) + 0.1 * Math.exp(-r * r * 5);
    }));
    const columnMap = own(texture(1, 64, (_u, v) =>
      THREE.MathUtils.smoothstep(v, 0, 0.12) * (1 - v) ** 2));
    const dustMap = own(texture(24, 24, (u, v) => Math.max(0, 1 - ((u - 0.5) ** 2 + (v - 0.5) ** 2) * 4) ** 3));
    const options = { color, transparent: true, depthWrite: false, toneMapped: false, fog: true };
    this.groundMaterial = own(new THREE.MeshBasicMaterial({ ...options, map: ringMap, opacity: 0 }));
    this.ground = new THREE.Mesh(own(new THREE.PlaneGeometry(radius * 2.8, radius * 2.8)), this.groundMaterial);
    this.ground.rotation.x = -Math.PI / 2; this.ground.position.y = 0.045;
    this.columnMaterial = own(new THREE.MeshBasicMaterial({ ...options, map: columnMap, side: THREE.DoubleSide, opacity: 0 }));
    this.column = new THREE.Mesh(own(new THREE.CylinderGeometry(radius * 0.97, radius, height, 48, 1, true)), this.columnMaterial);
    this.column.position.y = height / 2 + 0.04;
    const geometry = own(new THREE.BufferGeometry());
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(36 * 3), 3));
    this.dustMaterial = own(new THREE.PointsMaterial({ ...options, map: dustMap, size: 0.075, opacity: 0 }));
    this.dust = new THREE.Points(geometry, this.dustMaterial); this.dust.frustumCulled = false;
    this.root.add(this.ground, this.column, this.dust);
    this._pose();
  }

  update(dt, visible, position) {
    this.root.visible = !!visible;
    if (position) this.root.position.copy(position);
    if (!visible) { this.fade = 0; return; }
    this.time += Math.max(0, Math.min(dt, 0.15));
    this.fade = Math.min(1, this.fade + dt * 3);
    this._pose();
  }

  _pose() {
    const breath = Math.sin(this.time * 1.5);
    this.groundMaterial.opacity = this.fade * (0.8 + breath * 0.06);
    this.columnMaterial.opacity = this.fade * (0.25 + breath * 0.015);
    this.dustMaterial.opacity = this.fade * 0.65;
    this.ground.scale.setScalar(1 + breath * 0.015);
    const positions = this.dust.geometry.attributes.position;
    for (let i = 0; i < positions.count; i++) {
      const angle = i * 2.39996 + this.time * 0.045;
      const r = this.radius * Math.sqrt((i + 0.5) / positions.count) * 0.9;
      const rise = (i * 0.618034 + this.time * 0.07) % 1;
      positions.setXYZ(i, Math.cos(angle) * r, 0.18 + rise * this.height * 0.85, Math.sin(angle) * r);
    }
    positions.needsUpdate = true;
  }

  hide() { this.root.visible = false; this.fade = 0; }

  dispose() {
    this.root.removeFromParent();
    for (const resource of this.resources) resource.dispose();
    this.resources.clear();
  }
}
