import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { SurvivorWeapon } from './SurvivorWeapon.js';
import { createDirectionalWalkClips, DIRECTIONAL_STEP_LENGTH } from './DirectionalWalk.js';

/**
 * Player - Hierarchical group: body mesh + camera rig + gun.
 * Handles movement, mouse look, sprinting, dodge-rolling, and health.
 */
export class Player {
  constructor(scene, input, camera) {
    this.scene = scene;
    this.input = input;
    this.camera = camera;

    // --- Config ---
    this.moveSpeed = 8;        // units/sec
    this.sprintMultiplier = 1.7;
    this.dodgeSpeed = 18;
    this.dodgeDuration = 0.3;  // seconds
    this.dodgeCooldown = 0.8;
    this.mouseSensitivity = 0.002;
    this.maxHealth = 100;
    this.health = this.maxHealth;
    this.score = 0;
    this.ammo = 30;
    this.maxAmmo = 120;
    this.bashTime = 0;
    this.shotTime = 0;
    this.radius = 0.4; // horizontal collision radius
    this.maxLookPitch = THREE.MathUtils.degToRad(85);
    this.cameraCollisionRadius = 0.25;

    // --- State ---
    this.yaw = 0;
    this.pitch = 0;
    this.velocity = new THREE.Vector3();
    this.isDodging = false;
    this.dodgeTimer = 0;
    this.dodgeCooldownTimer = 0;
    this.dodgeDirection = new THREE.Vector3();
    this.isFirstPerson = false;
    this.alive = true;

    // --- Build the player group ---
    this.group = new THREE.Group();
    this.group.name = 'Player';

    // Body (visible in 3rd person, hidden in 1st person)
    this.bodyMesh = new THREE.Group();
    this.bodyMesh.name = 'CharacterBody';
    this.group.add(this.bodyMesh);

    // Gun (child of body, visible in both modes)
    this.gunGroup = new THREE.Group();
    this.gunGroup.position.set(0.4, 1.1, -0.3);
    this.group.add(this.gunGroup);

    // A shoulder pivot lets the camera orbit with both axes while keeping the reticle clear.
    this.cameraPivotOffset = new THREE.Vector3(0, 1.55, 0);
    this.thirdPersonOffset = new THREE.Vector3(1, 0.65, 4.8);
    this.cameraObstacles = [];
    this.cameraGroundY = 0;
    this.platformSupport = null;
    // 1st person camera position (at head height)
    this.firstPersonOffset = new THREE.Vector3(0, 1.6, 0);

    // Muzzle flash point (for raycasting origin)
    this.muzzlePoint = new THREE.Object3D();
    this.muzzlePoint.position.set(0, 0, -0.5);
    this.gunGroup.add(this.muzzlePoint);

    // Start position
    this.group.position.set(0, 0, 0);
    this.lastSafePosition = this.group.position.clone();
    scene.add(this.group);

    // Gravity
    this.verticalVelocity = 0;
    this.gravity = -20;
    this.grounded = true;
    this._updateCamera();
  }

