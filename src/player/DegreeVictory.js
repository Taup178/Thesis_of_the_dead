import * as THREE from 'three';
import { ArenaNavigation } from '../environment/ArenaNavigation.js';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const smooth = THREE.MathUtils.smootherstep;

function aim(joint, localEnd, target) {
  joint.parent.updateWorldMatrix(true, false);
  const desired = joint.parent.worldToLocal(target.clone()).sub(joint.position).normalize();
  const current = localEnd.clone().applyQuaternion(joint.quaternion).normalize();
  joint.quaternion.premultiply(new THREE.Quaternion().setFromUnitVectors(current, desired));
  joint.updateWorldMatrix(false, true);
}

/** Walk to the fallen hand, make contact, transfer the actual paper, and lift it into view. */
export class DegreeVictory {
  constructor(player, boss, degreeCatch, obstacles = []) {
    this.player = player; this.boss = boss; this.catch = degreeCatch; this.scroll = degreeCatch.scroll;
    this.phase = 'approach'; this.time = 0; this.done = false; this.taken = false; this.speed = 0;
    this.saved = { scripted: player.scriptedMovement, bodyVisible: player.bodyMesh?.visible, firstPerson: player.isFirstPerson,
      scrollParent: this.scroll.parent, scrollPosition: this.scroll.position.clone(),
      scrollRotation: this.scroll.quaternion.clone(), scrollScale: this.scroll.scale.clone() };
    player.scriptedMovement = true; player.setBossLockTarget?.(null);
    player.isDodging = false; player.dodgeTimer = player.dodgeBufferTimer = 0;
    player.shotTime = player.bashTime = player.hitReactionTime = 0;
    player.velocity?.set(0, 0, 0); player.verticalVelocity = 0; player.grounded = true;
    if (player.bodyMesh) {
      player.bodyMesh.visible = true; player.bodyMesh.rotation.set(0, 0, 0); player.bodyMesh.position.set(0, 0, 0);
    }
    this.weapons = Object.values(player.weaponPresentation?.worldWeapons ?? {}).map(node => ({ node, visible: node.visible }));
    this.bones = [];
    player.characterModel?.traverse(node => {
      if (node.isBone) this.bones.push({ node, position: node.position.clone(), rotation: node.quaternion.clone() });
    });
    const model = player.characterModel;
    this.upper = model?.getObjectByName('UpperArmL'); this.lower = model?.getObjectByName('LowerArmL');
    const finger = model?.getObjectByName('Middle1L');
    this.grip = new THREE.Object3D(); this.grip.name = 'ShaunVictoryDegreeGrip';
    const paperScale = this.scroll.getWorldScale(V());
    this.paperFit = 0.7;
    if (this.lower && finger) {
      this.lower.updateWorldMatrix(true, true);
      const knuckles = ['Index1L', 'Middle1L', 'Pinky1L'].map(name => model.getObjectByName(name)).filter(Boolean);
      const points = knuckles.map(node => this.lower.worldToLocal(node.getWorldPosition(V())));
      const center = points.reduce((sum, point) => sum.add(point), V()).divideScalar(points.length);
      const across = points[0].clone().sub(points.at(-1)).normalize();
      const forward = center.clone().addScaledVector(across, -center.dot(across)).normalize();
      const normal = new THREE.Vector3().crossVectors(forward, across).normalize();
      const unit = Math.abs(this.lower.getWorldScale(V()).x);
      const width = points[0].distanceTo(points.at(-1)) * unit;
      this.paperFit = THREE.MathUtils.clamp(width * 3.2, 0.57, 0.63) / (0.85 * Math.abs(paperScale.x));
      const gun = player.weaponPresentation?.worldWeapons.smg;
      if (gun) {
        const handle = this.lower.worldToLocal(gun.getWorldPosition(V()));
        if (handle.sub(center).dot(normal) < 0) { normal.negate(); forward.negate(); }
      }
      const radius = 0.105 * Math.abs(paperScale.y) * this.paperFit;
      this.grip.position.copy(center).addScaledVector(normal, (radius + 0.045) / unit);
      this.grip.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(across, normal, forward));
      this.lower.add(this.grip); this.palm = this.grip.position.clone();
    } else { player.group.add(this.grip); this.grip.position.set(0.28, 1, -0.3); }
    const fingerPose = (clipName, node, fallback) => {
      const track = player.animations?.find(clip => clip.name === clipName)?.tracks.find(track => track.name === `${node.name}.quaternion`);
      return track ? new THREE.Quaternion().fromArray(track.createInterpolant().evaluate(0.3)) : fallback.clone();
    };
    this.fingers = this.bones.filter(({ node }) => /^(Index|Middle|Pinky|Thumb)[123]L$/.test(node.name))
      .map(({ node, rotation }) => ({ node, open: fingerPose('Idle', node, rotation), closed: fingerPose('Idle_Gun', node, rotation) }));
    this.openFingers = degreeCatch.pose.filter(({ node }) => /^L_(thumb|point|middle|ring|pink)/.test(node.name));
    const paperCenter = this.scroll.getWorldPosition(V());
    boss.group.updateMatrixWorld(true);
    this.corpseBounds = new THREE.Box3().setFromObject(boss.group, true);
    this.retreatDirection = paperCenter.clone().sub(this.corpseBounds.getCenter(V())).setY(0).normalize();
    this.outward = paperCenter.clone().sub(boss.group.getWorldPosition(V())).setY(0).normalize();
    if (this.outward.lengthSq() < 0.01) this.outward.set(0, 0, 1);
    if (this.retreatDirection.lengthSq() < 0.01) this.retreatDirection.copy(this.outward);
    this.side = V(-this.outward.z, 0, this.outward.x);
    const paperAxis = V(1, 0, 0).transformDirection(this.scroll.matrixWorld).setY(0).normalize();
    if (paperAxis.lengthSq() < 0.01) paperAxis.copy(this.outward);
    this.contact = paperCenter.clone().addScaledVector(paperAxis, Math.sign(paperAxis.dot(this.outward) || 1) * Math.min(0.25, Math.abs(paperScale.x) * 0.22));
    const nav = this.navigation = new ArenaNavigation(obstacles, 46, 0.75, (player.radius ?? 0.4) + 0.02);
    const candidates = [];
    for (const distance of [0.48, 0.62, 0.78, 0.94, 1.1]) {
      for (const angle of [0, -0.4, 0.4, -0.8, 0.8, -1.2, 1.2, Math.PI]) {
        const offset = this.outward.clone().applyAxisAngle(THREE.Object3D.DEFAULT_UP, angle);
        const point = this.contact.clone().setY(0).addScaledVector(offset, distance);
        if (!nav.clear(point, point)) continue;
        const path = nav.route(player.group.position, point);
        if (!path.length || Math.hypot(path.at(-1).x - point.x, path.at(-1).z - point.z) > 0.05) continue;
        candidates.push({ point, path, score: distance + Math.abs(angle) * 0.2 + path.reduce((sum, p, i) => sum + Math.hypot(p.x - (i ? path[i - 1].x : player.group.position.x), p.z - (i ? path[i - 1].z : player.group.position.z)), 0) * 0.05 });
      }
    }
    candidates.sort((a, b) => a.score - b.score);
    this.goal = candidates[0]?.point ?? player.group.position.clone().setY(0);
    this.route = (candidates[0]?.path ?? [this.goal]).map(point => V(point.x, 0, point.z));
    this.cameraPosition = player.camera?.position.clone() ?? V(); this.cameraAim = player.group.position.clone().add(V(0, 1.1, 0));
    this._hideWeapons();
  }

  _hideWeapons() {
    for (const { node } of this.weapons) node.visible = false;
    if (this.player.weaponPresentation?.viewRoot) this.player.weaponPresentation.viewRoot.visible = false;
  }

  _animate(name, dt) {
    const player = this.player;
    if (player.currentActionName !== name) player._playAnimation?.(name, 'Idle');
    if (player.currentAction) {
      player.currentAction.setEffectiveTimeScale(name.includes('Walk') ? Math.max(0.2, this.speed / 1.8) : name === 'Run' ? this.speed / 4.5 : 1);
      if (name === 'Duck') {
        player.currentAction.setLoop(THREE.LoopOnce, 1); player.currentAction.clampWhenFinished = true;
      }
    }
    player.mixer?.update(dt); player.group.updateWorldMatrix(true, true);
  }

  _reach(target, weight = 1) {
    if (!this.upper || !this.lower) { this.grip.position.copy(this.player.group.worldToLocal(target.clone())); return; }
    const start = this.upper.getWorldPosition(V()), elbow = this.lower.getWorldPosition(V());
    const hand = this.lower.localToWorld(this.palm.clone());
    target = hand.clone().lerp(target, weight);
    const a = start.distanceTo(elbow), b = elbow.distanceTo(hand), axis = target.clone().sub(start);
    const distance = THREE.MathUtils.clamp(axis.length(), Math.abs(a - b) + 0.001, a + b - 0.001);
    axis.normalize();
    const pole = this.player.group.localToWorld(V(0.65, 0.75, -0.15)).sub(start);
    pole.addScaledVector(axis, -pole.dot(axis)).normalize();
    const along = (a * a - b * b + distance * distance) / (2 * distance);
    const bend = start.clone().addScaledVector(axis, along).addScaledVector(pole, Math.sqrt(Math.max(0, a * a - along * along)));
    aim(this.upper, this.lower.position, bend); aim(this.lower, this.palm, start.addScaledVector(axis, distance));
  }

  _camera(dt) {
    const player = this.player, close = this.phase !== 'approach';
    const eye = player.group.position.clone().add(V(0, 1.1, 0));
    const paper = this.scroll.getWorldPosition(V());
    const focus = eye.clone().lerp(paper, close ? 0.55 : Math.min(0.35, 2 / Math.max(2, eye.distanceTo(paper))));
    const desired = player.group.position.clone().addScaledVector(this.outward, close ? 2.8 : 4.3)
      .addScaledVector(this.side, close ? -1.9 : 2.5).add(V(0, close ? 1.45 : 2.2, 0));
    this.cameraPosition.lerp(desired, 1 - Math.exp(-3.5 * dt)); this.cameraAim.lerp(focus, 1 - Math.exp(-5 * dt));
    if (player.camera) {
      player.camera.position.copy(this.cameraPosition); player.camera.lookAt(this.cameraAim); player.camera.updateMatrixWorld(true);
    }
  }

  update(dt) {
    if (this.done || this.disposed) return;
    const player = this.player; this.time += dt; this._hideWeapons();
    if (this.phase === 'approach') {
      const next = this.route[0], delta = next.clone().sub(player.group.position).setY(0), distance = delta.length();
      const remaining = player.group.position.distanceTo(this.goal);
      const targetSpeed = Math.min(remaining > 12 ? 4.5 : 2.2, Math.max(0.3, distance * 3));
      this.speed = THREE.MathUtils.damp(this.speed, targetSpeed, 5, dt);
      if (distance > 0.001) {
        delta.normalize(); player.group.position.addScaledVector(delta, Math.min(distance, this.speed * dt));
        const heading = new THREE.Quaternion().setFromAxisAngle(THREE.Object3D.DEFAULT_UP, Math.atan2(-delta.x, -delta.z));
        player.group.quaternion.rotateTowards(heading, 4 * dt); player.yaw = player.group.rotation.y;
      }
      this._animate(this.speed > 3 ? 'Run' : 'Walk', dt);
      if (distance < 0.035) {
        this.route.shift();
        if (!this.route.length) { this.phase = 'reach'; this.time = 0; this.speed = 0; }
      }
    } else {
      if (this.phase === 'hold') {
        const before = player.group.position.clone();
        player.group.position.lerpVectors(this.stepStart, this.stepEnd, smooth(this.time, 0.45, 1.8));
        this.speed = player.group.position.distanceTo(before) / Math.max(dt, 1e-6);
      }
      const toward = this.contact.clone().sub(player.group.position).setY(0);
      const heading = new THREE.Quaternion().setFromAxisAngle(THREE.Object3D.DEFAULT_UP, Math.atan2(-toward.x, -toward.z));
      player.group.quaternion.rotateTowards(heading, 3 * dt); player.yaw = player.group.rotation.y;
      this._animate(this.phase === 'hold' && this.speed > 0.05 ? 'RelaxedWalkBackward' : 'Idle', dt);
      const celebration = this.phase === 'hold' ? smooth(this.time, 1.9, 2.6) * (1 - smooth(this.time, 3.3, 4)) : 0;
      const target = this.phase === 'reach' ? this.contact.clone()
        : player.group.localToWorld(V(0.28 + celebration * 0.04, 1.05 + celebration * 0.73, -0.3 + celebration * 0.22));
      if (this.phase === 'hold') target.lerp(this.contact, 1 - smooth(this.time, 0, 1));
      this._reach(target, this.phase === 'reach' ? smooth(this.time, 0.12, 1.05) : 1);
      const curl = this.phase === 'reach' ? smooth(this.time, 0.9, 1.38) : 1;
      this._gripFingers(curl);
      player.group.updateWorldMatrix(true, true);
      if (this.phase === 'reach' && this.time >= 1.55) {
        const error = this.grip.getWorldPosition(V()).distanceTo(this.contact);
        if (error < 0.12) {
          this.grip.attach(this.scroll); this.taken = true; this.phase = 'hold'; this.time = 0;
          this.transfer = { position: this.scroll.position.clone(), rotation: this.scroll.quaternion.clone(), scale: this.scroll.scale.clone() };
          this.stepStart = player.group.position.clone();
          this.stepEnd = this.stepStart.clone().addScaledVector(this.retreatDirection, 1.8);
          const clearance = this.corpseBounds.clone().expandByScalar(0.55);
          for (let extra = 0; extra < 8 && this.stepEnd.x > clearance.min.x && this.stepEnd.x < clearance.max.x
            && this.stepEnd.z > clearance.min.z && this.stepEnd.z < clearance.max.z; extra++) {
            this.stepEnd.addScaledVector(this.retreatDirection, 0.25);
          }
          this.stepEnd.x = THREE.MathUtils.clamp(this.stepEnd.x, -45, 45); this.stepEnd.z = THREE.MathUtils.clamp(this.stepEnd.z, -45, 45);
          if (!this.navigation.clear(this.stepStart, this.stepEnd)) this.stepEnd.copy(this.stepStart);
        }
      }
      if (this.phase === 'hold') {
        this._seatPaper(smooth(this.time, 0, 0.14));
        const opening = smooth(this.time, 0, 0.3);
        for (const { node, rotation } of this.openFingers) {
          const closed = this.catch.closedFingers.get(node);
          if (closed) node.quaternion.slerpQuaternions(closed, rotation, opening);
        }
        if (this.time >= 4) this.done = true;
      }
    }
    this._camera(dt);
  }

  _seatPaper(blend) {
    this.scroll.position.copy(this.transfer.position).multiplyScalar(1 - blend);
    this.scroll.quaternion.copy(this.transfer.rotation).slerp(new THREE.Quaternion(), blend);
    this.scroll.scale.copy(this.transfer.scale).multiplyScalar(THREE.MathUtils.lerp(1, this.paperFit, blend));
  }

  _gripFingers(weight) {
    for (const { node, open, closed } of this.fingers) node.quaternion.slerpQuaternions(open, closed, weight);
  }

  releaseControl() {
    this.player.scriptedMovement = this.saved.scripted;
    this.player.carryingDegree = true; this.player.isFirstPerson = false;
    this.player.yaw = 0; this.player.pitch = 0; this.player.group.rotation.y = 0;
    this.player.lastSafePosition?.copy(this.player.group.position);
    this.player._updateCamera?.();
  }

  keepHolding() {
    this._hideWeapons();
    if (!this.player.isDodging) this._reach(this.player.group.localToWorld(V(0.28, 1.05, -0.3)));
    this._gripFingers(1);
    this._seatPaper(1);
    this.player.group.updateWorldMatrix(true, true);
  }

  dispose() {
    if (this.disposed) return; this.disposed = true;
    if (this.scroll.parent === this.grip) {
      this.saved.scrollParent.add(this.scroll); this.scroll.position.copy(this.saved.scrollPosition);
      this.scroll.quaternion.copy(this.saved.scrollRotation); this.scroll.scale.copy(this.saved.scrollScale);
    }
    this.grip.removeFromParent();
    this.player.scriptedMovement = this.saved.scripted;
    this.player.carryingDegree = false; this.player.isFirstPerson = this.saved.firstPerson;
    if (this.player.bodyMesh) this.player.bodyMesh.visible = this.saved.bodyVisible;
    for (const { node, position, rotation } of this.bones) { node.position.copy(position); node.quaternion.copy(rotation); }
    for (const { node, visible } of this.weapons) node.visible = visible;
  }
}
