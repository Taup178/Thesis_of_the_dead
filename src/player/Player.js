import * as THREE from 'three';

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
    const bodyGeo = new THREE.CapsuleGeometry(0.35, 1.0, 4, 8);
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0x3a7ca5, roughness: 0.7 });
    this.bodyMesh = new THREE.Mesh(bodyGeo, bodyMat);
    this.bodyMesh.position.y = 0.85;
    this.bodyMesh.castShadow = true;
    this.group.add(this.bodyMesh);

    // Gun (child of body, visible in both modes)
    this.gunGroup = new THREE.Group();
    const gunBarrel = new THREE.Mesh(
      new THREE.BoxGeometry(0.08, 0.08, 0.5),
      new THREE.MeshStandardMaterial({ color: 0x333333, roughness: 0.3, metalness: 0.8 })
    );
    gunBarrel.position.z = -0.25;
    const gunBody = new THREE.Mesh(
      new THREE.BoxGeometry(0.12, 0.18, 0.2),
      new THREE.MeshStandardMaterial({ color: 0x444444, roughness: 0.4, metalness: 0.7 })
    );
    this.gunGroup.add(gunBarrel, gunBody);
    this.gunGroup.position.set(0.4, 1.1, -0.3);
    this.group.add(this.gunGroup);

    // Camera holder (child of group so it follows player)
    this.cameraHolder = new THREE.Group();
    this.cameraHolder.name = 'CameraHolder';
    this.group.add(this.cameraHolder);

    // 3rd person camera position (behind and above)
    this.thirdPersonOffset = new THREE.Vector3(0, 2.5, 5);
    // 1st person camera position (at head height)
    this.firstPersonOffset = new THREE.Vector3(0, 1.6, 0);

    // Muzzle flash point (for raycasting origin)
    this.muzzlePoint = new THREE.Object3D();
    this.muzzlePoint.position.set(0, 0, -0.5);
    this.gunGroup.add(this.muzzlePoint);

    // Start position
    this.group.position.set(0, 0, 0);
    scene.add(this.group);

    // Gravity
    this.verticalVelocity = 0;
    this.gravity = -20;
    this.grounded = true;
  }

  /** Returns world position of the muzzle for raycasting. */
  getMuzzleWorldPosition() {
    const pos = new THREE.Vector3();
    this.muzzlePoint.getWorldPosition(pos);
    return pos;
  }

  /** Returns the forward direction of the player (for raycasting). */
  getForwardDirection() {
    const dir = new THREE.Vector3(0, 0, -1);
    dir.applyQuaternion(this.group.quaternion);
    return dir.normalize();
  }

  toggleCamera() {
    this.isFirstPerson = !this.isFirstPerson;
    this.bodyMesh.visible = !this.isFirstPerson;
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
    if (spawnPoint) {
      this.group.position.copy(spawnPoint);
    }
  }

  update(dt) {
    if (!this.alive) return;

    const inp = this.input;

    // ---- Mouse Look ----
    if (inp.pointerLocked) {
      this.yaw -= inp.mouseDeltaX * this.mouseSensitivity;
      this.pitch -= inp.mouseDeltaY * this.mouseSensitivity;
      this.pitch = Math.max(-Math.PI / 2.5, Math.min(Math.PI / 2.5, this.pitch));
    }
    inp.flushMouseDelta();

    // Apply yaw to player group (horizontal rotation)
    this.group.rotation.y = this.yaw;

    // Apply pitch to camera holder (vertical look)
    this.cameraHolder.rotation.x = this.pitch;

    // ---- Movement ----
    const forward = new THREE.Vector3(0, 0, -1).applyAxisAngle(new THREE.Vector3(0, 1, 0), this.yaw);
    const right = new THREE.Vector3(1, 0, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), this.yaw);

    let moveDir = new THREE.Vector3();
    if (inp.isDown('KeyW')) moveDir.add(forward);
    if (inp.isDown('KeyS')) moveDir.sub(forward);
    if (inp.isDown('KeyA')) moveDir.sub(right);
    if (inp.isDown('KeyD')) moveDir.add(right);

    let speed = this.moveSpeed;
    if (inp.isDown('ShiftLeft') || inp.isDown('ShiftRight')) {
      speed *= this.sprintMultiplier;
    }

    // ---- Dodge Roll ----
    if (this.dodgeCooldownTimer > 0) {
      this.dodgeCooldownTimer -= dt;
    }

    if (inp.isDown('Space') && !this.isDodging && this.dodgeCooldownTimer <= 0 && moveDir.length() > 0) {
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
    this.group.position.x += this.velocity.x * dt;
    this.group.position.z += this.velocity.z * dt;
    this.group.position.y += this.velocity.y * dt;

    // Simple ground clamp
    if (this.group.position.y <= 0) {
      this.group.position.y = 0;
      this.verticalVelocity = 0;
      this.grounded = true;
    } else {
      this.grounded = false;
    }

    // ---- Camera Position ----
    const offset = this.isFirstPerson ? this.firstPersonOffset : this.thirdPersonOffset;
    this.camera.position.copy(this.group.position).add(offset.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), this.yaw));

    // Camera look target
    const lookTarget = this.group.position.clone().add(new THREE.Vector3(0, 1.4, 0));
    this.camera.lookAt(lookTarget);
  }

  dispose() {
    this.bodyMesh.geometry.dispose();
    this.bodyMesh.material.dispose();
    this.gunGroup.traverse((child) => {
      if (child.isMesh) {
        child.geometry.dispose();
        child.material.dispose();
      }
    });
    this.scene.remove(this.group);
  }
}
