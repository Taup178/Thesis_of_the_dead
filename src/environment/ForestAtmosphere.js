import * as THREE from 'three';
import {
  createFireflyMaterial,
  createMistMaterial,
  decorateWindMaterial,
  WIND_PRESETS
} from '../shaders/ForestAtmosphereShader.js';

const FIREFLY_COUNT = 120;
const MIST_COUNT = 14;
const MAX_CREDIT_UNIFORMS = 8;

function seededRandom(seed = 918273) {
  return () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
}

/**
 * Dynamic Forest Atmosphere (Level 1).
 * Owns every ambient visual of the moonlit woods: GPU-animated fireflies,
 * instanced drifting ground mist, and vertex-shader wind sway injected into
 * the woods' cloned vegetation materials. Fireflies and mist animate entirely
 * in shaders from one shared forestTime uniform; wind sway reads the same
 * clock through onBeforeCompile injection. update() is driven from
 * Level1.update so all motion freezes while the game is paused. Wind clones
 * restore the originals on dispose, so StylizedWoods keeps sole ownership of
 * its GLB materials and textures.
 */
export class ForestAtmosphere {
  constructor(scene, woodsRoot = null, credits = []) {
    this.scene = scene;
    this.disposed = false;
    this.forestTime = { value: 0 };
    this.windStrength = { value: 1 };

    const fog = scene.fog?.isFogExp2 ? scene.fog : null;
    this.fogColor = fog ? fog.color : new THREE.Color(0x111920);
    this.fogDensity = fog ? fog.density : 0.0075;

    this.creditPositions = [];
    for (let i = 0; i < MAX_CREDIT_UNIFORMS; i++) {
      this.creditPositions.push(i < credits.length ? credits[i].mesh.position.clone() : new THREE.Vector3(0, -999, 0));
    }
    this.creditCount = Math.min(credits.length, MAX_CREDIT_UNIFORMS);

    this.root = new THREE.Group();
    this.root.name = 'ForestAtmosphere';
    scene.add(this.root);

    this.fireflies = this._createFireflies();
    this.mist = this._createMist(credits);
    this.windInjections = [];
    this.windMeshCount = 0;
    if (woodsRoot) this._injectWind(woodsRoot);

    this.disposables = [];
    this.root.traverse(child => {
      if (child.geometry) this.disposables.push(child.geometry);
      if (child.material) this.disposables.push(child.material);
    });
  }

  /** Anchors are static; the vertex shader wanders every firefly from forestTime alone. */
  _createFireflies() {
    const random = seededRandom();
    const positions = new Float32Array(FIREFLY_COUNT * 3);
    const seeds = new Float32Array(FIREFLY_COUNT);
    const sizes = new Float32Array(FIREFLY_COUNT);
    const tints = new Float32Array(FIREFLY_COUNT);
    for (let i = 0; i < FIREFLY_COUNT; i++) {
      const angle = random() * Math.PI * 2;
      const radius = 6 + Math.sqrt(random()) * 48;
      positions[i * 3] = Math.cos(angle) * radius;
      positions[i * 3 + 1] = 0.5 + random() * 2.8;
      positions[i * 3 + 2] = Math.sin(angle) * radius;
      seeds[i] = i * 0.6180339887 + random() * 0.37;
      sizes[i] = 0.1 + random() * 0.06;
      // A gold bias near the woods heart keeps the palette tied to the credits.
      tints[i] = THREE.MathUtils.clamp(0.25 + (1 - radius / 54) * 0.45 + (random() - 0.5) * 0.4, 0, 1);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('fireflySeed', new THREE.BufferAttribute(seeds, 1));
    geometry.setAttribute('fireflySize', new THREE.BufferAttribute(sizes, 1));
    geometry.setAttribute('fireflyTint', new THREE.BufferAttribute(tints, 1));
    const material = createFireflyMaterial({
      forestTime: this.forestTime,
      fogColor: this.fogColor,
      fogDensity: this.fogDensity,
      creditPositions: this.creditPositions,
      creditCount: this.creditCount
    });
    const points = new THREE.Points(geometry, material);
    points.name = 'Fireflies';
    points.frustumCulled = false;
    points.renderOrder = 10;
    const bufferSize = new THREE.Vector2();
    points.onBeforeRender = renderer => {
      material.uniforms.uPixelScale.value = renderer.getDrawingBufferSize(bufferSize).y / 900;
    };
    this.root.add(points);
    return { points, geometry, material, count: FIREFLY_COUNT };
  }

  /** Instanced billboards; matrices carry anchor + size, drift happens in the shader. */
  _createMist(credits) {
    const random = seededRandom(4451);
    const geometry = new THREE.PlaneGeometry(1, 1);
    const seeds = new Float32Array(MIST_COUNT);
    for (let i = 0; i < MIST_COUNT; i++) seeds[i] = i * 1.618 + random() * 0.5;
    geometry.setAttribute('mistSeed', new THREE.InstancedBufferAttribute(seeds, 1));
    const material = createMistMaterial({
      forestTime: this.forestTime,
      fogColor: this.fogColor,
      fogDensity: this.fogDensity,
      creditPositions: this.creditPositions,
      creditCount: this.creditCount
    });
    const mesh = new THREE.InstancedMesh(geometry, material, MIST_COUNT);
    mesh.name = 'GroundMist';
    mesh.frustumCulled = false;
    mesh.renderOrder = 3;
    const dummy = new THREE.Object3D();
    for (let i = 0; i < MIST_COUNT; i++) {
      // Ring distribution keeps the spawn clearing readable and hugs the treeline.
      const angle = random() * Math.PI * 2;
      const radius = 9 + Math.sqrt(random()) * 42;
      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius;
      dummy.position.set(x, 0.55 + random() * 0.5, z);
      dummy.scale.set(6 + random() * 7, 2.2 + random() * 1.4, 1);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
    this.root.add(mesh);
    return { mesh, geometry, material, count: MIST_COUNT };
  }

  /**
   * Clones each sway-able InstancedMesh's material, decorates the clone with wind,
   * and leaves the original referenced for restore. Rocks and the ground plane
   * are ignored by name; anything without a WIND_PRESETS entry is untouched.
   */
  _injectWind(woodsRoot) {
    woodsRoot.traverse(node => {
      if (!node.isInstancedMesh || !node.name || Array.isArray(node.material)) return;
      const kind = node.name.split('_')[0];
      if (!WIND_PRESETS[kind]) return;
      const original = node.material;
      const clone = original.clone();
      if (!decorateWindMaterial(clone, kind, this.forestTime, this.windStrength)) {
        clone.dispose();
        return;
      }
      node.material = clone;
      this.windInjections.push({ mesh: node, original, clone, kind });
      this.windMeshCount++;
    });
  }

  /** Shared clock for fireflies, mist and wind; one write advances every effect. */
  update(dt) {
    if (this.disposed) return;
    this.forestTime.value += dt;
  }

  get time() {
    return this.forestTime.value;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const { mesh, original, clone } of this.windInjections) {
      if (mesh.material === clone) mesh.material = original;
      clone.dispose();
    }
    this.windInjections = [];
    this.windMeshCount = 0;
    for (const resource of this.disposables) resource.dispose();
    this.disposables = [];
    this.root.removeFromParent();
    this.fireflies = null;
    this.mist = null;
  }
}
