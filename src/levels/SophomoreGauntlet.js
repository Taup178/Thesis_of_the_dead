import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { SOPHOMORE_LAYOUT as layout } from './SophomoreLayout.js';

const STEEL = 0x313b40;
const WARNING = 0xf0a64b;
const SPARKS_PER_BLADE = 8;

function createFloorSparks(level) {
  const count = level.blades.length * SPARKS_PER_BLADE;
  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  const opacity = new Float32Array(count);
  const emitters = [];
  const ember = new THREE.Color();

  for (let bladeIndex = 0; bladeIndex < level.blades.length; bladeIndex++) {
    for (let sparkIndex = 0; sparkIndex < SPARKS_PER_BLADE; sparkIndex++) {
      const index = bladeIndex * SPARKS_PER_BLADE + sparkIndex;
      const phase = (bladeIndex * 0.618 + sparkIndex * 0.381) % 1;
      const warm = 0.5 + 0.5 * Math.sin(index * 17.31);
      ember.setRGB(1, 0.22 + warm * 0.58, 0.025 + warm * 0.08);
      colors.set([ember.r, ember.g, ember.b], index * 3);
      sizes[index] = 0.48 + warm * 0.36;
      emitters.push({ bladeIndex, phase, direction: sparkIndex % 2 ? 1 : -1,
        height: 0.11 + warm * 0.2, zOffset: (warm - 0.5) * 0.34 });
    }
  }

  const positionAttribute = new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage);
  const opacityAttribute = new THREE.BufferAttribute(opacity, 1).setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('position', positionAttribute);
  geometry.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
  geometry.setAttribute('aOpacity', opacityAttribute);
  const material = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: `attribute vec3 aColor; attribute float aSize; attribute float aOpacity;
      varying vec3 vColor; varying float vOpacity;
      void main(){ vec4 viewPosition=modelViewMatrix*vec4(position,1.0);
        gl_Position=projectionMatrix*viewPosition;
        gl_PointSize=clamp(aSize*300.0/max(1.0,-viewPosition.z),2.0,16.0);
        vColor=aColor; vOpacity=aOpacity; }`,
    fragmentShader: `varying vec3 vColor; varying float vOpacity;
      void main(){ float r=length(gl_PointCoord-vec2(0.5));
        float core=1.0-smoothstep(0.06,0.28,r); float glow=exp(-r*r*18.0);
        float alpha=(core*0.78+glow*0.3)*vOpacity;
        gl_FragColor=vec4(vColor,alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const points = new THREE.Points(geometry, material);
  points.name = 'SawFloorSparks'; points.frustumCulled = false; points.renderOrder = 2;
  level.root.add(points);
  level.floorSparks = { points, positions, opacity, emitters, time: 0 };
}

function updateFloorSparks(level, dt) {
  const sparks = level.floorSparks;
  if (!sparks) return;
  sparks.time += dt;
  for (let i = 0; i < sparks.emitters.length; i++) {
    const emitter = sparks.emitters[i];
    const blade = level.blades[emitter.bladeIndex];
    const age = (sparks.time * 1.65 + emitter.phase) % 1;
    const flight = Math.min(age / 0.76, 1);
    const alpha = age < 0.76 ? Math.sin(Math.PI * flight) : 0;
    const offset = i * 3;
    sparks.positions[offset] = blade.wheel.position.x + emitter.direction * (0.12 + flight * 1.05);
    sparks.positions[offset + 1] = 0.06 + Math.sin(Math.PI * flight) * emitter.height;
    sparks.positions[offset + 2] = blade.z + 0.16 + emitter.zOffset + flight * emitter.direction * 0.18;
    sparks.opacity[i] = alpha;
  }
  sparks.points.geometry.attributes.position.needsUpdate = true;
  sparks.points.geometry.attributes.aOpacity.needsUpdate = true;
}

/** Shared sweep timing lets the Dean predict the same blade positions the player sees. */
export function getSophomoreBladeX(blade, time) {
  return Math.sin(time * 2.8 + blade.phase) * 4.25;
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
  createFloorSparks(level);
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
        model.scale.setScalar(scale);
        model.position.set(-center.x * scale, -center.y * scale, -center.z * scale);
        model.traverse(child => {
          if (!child.isMesh) return;
          child.castShadow = child.receiveShadow = true;
          child.frustumCulled = false;
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
  for (const blade of level.blades || []) {
    if (level.puzzleIndex === 0) {
      blade.wheel.position.x = getSophomoreBladeX(blade, level.gauntletTime);
      blade.rotor.rotation.z -= dt * 18;
    } else {
      blade.wheel.position.x = THREE.MathUtils.damp(blade.wheel.position.x, 8.35, 5, dt);
      blade.rotor.rotation.z -= dt * 1.2;
    }
    blade.hitCooldown = Math.max(0, blade.hitCooldown - dt);
    if (!['chase', 'dean_challenge'].includes(level.phase) || level.puzzleIndex !== 0 || !player.alive) continue;
    const position = player.group.position;
    if (blade.hitCooldown === 0 && Math.abs(position.z - blade.z) < 0.66 &&
        Math.abs(position.x - blade.wheel.position.x) < 1.55 && position.y < 2.7 && !player.isDodging) {
      player.takeDamage(player.health);
      blade.hitCooldown = 1;
      if (player.alive) {
        position.z = blade.z + 1.65;
        player.velocity.z = 0;
      }
    }
  }
  updateFloorSparks(level, dt);
  for (const bridge of level.bridgePlatforms || []) {
    const oldX = bridge.platform.position.x;
    const x = Math.sin(level.gauntletTime * 1.5 + bridge.phase) * 2.6;
    bridge.platform.position.x = x;
    bridge.surface.minX = x - 2.75;
    bridge.surface.maxX = x + 2.75;
    if (player.platformSupport === bridge.surface && player.grounded) {
      player.group.position.x += x - oldX;
      player._updateCamera();
    }
  }
}
