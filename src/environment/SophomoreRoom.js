import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

// Small, tileable concrete maps: pores, aggregate, formwork seams and water streaks.
function concreteMap() {
  const size = 256, pixels = new Uint8Array(size * size * 4);
  let seed = 73;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  const streaks = Array.from({ length: size }, () => random());
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const cloud = Math.sin(x * Math.PI / 32) * Math.cos(y * Math.PI / 64) * 7;
    const pore = random() < 0.025 ? 34 : 0;
    const seam = x < 2 || y < 2 ? 38 : 0;
    const stain = streaks[x] > 0.88 ? (Math.sin(y * Math.PI / 256) + 1) * 11 : 0;
    const v = Math.round(192 + cloud + (random() - 0.5) * 24 - pore - seam - stain);
    pixels.set([v, v - 3, v - 7, 255], (y * size + x) * 4);
  }
  const map = new THREE.DataTexture(pixels, size, size);
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.magFilter = THREE.LinearFilter; map.minFilter = THREE.LinearMipmapLinearFilter;
  map.generateMipmaps = true; map.anisotropy = 4; map.needsUpdate = true;
  return map;
}

function scaleUV(geometry, x, y) {
  const uv = geometry.getAttribute('uv');
  for (let n = 0; n < uv.count; n++) uv.setXY(n, uv.getX(n) * x, uv.getY(n) * y);
  return geometry;
}

export function createSophomoreRoom(level) {
  const final = level.tilePosition(...level.patterns.at(-1).at(-1));
  const backZ = final.z - 12, frontZ = 10, length = frontZ - backZ, center = (frontZ + backZ) / 2;
  const mesh = (geometry, material, x, y, z) => level._mesh(geometry, material, x, y, z);
  const map = concreteMap();
  const concrete = new THREE.MeshStandardMaterial({ color: 0x827c70, map, bumpMap: map, bumpScale: 0.055, roughness: 0.94 });
  const darkConcrete = concrete.clone(); darkConcrete.color.setHex(0x555451);
  const steel = new THREE.MeshStandardMaterial({ color: 0x343d41, metalness: 0.7, roughness: 0.58 });
  const trim = new THREE.MeshStandardMaterial({ color: 0x787e7c, metalness: 0.65, roughness: 0.48 });
  level.tileMaterial = new THREE.MeshStandardMaterial({ color: 0x626b79, map, bumpMap: map, bumpScale: 0.035, roughness: 0.87, metalness: 0.04 });
  level.tileTrimMaterial = steel;
  level.scene.background = new THREE.Color(0x0a0e13);
  level.scene.fog = new THREE.FogExp2(0x0a0e13, 0.009);
  level.root.add(new THREE.HemisphereLight(0x8dabc8, 0x141820, 0.2));
  // A broad overhead source keeps every demonstrated landing readable.
  const overhead = new THREE.DirectionalLight(0x9dbbd9, 0.55);
  overhead.position.set(-8, 32, center + 12); overhead.target.position.set(0, 0, center);
  overhead.castShadow = true; overhead.shadow.mapSize.set(2048, 2048);
  Object.assign(overhead.shadow.camera, { left: -14, right: 14, top: length / 2 + 10, bottom: -length / 2 - 10, near: 0.1, far: length + 100 });
  overhead.shadow.normalBias = 0.035; overhead.shadow.bias = -0.00015; overhead.shadow.intensity = 0.48;
  level.root.add(overhead, overhead.target);
  for (const x of [-10, 10]) {
    mesh(scaleUV(new THREE.BoxGeometry(0.65, 27, length), length / 5, 5), concrete, x, 1.5, center);
    for (const y of [-2.8, 7.2]) mesh(new THREE.BoxGeometry(0.4, 0.3, length), steel, x * 0.96, y, center);
    // Rusted service pipes and their couplings sit well outside the playable tiles.
    const pipe = mesh(new THREE.CylinderGeometry(0.1, 0.1, length, 10), steel, x * 0.91, 1.2, center);
    pipe.rotation.x = Math.PI / 2;
  }
  for (const z of [backZ, frontZ]) mesh(scaleUV(new THREE.BoxGeometry(20, 27, 0.65), 4, 5), concrete, 0, 1.5, z);
  mesh(scaleUV(new THREE.BoxGeometry(20, 0.5, length), 4, length / 5), darkConcrete, 0, -12, center);
  // One instanced mesh keeps the dense spike bed inexpensive to render.
  const spikeHeight = 3.6, baseY = -11.75, spacing = 0.95;
  level.spikeTipY = baseY + spikeHeight;
  const columns = 20, rows = Math.floor((length - 1) / spacing);
  const spikes = new THREE.InstancedMesh(new THREE.ConeGeometry(0.42, spikeHeight, 4),
    new THREE.MeshStandardMaterial({ color: 0x707e86, metalness: 0.7, roughness: 0.48,
      emissive: 0x304455, emissiveIntensity: 0.2 }), columns * rows);
  spikes.name = 'SpikePit';
  const transform = new THREE.Object3D();
  for (let row = 0; row < rows; row++) for (let col = 0; col < columns; col++) {
    transform.position.set((col - (columns - 1) / 2) * spacing, baseY + spikeHeight / 2, backZ + 0.5 + row * spacing);
    transform.rotation.y = (row + col) % 2 ? Math.PI / 4 : 0;
    transform.updateMatrix(); spikes.setMatrixAt(row * columns + col, transform.matrix);
  }
  spikes.instanceMatrix.needsUpdate = true; spikes.receiveShadow = true;
  level.root.add(spikes); level.spikes = spikes;
  const ceiling = mesh(scaleUV(new THREE.BoxGeometry(20, 0.5, length), 4, length / 5), darkConcrete, 0, 15, center);
  ceiling.castShadow = false; // Broad indirect fill reaches the interior; beams still cast shadows.
  const lamp = new THREE.MeshStandardMaterial({ color: 0xe3cfab, emissive: 0xffd7a0, emissiveIntensity: 1.2 });
  const beam = new THREE.BoxGeometry(0.35, 22, 0.65);
  for (let z = 3; z > backZ; z -= 12) {
    mesh(new THREE.BoxGeometry(19.4, 0.55, 0.65), steel, 0, 10.5, z);
    for (const x of [-9.5, 9.5]) {
      mesh(beam, steel, x, -0.3, z);
      mesh(new THREE.BoxGeometry(0.75, 0.22, 1.5), steel, x * 0.95, 5.4, z);
      mesh(new THREE.BoxGeometry(0.5, 0.08, 1.15), lamp, x * 0.95, 5.25, z);
      const light = new THREE.PointLight(0xffd7a3, 16, 13, 2);
      light.position.set(x * 0.91, 4.9, z); level.root.add(light);
      mesh(new THREE.BoxGeometry(0.48, 1.1, 0.4), trim, x * 0.96, -0.5, z);
    }
    // Recessed ceiling panels break up the long empty box without hiding the Dean.
    mesh(new THREE.BoxGeometry(5.5, 0.16, 2.8), steel, 0, 14.5, z - 3);
  }
  const width = level.tileSpacing + level.tileSize + 1;
  // Leave room behind the player for the third-person camera, ahead of the portal frame.
  const startMinZ = -level.tileSize / 2, startMaxZ = 9.5;
  level.startPlatform = mesh(new RoundedBoxGeometry(width, 0.7, startMaxZ - startMinZ, 2, 0.08), concrete, 0, -0.35, (startMinZ + startMaxZ) / 2);
  level.startPlatform.name = 'ArrivalPlatform';
  level.startSurface = { minX: -width / 2, maxX: width / 2, minZ: startMinZ, maxZ: startMaxZ, y: 0, tile: null };
  level.entrancePosition = new THREE.Vector3(0, 0, 7.5);
  const minZ = final.z - 9.5, maxZ = final.z - level.tileSize / 2;
  level.exitDeck = mesh(new RoundedBoxGeometry(width, 0.8, maxZ - minZ, 2, 0.08), concrete, 0, -0.4, (minZ + maxZ) / 2);
  level.exitDeck.name = 'PortalLanding';
  level.exitSurface = { minX: -width / 2, maxX: width / 2, minZ, maxZ, y: 0, tile: null };
  level.exitPosition = new THREE.Vector3(final.x, 0, final.z - 7.2);
  level.portalApproachPoint = new THREE.Vector3(final.x, 0, final.z - 4.7);
  // Guard rails belong to the safe landing, leaving the tiles and entrance clear.
  for (const x of [-width / 2 + 0.15, width / 2 - 0.15]) {
    for (const z of [minZ + 0.2, maxZ - 0.5]) mesh(new THREE.BoxGeometry(0.09, 1.05, 0.09), trim, x, 0.525, z);
    mesh(new THREE.BoxGeometry(0.09, 0.09, maxZ - minZ - 0.7), trim, x, 1.05, (minZ + maxZ - 0.3) / 2);
  }
  level._label('THE SOPHOMORE ROOM', 3.5, 0.45, -level.spawnPoint.x, 0.015, 0.1);
  level._label('WATCH / REMEMBER / JUMP', 3.2, 0.3, -level.spawnPoint.x, 0.015, 0.8);
}

