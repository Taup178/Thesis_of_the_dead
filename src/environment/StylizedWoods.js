import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export const NATURE_ASSET_ROOT = './assets/models/stylized-nature/';
export const WOODS_ASSETS = ['birch-trees', 'trees', 'maple-trees', 'pine-trees', 'dead-trees',
  'rocks', 'bushes', 'grass', 'flowers'];

function seededRandom(seed = 73419) {
  return () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
}

function segmentDistance(x, z, endX, endZ) {
  const lengthSq = endX * endX + endZ * endZ;
  const t = lengthSq ? THREE.MathUtils.clamp((x * endX + z * endZ) / lengthSq, 0, 1) : 0;
  return Math.hypot(x - endX * t, z - endZ * t);
}

/** Positive outside the paths and clearings; shared by scenery placement and ground colour. */
export function woodsClearance(x, z, credits = []) {
  let clearance = Math.min(Math.hypot(x, z) - 7,
    segmentDistance(x, z, 0, -50) - 4.5, segmentDistance(x, z, 0, 50) - 4.5);
  for (const credit of credits) {
    const point = credit.mesh?.position || credit;
    clearance = Math.min(clearance, segmentDistance(x, z, point.x, point.z) - 2.2,
      Math.hypot(x - point.x, z - point.z) - 4);
  }
  return Math.min(clearance, Math.hypot(x, z + 45) - 8, Math.hypot(x, z - 45) - 9);
}

/** Layout stays flat inside the playable area, with uninterrupted paths to every objective. */
export function createWoodsLayout(credits = []) {
  const random = seededRandom();
  const placements = [], obstacles = [];
  const add = (kind, x, z, height, radius = 0) => {
    placements.push({ kind, x, z, height, yaw: random() * Math.PI * 2, variant: Math.floor(random() * 3) });
    if (radius) obstacles.push({ x, z, radius });
  };
  for (let attempt = 0, count = 0; attempt < 1800 && count < 90; attempt++) {
    const x = (random() - 0.5) * 112, z = (random() - 0.5) * 112;
    if (woodsClearance(x, z, credits) < 2 || obstacles.some(o => Math.hypot(x - o.x, z - o.z) < 6)) continue;
    const kind = x < -14 ? 'birch-trees' : x > 17 ? 'pine-trees'
      : z < -18 ? 'dead-trees' : random() < 0.3 ? 'maple-trees' : 'trees';
    const height = kind === 'pine-trees' ? 14 + random() * 7 : 10 + random() * 6;
    add(kind, x, z, height, Math.max(0.55, height * 0.055)); count++;
  }
  // Two broken rings create depth beyond the square arena without blocking its edges.
  for (let ring = 0; ring < 2; ring++) for (let i = 0; i < 64; i++) {
    const angle = (i + random() * 0.5) / 64 * Math.PI * 2;
    const radius = 88 + ring * 35 + random() * 12;
    add(i % 3 ? 'pine-trees' : 'trees', Math.cos(angle) * radius, Math.sin(angle) * radius, 15 + random() * 10);
  }
  for (let i = 0; i < 55; i++) {
    const x = (random() - 0.5) * 108, z = (random() - 0.5) * 108;
    const height = 0.7 + random() * 1.4, radius = height * 1.2;
    if (woodsClearance(x, z, credits) < radius + 1 || obstacles.some(o => Math.hypot(x - o.x, z - o.z) < o.radius + radius + 1)) continue;
    add('rocks', x, z, height, radius);
  }
  for (let i = 0; i < 1500; i++) {
    const x = (random() - 0.5) * 118, z = (random() - 0.5) * 118;
    const clearance = woodsClearance(x, z, credits);
    if (clearance < 0.7 || obstacles.some(o => Math.hypot(x - o.x, z - o.z) < o.radius + 0.3)) continue;
    const kind = i % 11 === 0 ? 'bushes' : i % 7 === 0 ? 'flowers' : 'grass';
    add(kind, x, z, kind === 'bushes' ? 0.7 + random() * 0.6 : 0.25 + random() * 0.4);
  }
  return { placements, obstacles };
}

/** Remove the asset gallery offsets, bake orientation, and ground each individual plant. */
export function extractNatureVariants(source) {
  source.updateMatrixWorld(true);
  const gallery = source.getObjectByName('RootNode') || source;
  return gallery.children.filter(child => child.isMesh || child.children.length).map(child => {
    const parts = [];
    child.traverse(mesh => {
      if (!mesh.isMesh) return;
      const geometry = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld);
      parts.push({ geometry, material: mesh.material });
    });
    const bounds = new THREE.Box3();
    for (const part of parts) { part.geometry.computeBoundingBox(); bounds.union(part.geometry.boundingBox); }
    const height = Math.max(0.001, bounds.max.y - bounds.min.y);
    const center = bounds.getCenter(new THREE.Vector3());
    for (const part of parts) {
      part.geometry.translate(-center.x, -bounds.min.y, -center.z);
      part.geometry.scale(1 / height, 1 / height, 1 / height);
      part.geometry.computeBoundingBox(); part.geometry.computeBoundingSphere();
    }
    return { name: child.name, parts };
  });
}

