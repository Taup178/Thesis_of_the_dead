import * as THREE from 'three';
import {
  createCreditCoreMaterial,
  createCreditHaloMaterial,
  createCreditSparkMaterial,
  createCreditFinaleMaterial,
  createCreditColumnMaterial
} from '../shaders/CreditCoreShader.js';

const BURST_PARTICLES = 18;  // per pickup
const BURST_POOL = BURST_PARTICLES * 8;
const BURST_LIFE = 0.9;
const TRAIL_MOTES = 6;       // per pickup
const TRAIL_POOL = TRAIL_MOTES * 8;
const TRAIL_LIFE = 0.7;
const RUNES_PER_CREDIT = 3;
const FINALE_DURATION = 1.15;

/**
 * Academic Credit Energy System (Level 1).
 * Owns every visual resource of the credit collectibles: the energy core
 * material, orbiting seal-mark halos, rune satellites, pickup burst and
 * trail particles, and the eighth-credit finale. Particle pools are bounded
 * and pre-allocated; update() is driven from Level1.update so all motion
 * freezes while the game is paused.
 */
export class CreditEnergyEffects {
  constructor(scene) {
    this.scene = scene;
    this.disposed = false;
    this.time = 0;
    this.credits = null;
    this.burstCursor = 0;
    this.trailCursor = 0;
    this.burstLive = 0;
    this.trailLive = 0;
    this.finale = null;

    this.root = new THREE.Group();
    this.root.name = 'CreditEnergyEffects';
    scene.add(this.root);

    this.coreGeometry = new THREE.SphereGeometry(0.3, 16, 10);
    this.coreMaterial = createCreditCoreMaterial();
    this.haloMaterial = createCreditHaloMaterial();
    this.sparkMaterial = createCreditSparkMaterial();
    this.haloRings = [];
    // Keep the scene's light count constant across pickups. Removing a light with
    // each orb forces Three.js to compile new lighting shaders for the whole woods.
    this.glowLight = new THREE.PointLight(0xffd700, 0, 5);
    this.root.add(this.glowLight);

    this.ringGeometry = new THREE.TorusGeometry(0.62, 0.02, 6, 32);
    this.outerRingGeometry = new THREE.TorusGeometry(0.78, 0.014, 6, 32);
    this.runeGeometry = new THREE.OctahedronGeometry(0.055, 0);
    this.runeMaterial = new THREE.MeshBasicMaterial({ color: 0xffd700 });
    this.runeCount = 0;
    this.runes = null;

    this.burst = this._createSparkPool(BURST_POOL, true);
    this.trail = this._createSparkPool(TRAIL_POOL, false);
    this.finaleUniforms = { shock: createCreditFinaleMaterial(), column: createCreditColumnMaterial() };
    this.shockwave = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.finaleUniforms.shock);
    this.shockwave.rotation.x = -Math.PI / 2;
    this.shockwave.scale.setScalar(15);
    this.shockwave.visible = false;
    this.shockwave.renderOrder = 12;
    this.shockwave.frustumCulled = false;
    this.column = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.85, 7, 20, 1, true), this.finaleUniforms.column);
    this.column.visible = false;
    this.column.renderOrder = 12;
    this.column.frustumCulled = false;
    this.flashLight = new THREE.PointLight(0xffd700, 0, 22, 2);
    this.root.add(this.shockwave, this.column, this.flashLight);

    // Scratch objects - reused every frame to avoid allocations.
    this.scratch = new THREE.Object3D();
    this.scratchVector = new THREE.Vector3();
    this.scratchVector2 = new THREE.Vector3();
  }

  /** A bounded particle pool sharing the additive spark material. */
  _createSparkPool(capacity, burst) {
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(capacity * 3);
    const life = new Float32Array(capacity);
    const seed = new Float32Array(capacity);
    const size = new Float32Array(capacity);
    for (let i = 0; i < capacity; i++) seed[i] = i * 0.6180339887;
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('sparkLife', new THREE.BufferAttribute(life, 1).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('sparkSeed', new THREE.BufferAttribute(seed, 1));
    geometry.setAttribute('sparkSize', new THREE.BufferAttribute(size, 1).setUsage(THREE.DynamicDrawUsage));
    const points = new THREE.Points(geometry, this.sparkMaterial);
    points.frustumCulled = false;
    points.renderOrder = 12;
    points.visible = false;
    this.root.add(points);
    return {
      points, geometry, capacity, burst,
      positions, life, size,
      velocities: new Float32Array(capacity * 3),
      births: new Float32Array(capacity).fill(-1)
    };
  }

  /** Builds the orb core mesh; positions and gameplay remain Level1's concern. */
  createCoreMesh() {
    return new THREE.Mesh(this.coreGeometry, this.coreMaterial);
  }

  /** Adds halos and satellites around every credit. Call once after credits exist. */
  attach(credits) {
    this.credits = credits;
    for (let i = 0; i < credits.length; i++) {
      const host = credits[i].mesh;
      const inner = new THREE.Mesh(this.ringGeometry, this.haloMaterial);
      inner.name = 'CreditHalo';
      inner.rotation.set(1.05 + i * 0.11, i * 0.7, 0);
      const outer = new THREE.Mesh(this.outerRingGeometry, this.haloMaterial);
      outer.name = 'CreditHalo';
      outer.rotation.set(-0.85 - i * 0.09, -i * 0.5, 0.4);
      host.add(inner, outer);
      this.haloRings.push({ ring: inner, rate: 0.55 + (i % 3) * 0.14 }, { ring: outer, rate: -0.4 - (i % 4) * 0.11 });
    }
    this.runeCount = credits.length * RUNES_PER_CREDIT;
    this.runes = new THREE.InstancedMesh(this.runeGeometry, this.runeMaterial, this.runeCount);
    this.runes.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.runes.frustumCulled = false;
    this.runes.renderOrder = 11;
    this.root.add(this.runes);
  }

  getWarmupObjects() {
    return [this.burst.points, this.trail.points, this.shockwave, this.column];
  }

  /** Spawns the pickup burst, trail toward Shaun, and the finale on the last credit. */
  onCollected(credit, player, isFinal) {
    if (this.disposed) return;
    const origin = credit.mesh.position;
    this.coreMaterial.uniforms.uBoost.value = 1;
    this._spawnSparkPool(this.burst, BURST_PARTICLES, origin, 0);
    this._spawnSparkPool(this.trail, TRAIL_MOTES, origin, 0.035);
    if (isFinal) {
      this.finale = { position: origin.clone(), time: 0 };
      this.shockwave.position.set(origin.x, Math.max(0.3, origin.y - 1.1), origin.z);
      this.column.position.set(origin.x, origin.y + 1.6, origin.z);
      this.flashLight.position.set(origin.x, origin.y + 0.6, origin.z);
    }
  }

  _spawnSparkPool(pool, count, origin, stagger) {
    for (let k = 0; k < count; k++) {
      const slot = pool.burst ? this.burstCursor++ % pool.capacity : this.trailCursor++ % pool.capacity;
      const index = slot * 3;
      pool.births[slot] = this.time + k * stagger;
      pool.positions[index] = origin.x + (Math.random() - 0.5) * 0.14;
      pool.positions[index + 1] = origin.y + (Math.random() - 0.5) * 0.14;
      pool.positions[index + 2] = origin.z + (Math.random() - 0.5) * 0.14;
      // Deterministic-looking spread from the slot index keeps bursts varied but bounded.
      const theta = slot * 2.39996 + Math.random() * 0.6;
      const pitch = Math.random() * 1.2 - 0.35;
      const speed = pool.burst ? 2.1 + Math.random() * 2.5 : 1.6 + Math.random() * 1.4;
      pool.velocities[index] = Math.cos(theta) * Math.cos(pitch) * speed;
      pool.velocities[index + 1] = Math.sin(pitch) * speed + (pool.burst ? 1.4 : 0.9);
      pool.velocities[index + 2] = Math.sin(theta) * Math.cos(pitch) * speed;
      pool.size[slot] = pool.burst ? 0.55 + Math.random() * 0.6 : 0.4 + Math.random() * 0.35;
      pool.life[slot] = 0;
    }
    pool.geometry.attributes.sparkSize.needsUpdate = true;
    pool.geometry.attributes.position.needsUpdate = true;
    if (pool.burst) this.burstLive += count; else this.trailLive += count;
  }

  update(dt, player) {
    if (this.disposed) return;
    this.time += dt;
    const time = this.time;
    const boost = this.coreMaterial.uniforms.uBoost;
    if (boost.value > 0) boost.value = Math.max(0, boost.value - dt * 1.8);
    this.haloMaterial.uniforms.uTime.value = time;

    let nearest = null, nearestDistance = Infinity;
    for (const credit of this.credits || []) {
      if (credit.collected) continue;
      const distance = player ? player.group.position.distanceToSquared(credit.mesh.position) : 0;
      if (distance < nearestDistance) { nearest = credit; nearestDistance = distance; }
    }
    if (nearest) this.glowLight.position.copy(nearest.mesh.position);
    // Zero intensity keeps the light in the renderer's layout even after the last orb.
    this.glowLight.intensity = nearest ? 0.75 + 0.35 * Math.sin(time * 3.1) + boost.value * 1.6 : 0;

    if (this.credits) {
      for (const entry of this.haloRings) {
        entry.ring.rotation.y += entry.rate * dt;
      }
      this._updateRunes(time);
    }

    this._updateSparkPool(this.burst, dt, player, this.burstLive > 0);
    this._updateSparkPool(this.trail, dt, player, this.trailLive > 0);
    this._updateFinale(dt, time);
  }

  _updateRunes(time) {
    const runes = this.runes;
    if (!runes) return;
    const object = this.scratch;
    let instance = 0;
    for (const credit of this.credits) {
      if (credit.collected) continue;
      const center = credit.mesh.position;
      for (let j = 0; j < RUNES_PER_CREDIT; j++, instance++) {
        const phase = instance * 2.39996;
        const speed = 1.15 + (j % 3) * 0.35;
        const angle = time * (j % 2 === 0 ? speed : -speed) + phase;
        object.position.set(
          center.x + Math.cos(angle) * 0.98,
          center.y + Math.sin(time * 1.35 + phase) * 0.32,
          center.z + Math.sin(angle) * 0.98
        );
        object.rotation.set(time * 1.9 + phase, time * 1.4, phase);
        object.scale.setScalar(0.85 + 0.25 * Math.sin(time * 4 + phase * 3));
        object.updateMatrix();
        runes.setMatrixAt(instance, object.matrix);
      }
    }
    runes.count = instance;
    runes.visible = instance > 0;
    if (instance > 0) runes.instanceMatrix.needsUpdate = true;
  }

  _updateSparkPool(pool, dt, player, active) {
    pool.points.visible = active;
    if (!active) return;
    const { capacity, positions, velocities, births, life, size } = pool;
    const target = this.scratchVector;
    const direction = this.scratchVector2;
    if (!pool.burst && player) target.copy(player.group.position);
    let live = 0;
    for (let slot = 0; slot < capacity; slot++) {
      const age = this.time - births[slot];
      if (age < 0 || age > (pool.burst ? BURST_LIFE : TRAIL_LIFE)) {
        if (life[slot] !== 0) life[slot] = 0;
        continue;
      }
      live++;
      const index = slot * 3;
      const vy = velocities[index + 1];
      let distance = Infinity;
      if (pool.burst) {
        // Sparks decelerate, feel gravity, then gutter out.
        const drag = Math.max(0, 1 - 2.1 * dt);
        velocities[index] *= drag;
        velocities[index + 1] = vy * drag - 3.4 * dt;
        velocities[index + 2] *= drag;
        positions[index] += velocities[index] * dt;
        positions[index + 1] += velocities[index + 1] * dt;
        positions[index + 2] += velocities[index + 2] * dt;
      } else {
        // Trail motes stream toward Shaun and die as they reach him.
        direction.set(target.x - positions[index], target.y + 1.1 - positions[index + 1], target.z - positions[index + 2]);
        distance = direction.length();
        if (distance > 0.001) {
          direction.multiplyScalar(1 / distance);
          const pull = 10 + 16 * Math.min(1, age / TRAIL_LIFE);
          velocities[index] += (direction.x * pull - velocities[index]) * Math.min(1, 6 * dt);
          velocities[index + 1] += (direction.y * pull - vy) * Math.min(1, 6 * dt);
          velocities[index + 2] += (direction.z * pull - velocities[index + 2]) * Math.min(1, 6 * dt);
        }
        positions[index] += velocities[index] * dt;
        positions[index + 1] += velocities[index + 1] * dt;
        positions[index + 2] += velocities[index + 2] * dt;
      }
      const fade = 1 - age / (pool.burst ? BURST_LIFE : TRAIL_LIFE);
      life[slot] = Math.min(1, age * 14) * fade * fade;
      if (!pool.burst) life[slot] *= Math.min(1, distance / 0.35);
    }
    if (pool.burst) this.burstLive = live; else this.trailLive = live;
    pool.geometry.attributes.position.needsUpdate = true;
    pool.geometry.attributes.sparkLife.needsUpdate = true;
  }

  _updateFinale(dt, time) {
    if (!this.finale) return;
    this.finale.time += dt;
    const progress = this.finale.time / FINALE_DURATION;
    this.finaleUniforms.shock.uniforms.uTime.value = time;
    this.finaleUniforms.shock.uniforms.uProgress.value = Math.min(progress * 1.15, 1);
    this.finaleUniforms.column.uniforms.uTime.value = time;
    this.finaleUniforms.column.uniforms.uProgress.value = Math.min(progress * 1.35, 1);
    this.shockwave.visible = progress < 1;
    this.column.visible = progress < 1;
    this.flashLight.intensity = progress < 1 ? 30 * Math.pow(1 - progress, 2) : 0;
    if (progress >= 1) {
      this.shockwave.visible = false;
      this.column.visible = false;
      this.flashLight.intensity = 0;
      this.finale = null;
    }
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const { ring } of this.haloRings) ring.removeFromParent();
    this.haloRings = [];
    this.glowLight.intensity = 0;
    this.root.removeFromParent();
    this.runes?.dispose();
    for (const pool of [this.burst, this.trail]) pool.geometry.dispose();
    for (const resource of [
      this.coreGeometry, this.coreMaterial, this.haloMaterial, this.sparkMaterial,
      this.ringGeometry, this.outerRingGeometry, this.runeGeometry, this.runeMaterial,
      this.shockwave.geometry, this.column.geometry,
      this.finaleUniforms.shock, this.finaleUniforms.column
    ]) resource.dispose();
    this.flashLight.intensity = 0;
    this.credits = null;
    this.runes = null;
    this.finale = null;
  }
}