  /**
   * Loads the survivor character model and replaces the placeholder body.
   */
  async loadCharacter(url = './assets/models/character/shaun.gltf') {
    const loader = new GLTFLoader();
    return new Promise((resolve, reject) => {
      loader.load(
        url,
        (gltf) => {
          try {
            const character = gltf.scene;
            character.name = 'ShaunCharacter';

            // Remove any placeholder children
            while (this.bodyMesh.children.length > 0) {
              this.bodyMesh.remove(this.bodyMesh.children[0]);
            }

            // Reset transforms so we can scale/orient explicitly
            character.position.set(0, 0, 0);
            character.quaternion.set(0, 0, 0, 1);
            character.scale.set(1, 1, 1);
            character.updateMatrix();

            // The survivor is authored facing +Z; rotate 180 degrees so
            // the character faces game forward (-Z) and the camera sees his back.
            character.rotation.y = Math.PI;
            character.updateMatrix();

            this.bodyMesh.add(character);
            this.bodyMesh.updateMatrixWorld(true);

            // Compute precise bounds and scale to a reasonable player height (~1.75 units)
            const box = new THREE.Box3().setFromObject(character, true);
            const size = new THREE.Vector3();
            box.getSize(size);
            const targetHeight = 1.75;
            const scale = targetHeight / Math.max(size.y, 0.01);
            // Mirror the rig and its authored grip together to hold the SMG in the right hand.
            character.scale.set(-scale, scale, scale);
            character.updateMatrix();
            this.bodyMesh.updateMatrixWorld(true);

            // Ground the character so its feet sit at y=0
            const scaledBox = new THREE.Box3().setFromObject(character, true);
            character.position.y = -scaledBox.min.y;
            character.updateMatrix();
            this.bodyMesh.updateMatrixWorld(true);

            // Shadows and material tweaks
            character.traverse((child) => {
              if (child.isMesh) {
                child.castShadow = true;
                child.receiveShadow = true;
                if (child.material) {
                  child.material.roughness = Math.max(child.material.roughness || 0.5, 0.5);
                }
              }
            });

            this.characterModel = character;

            // Set up animation mixer and actions
            this.animations = [...gltf.animations, ...createDirectionalWalkClips(character,
              gltf.animations.find(clip => clip.name === 'Idle_Gun'))];
            this.mixer = new THREE.AnimationMixer(character);
            this.actions = {};
            for (const clip of this.animations) {
              this.actions[clip.name] = this.mixer.clipAction(clip);
            }
            this.currentActionName = null;
            this.currentAction = null;
            this._playAnimation('Idle_Gun', 'Idle');
            this.mixer.update(0.001);
            this.weaponPresentation = new SurvivorWeapon(this);

            resolve();
          } catch (err) {
            console.error('[Player] failed to process character model:', err);
            reject(err);
          }
        },
        undefined,
        (err) => {
          console.error('[Player] failed to load character model:', err);
          reject(err);
        }
      );
    });
  }

  /**
   * Crossfades to the named animation, trying fallbacks if the primary is missing.
   */
  _playAnimation(primary, ...fallbacks) {
    const names = [primary, ...fallbacks];
    let nextAction = null;
    for (const name of names) {
      if (this.actions[name]) {
        nextAction = this.actions[name];
        break;
      }
    }
    if (!nextAction || nextAction === this.currentAction) return;

    if (this.currentAction) {
      this.currentAction.fadeOut(0.15);
    }
    nextAction.reset().fadeIn(0.15).play();
    this.currentAction = nextAction;
    this.currentActionName = names.find((n) => this.actions[n]);
  }

  /** Returns world position of the muzzle for raycasting. */
  getMuzzleWorldPosition() {
    if (this.weaponPresentation) return this.weaponPresentation.getMuzzlePosition();
    const pos = new THREE.Vector3();
    this.muzzlePoint.getWorldPosition(pos);
    return pos;
  }

  /** Returns the aiming direction, including vertical mouse look. */
  getForwardDirection() {
    return this.camera.getWorldDirection(new THREE.Vector3());
  }

  toggleCamera() {
    this.isFirstPerson = !this.isFirstPerson;
    this.bodyMesh.visible = !this.isFirstPerson;
    this._updateCamera();
    this.weaponPresentation?.update(0);
  }

  startGunBash() {
    if (this.bashTime > 0 || this.scriptedMovement || !this.alive) return false;
    this.bashTime = 0.6;
    if (this.actions?.Stab) {
      this._playAnimation('Stab');
      this.actions.Stab.setLoop(THREE.LoopOnce, 1).setEffectiveTimeScale(this.actions.Stab.getClip().duration / 0.6);
      this.actions.Stab.clampWhenFinished = true;
    }
    this.weaponPresentation?.bash();
    return true;
  }

  takeDamage(amount) {
    if (!this.alive) return;
    this.health = Math.max(0, this.health - amount);
    if (this.health <= 0) {
      this.alive = false;
    }
  }

  heal(amount) {
    this.health = Math.min(this.maxHealth, this.health + amount);
  }

  addScore(amount) {
    this.score += amount;
  }

  reset(spawnPoint) {
    this.bodyMesh.rotation.y = 0;
    this.scriptedMovement = false;
    this.boundaryNoticeTime = 0;
    this.ammo = 30;
    this.bashTime = 0;
    this.shotTime = 0;
    this.health = this.maxHealth;
    this.score = 0;
    this.alive = true;
    this.isDodging = false;
    this.dodgeTimer = 0;
    this.dodgeCooldownTimer = 0;
    this.yaw = 0;
    this.pitch = 0;
    this.velocity.set(0, 0, 0);
    this.verticalVelocity = 0;
    this.grounded = true;
    this.platformSupport = null;
    this.cameraGroundY = 0;
    this.cameraObstacles = [];
    if (spawnPoint) {
      this.group.position.copy(spawnPoint);
    }
    this.lastSafePosition.copy(this.group.position);
    this.group.rotation.y = this.yaw;
    this._updateCamera();
  }