export class StylizedWoods {
  constructor(scene, credits) {
    this.root = new THREE.Group(); this.root.name = 'UltimateStylizedWoods'; scene.add(this.root);
    this.credits = credits; this.resources = new Set(); this.bulletMeshes = [];
    this.layout = createWoodsLayout(credits); this.obstacles = this.layout.obstacles;
  }

  async load(onProgress) {
    const loader = new GLTFLoader();
    let loaded = 0;
    const sources = await Promise.all(WOODS_ASSETS.map(async kind => {
      const gltf = await loader.loadAsync(`${NATURE_ASSET_ROOT}${kind}.glb`);
      this._track(gltf.scene);
      onProgress?.(++loaded / WOODS_ASSETS.length);
      return [kind, gltf.scene];
    }));
    for (const [kind, source] of sources) {
      const variants = extractNatureVariants(source);
      for (const variant of variants) for (const part of variant.parts) this.resources.add(part.geometry);
      for (let index = 0; index < variants.length; index++) {
        const placements = this.layout.placements.filter(p => p.kind === kind && p.variant % variants.length === index);
        if (!placements.length) continue;
        for (const part of variants[index].parts) {
          const mesh = new THREE.InstancedMesh(part.geometry, part.material, placements.length);
          mesh.name = `${kind}_${variants[index].name}`;
          mesh.castShadow = kind !== 'grass' && kind !== 'flowers'; mesh.receiveShadow = true;
          const dummy = new THREE.Object3D();
          placements.forEach((p, i) => {
            dummy.position.set(p.x, 0, p.z); dummy.rotation.set(0, p.yaw, 0); dummy.scale.setScalar(p.height);
            dummy.updateMatrix(); mesh.setMatrixAt(i, dummy.matrix);
          });
          mesh.instanceMatrix.needsUpdate = true; mesh.computeBoundingSphere();
          this.root.add(mesh);
          if (kind.includes('trees') || kind === 'rocks') this.bulletMeshes.push(mesh);
        }
      }
    }
    this._createGround();
  }

  _track(source) {
    source.traverse(mesh => {
      if (!mesh.isMesh) return;
      this.resources.add(mesh.geometry);
      for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
        this.resources.add(material);
        material.roughness = 0.95; material.metalness = 0;
        if (material.transparent) {
          material.transparent = false; material.alphaTest = 0.45; material.alphaToCoverage = true;
          material.side = THREE.DoubleSide; material.depthWrite = true;
        }
        for (const value of Object.values(material)) if (value?.isTexture) {
          value.anisotropy = 4; this.resources.add(value);
        }
      }
    });
  }

  _createGround() {
    const geometry = new THREE.PlaneGeometry(320, 320, 200, 200); geometry.rotateX(-Math.PI / 2);
    const positions = geometry.getAttribute('position');
    const colors = new Float32Array(positions.count * 3);
    const grass = new THREE.Color(0x455d32), dirt = new THREE.Color(0x827456), color = new THREE.Color();
    for (let i = 0; i < positions.count; i++) {
      const x = positions.getX(i), z = positions.getZ(i);
      const clearance = woodsClearance(x, z, this.credits);
      const path = 1 - THREE.MathUtils.smoothstep(clearance, -1.2, 1.5);
      const variation = 0.9 + Math.sin(x * 0.32 + Math.cos(z * 0.25)) * 0.07 + Math.cos(z * 0.55) * 0.03;
      color.copy(grass).lerp(dirt, path * 0.85).multiplyScalar(variation); color.toArray(colors, i * 3);
      positions.setY(i, -0.035);
    }
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 });
    const ground = new THREE.Mesh(geometry, material); ground.name = 'WoodlandPaths'; ground.receiveShadow = true;
    this.resources.add(geometry); this.resources.add(material); this.root.add(ground);
    this.bulletMeshes.push(ground);
  }

  dispose() {
    this.root.traverse(node => { if (node.isInstancedMesh) node.dispose(); });
    this.root.removeFromParent();
    for (const resource of this.resources) resource.dispose();
    this.resources.clear(); this.bulletMeshes.length = 0;
  }
}
