import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as skeletonClone } from 'three/addons/utils/SkeletonUtils.js';

/**
 * Zombie - Animated zombie enemy using Quaternius Zombie Kit (glTF).
 * Loads a rigged model with Walk, Run, Idle, and Death animations.
 * AI: lerps toward the player, plays appropriate animation.
 *
 * Available model variants:
 *   Zombie_Basic, Zombie_Chubby, Zombie_Ribcage, Zombie_Arm
 */

// Model paths (served from public/ by Vite)
const ZOMBIE_MODELS = [
  './assets/models/zombies/Zombie_Basic.gltf',
  './assets/models/zombies/Zombie_Chubby.gltf',
  './assets/models/zombies/Zombie_Ribcage.gltf',
];

// Shared loader & cache (load once, clone for each instance)
const _loader = new GLTFLoader();
const _cache = {};        // path -> { scene, animations }
const _loading = {};      // path -> Promise

/**
 * Load (or retrieve from cache) a glTF zombie model.
 * Returns { scene: THREE.Group, animations: AnimationClip[] }
 */
async function loadZombieModel(path) {
  if (_cache[path]) return _cache[path];
  if (_loading[path]) return _loading[path];

  _loading[path] = new Promise((resolve, reject) => {
    _loader.load(
      path,
      (gltf) => {
        _cache[path] = {
          scene: gltf.scene,
          animations: gltf.animations
        };
        delete _loading[path];
        resolve(_cache[path]);
      },
      undefined,
      (err) => {
        delete _loading[path];
        reject(err);
      }
    );
  });

  return _loading[path];
}

export class Zombie {
  /**
   * @param {THREE.Scene} scene
   * @param {THREE.Vector3} position
   * @param {string} [modelPath] - Override model variant
   */
  constructor(scene, position, modelPath) {
    this.scene = scene;
    this.alive = true;
    this.speed = 2.0 + Math.random() * 1.5;
    this.damage = 10;
    this.damageCooldown = 0;
    this.damageRate = 1.0;
    this.health = 30;

    // Hierarchical group (the loaded model goes inside this)
    this.group = new THREE.Group();
    this.group.name = 'Zombie';
    this.group.position.copy(position);
    scene.add(this.group);

    // Animation
    this.mixer = null;
    this.actions = {};      // { Walk, Run, Idle, Death }
    this.currentAction = null;
    this.deathPlayed = false;

    // Model loading
    this._loaded = false;
    this._modelPath = modelPath || ZOMBIE_MODELS[Math.floor(Math.random() * ZOMBIE_MODELS.length)];
    this._loadModel();
  }

  async _loadModel() {
    try {
      const { scene: templateScene, animations } = await loadZombieModel(this._modelPath);

      // Clone with SkeletonUtils so each zombie gets its OWN skeleton.
      // Plain .clone() shares the Skeleton, causing all AnimationMixers
      // to fight over the same bones (zombies freeze in place).
      const model = skeletonClone(templateScene);

      // Scale the model to fit our world (Quaternius models are ~1.8m)
      // Adjust if they look too big/small
      model.scale.setScalar(1.0);

      // Enable shadows on all meshes
      model.traverse((child) => {
        if (child.isMesh) {
          child.castShadow = true;
          child.receiveShadow = true;
        }
      });

      this.group.add(model);

      // Set up AnimationMixer
      this.mixer = new THREE.AnimationMixer(model);

      // Map animation clips by name
      for (const clip of animations) {
        const action = this.mixer.clipAction(clip);
        this.actions[clip.name] = action;
      }

      // Start with Walk animation (default shamble)
      if (this.actions['Walk']) {
        this.currentAction = this.actions['Walk'];
        this.currentAction.play();
      } else if (this.actions['Idle']) {
        // Fallback if Walk isn't found
        this.currentAction = this.actions['Idle'];
        this.currentAction.play();
      }

      this._loaded = true;
    } catch (err) {
      console.warn('Failed to load zombie model, using fallback primitive:', err);
      this._createFallback();
    }
  }