  update(dt, obstacles = [], worldBounds = null, platforming = null) {
    this.boundaryNoticeTime = Math.max(0, (this.boundaryNoticeTime || 0) - dt);
    if (this.scriptedMovement) { this.input.flushMouseDelta(); this.shotTime = 0; this.weaponPresentation?.update(0); return; }
    if (!this.alive) return;
    this.bashTime = Math.max(0, this.bashTime - dt);
    this.shotTime = Math.max(0, this.shotTime - dt);

    const inp = this.input;

    // ---- Mouse Look ----
    if (inp.pointerLocked) {
      this.yaw -= inp.mouseDeltaX * this.mouseSensitivity;
      this.pitch -= inp.mouseDeltaY * this.mouseSensitivity;
      this.pitch = THREE.MathUtils.clamp(this.pitch, -this.maxLookPitch, this.maxLookPitch);
    }
    inp.flushMouseDelta();

    // Apply yaw to player group (horizontal rotation)
    this.group.rotation.y = this.yaw;

    // ---- Movement ----
    const forward = new THREE.Vector3(0, 0, -1).applyAxisAngle(new THREE.Vector3(0, 1, 0), this.yaw);
    const right = new THREE.Vector3(1, 0, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), this.yaw);

    let moveDir = new THREE.Vector3();
    if (inp.isDown('KeyW')) moveDir.add(forward);
    if (inp.isDown('KeyS')) moveDir.sub(forward);
    if (inp.isDown('KeyA')) moveDir.sub(right);
    if (inp.isDown('KeyD')) moveDir.add(right);

    let speed = platforming?.moveSpeed ?? this.moveSpeed;
    if ((!platforming || platforming.allowSprint) && (inp.isDown('ShiftLeft') || inp.isDown('ShiftRight'))) {
      speed *= this.sprintMultiplier;
    }

    // ---- Dodge Roll ----
    if (this.dodgeCooldownTimer > 0) {
      this.dodgeCooldownTimer -= dt;
    }

    if (platforming) {
      this.isDodging = false;
      if (!platforming.canMove) moveDir.set(0, 0, 0);
      const jumpPressed = inp.consumeKeyPress('Space');
      if (jumpPressed && platforming.canMove && this.grounded) {
        this.verticalVelocity = platforming.jumpVelocity;
        this.grounded = false;
        if (this.mixer) this._playAnimation('Jump', 'Jump_Idle');
      }
    } else if (inp.isDown('Space') && !this.isDodging && this.dodgeCooldownTimer <= 0 && moveDir.length() > 0) {
      this.isDodging = true;
      this.dodgeTimer = this.dodgeDuration;
      this.dodgeDirection.copy(moveDir).normalize();
    }

    if (this.isDodging) {
      this.dodgeTimer -= dt;
      moveDir.copy(this.dodgeDirection);
      speed = this.dodgeSpeed;
      if (this.dodgeTimer <= 0) {
        this.isDodging = false;
        this.dodgeCooldownTimer = this.dodgeCooldown;
      }
    }

    if (moveDir.length() > 0) {
      moveDir.normalize();
    }

    // Apply horizontal movement
    this.velocity.x = moveDir.x * speed;
    this.velocity.z = moveDir.z * speed;

    // Gravity
    this.verticalVelocity += this.gravity * dt;
    this.velocity.y = this.verticalVelocity;

    // Integrate position
    const previousY = this.group.position.y;
    this.group.position.x += this.velocity.x * dt;
    this.group.position.z += this.velocity.z * dt;
    this.group.position.y += this.velocity.y * dt;

    // Obstacle collision resolution (e.g. tree trunks)
    if (obstacles && obstacles.length > 0) {
      this._resolveObstacles(obstacles);
    }

    if (platforming) {
      // Land only when descending across a platform's top. Gaps have no floor.
      this.grounded = false;
      this.platformSupport = null;
      if (this.verticalVelocity <= 0) {
        for (const surface of platforming.surfaces) {
          const position = this.group.position;
          if (position.x < surface.minX || position.x > surface.maxX || position.z < surface.minZ || position.z > surface.maxZ) continue;
          if (previousY < surface.y - 0.001 || position.y > surface.y) continue;
          position.y = surface.y;
          this.verticalVelocity = 0;
          this.velocity.y = 0;
          this.grounded = true;
          this.platformSupport = surface;
          break;
        }
      }
      this.cameraGroundY = this.grounded ? this.group.position.y : -Infinity;
    } else if (this.group.position.y <= 0) {
      this.group.position.y = 0;
      this.verticalVelocity = 0;
      this.grounded = true;
    } else {
      this.grounded = false;
    }

