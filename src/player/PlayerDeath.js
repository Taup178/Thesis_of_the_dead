import * as THREE from 'three';
import { createSawSlice, getVisibleBodyBounds } from './SawSlice.js';
import { addBloodSplatter, createBloodSplatterMaterial } from '../environment/BloodSplatter.js';

/** A short, interruptible death presentation. Gameplay stops; the body keeps moving. */
export class PlayerDeath {
  constructor(player, impact = {}) {
    this.player = player;
    this.type = impact.type || 'blunt';
    this.time = 0; this.done = false;
    this.duration = this.type === 'saw' ? 2.8 : 2.35;
    this.bodyVisible = player.bodyMesh.visible;
    this.bodyPosition = player.bodyMesh.position.clone();
    this.bodyRotation = player.bodyMesh.quaternion.clone();
    this.origin = player.group.position.clone();
    this.floorY = Number.isFinite(player.cameraGroundY) ? player.cameraGroundY : (player.platformSupport?.y ?? 0);
    this.direction = impact.direction?.clone() || new THREE.Vector3(Math.sin(player.yaw), 0, Math.cos(player.yaw));
    this.direction.y = 0;
    if (this.direction.lengthSq() < 0.001) this.direction.set(0, 0, 1);
    this.direction.normalize();
    this.velocity = this.direction.clone().multiplyScalar(this.type === 'saw' ? 0.5 : 1.35);
    this.verticalVelocity = Math.min(0, player.verticalVelocity);
    this.bounds = new THREE.Box3();
    this.root = new THREE.Group(); this.root.name = 'PlayerDeathEffects'; player.scene.add(this.root);
    this.geometries = new Set(); this.materials = new Set();
    this.cameraStart = player.camera.position.clone();
    this.cameraRotation = player.camera.quaternion.clone();
    const cameraSide = this.cameraStart.clone().sub(this.origin); cameraSide.y = 0;
    if (cameraSide.lengthSq() < 0.1) cameraSide.copy(this.direction).negate();
    this.cameraEnd = this.origin.clone().add(cameraSide.normalize().multiplyScalar(3.6));
    this.cameraEnd.y = this.floorY + 1.8;
    const target = this.origin.clone(); target.y = this.floorY + 0.65;
    this.cameraEnd.lerpVectors(target, this.cameraEnd, player._cameraClearance(target, this.cameraEnd));
    this.cameraEnd.y = Math.max(this.cameraEnd.y, this.floorY + 0.25);

    player.isDodging = false; player.dodgeTimer = 0; player.dodgeProgress = 0;
    player.bashTime = 0; player.shotTime = 0; player.aimTime = 0; player.swordAttack = null;
    player.hitReactionTime = 0;
    player.bodyMesh.position.set(0, 0, 0); player.bodyMesh.rotation.set(0, 0, 0);
    player.bodyMesh.visible = true;
    if (player.weaponPresentation?.viewRoot) player.weaponPresentation.viewRoot.visible = false;
    this.hiddenEquipment = [];
    this._dropEquipment();

    if (this.type === 'saw' && player.characterModel) this._slice(impact);
    else this._collapse();
    this._createBlood(impact);
  }

  _material(options) {
    const material = new THREE.MeshStandardMaterial(options); this.materials.add(material); return material;
  }

  _geometry(geometry) { this.geometries.add(geometry); return geometry; }

  _dropEquipment() {
    const player = this.player;
    player.group.updateMatrixWorld(true);
    const equipment = Object.values(player.weaponPresentation?.worldWeapons || {})
      .concat(player.weaponPresentation ? [] : [player.characterModel?.getObjectByName('SMG')]).filter(Boolean);
    this.droppedWeapons = [];
    for (const mesh of equipment) {
      if (mesh.visible) {
        const clone = mesh.clone(true);
        mesh.matrixWorld.decompose(clone.position, clone.quaternion, clone.scale);
        this.root.add(clone);
        const pivot = new THREE.Group();
        pivot.position.copy(new THREE.Box3().setFromObject(clone, true).getCenter(new THREE.Vector3()));
        this.root.add(pivot); pivot.attach(clone);
        this.droppedWeapons.push({ mesh: pivot, velocity: this.velocity.clone().multiplyScalar(0.5),
          spin: new THREE.Vector3(1.8, 0.6, 0.9), grounded: false });
      }
      this.hiddenEquipment.push([mesh, mesh.visible]); mesh.visible = false;
    }
    this.hiddenEquipment.push([player.gunGroup, player.gunGroup.visible]); player.gunGroup.visible = false;
  }