  /** Fallback box zombie if glTF loading fails. */
  _createFallback() {
    const bodyGeo = new THREE.BoxGeometry(0.6, 1.6, 0.4);
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0x4a7a3a, roughness: 0.9 });
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    body.position.y = 1.0;
    body.castShadow = true;
    this.group.add(body);

    const eyeGeo = new THREE.SphereGeometry(0.06, 6, 4);
    const eyeMat = new THREE.MeshStandardMaterial({
      color: 0xff0000, emissive: 0xff0000, emissiveIntensity: 2.0
    });
    const leftEye = new THREE.Mesh(eyeGeo, eyeMat);
    leftEye.position.set(-0.1, 1.7, -0.2);
    const rightEye = new THREE.Mesh(eyeGeo, eyeMat.clone());
    rightEye.position.set(0.1, 1.7, -0.2);
    this.group.add(leftEye, rightEye);

    this._loaded = true;
  }

  /** Smoothly crossfade to a new animation action. */
  _playAction(name, fadeIn = 0.3) {
    const next = this.actions[name];
    if (!next || next === this.currentAction) return;

    next.reset();
    next.play();
    if (this.currentAction) {
      this.currentAction.crossFadeTo(next, fadeIn, false);
    }
    this.currentAction = next;
  }

  takeDamage(amount) {
    if (!this.alive) return false;
    this.health -= amount;

    // Flash white on hit
    this.group.traverse((child) => {
      if (child.isMesh && child.material) {
        const mat = child.material;
        if (mat.emissive) {
          mat.emissive.setHex(0xffffff);
          mat.emissiveIntensity = 0.6;
          setTimeout(() => {
            if (mat.emissive) {
              mat.emissive.setHex(0x000000);
              mat.emissiveIntensity = 0;
            }
          }, 120);
        }
      }
    });

    if (this.health <= 0) {
      this.die();
      return true;
    }
    return false;
  }

  die() {
    this.alive = false;
    this.speed = 0;

    // Play death animation
    if (this.actions['Death'] && !this.deathPlayed) {
      this._playAction('Death', 0.2);
      // Make death animation play once and stop
      this.actions['Death'].setLoop(THREE.LoopOnce, 1);
      this.actions['Death'].clampWhenFinished = true;
      this.deathPlayed = true;
    } else {
      // Fallback: tilt the model
      this.group.rotation.z = Math.PI / 2;
      this.group.position.y = -0.3;
    }
  }

  update(dt, playerPosition) {
    // Don't move or damage until the model is fully loaded
    if (!this._loaded) {
      if (this.mixer) this.mixer.update(dt);
      return { hit: false };
    }

    // Update animation mixer
    if (this.mixer) {
      this.mixer.update(dt);
    }

    if (!this.alive) return { hit: false };

    this.damageCooldown = Math.max(0, this.damageCooldown - dt);

    // Direction toward player (XZ plane only)
    const playerPos = new THREE.Vector3(playerPosition.x, 0, playerPosition.z);
    const zombiePos = new THREE.Vector3(this.group.position.x, 0, this.group.position.z);
    const dir = new THREE.Vector3().subVectors(playerPos, zombiePos);
    const dist = dir.length();

    if (dist > 1.5) {
      dir.normalize();
      this.group.position.x += dir.x * this.speed * dt;
      this.group.position.z += dir.z * this.speed * dt;

      // Face the player using lookAt on the group itself
      this.group.lookAt(playerPosition.x, this.group.position.y, playerPosition.z);

      // Choose animation based on distance
      if (dist > 15 && this.actions['Run']) {
        this._playAction('Run');
      } else if (this.actions['Walk']) {
        this._playAction('Walk');
      }
    } else {
      // Close to player - idle menacingly
      this.group.lookAt(playerPosition.x, this.group.position.y, playerPosition.z);
      if (this.actions['Idle']) {
        this._playAction('Idle');
      }
    }

    // Damage player ONLY when genuinely close (1.5 units)
    if (dist < 1.5 && this.damageCooldown <= 0) {
      this.damageCooldown = this.damageRate;
      return { hit: true, damage: this.damage };
    }

    return { hit: false };
  }

  dispose() {
    // Dispose the cloned model (not the cached template)
    this.group.traverse((child) => {
      if (child.isMesh) {
        // Dispose cloned geometry (the cache stays intact)
        if (child.geometry) child.geometry.dispose();
        if (child.material) {
          if (Array.isArray(child.material)) {
            child.material.forEach(m => {
              if (m.map) m.map.dispose();
              m.dispose();
            });
          } else {
            if (child.material.map) child.material.map.dispose();
            child.material.dispose();
          }
        }
      }
    });
    if (this.mixer) {
      this.mixer.stopAllAction();
      this.mixer = null;
    }
    this.scene.remove(this.group);
  }
}
