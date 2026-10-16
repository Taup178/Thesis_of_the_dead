import * as THREE from 'three';
import { DecalGeometry } from 'three/addons/geometries/DecalGeometry.js';

/** Irregular wet patches and scattered droplets, generated without an external texture. */
export function createBloodSplatterMaterial() {
  const size = 256, data = new Uint8Array(size * size * 4);
  for (let i = 3; i < data.length; i += 4) data[i] = 255;
  let seed = 7419;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  const blot = (x, y, rx, ry, angle) => {
    const radius = Math.max(rx, ry), cos = Math.cos(angle), sin = Math.sin(angle);
    for (let py = Math.max(0, Math.floor((y - radius) * size)); py < Math.min(size, Math.ceil((y + radius) * size)); py++) {
      for (let px = Math.max(0, Math.floor((x - radius) * size)); px < Math.min(size, Math.ceil((x + radius) * size)); px++) {
        const dx = (px + 0.5) / size - x, dy = (py + 0.5) / size - y;
        const distance = ((dx * cos + dy * sin) / rx) ** 2 + ((dy * cos - dx * sin) / ry) ** 2;
        if (distance >= 1) continue;
        const offset = (py * size + px) * 4;
        const alpha = Math.max(data[offset], Math.min(255, Math.round((1 - distance) * 1800)));
        data[offset] = data[offset + 1] = data[offset + 2] = alpha;
      }
    }
  };
  for (let i = 0; i < 12; i++) {
    blot(0.5 + (random() - 0.5) * 0.35, 0.5 + (random() - 0.5) * 0.3,
      0.08 + random() * 0.12, 0.06 + random() * 0.1, random() * Math.PI);
  }
  for (let i = 0; i < 36; i++) {
    const angle = random() * Math.PI * 2, radius = 0.2 + random() * 0.26;
    const width = 0.006 + random() * 0.026;
    blot(0.5 + Math.cos(angle) * radius, 0.5 + Math.sin(angle) * radius,
      width * (1 + random() * 1.5), width, angle);
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return new THREE.MeshStandardMaterial({ color: 0x8b101a, alphaMap: texture,
    roughness: 0.26, metalness: 0, transparent: true, alphaTest: 0.015, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4, side: THREE.DoubleSide });
}

/** Project onto real triangles and attach in their local space so the stain moves with them. */
export function addBloodSplatter(mesh, point, normal, size, material, roll = 0) {
  mesh.updateWorldMatrix(true, false);
  const rotation = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
  rotation.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), roll));
  const geometry = new DecalGeometry(mesh, point, new THREE.Euler().setFromQuaternion(rotation), size);
  if (!geometry.attributes.position.count) { geometry.dispose(); return null; }
  geometry.applyMatrix4(mesh.matrixWorld.clone().invert());
  const decal = new THREE.Mesh(geometry, material);
  decal.name = 'BloodSplatter'; decal.renderOrder = 1;
  mesh.add(decal);
  return decal;
}

export function stainSawBlade(blade, contact) {
  if (!blade.model) return;
  const material = blade.bloodMaterial ??= createBloodSplatterMaterial();
  blade.rotor.updateWorldMatrix(true, true);
  const meshes = [];
  blade.model.traverse(mesh => { if (mesh.isMesh && mesh.name !== 'BloodSplatter') meshes.push(mesh); });
  const depth = blade.bloodDepth || 0.12;
  for (const side of [-1, 1]) {
    const point = contact.clone();
    point.z = blade.wheel.position.z + blade.rotor.position.z + side * depth / 2;
    const normal = new THREE.Vector3(0, 0, side);
    for (const mesh of meshes) {
      addBloodSplatter(mesh, point, normal, new THREE.Vector3(1.25, 1.1, Math.max(0.08, depth * 0.7)), material, side * 0.45);
    }
  }
}
