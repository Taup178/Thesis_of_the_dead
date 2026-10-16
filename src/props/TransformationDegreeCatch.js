import * as THREE from 'three';

const smooth = THREE.MathUtils.smoothstep;
const UP = new THREE.Vector3(0, 1, 0);
const GRAVITY = 9.81;

/** A timed, ballistic toss of the existing degree, followed by a skeletal hand catch. */
export class TransformationDegreeCatch {
  constructor(root, monster, scroll, timing) {
    this.root = root; this.monster = monster; this.scroll = scroll; this.timing = timing;
    this.rest = { parent: scroll.parent, position: scroll.position.clone(), rotation: scroll.quaternion.clone(),
      scale: scroll.scale.clone(), visible: scroll.visible };
    const find = pattern => {
      let result; monster.group.traverse(node => { if (!result && pattern.test(node.name)) result = node; });
      return result;
    };
    this.hand = find(/^L_wrist_\d+$/);
    this.wristRest = this.hand?.quaternion.clone() ?? new THREE.Quaternion();
    this.upper = find(/^L_arm_\d+$/); this.elbow = find(/^L_elbow_\d+$/);
    this.chest = find(/^chest_/);
    this.shoulder = find(/^L_shoulder_/); this.head = find(/^head_/);
    this.bodyPose = [this.chest, this.shoulder, this.head].filter(Boolean)
      .map(node => ({ node, rotation: node.quaternion.clone() }));
    this.fingers = [];
    monster.group.traverse(node => {
      const match = /^L_(thumb|point|middle|ring|pink)([123])_/.exec(node.name);
      if (match) this.fingers.push({ node, thumb: match[1] === 'thumb', joint: Number(match[2]) });
    });
    this.pose = [...new Set([this.upper, this.elbow, this.hand, ...this.fingers.map(finger => finger.node)].filter(Boolean))]
      .map(node => ({ node, rotation: node.quaternion.clone() }));
    this.idleArm = [this.upper, this.elbow, this.hand].filter(Boolean)
      .map(node => ({ node, rotation: new THREE.Quaternion() }));
    this.tails = scroll.children.filter(child => child.userData.degreeRibbonTail)
      .map(node => ({ node, rotation: node.quaternion.clone() }));
    this.grip = new THREE.Object3D(); this.grip.name = 'TransformedDegreeGrip';
    this.palmBasis = new THREE.Quaternion();
    this.palmCenter = new THREE.Vector3(); this.palmAcross = new THREE.Vector3(1, 0, 0);
    this.palmForward = new THREE.Vector3(0, 0, 1); this.palmNormal = new THREE.Vector3(0, 1, 0);
    this.closedFingers = new Map();
    const knuckles = this.fingers.filter(finger => finger.joint === 1 && !finger.thumb);
    if (this.hand && knuckles.length) {
      const center = new THREE.Vector3();
      for (const finger of knuckles) center.add(finger.node.position);
      center.divideScalar(knuckles.length);
      const across = find(/^L_point1_/).position.clone().sub(find(/^L_pink1_/).position).normalize();
      const forward = center.clone().addScaledVector(across, -center.dot(across)).normalize();
      const normal = new THREE.Vector3().crossVectors(forward, across).normalize();
      this.palmCenter.copy(center); this.palmAcross.copy(across);
      this.palmForward.copy(forward); this.palmNormal.copy(normal);
      this.palmBasis.setFromRotationMatrix(new THREE.Matrix4().makeBasis(across, normal, forward));
      const unit = this.hand.getWorldScale(new THREE.Vector3()).x;
      this.grip.position.copy(center).multiplyScalar(0.68).addScaledVector(normal, 0.065 / unit);
      this.grip.quaternion.copy(this.palmBasis); this.grip.scale.setScalar(1 / unit);
      this.hand.add(this.grip);
    } else {
      monster.group.add(this.grip); this.grip.position.set(1.1, 3, 1);
    }
    this.worldScale = new THREE.Vector3(); this.origin = new THREE.Vector3();
    this.launch = new THREE.Vector3(); this.catchPoint = new THREE.Vector3(); this.target = new THREE.Vector3();
    this.restGrip = new THREE.Vector3(); this.focus = new THREE.Vector3(); this.position = new THREE.Vector3();
    this.restElbow = new THREE.Vector3();
    this.worldRotation = new THREE.Quaternion(); this.wristRotation = new THREE.Quaternion();
    this.catchRotation = new THREE.Quaternion(); this.neutralWrist = new THREE.Quaternion();
    this.spin = new THREE.Quaternion(); this.localRotation = new THREE.Quaternion();
    this.a = new THREE.Vector3(); this.b = new THREE.Vector3(); this.c = new THREE.Vector3();
    this.direction = new THREE.Vector3(); this.pole = new THREE.Vector3(); this.desiredElbow = new THREE.Vector3();
    this.wristTarget = new THREE.Vector3(); this.offset = new THREE.Vector3();
    this.from = new THREE.Vector3(); this.to = new THREE.Vector3(); this.axis = new THREE.Vector3();
    this.correction = new THREE.Quaternion(); this.parentRotation = new THREE.Quaternion();
    this.tailDirection = new THREE.Vector3(); this.tailRotation = new THREE.Quaternion();
    this.launched = false; this.caught = false;
  }