  _slice(impact) {
    const normal = impact.cutNormal?.clone().normalize() || new THREE.Vector3(0, 0, 1);
    const contact = impact.cutPoint?.clone() || impact.point?.clone() || this.origin.clone().add(new THREE.Vector3(0, 1, 0));
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, contact);
    const surface = this._material({ color: 0x5a171d, roughness: 0.63, side: THREE.DoubleSide });
    const halves = createSawSlice(this.player.bodyMesh, plane, surface);
    const blood = createBloodSplatterMaterial(); this.materials.add(blood);
    const head = this.player.characterModel.getObjectByName('Head')?.getWorldPosition(new THREE.Vector3());
    this.pieces = halves.map((mesh, index) => {
      this.root.add(mesh);
      mesh.updateMatrixWorld(true);
      const surfaces = mesh.children.filter(child => child.isMesh && child.name !== 'SawCutSurface');
      for (const body of surfaces) {
        const bounds = new THREE.Box3().setFromObject(body, true);
        for (const side of [-1, 1]) {
          const normal = new THREE.Vector3(0, 0, side);
          const z = side > 0 ? bounds.max.z : bounds.min.z;
          const point = new THREE.Vector3(contact.x, contact.y, z);
          addBloodSplatter(body, point, normal, new THREE.Vector3(0.9, 1.05, 0.42), blood, side * 0.3);
          if (head) addBloodSplatter(body, new THREE.Vector3(head.x, head.y, z), normal,
            new THREE.Vector3(0.52, 0.55, 0.42), blood, side * 1.2);
        }
      }
      mesh.traverse(child => { if (child.isMesh) this.geometries.add(child.geometry); });
      const side = index === 0 ? 1 : -1;
      return { mesh, velocity: this.velocity.clone().addScaledVector(normal, side * 0.75)
        .add(new THREE.Vector3((impact.bladeVelocity || 0) * 0.08, 0.25, 0)),
      spin: new THREE.Vector3(side * 1.65, side * 0.3, -side * 0.55), grounded: false };
    });
    this.player.bodyMesh.visible = false;
  }

  _collapse() {
    const player = this.player;
    player.mixer?.stopAllAction();
    this.action = player.actions?.Death;
    this.fallDuration = 1.05;
    // The rig's authored fall folds the knees, releases the arms and lands on the ground.
    if (this.action) {
      this.action.reset().setLoop(THREE.LoopOnce, 1).setEffectiveWeight(1)
        .setEffectiveTimeScale(this.action.getClip().duration / this.fallDuration).play();
      this.action.clampWhenFinished = true;
      player.currentAction = this.action; player.currentActionName = 'Death';
    }
    this.fallYaw = Math.atan2(this.direction.x, this.direction.z) - player.yaw;
  }

  _createBlood(impact) {
    const saw = this.type === 'saw';
    const material = this._material({ color: 0x65141b, roughness: 0.5 });
    const geometry = this._geometry(new THREE.IcosahedronGeometry(0.022, 0));
    const point = impact.point?.clone() || this.origin.clone().add(new THREE.Vector3(0, 1.35, 0));
    this.drops = Array.from({ length: saw ? 48 : 12 }, () => {
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.copy(point).add(new THREE.Vector3((Math.random() - 0.5) * 0.18, (Math.random() - 0.5) * 0.25, 0));
      mesh.scale.setScalar(0.5 + Math.random()); this.root.add(mesh);
      const velocity = this.direction.clone().multiplyScalar(0.5 + Math.random() * 1.5);
      velocity.add(new THREE.Vector3((Math.random() - 0.5) * (saw ? 3.5 : 1.5),
        0.6 + Math.random() * 1.8, (Math.random() - 0.5) * 1.3));
      if (saw) velocity.x += (impact.bladeVelocity || 0) * 0.1;
      return { mesh, velocity, landed: false };
    });
    const stainGeometry = this._geometry(new THREE.CircleGeometry(1, 11));
    const points = stainGeometry.attributes.position;
    for (let i = 1; i < points.count; i++) {
      const factor = 0.8 + 0.2 * Math.sin(i * 13.1);
      points.setXY(i, points.getX(i) * factor, points.getY(i) * factor);
    }
    const stainMaterial = this._material({ color: 0x3e0d12, roughness: 0.58,
      transparent: true, opacity: 0.82, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
    this.stains = Array.from({ length: saw ? 18 : 7 }, (_, i) => {
      const mesh = new THREE.Mesh(stainGeometry, stainMaterial);
      const angle = i * 2.4, distance = i === 0 ? 0 : Math.sqrt(i) * (saw ? 0.18 : 0.1);
      mesh.position.set(point.x + Math.cos(angle) * distance, this.floorY + 0.012 + i * 0.0002,
        point.z + Math.sin(angle) * distance);
      mesh.rotation.x = -Math.PI / 2; mesh.rotation.z = angle;
      mesh.scale.setScalar(0.001); this.root.add(mesh);
      return { mesh, offset: new THREE.Vector2(mesh.position.x - point.x, mesh.position.z - point.z),
        size: i === 0 ? (saw ? 0.48 : 0.23) : 0.025 + Math.random() * 0.08 };
    });
  }

  update(dt) {
    if (this.done) return;
    this.time = Math.min(this.duration, this.time + dt);
    const player = this.player;
    player.input.flushMouseDelta();
    player.damageFlashTime = Math.max(0, player.damageFlashTime - dt);
    if (this.pieces) this._updatePieces(dt);
    else this._updateCollapse(dt);
    this._updatePieces(dt, this.droppedWeapons, false);
    for (const drop of this.drops) {
      if (drop.landed) continue;
      drop.velocity.y -= 12 * dt;
      drop.mesh.position.addScaledVector(drop.velocity, dt);
      if (drop.mesh.position.y <= this.floorY + 0.02) {
        drop.landed = true; drop.mesh.visible = false;
      }
    }
    const head = !this.pieces ? player.characterModel?.getObjectByName('Head')?.getWorldPosition(new THREE.Vector3()) : null;
    for (const stain of this.stains) {
      if (head) { stain.mesh.position.x = head.x + stain.offset.x; stain.mesh.position.z = head.z + stain.offset.y; }
      const growth = THREE.MathUtils.smoothstep(this.time, 0.2, this.duration);
      stain.mesh.scale.set(stain.size * growth, stain.size * growth * 0.72, 1);
    }
    const blend = THREE.MathUtils.smoothstep(this.time, 0, 0.85);
    player.camera.position.lerpVectors(this.cameraStart, this.cameraEnd, blend);
    const look = this.origin.clone(); look.y = this.floorY + 0.55;
    player.camera.lookAt(look);
    player.camera.quaternion.slerpQuaternions(this.cameraRotation, player.camera.quaternion.clone(), blend);
    player.camera.updateMatrixWorld(true);
    this.done = this.time >= this.duration;
  }

  _updatePieces(dt, pieces = this.pieces, topple = true) {
    for (const piece of pieces) {
      if (piece.grounded) continue;
      piece.velocity.y -= 12 * dt;
      piece.mesh.position.addScaledVector(piece.velocity, dt);
      piece.mesh.rotation.x += piece.spin.x * dt;
      piece.mesh.rotation.y += piece.spin.y * dt;
      piece.mesh.rotation.z += piece.spin.z * dt;
      piece.mesh.updateMatrixWorld(true);
      this.bounds.setFromObject(piece.mesh, true);
      if (this.bounds.min.y <= this.floorY + 0.015) {
        piece.mesh.position.y += this.floorY + 0.015 - this.bounds.min.y;
        // Friction removes energy at contact instead of leaving the halves spinning forever.
        piece.velocity.y = 0;
        piece.velocity.multiplyScalar(Math.exp(-12 * dt));
        // A tall slice keeps toppling under its own weight until its broad side lands.
        if (topple && Math.abs(piece.mesh.rotation.x) < 1.4) piece.spin.x *= Math.exp(0.7 * dt);
        else piece.spin.multiplyScalar(Math.exp(-14 * dt));
        if (piece.spin.lengthSq() < 0.006 && piece.velocity.lengthSq() < 0.006) piece.grounded = true;
      }
    }
  }

  _updateCollapse(dt) {
    const player = this.player;
    const t = THREE.MathUtils.smoothstep(this.time, 0, this.fallDuration);
    player.bodyMesh.rotation.y = this.fallYaw * THREE.MathUtils.smoothstep(this.time, 0, 0.25);
    if (this.action) player.mixer.update(dt);
    else {
      // Pivot around the hips when a replacement model has no authored fall.
      const angle = t * Math.PI / 2;
      player.bodyMesh.rotation.x = angle;
      player.bodyMesh.position.set(0, 0.85 * (1 - Math.cos(angle)), -0.85 * Math.sin(angle));
    }
    player.group.position.addScaledVector(this.velocity, dt);
    player._resolveObstacles(player.cameraObstacles);
    this.velocity.multiplyScalar(Math.exp(-(this.time > 0.65 ? 12 : 5) * dt));
    if (player.group.position.y > this.floorY) {
      this.verticalVelocity += player.gravity * dt;
      player.group.position.y = Math.max(this.floorY, player.group.position.y + this.verticalVelocity * dt);
    }
    getVisibleBodyBounds(player.bodyMesh, this.bounds);
    if (!this.bounds.isEmpty()) {
      player.bodyMesh.position.y += player.group.position.y + 0.015 - this.bounds.min.y;
    }
    // A small damped recoil as the torso reaches the floor.
    if (this.action && this.time > 0.65 && this.time < 1.35) {
      player.bodyMesh.position.y += Math.abs(Math.sin((this.time - 0.65) * 15)) * 0.018 * Math.exp(-7 * (this.time - 0.65));
    }
  }

  dispose() {
    this.root.removeFromParent();
    for (const geometry of this.geometries) geometry.dispose();
    for (const material of this.materials) { material.alphaMap?.dispose(); material.dispose(); }
    for (const [mesh, visible] of this.hiddenEquipment) mesh.visible = visible;
    this.player.bodyMesh.visible = this.bodyVisible;
    this.player.bodyMesh.position.copy(this.bodyPosition);
    this.player.bodyMesh.quaternion.copy(this.bodyRotation);
    this.action?.stop();
  }
}
