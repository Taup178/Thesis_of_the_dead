import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as skeletonClone } from 'three/addons/utils/SkeletonUtils.js';

/**
 * Zombie - Animated zombie enemy using Quaternius Zombie Kit (glTF).
 * Loads a rigged model with movement, attack, and death animations.
 * AI: lerps toward the player, plays appropriate animation.
 *
 * Regular variants: Zombie_Basic, Zombie_Chubby, Zombie_Ribcage.
 * Zombie_Arm is reserved for the final boss.
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
    this.isBoss = false;
    this.speed = 2.0 + Math.random() * 1.5;
    this.damage = 10;
    this.damageCooldown = 0;
    this.damageRate = 1.0;
    this.health = 30;
    this.attackTimer = 0;
    this.audioIdleTimer = 5 + Math.random() * 7;
    this.audioDetected = false;

    // Hierarchical group (the loaded model goes inside this)
    this.group = new THREE.Group();
    this.group.name = 'Zombie';
    this.group.position.copy(position);
    scene.add(this.group);

    // Animation
    this.mixer = null;
    this.actions = {};      // Clip name -> AnimationAction
    this.currentAction = null;
    this.deathPlayed = false;

    // Model loading
    this._loaded = false;
    this._disposed = false;
    this._ownsGeometry = false;
    this._scratchPlayerPosition = new THREE.Vector3();
    this._scratchZombiePosition = new THREE.Vector3();
    this._scratchDirection = new THREE.Vector3();
    this._hitResult = { hit: false };
    this._modelPath = modelPath || ZOMBIE_MODELS[Math.floor(Math.random() * ZOMBIE_MODELS.length)];
    this.ready = this._loadModel();
  }

  async _loadModel() {
    try {
      const { scene: templateScene, animations } = await loadZombieModel(this._modelPath);
      if (this._disposed) return;

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
          // Each enemy owns its hit flash and material lifetime.
          child.material = Array.isArray(child.material)
            ? child.material.map(material => material.clone())
            : child.material.clone();
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

      // The armless ribcage variant has no attack clip: give it a short body lunge.
      if (!this.actions['Punch'] && !this.actions['Idle_Attack']) {
        const attackClip = new THREE.AnimationClip('Attack', 0.6, [
          new THREE.NumberKeyframeTrack('.rotation[x]', [0, 0.2, 0.4, 0.6], [0, 0.25, 0.12, 0]),
          new THREE.NumberKeyframeTrack('.position[z]', [0, 0.2, 0.4, 0.6], [0, 0.3, 0.15, 0]),
        ]);
        this.actions['Attack'] = this.mixer.clipAction(attackClip);
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
      if (this._disposed) return;
      console.warn('Failed to load zombie model, using fallback primitive:', err);
      this._createFallback();
    }
  }

  /** Fallback box zombie if glTF loading fails. */
  _createFallback() {
    this._ownsGeometry = true;
    const bodyGeo = new THREE.BoxGeometry(0.6, 1.6, 0.4);
    const bodyMat = new THREE.MeshStandardMaterial({
      color: this.isBoss ? 0xffd54f : 0x4a7a3a, roughness: 0.9
    });
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
  _playAction(name, fadeIn = 0.3, restart = false) {
    const next = this.actions[name];
    if (!next || (next === this.currentAction && !restart)) return;

    next.reset();
    next.play();
    if (this.currentAction && this.currentAction !== next) {
      this.currentAction.crossFadeTo(next, fadeIn, false);
    }
    this.currentAction = next;
  }

  /** Play one attack for each damage tick, then return to movement or idle. */
  _playAttack() {
    const name = this.actions['Punch'] ? 'Punch'
      : this.actions['Idle_Attack'] ? 'Idle_Attack' : 'Attack';
    const action = this.actions[name];
    this.attackTimer = action ? Math.min(action.getClip().duration, this.damageRate) : 0.6;
    if (!action) return;

    action.setLoop(THREE.LoopOnce, 1);
    action.clampWhenFinished = true;
    action.setEffectiveTimeScale(action.getClip().duration / this.attackTimer);
    this._playAction(name, 0.1, true);
  }

  takeDamage(amount) {
    if (!this.alive) return false;
    this.health = Math.max(0, this.health - amount);

    // Flash white on hit
    this.group.traverse((child) => {
      if (child.isMesh && child.material) {
        const materials = Array.isArray(child.material) ? child.material : [child.material];
        for (const mat of materials) {
          if (mat.emissive) {
            mat.emissive.setHex(0xffffff);
            mat.emissiveIntensity = 0.6;
            setTimeout(() => {
              if (!this._disposed && mat.emissive) {
                mat.emissive.setHex(0x000000);
                mat.emissiveIntensity = 0;
              }
            }, 120);
          }
        }
      }
    });

    if (this.health <= 0) {
      this.die();
      return true;
    }
    globalThis.__thesisAudioManager?.playRandom(['./assets/audio/sfx/zombie/hurt-01.ogg', './assets/audio/sfx/zombie/hurt-02.ogg'], {
      volume: 0.46, pitch: 0.88 + Math.random() * 0.18, position: this.group.position,
      category: 'voice', group: 'zombie', maxVoices: 4, cooldownKey: `zombie-damage-${this.group.id}`, cooldown: 0.45,
    });
    return false;
  }

  die() {
    if (!this.alive) return;
    this.alive = false;
    this.speed = 0;
    this.attackTimer = 0;
    globalThis.__thesisAudioManager?.playRandom(['./assets/audio/sfx/zombie/death-01.ogg', './assets/audio/sfx/zombie/death-02.ogg'], {
      volume: 0.56, pitch: 0.88 + Math.random() * 0.16, position: this.group.position,
      category: 'voice', group: 'zombie', maxVoices: 3, cooldownKey: `zombie-death-${this.group.id}`, cooldown: 2,
    });

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
    this._hitResult.hit = false;
    // Don't move or damage until the model is fully loaded
    if (!this._loaded) {
      if (this.mixer) this.mixer.update(dt);
      return this._hitResult;
    }

    // Update animation mixer
    if (this.mixer) {
      this.mixer.update(dt);
    }

    if (!this.alive) return this._hitResult;

    this.damageCooldown = Math.max(0, this.damageCooldown - dt);
    this.attackTimer = Math.max(0, this.attackTimer - dt);

    // Direction toward player (XZ plane only)
    const playerPos = this._scratchPlayerPosition.set(playerPosition.x, 0, playerPosition.z);
    const zombiePos = this._scratchZombiePosition.set(this.group.position.x, 0, this.group.position.z);
    const dir = this._scratchDirection.subVectors(playerPos, zombiePos);
    const dist = dir.length();
    this.audioIdleTimer -= dt;
    if (dist < 16 && !this.audioDetected) {
      this.audioDetected = true;
      globalThis.__thesisAudioManager?.playRandom('./assets/audio/sfx/zombie/detection.ogg', {
        volume: 0.5, pitch: 0.9 + Math.random() * 0.16, position: this.group.position, category: 'voice', group: 'zombie',
        maxVoices: 4, maxDistance: 28, referenceDistance: 5, cooldownKey: `zombie-detect-${this.group.id}`, cooldown: 8,
      });
    }
    if (dist < 20 && this.audioIdleTimer <= 0) {
      this.audioIdleTimer = 10 + Math.random() * 9;
      globalThis.__thesisAudioManager?.playRandom(['./assets/audio/sfx/zombie/moan-1.ogg', './assets/audio/sfx/zombie/moan-2.ogg', './assets/audio/sfx/zombie/moan-3.ogg'], {
        volume: 0.34, pitch: 0.86 + Math.random() * 0.2, position: this.group.position, category: 'voice', group: 'zombie',
        maxVoices: 3, maxDistance: 30, referenceDistance: 4, cooldownKey: `zombie-idle-${this.group.id}`, cooldown: 8,
      });
    }

    this.group.lookAt(playerPosition.x, this.group.position.y, playerPosition.z);

    // Hold the attack pose long enough to see it, even if the player backs away.
    if (this.attackTimer > 0) return this._hitResult;

    if (dist >= 1.5) {
      dir.normalize();
      this.group.position.x += dir.x * this.speed * dt;
      this.group.position.z += dir.z * this.speed * dt;

      // Choose animation based on distance
      if ((this.alwaysRun || dist > 15) && this.actions['Run']) {
        this._playAction('Run');
      } else if (this.actions['Walk']) {
        this._playAction('Walk');
      }
    } else {
      // Close to player - idle between attacks.
      if (this.actions['Idle']) {
        this._playAction('Idle');
      }
    }

    // Damage and attack animation share the same cooldown.
    if (dist < 1.5 && this.damageCooldown <= 0) {
      this.damageCooldown = this.damageRate;
      this._playAttack();
      globalThis.__thesisAudioManager?.playRandom('./assets/audio/sfx/zombie/attack.ogg', {
        volume: 0.56, pitch: 0.84 + Math.random() * 0.16, position: this.group.position, category: 'voice', group: 'zombie',
        maxVoices: 3, maxDistance: 24, referenceDistance: 3, cooldownKey: `zombie-attack-${this.group.id}`, cooldown: 0.65,
      });
      this._hitResult.hit = true;
      this._hitResult.damage = this.damage;
      return this._hitResult;
    }

    return this._hitResult;
  }

  dispose() {
    this._disposed = true;
    // glTF geometry and textures belong to the shared cache; materials are per enemy.
    const skeletons = new Set();
    this.group.traverse((child) => {
      if (child.isMesh) {
        if (child.isSkinnedMesh && child.skeleton) skeletons.add(child.skeleton);
        if (this._ownsGeometry && child.geometry) child.geometry.dispose();
        if (child.material) {
          if (Array.isArray(child.material)) {
            child.material.forEach(m => m.dispose());
          } else {
            child.material.dispose();
          }
        }
      }
    });
    if (this.mixer) {
      this.mixer.stopAllAction();
      this.mixer.uncacheRoot(this.mixer.getRoot());
      this.mixer = null;
    }
    for (const skeleton of skeletons) skeleton.dispose();
    this.scene.remove(this.group);
  }
}