  start(origin) {
    this.origin.copy(origin);
    this.monster.group.updateWorldMatrix(true, true);
    this.scroll.getWorldScale(this.worldScale);
    this._bakeGrip();
    this.launch.set(0.15, 2.45, 0.45).applyQuaternion(this.monster.group.quaternion).add(origin);
    this.catchPoint.set(1.1, 3, 1).applyQuaternion(this.monster.group.quaternion).add(origin);
    this.chestHeight = this.chest?.getWorldPosition(this.position).y ?? 0;
  }

  _bakeGrip() {
    if (!this.hand) return;
    const unit = Math.abs(this.hand.getWorldScale(new THREE.Vector3()).x);
    const paperRadius = 0.105 * Math.max(this.worldScale.y, this.worldScale.z);
    // Seat the paper outside the palm, at the finger roots rather than inside the hand.
    this.grip.position.copy(this.palmCenter).addScaledVector(this.palmForward, paperRadius * 0.15 / unit)
      .addScaledVector(this.palmNormal, (paperRadius + 0.025) / unit);
    const radius = (paperRadius + 0.035) / unit;
    const point = new THREE.Vector3(), base = new THREE.Vector3(), next = new THREE.Vector3();
    const center = this.grip.position;
    const rotation = new THREE.Quaternion(), parent = new THREE.Quaternion(), correction = new THREE.Quaternion();
    for (const finger of this.fingers.filter(candidate => candidate.joint === 1)) {
      const joints = [finger.node];
      for (let index = 0; index < 3; index++) {
        const child = joints.at(-1).children.find(node => node.isBone);
        if (child) joints.push(child);
      }
      if (joints.length !== 4) continue;
      this.hand.updateWorldMatrix(true, true);
      const points = joints.map(node => this.hand.worldToLocal(node.getWorldPosition(new THREE.Vector3())));
      const lengths = points.slice(1).map((p, index) => p.distanceTo(points[index]));
      base.copy(points[0]).sub(center);
      const across = base.dot(this.palmAcross), y = base.dot(this.palmNormal), z = base.dot(this.palmForward);
      const distance = Math.hypot(y, z), direction = finger.thumb ? -1 : 1;
      const cosine = THREE.MathUtils.clamp((distance ** 2 + radius ** 2 - lengths[0] ** 2) / (2 * Math.max(0.001, distance) * radius), -1, 1);
      let angle = Math.atan2(y, z) + direction * Math.acos(cosine);
      for (let index = 0; index < 3; index++) {
        if (index > 0) angle += direction * 2 * Math.asin(Math.min(0.99, lengths[index] / (2 * radius)));
        point.copy(center).addScaledVector(this.palmAcross, across)
          .addScaledVector(this.palmNormal, Math.sin(angle) * radius)
          .addScaledVector(this.palmForward, Math.cos(angle) * radius);
        this.hand.localToWorld(point); joints[index].getWorldPosition(base);
        joints[index + 1].getWorldPosition(next).sub(base).normalize(); point.sub(base).normalize();
        rotation.setFromUnitVectors(next, point); joints[index].parent.getWorldQuaternion(parent);
        correction.copy(parent).invert().multiply(rotation).multiply(parent);
        joints[index].quaternion.premultiply(correction); joints[index].updateWorldMatrix(false, true);
        this.closedFingers.set(joints[index], joints[index].quaternion.clone());
      }
    }
    for (const pose of this.pose) pose.node.quaternion.copy(pose.rotation);
    this.hand.updateWorldMatrix(true, true);
  }

