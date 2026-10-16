import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { SOPHOMORE_LAYOUT as layout } from './SophomoreLayout.js';
import { SawFloorSparks } from '../environment/SawFloorSparks.js';
import { stainSawBlade } from '../environment/BloodSplatter.js';

const STEEL = 0x313b40;
const WARNING = 0xf0a64b;
const SWEEP_SPEED = 3.15;
const SPIN_SPEED = 20.5;

/** Shared sweep timing lets the Dean predict the same blade positions the player sees. */
export function getSophomoreBladeX(blade, time) {
  return Math.sin(time * SWEEP_SPEED + blade.phase) * 4.25;
}

/** Sweep both movements so sprinting or a slow frame cannot skip the thin disk. */
export function getSophomoreSawContact(blade, previous, position, oldBladeX) {
  // Preserve the original first-touch envelope around the visible saw.
  // The narrower disk-plane check let the blade enter the character before killing.
  const axes = [
    [previous.x - oldBladeX, position.x - previous.x - (blade.wheel.position.x - oldBladeX), -1.55, 1.55],
    [previous.z - blade.z, position.z - previous.z, -0.66, 0.66],
    [previous.y, position.y - previous.y, -Infinity, 2.7],
  ];
  let enter = 0, exit = 1;
  for (const [start, movement, min, max] of axes) {
    if (Math.abs(movement) < 1e-8) {
      if (start < min || start > max) return null;
      continue;
    }
    const a = (min - start) / movement, b = (max - start) / movement;
    enter = Math.max(enter, Math.min(a, b)); exit = Math.min(exit, Math.max(a, b));
    if (enter > exit) return null;
  }
  const contact = previous.clone().lerp(position, enter);
  const y = THREE.MathUtils.clamp(blade.wheel.position.y, contact.y + 0.25, contact.y + 1.55);
  return { position: contact, point: new THREE.Vector3(contact.x, y, blade.z + blade.rotor.position.z) };
}

/** The two physical chase challenges before the memory room. */
export function createSophomoreGauntlet(level) {
  const mesh = (geometry, material, x, y, z) => level._mesh(geometry, material, x, y, z);
  const floor = level.floors.material;
  const steel = new THREE.MeshStandardMaterial({ color: STEEL, metalness: 0.72, roughness: 0.38 });
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
  // Suspended saw carriages run on overhead rails with the kit's detailed blades.
  level.blades = [];
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
    const rotor = new THREE.Group();
    rotor.position.z = 0.14;
    wheel.add(rotor);
    const axle = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.19, 0.66, 16), steel);
    axle.rotation.x = Math.PI / 2;
    axle.position.z = -0.27;
    wheel.add(axle);
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
  level.floorSparks = new SawFloorSparks(level);
  // Normalize the transformed kit model to the old blade diameter. The GLTF
  // has an internal root transform, so its accessor dimensions are not its
  // rendered dimensions.
  level.sawBladeReady = new GLTFLoader().loadAsync('./assets/models/circular-saw-blade/scene.gltf')
    .then(({ scene }) => {
      for (const blade of level.blades) {
        const model = scene.clone(true);
        // The Sketchfab scene has a small baked-in X tilt. Cancel it so the
        // disc sits square to the holder and spins on the holder's axle.
        const assetRoot = model.children[0];
        model.rotation.x = -(assetRoot?.rotation.x || 0);
        model.updateMatrixWorld(true);
        const bounds = new THREE.Box3().setFromObject(model);
        const size = bounds.getSize(new THREE.Vector3());
        const center = bounds.getCenter(new THREE.Vector3());
        const scale = 3.25 / Math.max(size.x, size.y);
        blade.sparkRadius = Math.max(size.x, size.y) * scale / 2;
        blade.bloodDepth = size.z * scale;
        blade.model = model;
        model.scale.setScalar(scale);
        model.position.set(-center.x * scale, -center.y * scale, -center.z * scale);
        model.traverse(child => {
          if (!child.isMesh) return;
          child.castShadow = child.receiveShadow = true;
          child.frustumCulled = true;
          child.geometry.computeBoundingSphere();
          for (const material of Array.isArray(child.material) ? child.material : [child.material]) {
            material.side = THREE.DoubleSide;
            if (material.color) material.color.setHex(0xc3c9c9);
            if (material.isMeshStandardMaterial) {
              material.metalness = 0.42;
              material.roughness = 0.42;
              material.emissive?.setHex(0x171b1c);
              material.emissiveIntensity = 0.2;
            }
            material.needsUpdate = true;
          }
        });
        blade.rotor.add(model);
      }
    });
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
  return level.sawBladeReady;
}

export function updateSophomoreGauntlet(level, dt, player) {
  level.gauntletTime = (level.gauntletTime || 0) + dt;
  const previous = level.previousGauntletPosition || player.group.position.clone().addScaledVector(player.velocity, -dt);
  const current = player.group.position.clone();
  level.previousGauntletPosition = current;
  for (const blade of level.blades || []) {
    const oldX = blade.wheel.position.x;
    if (level.puzzleIndex === 0) {
      blade.wheel.position.x = getSophomoreBladeX(blade, level.gauntletTime);
      blade.rotor.rotation.z -= dt * SPIN_SPEED;
    } else {
      blade.wheel.position.x = THREE.MathUtils.damp(blade.wheel.position.x, 8.35, 5, dt);
      blade.rotor.rotation.z -= dt * 1.2;
    }
    blade.hitCooldown = Math.max(0, blade.hitCooldown - dt);
    if (!['chase', 'dean_challenge'].includes(level.phase) || level.puzzleIndex !== 0 || !player.alive) continue;
    const position = player.group.position;
    const contact = blade.hitCooldown === 0 && !player.isDodging
      ? getSophomoreSawContact(blade, previous, current, oldX) : null;
    if (contact) {
      position.copy(contact.position);
      player.takeDamage(player.health, { type: 'saw', cutNormal: new THREE.Vector3(0, 0, 1),
        point: contact.point,
        // Finish the cut through the body when its outer edge first meets the teeth.
        cutPoint: player.characterModel?.getObjectByName('Torso')?.getWorldPosition(new THREE.Vector3())
          ?? position.clone().add(new THREE.Vector3(0, 1, 0)),
        direction: new THREE.Vector3(Math.sign(blade.wheel.position.x - oldX) || 1, 0, 0),
        bladeVelocity: dt > 0 ? (blade.wheel.position.x - oldX) / dt : 0 });
      if (!player.alive) stainSawBlade(blade, contact.point);
      level.failureReason = 'You were caught by a saw blade. Time your run or roll through the sweep.';
      blade.hitCooldown = 1;
      if (player.alive) {
        position.z = blade.z + 1.65;
        player.velocity.z = 0;
      }
    }
  }
  level.floorSparks?.update(dt);
  for (const bridge of level.bridgePlatforms || []) {
    const oldX = bridge.platform.position.x;
    const x = Math.sin(level.gauntletTime * 1.5 + bridge.phase) * 2.6;
    bridge.platform.position.x = x;
    bridge.surface.minX = x - 2.75;
    bridge.surface.maxX = x + 2.75;
    if (player.alive && player.platformSupport === bridge.surface && player.grounded) {
      player.group.position.x += x - oldX;
      player._updateCamera();
    }
  }
}