    // Recover before updating the camera or shooting from an invalid position.
    if (worldBounds) this._recoverWorldBounds(worldBounds);

    this._updateLocomotion(dt, platforming);
    this.cameraObstacles = obstacles || [];
    if (!platforming) this.cameraGroundY = 0;
    this._updateCamera();
    this.weaponPresentation?.update(dt);
  }

  /** Body and camera share their heading, keeping the gun aligned with the reticle. */
  _updateLocomotion(dt, platforming) {
    const speed = Math.hypot(this.velocity.x, this.velocity.z);
    const moving = speed > 0.1;
    this.bodyMesh.rotation.y = 0;

    if (!this.mixer) return;
    if (this.bashTime > 0) {
      // Let the one-shot strike finish.
    } else if (platforming && !this.grounded) {
      this._playAnimation('Jump_Idle', 'Jump', 'Idle');
    } else if (moving && this._directionalWalkName()) {
      const name = this._directionalWalkName();
      this._playAnimation(name, 'Walk_Gun', 'Walk');
      // Speed up the foot cycle with actual movement, including sprint and diagonals.
      if (this.actions[name]) this.currentAction.setEffectiveTimeScale(Math.min(3, speed * 0.6 / (2 * DIRECTIONAL_STEP_LENGTH)));
    } else if (moving && speed > (platforming?.moveSpeed ?? this.moveSpeed) * 1.1) {
      this._playAnimation('Run_Gun', 'Run');
    } else if (moving) {
      this._playAnimation('Walk_Gun', 'Walk');
    } else {
      this._playAnimation('Idle_Gun', 'Idle');
    }
    this.mixer.update(dt);
  }

  _directionalWalkName() {
    const sideways = this.velocity.x * Math.cos(this.yaw) - this.velocity.z * Math.sin(this.yaw);
    const backward = this.velocity.x * Math.sin(this.yaw) + this.velocity.z * Math.cos(this.yaw);
    if (Math.abs(sideways) > 0.1) {
      const side = sideways > 0 ? 'Right' : 'Left';
      return Math.abs(backward) > 0.1 ? `Walk${backward > 0 ? 'Backward' : 'Forward'}${side}` : `Strafe${side}`;
    }
    return backward > 0.1 ? 'WalkBackward' : null;
  }

  _updateCamera() {
    this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
    if (this.isFirstPerson) {
      this.camera.position.copy(this.group.position).add(this.firstPersonOffset);
    } else {
      const pivot = this.group.position.clone().add(this.cameraPivotOffset);
      const shoulder = new THREE.Vector3(this.thirdPersonOffset.x, this.thirdPersonOffset.y, 0)
        .applyQuaternion(this.camera.quaternion).add(pivot);
      const backward = new THREE.Vector3(0, 0, 1).applyQuaternion(this.camera.quaternion);
      let distance = this.thirdPersonOffset.z;
      // Shorten the boom when looking up so the camera stays above the ground.
      if (backward.y < 0 && Number.isFinite(this.cameraGroundY)) {
        distance = Math.min(distance, (shoulder.y - this.cameraGroundY - this.cameraCollisionRadius) / -backward.y);
      }
      const desired = shoulder.addScaledVector(backward, Math.max(0, distance));
      this.camera.position.lerpVectors(pivot, desired, this._cameraClearance(pivot, desired));
    }
    // Shooting happens before rendering, so its camera matrices must be current now.
    this.camera.updateMatrixWorld(true);
  }

  /** Keep the camera boom outside tree trunks without changing aim direction. */
  _cameraClearance(start, end) {
    const dx = end.x - start.x, dz = end.z - start.z;
    const lengthSquared = dx * dx + dz * dz;
    if (lengthSquared < 1e-8) return 1;
    let fraction = 1;
    for (const obstacle of this.cameraObstacles) {
      const ox = start.x - obstacle.x, oz = start.z - obstacle.z;
      const radius = obstacle.radius + this.cameraCollisionRadius;
      const b = ox * dx + oz * dz;
      const c = ox * ox + oz * oz - radius * radius;
      if (c <= 0) continue;
      const discriminant = b * b - lengthSquared * c;
      if (discriminant < 0) continue;
      const entry = (-b - Math.sqrt(discriminant)) / lengthSquared;
      if (entry >= 0 && entry <= fraction) fraction = Math.max(0, entry - 0.02 / Math.sqrt(lengthSquared));
    }
    return fraction;
  }

  /** Return inside the crossed edge and face back along the direction of travel. */
  _recoverWorldBounds(bounds) {
    const minX = bounds.minX + this.radius, maxX = bounds.maxX - this.radius;
    const minZ = bounds.minZ + this.radius, maxZ = bounds.maxZ - this.radius;
    const position = this.group.position;
    if (position.x >= minX && position.x <= maxX && position.z >= minZ && position.z <= maxZ) {
      this.lastSafePosition.copy(position);
      return false;
    }

    const start = this.lastSafePosition;
    const dx = position.x - start.x, dz = position.z - start.z;
    let exit = 1;
    if (position.x > maxX && dx > 0) exit = Math.min(exit, (maxX - start.x) / dx);
    if (position.x < minX && dx < 0) exit = Math.min(exit, (minX - start.x) / dx);
    if (position.z > maxZ && dz > 0) exit = Math.min(exit, (maxZ - start.z) / dz);
    if (position.z < minZ && dz < 0) exit = Math.min(exit, (minZ - start.z) / dz);
    exit = THREE.MathUtils.clamp(exit, 0, 1);
    const inset = 1.5;
    position.set(
      THREE.MathUtils.clamp(start.x + dx * exit, minX + inset, maxX - inset),
      0,
      THREE.MathUtils.clamp(start.z + dz * exit, minZ + inset, maxZ - inset)
    );
    this.yaw = Math.atan2(dx, dz);
    this.pitch = 0;
    this.group.rotation.y = this.yaw;
    this.input.flushMouseDelta();
    this.boundaryNoticeTime = 3.5;
    this.velocity.set(0, 0, 0);
    this.verticalVelocity = 0;
    this.grounded = true;
    this.isDodging = false;
    this.dodgeTimer = 0;
    this.dodgeCooldownTimer = Math.max(this.dodgeCooldownTimer, this.dodgeCooldown);
    this.lastSafePosition.copy(position);
    return true;
  }

  /**
   * Resolves horizontal collisions against circular obstacles (such as tree trunks).
   * Pushes the player outside the obstacle radius and eliminates velocity directed into the obstacle
   * to allow smooth sliding along the obstacle's surface.
   */
  _resolveObstacles(obstacles) {
    const pRad = this.radius || 0.4;
    for (let pass = 0; pass < 2; pass++) {
      for (const obs of obstacles) {
        const dx = this.group.position.x - obs.x;
        const dz = this.group.position.z - obs.z;
        const minDist = obs.radius + pRad;
        const distSq = dx * dx + dz * dz;

        if (distSq < minDist * minDist) {
          const dist = Math.sqrt(distSq);
          const nx = dist > 1e-5 ? dx / dist : 1;
          const nz = dist > 1e-5 ? dz / dist : 0;
          const overlap = minDist - dist;

          this.group.position.x += nx * overlap;
          this.group.position.z += nz * overlap;

          // Remove velocity component pushing into obstacle for smooth sliding
          const vDotN = this.velocity.x * nx + this.velocity.z * nz;
          if (vDotN < 0) {
            this.velocity.x -= vDotN * nx;
            this.velocity.z -= vDotN * nz;
          }
        }
      }
    }
  }

  dispose() {
    if (this.mixer) {
      this.mixer.stopAllAction();
    }
    this.weaponPresentation?.viewMixer.stopAllAction();
    const resources = new Set(), skeletons = new Set();
    for (const root of [this.group, this.weaponPresentation?.viewRoot]) root?.traverse(child => {
      if (child.skeleton) skeletons.add(child.skeleton);
      if (!child.isMesh) return;
      resources.add(child.geometry);
      for (const material of Array.isArray(child.material) ? child.material : [child.material]) {
        resources.add(material);
        for (const value of Object.values(material)) if (value?.isTexture) resources.add(value);
      }
    });
    for (const resource of resources) resource.dispose();
    for (const skeleton of skeletons) skeleton.dispose();
    this.weaponPresentation?.viewRoot.removeFromParent();
    this.scene.remove(this.group);
  }
}