  getFlightPosition(time, output) {
    const duration = this.timing.scrollCatch - this.timing.scrollLaunch;
    const age = THREE.MathUtils.clamp(time - this.timing.scrollLaunch, 0, duration);
    output.lerpVectors(this.launch, this.catchPoint, age / duration);
    // Constant gravitational acceleration; the endpoints are the dust and the open palm.
    output.y += 0.5 * GRAVITY * age * (duration - age);
    return output;
  }

  _rotateToward(joint, current, desired) {
    this.from.copy(current).sub(this.a).normalize(); this.to.copy(desired).sub(this.a).normalize();
    this.correction.setFromUnitVectors(this.from, this.to);
    joint.parent.getWorldQuaternion(this.parentRotation);
    this.localRotation.copy(this.parentRotation).invert().multiply(this.correction).multiply(this.parentRotation);
    joint.quaternion.premultiply(this.localRotation);
    joint.updateWorldMatrix(false, true);
  }

  _reach(target, wristRotation, reach) {
    if (!this.upper || !this.elbow || !this.hand) return;
    this.upper.getWorldPosition(this.a); this.elbow.getWorldPosition(this.b); this.hand.getWorldPosition(this.c);
    const upperLength = this.a.distanceTo(this.b), lowerLength = this.b.distanceTo(this.c);
    this.hand.getWorldScale(this.offset).multiply(this.grip.position).applyQuaternion(wristRotation);
    this.wristTarget.copy(target).sub(this.offset);
    this.direction.copy(this.wristTarget).sub(this.a);
    const distance = THREE.MathUtils.clamp(this.direction.length(), Math.abs(upperLength - lowerLength) + 0.001, upperLength + lowerLength - 0.001);
    this.direction.normalize(); this.wristTarget.copy(this.a).addScaledVector(this.direction, distance);
    // Keep the elbow below the shoulder and beside the ribs, rather than flared out.
    this.pole.set(1.25, 2.1, -0.15).applyQuaternion(this.monster.group.quaternion).add(this.origin);
    this.pole.lerpVectors(this.restElbow, this.pole, reach).sub(this.a);
    this.pole.addScaledVector(this.direction, -this.pole.dot(this.direction)).normalize();
    const along = (upperLength ** 2 - lowerLength ** 2 + distance ** 2) / (2 * distance);
    const bend = Math.sqrt(Math.max(0, upperLength ** 2 - along ** 2));
    this.desiredElbow.copy(this.a).addScaledVector(this.direction, along).addScaledVector(this.pole, bend);
    this._rotateToward(this.upper, this.b, this.desiredElbow);
    this.elbow.getWorldPosition(this.a); this.hand.getWorldPosition(this.c);
    this._rotateToward(this.elbow, this.c, this.wristTarget);
    this.hand.parent.getWorldQuaternion(this.parentRotation);
    this.hand.quaternion.copy(this.parentRotation).invert().multiply(wristRotation);
    this.hand.updateWorldMatrix(false, true);
  }

