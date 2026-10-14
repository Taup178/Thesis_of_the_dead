import * as THREE from 'three';
import { SOPHOMORE_LAYOUT as layout } from './SophomoreLayout.js';

const STEEL = 0x313b40;
const WARNING = 0xf0a64b;

function brushedSteelMap() {
  const size = 128, pixels = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const grain = ((Math.imul(x + 19, 73856093) ^ Math.imul(y + 7, 19349663)) >>> 0) % 19;
    const streak = Math.sin(y * 1.4) * 8 + Math.sin(y * 0.19) * 5;
    const value = Math.max(0, Math.min(255, Math.round(167 + grain - 9 + streak)));
    pixels.set([value, value, value, 255], (y * size + x) * 4);
  }
  const texture = new THREE.DataTexture(pixels, size, size);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

function sawBladeGeometry() {
  const shape = new THREE.Shape();
  const count = 24, step = Math.PI * 2 / count;
  for (let n = 0; n < count; n++) {
    const angle = n * step;
    for (const [offset, radius] of [[0, 1.39], [0.13, 1.55], [0.4, 1.64], [0.86, 1.4]]) {
      const a = angle + offset * step;
      const x = Math.cos(a) * radius, y = Math.sin(a) * radius;
      if (n === 0 && offset === 0) shape.moveTo(x, y);
      else shape.lineTo(x, y);
    }
  }
  shape.closePath();
  for (let n = 0; n < 8; n++) {
    const a = n * Math.PI / 4;
    const vent = new THREE.Path();
    vent.absarc(Math.cos(a) * 0.98, Math.sin(a) * 0.98, 0.105, 0, Math.PI * 2, true);
    shape.holes.push(vent);
  }
  const axleHole = new THREE.Path();
  axleHole.absarc(0, 0, 0.2, 0, Math.PI * 2, true);
  shape.holes.push(axleHole);
  return new THREE.ExtrudeGeometry(shape, { depth: 0.12, bevelEnabled: true,
    bevelThickness: 0.012, bevelSize: 0.014, bevelSegments: 1, curveSegments: 12 });
}

/** Shared sweep timing lets the Dean predict the same blade positions the player sees. */
export function getSophomoreBladeX(blade, time) {
  return Math.sin(time * 1.75 + blade.phase) * 4.25;
}

