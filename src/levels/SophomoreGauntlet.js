import * as THREE from 'three';

const FLOOR = 0x4a5054;
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

/** The three physical chase challenges before the memory room. */
export function createSophomoreGauntlet(level) {
  const mesh = (geometry, material, x, y, z) => level._mesh(geometry, material, x, y, z);
  const floor = new THREE.MeshStandardMaterial({ color: FLOOR, roughness: 0.83, metalness: 0.16 });
  const steel = new THREE.MeshStandardMaterial({ color: STEEL, metalness: 0.72, roughness: 0.38 });
  const grain = brushedSteelMap();
  const bladeMetal = new THREE.MeshStandardMaterial({ color: 0xb9bfba, metalness: 0.54, roughness: 0.43,
    bumpMap: grain, bumpScale: 0.025, emissive: 0x222a2b, emissiveIntensity: 0.15,
    side: THREE.DoubleSide });
  const warning = new THREE.MeshStandardMaterial({ color: 0x9b7744, roughness: 0.8, metalness: 0.12 });
  const deck = (z, length, name) => {
    const slab = mesh(new THREE.BoxGeometry(14, 0.7, length), floor, 0, -0.35, z);
    slab.name = name;
    return { minX: -7, maxX: 7, minZ: z - length / 2, maxZ: z + length / 2, y: 0, tile: null };
  };
  level.bladeSurface = deck(74.5, 41, 'SlicingDiskCorridor'); // z 54..95
  level.runeSurface = deck(21.75, 24.5, 'RuneDeck'); // z 9.5..34
  for (const z of [54, 34]) {
    mesh(new THREE.BoxGeometry(14.5, 0.3, 0.35), steel, 0, -0.05, z);
  }
  // Suspended saw carriages run on overhead rails. Guards cover the upper teeth,
  // while cut vents and a real axle keep the disks legible as machinery.
  level.blades = [];
  const bladeGeometry = sawBladeGeometry();
  const guardMaterial = new THREE.MeshStandardMaterial({ color: 0x4f5a5b, metalness: 0.57, roughness: 0.55 });
  for (let n = 0; n < 4; n++) {
    const z = 75 - n * 6;
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
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.12, 0.26),
      new THREE.MeshStandardMaterial({ color: 0xd5d9ca, emissive: 0xc5ccb6, emissiveIntensity: 0.6 }));
    lamp.position.set(0, 2.18, 0.32);
    wheel.add(lamp);
    const workLight = new THREE.PointLight(0xd3dbd4, 42, 7, 2);
    workLight.position.set(0, 2.04, 1.35);
    wheel.add(workLight);
    mesh(new THREE.BoxGeometry(12.4, 0.035, 0.18), warning, 0, 0.025, z);
    level.blades.push({ wheel, rotor, z, phase: n * 1.8, hitCooldown: 0 });
  }
  // Three independently oscillating platforms bridge a real opening over spikes.
  level.bridgePlatforms = [];
  level.bridgeCatchSurface = { minX: -9.2, maxX: 9.2, minZ: 34, maxZ: 54,
    y: -3.8, tile: null, bridgeCatch: true };
  const net = mesh(new THREE.BoxGeometry(18.4, 0.06, 20),
    new THREE.MeshStandardMaterial({ color: 0x4b5555, metalness: 0.52, roughness: 0.72,
      transparent: true, opacity: 0.18, depthWrite: false }), 0, -3.85, 44);
  net.name = 'BridgeMaintenanceGrate';
  net.castShadow = false;
  const grate = new THREE.MeshStandardMaterial({ color: 0x56605f, metalness: 0.56, roughness: 0.68 });
  for (let z = 34.5; z < 54; z += 1) {
    const bar = mesh(new THREE.BoxGeometry(18.3, 0.065, 0.075), grate, 0, -3.79, z);
    bar.castShadow = false;
  }
  for (let x = -9; x < 9.2; x += 1.5) {
    const bar = mesh(new THREE.BoxGeometry(0.075, 0.065, 19.8), grate, x, -3.79, 44);
    bar.castShadow = false;
  }
  for (let n = 0; n < 3; n++) {
    const z = 49.5 - n * 5.2;
    const platform = mesh(new THREE.BoxGeometry(5.5, 0.65, 4.1), floor, 0, -0.325, z);
    platform.name = `MovingBridge_${n + 1}`;
    mesh(new THREE.BoxGeometry(0.9, 0.24, 0.9), steel, 0, 4.55, z);
    const bridgeLamp = mesh(new THREE.BoxGeometry(0.65, 0.08, 0.65),
      new THREE.MeshStandardMaterial({ color: 0xc8c5af, emissive: 0xbab7a2, emissiveIntensity: 0.6 }),
      0, 4.39, z);
    bridgeLamp.castShadow = false;
    const bridgeLight = new THREE.PointLight(0xc9d3ca, 58, 9, 2);
    bridgeLight.position.set(0, 4.23, z);
    level.root.add(bridgeLight);
    mesh(new THREE.BoxGeometry(14, 0.16, 0.25), steel, 0, -0.45, z);
    const edge = new THREE.Mesh(new THREE.BoxGeometry(5.5, 0.08, 0.12), warning);
    edge.position.set(0, 0.04, -1.95); platform.add(edge);
    const surface = { minX: -2.75, maxX: 2.75, minZ: z - 2.05,
      maxZ: z + 2.05, y: 0, tile: null, bridge: n };
    level.bridgePlatforms.push({ platform, surface, phase: n * 1.65 });
  }
  // The lit path is legible from the entrance to this section and must be
  // crossed in order. The safe lane changes on each row.
  const lanes = [-4.5, 0, 4.5];
  const order = [0, 2, 1];
  level.runeOrder = order;
  level.runePads = [];
  for (let row = 0; row < 3; row++) {
    const z = 29.5 - row * 6.5;
    const pads = [];
    for (let lane = 0; lane < 3; lane++) {
      const safe = lane === order[row];
      const material = new THREE.MeshStandardMaterial({ color: safe ? 0x22795b : 0x735746,
        emissive: safe ? 0x28d99e : 0xa66236, emissiveIntensity: safe ? 0.9 : 0.3,
        metalness: 0.55, roughness: 0.35 });
      const pad = mesh(new THREE.BoxGeometry(4.16, 0.06, 2.7), material, lanes[lane], 0.035, z);
      pad.name = `Rune_${row + 1}_${lane + 1}`;
      pads.push(pad);
    }
    level.runePads.push({ z, pads });
  }
  for (const [label, z] of [['DODGE THE BLADES', 78], ['TIME THE BRIDGE', 53], ['FOLLOW THE GREEN RUNES', 33]]) {
    level._label(label, 4.8, 0.5, 0, 0.05, z);
  }
}

export function updateSophomoreGauntlet(level, dt, player) {
  level.gauntletTime = (level.gauntletTime || 0) + dt;
  for (const blade of level.blades || []) {
    if (level.puzzleIndex === 0) {
      blade.wheel.position.x = Math.sin(level.gauntletTime * 1.75 + blade.phase) * 4.25;
      blade.rotor.rotation.z -= dt * 11;
    } else {
      blade.wheel.position.x = THREE.MathUtils.damp(blade.wheel.position.x, 8.35, 5, dt);
      blade.rotor.rotation.z -= dt * 1.2;
    }
    blade.hitCooldown = Math.max(0, blade.hitCooldown - dt);
    if (level.phase !== 'chase' || level.puzzleIndex !== 0 || !player.alive) continue;
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