  update(time, dt) {
    // Remove only the preceding procedural pose, then let the authored idle breathe.
    for (const pose of this.pose) pose.node.quaternion.copy(pose.rotation);
    for (const pose of this.bodyPose) pose.node.quaternion.copy(pose.rotation);
    this.monster.mixer?.update(dt); this.monster.group.updateWorldMatrix(true, true);
    for (const pose of this.bodyPose) pose.rotation.copy(pose.node.quaternion);
    for (const pose of this.idleArm) pose.rotation.copy(pose.node.quaternion);
    if (time < this.timing.scrollLaunch) return;
    if (!this.launched) {
      this.root.attach(this.scroll); this.scroll.visible = true;
      this.root.getWorldScale(this.offset); this.scroll.scale.copy(this.worldScale).divide(this.offset);
      this.launched = true;
    }
    this._bodyResponse(time);
    const reach = smooth(time, this.timing.scrollCatch - 0.75, this.timing.scrollCatch - 0.04);
    const settle = smooth(time, this.timing.scrollCatch, this.timing.scrollCatch + 1.15);
    const relax = smooth(time, this.timing.scrollCatch + 0.15, this.timing.scrollCatch + 1.9);
    this.grip.getWorldPosition(this.restGrip);
    this.target.copy(this.catchPoint);
    this.offset.set(0.02 * settle, -0.85 * settle, -0.38 * settle)
      .applyQuaternion(this.monster.group.quaternion); this.target.add(this.offset);
    const impactAge = Math.max(0, time - this.timing.scrollCatch);
    this.target.y -= impactAge * Math.exp(-impactAge * 13) * 2.8;
    if (settle > 0 && this.chest) this.target.y += (this.chest.getWorldPosition(this.position).y - this.chestHeight) * settle;
    this.target.lerpVectors(this.restGrip, this.target, reach);
    this.worldRotation.copy(this.monster.group.quaternion);
    if (this.hand) {
      this.wristRotation.copy(this.palmBasis).invert().premultiply(this.worldRotation);
      this.hand.getWorldQuaternion(this.parentRotation);
      this.parentRotation.slerp(this.wristRotation, reach); this.wristRotation.copy(this.parentRotation);
      if (reach > 0 && relax < 1) {
        this.elbow?.getWorldPosition(this.restElbow);
        this.catchRotation.copy(this.wristRotation);
        // The palm opens for the catch, then returns to the rig's neutral wrist.
        // Reconcile the palm offset with the arm as the wrist rolls inward.
        for (let iteration = 0; iteration < 4; iteration++) {
          this._reach(this.target, this.wristRotation, reach);
          this.hand.parent.getWorldQuaternion(this.neutralWrist).multiply(this.wristRest);
          this.wristRotation.slerpQuaternions(this.catchRotation, this.neutralWrist, settle);
        }
        this._reach(this.target, this.wristRotation, reach);
      }
      // Let the entire arm hang in its authored idle, like the free arm.
      // Only the fingers keep their grip; the degree follows the relaxed wrist.
      for (const pose of this.idleArm) pose.node.quaternion.slerp(pose.rotation, relax);
      this.monster.group.updateWorldMatrix(true, true);
      this.grip.getWorldQuaternion(this.worldRotation);
    }
    const close = smooth(time, this.timing.scrollCatch - 0.025, this.timing.scrollCatch + 0.18);
    for (const finger of this.fingers) {
      const closed = this.closedFingers.get(finger.node);
      if (closed) finger.node.quaternion.slerp(closed, close);
    }
    this.monster.group.updateWorldMatrix(true, true);
    if (time < this.timing.scrollCatch) {
      const duration = this.timing.scrollCatch - this.timing.scrollLaunch;
      const u = (time - this.timing.scrollLaunch) / duration;
      this.getFlightPosition(time, this.position); this.root.worldToLocal(this.position);
      this.scroll.position.copy(this.position);
      this.worldRotation.copy(this.monster.group.quaternion);
      this.worldRotation.multiply(this.spin.setFromAxisAngle(new THREE.Vector3(0, 0, 1), -Math.PI * 2 * (1 - u)));
      this.root.getWorldQuaternion(this.parentRotation).invert();
      this.scroll.quaternion.copy(this.parentRotation).multiply(this.worldRotation);
    } else if (!this.caught) {
      this.grip.add(this.scroll); this.scroll.position.set(0, 0, 0);
      this.scroll.quaternion.identity(); this.grip.getWorldScale(this.offset);
      this.scroll.scale.copy(this.worldScale).divide(this.offset);
      this.caught = true;
    }
    if (this.caught) {
      this.grip.getWorldScale(this.offset); this.scroll.scale.copy(this.worldScale).divide(this.offset);
    }
    // Ribbon inertia trails the toss, then relaxes under gravity after the catch.
    const duration = this.timing.scrollCatch - this.timing.scrollLaunch;
    const age = THREE.MathUtils.clamp(time - this.timing.scrollLaunch, 0, duration);
    const vy = (this.catchPoint.y - this.launch.y) / duration + GRAVITY * (duration / 2 - age);
    this.tailDirection.set(0, this.caught ? -1 : -1 - vy * 0.22, this.caught ? 0 : -0.16).normalize();
    this.scroll.getWorldQuaternion(this.parentRotation).invert(); this.tailDirection.applyQuaternion(this.parentRotation);
    this.tailRotation.setFromUnitVectors(UP.clone().negate(), this.tailDirection);
    for (const tail of this.tails) tail.node.quaternion.slerp(this.tailRotation, 1 - Math.exp(-12 * dt));
  }

