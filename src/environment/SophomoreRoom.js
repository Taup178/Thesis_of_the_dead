import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { SkullWalls } from './SkullWalls.js';
import { DungeonTorches } from './DungeonTorches.js';
import { StoneFloors } from './StoneFloors.js';
import { SpikeTrapPit } from './SpikeTrapPit.js';
import { SOPHOMORE_LAYOUT as layout } from '../levels/SophomoreLayout.js';

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
  // Checkpoints change the spawn, never the room's physical boundaries.
  const backZ = final.z - 12, frontZ = layout.frontZ;
  const length = frontZ - backZ, center = (frontZ + backZ) / 2;
  const mesh = (geometry, material, x, y, z) => level._mesh(geometry, material, x, y, z);
  const map = concreteMap();
  const darkConcrete = new THREE.MeshStandardMaterial({ color: 0x555451, map, bumpMap: map, bumpScale: 0.055, roughness: 0.94 });
  const steel = new THREE.MeshStandardMaterial({ color: 0x343d41, metalness: 0.7, roughness: 0.58 });
  const trim = new THREE.MeshStandardMaterial({ color: 0x787e7c, metalness: 0.65, roughness: 0.48 });
  level.floors = new StoneFloors();
  level.tileMaterial = level.floors.material;
  level.tileTrimMaterial = steel;
  level.scene.background = new THREE.Color(0x0c0a08);
  level.scene.fog = new THREE.FogExp2(0x0c0a08, 0.009);
  // A faint warm bounce approximates indirect torchlight; direct light comes from the flames.
  level.root.add(new THREE.AmbientLight(0xe9b27b, 0.045));
  level.walls = new SkullWalls(level.root, backZ, frontZ);
  level.torches = new DungeonTorches(level.root, backZ, frontZ);
  level.localLights = level.torches.lights;
  mesh(level.floors.mapGeometry(new THREE.BoxGeometry(20, 0.5, length), 0, center), level.floors.material, 0, -12, center);
  level.spikePit = new SpikeTrapPit(level.root, backZ, frontZ);
  level.spikeTipY = level.spikePit.tipY;
  const ceiling = mesh(scaleUV(new THREE.BoxGeometry(20, 0.5, length), 4, length / 5), darkConcrete, 0, 15, center);
  ceiling.castShadow = false;
  for (let z = 3; z > backZ; z -= 12) {
    mesh(new THREE.BoxGeometry(19.4, 0.55, 0.65), steel, 0, 10.5, z);
    // Recessed ceiling panels break up the long empty box without hiding the Dean.
    mesh(new THREE.BoxGeometry(5.5, 0.16, 2.8), steel, 0, 14.5, z - 3);
  }
  const width = layout.deckWidth;
  // Safe memory entrance, with room behind the player for the third-person camera.
  const startMinZ = -level.tileSize / 2, startMaxZ = layout.memoryDeckMaxZ;
  const startCenter = (startMinZ + startMaxZ) / 2;
  level.startPlatform = mesh(level.floors.mapGeometry(new RoundedBoxGeometry(width, 0.7, startMaxZ - startMinZ, 2, 0.08), 0, startCenter), level.floors.material, 0, -0.35, startCenter);
  level.startPlatform.name = 'ArrivalPlatform';
  level.startSurface = { minX: -width / 2, maxX: width / 2, minZ: startMinZ, maxZ: startMaxZ, y: 0, tile: null };
  const entryCenter = (layout.spikeCorridorMaxZ + layout.spikeEntryMaxZ) / 2;
  level.bridgeExitDeck = mesh(level.floors.mapGeometry(new RoundedBoxGeometry(width, 0.7,
    layout.spikeEntryMaxZ - layout.spikeCorridorMaxZ, 2, 0.08), 0, entryCenter), level.floors.material, 0, -0.35, entryCenter);
  level.bridgeExitDeck.name = 'SpikeEntranceLanding';
  level.bridgeExitSurface = { minX: -width / 2, maxX: width / 2, minZ: layout.spikeCorridorMaxZ,
    maxZ: layout.spikeEntryMaxZ, y: 0, tile: null };
  level.entrancePosition = new THREE.Vector3(0, 0, layout.entrancePortalZ);
  const minZ = final.z - 9.5, maxZ = final.z - level.tileSize / 2;
  const exitCenter = (minZ + maxZ) / 2;
  level.exitDeck = mesh(level.floors.mapGeometry(new RoundedBoxGeometry(width, 0.8, maxZ - minZ, 2, 0.08), 0, exitCenter), level.floors.material, 0, -0.4, exitCenter);
  level.exitDeck.name = 'PortalLanding';
  level.exitSurface = { minX: -width / 2, maxX: width / 2, minZ, maxZ, y: 0, tile: null };
  level.exitPosition = new THREE.Vector3(final.x, 0, final.z - 7.2);
  level.portalApproachPoint = new THREE.Vector3(final.x, 0, final.z - 4.7);
  // Guard rails belong to the safe landing, leaving the tiles and entrance clear.
  for (const x of [-width / 2 + 0.15, width / 2 - 0.15]) {
    for (const z of [minZ + 0.2, maxZ - 0.5]) mesh(new THREE.BoxGeometry(0.09, 1.05, 0.09), trim, x, 0.525, z);
    mesh(new THREE.BoxGeometry(0.09, 0.09, maxZ - minZ - 0.7), trim, x, 1.05, (minZ + maxZ - 0.3) / 2);
  }
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