/** The two physical chase challenges before the memory room. */
export function createSophomoreGauntlet(level) {
  const mesh = (geometry, material, x, y, z) => level._mesh(geometry, material, x, y, z);
  const floor = level.floors.material;
  const steel = new THREE.MeshStandardMaterial({ color: STEEL, metalness: 0.72, roughness: 0.38 });
  const grain = brushedSteelMap();
  const bladeMetal = new THREE.MeshStandardMaterial({ color: 0xb9bfba, metalness: 0.54, roughness: 0.43,
    bumpMap: grain, bumpScale: 0.025,
    side: THREE.DoubleSide });
  const warning = new THREE.MeshStandardMaterial({ color: 0x9b7744, roughness: 0.8, metalness: 0.12 });
  const deck = (z, length, name) => {
    const slab = mesh(level.floors.mapGeometry(new THREE.BoxGeometry(layout.deckWidth, 0.7, length), 0, z), floor, 0, -0.35, z);
    slab.name = name;
    return { minX: -layout.deckWidth / 2, maxX: layout.deckWidth / 2, minZ: z - length / 2, maxZ: z + length / 2, y: 0, tile: null };
  };
  level.bladeSurface = deck((layout.frontZ + layout.bladeDeckMinZ) / 2, layout.frontZ - layout.bladeDeckMinZ, 'SlicingDiskCorridor');
  for (const z of [layout.bridgeMaxZ, layout.bridgeMinZ]) {
    mesh(new THREE.BoxGeometry(14.5, 0.3, 0.35), steel, 0, -0.05, z);
  }
  // Suspended saw carriages run on overhead rails. Guards cover the upper teeth,
  // while cut vents and a real axle keep the disks legible as machinery.
  level.blades = [];
  const bladeGeometry = sawBladeGeometry();
  const guardMaterial = new THREE.MeshStandardMaterial({ color: 0x4f5a5b, metalness: 0.57, roughness: 0.55 });
  for (let n = 0; n < layout.bladeCount; n++) {
    const z = layout.firstBladeZ - n * layout.bladeSpacing;
    const rail = mesh(new THREE.BoxGeometry(18.5, 0.28, 0.5), steel, 0, 4.1, z - 0.38);
    rail.name = `SawRail_${n + 1}`;
    for (const x of [-9.25, 9.25]) mesh(new THREE.BoxGeometry(0.45, 1.7, 0.7), steel, x, 3.3, z - 0.38);
    const wheel = new THREE.Group();
    wheel.name = `SweepingSaw_${n + 1}`;
    wheel.position.set(level.puzzleIndex === 0 ? 0 : 8.35, 1.55, z);
    level.root.add(wheel);
    const rotor = new THREE.Mesh(bladeGeometry, bladeMetal);
    rotor.position.z = 0.14;
    rotor.castShadow = rotor.receiveShadow = true;
    wheel.add(rotor);
    const machinedRing = new THREE.Mesh(new THREE.TorusGeometry(0.67, 0.022, 6, 48), guardMaterial);
    machinedRing.position.z = 0.29;
    rotor.add(machinedRing);
    const axle = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.19, 0.66, 16), steel);
    axle.rotation.x = Math.PI / 2;
    axle.position.z = -0.27;
    wheel.add(axle);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.13, 16), guardMaterial);
    cap.rotation.x = Math.PI / 2;
    cap.position.z = 0.36;
    rotor.add(cap);
    for (let boltIndex = 0; boltIndex < 6; boltIndex++) {
      const angle = boltIndex * Math.PI / 3;
      const bolt = new THREE.Mesh(new THREE.CylinderGeometry(0.038, 0.038, 0.028, 6), steel);
      bolt.rotation.x = Math.PI / 2;
      bolt.position.set(Math.cos(angle) * 0.245, Math.sin(angle) * 0.245, 0.435);
      rotor.add(bolt);
    }
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.24, 2.4, 0.29), steel);
    arm.position.set(0, 1.2, -0.39);
    wheel.add(arm);
    const carriage = new THREE.Mesh(new THREE.BoxGeometry(1, 0.47, 0.83), guardMaterial);
    carriage.position.set(0, 2.48, -0.38);
    wheel.add(carriage);
    const guard = new THREE.Mesh(new THREE.TorusGeometry(1.57, 0.105, 8, 30, Math.PI), guardMaterial);
    guard.position.z = 0.25;
    wheel.add(guard);
    mesh(new THREE.BoxGeometry(12.4, 0.035, 0.18), warning, 0, 0.025, z);
    level.blades.push({ wheel, rotor, z, phase: n * 1.8, hitCooldown: 0 });
  }
  // Six independently oscillating platforms bridge an open, lethal spike pit.
  level.bridgePlatforms = [];
  for (let n = 0; n < layout.bridgeCount; n++) {
    const z = layout.bridgeFirstZ - n * layout.bridgeSpacing;
    const platform = mesh(level.floors.mapGeometry(new THREE.BoxGeometry(5.5, 0.65, 4.1), 0, z), floor, 0, -0.325, z);
    platform.name = `MovingBridge_${n + 1}`;
    const edge = new THREE.Mesh(new THREE.BoxGeometry(5.5, 0.08, 0.12), warning);
    edge.position.set(0, 0.04, -1.95); platform.add(edge);
    const surface = { minX: -2.75, maxX: 2.75, minZ: z - 2.05,
      maxZ: z + 2.05, y: 0, tile: null, bridge: n };
    level.bridgePlatforms.push({ platform, surface, phase: n * 1.65 });
  }
}

export function updateSophomoreGauntlet(level, dt, player) {
  level.gauntletTime = (level.gauntletTime || 0) + dt;
  for (const blade of level.blades || []) {
    if (level.puzzleIndex === 0) {
      blade.wheel.position.x = getSophomoreBladeX(blade, level.gauntletTime);
      blade.rotor.rotation.z -= dt * 11;
    } else {
      blade.wheel.position.x = THREE.MathUtils.damp(blade.wheel.position.x, 8.35, 5, dt);
      blade.rotor.rotation.z -= dt * 1.2;
    }
    blade.hitCooldown = Math.max(0, blade.hitCooldown - dt);
    if (!['chase', 'dean_challenge'].includes(level.phase) || level.puzzleIndex !== 0 || !player.alive) continue;
    const position = player.group.position;
    if (blade.hitCooldown === 0 && Math.abs(position.z - blade.z) < 0.66 &&
        Math.abs(position.x - blade.wheel.position.x) < 1.55 && position.y < 2.7 && !player.isDodging) {
      player.takeDamage(28);
      blade.hitCooldown = 1;
      if (player.alive) {
        position.z = blade.z + 1.65;
        player.velocity.z = 0;
      }
    }
  }
  for (const bridge of level.bridgePlatforms || []) {
    const oldX = bridge.platform.position.x;
    const x = Math.sin(level.gauntletTime * 1.25 + bridge.phase) * 2;
    bridge.platform.position.x = x;
    bridge.surface.minX = x - 2.75;
    bridge.surface.maxX = x + 2.75;
    if (player.platformSupport === bridge.surface && player.grounded) {
      player.group.position.x += x - oldX;
      player._updateCamera();
    }
  }
}