  _bodyResponse(time) {
    const age = Math.max(0, time - this.timing.scrollCatch), impulse = age * Math.exp(-age * 10);
    if (this.chest) this.chest.rotation.x += impulse * 0.22;
    if (this.shoulder) this.shoulder.rotation.z -= impulse * 0.4;
    this.monster.group.updateWorldMatrix(true, true);
    const follow = smooth(time, this.timing.scrollLaunch + 0.1, this.timing.scrollLaunch + 0.55)
      * (1 - smooth(time, this.timing.scrollCatch + 0.12, this.timing.scrollCatch + 0.85));
    if (this.head && follow > 0) {
      this.getFlightPosition(time, this.focus); this.head.getWorldPosition(this.position);
      this.to.copy(this.focus).sub(this.position).normalize();
      this.from.set(0, 0, 1).applyQuaternion(this.monster.group.quaternion);
      this.correction.setFromUnitVectors(this.from, this.to);
      const angle = 2 * Math.acos(Math.min(1, Math.abs(this.correction.w)));
      this.spin.identity().slerp(this.correction, follow * Math.min(1, 0.35 / Math.max(0.001, angle)));
      this.head.parent.getWorldQuaternion(this.parentRotation);
      this.localRotation.copy(this.parentRotation).invert().multiply(this.spin).multiply(this.parentRotation);
      this.head.quaternion.premultiply(this.localRotation);
      this.head.updateWorldMatrix(false, true);
    }
  }

  dispose() {
    this.rest.parent?.add(this.scroll);
    this.scroll.position.copy(this.rest.position); this.scroll.quaternion.copy(this.rest.rotation);
    this.scroll.scale.copy(this.rest.scale); this.scroll.visible = this.rest.visible;
    for (const pose of this.pose) pose.node.quaternion.copy(pose.rotation);
    for (const pose of this.bodyPose) pose.node.quaternion.copy(pose.rotation);
    for (const tail of this.tails) tail.node.quaternion.copy(tail.rotation);
    this.grip.removeFromParent();
  }
}