export function createTileGeometry(size) {
  return new RoundedBoxGeometry(size, 0.45, size, 2, 0.055);
}

/** Nine adjoining irregular pieces, also used to draw the warning cracks. */
export function createTileFracture(size) {
  const points = [], edges = [], pieces = [];
  for (let z = 0; z <= 3; z++) {
    points[z] = [];
    for (let x = 0; x <= 3; x++) points[z][x] = new THREE.Vector2(
      (x / 3 - 0.5) * size + (x > 0 && x < 3 ? Math.sin(x * 5 + z * 3) * 0.3 : 0),
      (z / 3 - 0.5) * size + (z > 0 && z < 3 ? Math.cos(x * 4 + z * 7) * 0.3 : 0));
  }
  for (let z = 0; z < 3; z++) for (let x = 0; x < 3; x++) {
    const polygon = [points[z][x], points[z][x + 1], points[z + 1][x + 1], points[z + 1][x]];
    const center = polygon.reduce((sum, point) => sum.add(point), new THREE.Vector2()).multiplyScalar(0.25);
    const geometry = new THREE.ExtrudeGeometry(new THREE.Shape(polygon), { depth: 0.45, bevelEnabled: false, steps: 1 });
    geometry.rotateX(Math.PI / 2); geometry.translate(-center.x, 0.225, -center.y);
    pieces.push({ geometry, x: center.x, z: center.y });
    for (let n = 0; n < 4; n++) {
      const a = polygon[n], b = polygon[(n + 1) % 4];
      edges.push(a.x, 0.24, a.y, b.x, 0.24, b.y);
    }
  }
  const cracks = new THREE.BufferGeometry(); cracks.setAttribute('position', new THREE.Float32BufferAttribute(edges, 3));
  return { pieces, cracks };
}
