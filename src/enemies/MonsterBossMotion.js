import * as THREE from 'three';
import { clone } from 'three/addons/utils/SkeletonUtils.js';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const smooth = THREE.MathUtils.smootherstep;
const SPRINT_CYCLE_DISTANCE = 6.4, SPRINT_STANCE = 0.38;

function aim(joint, endLocal, target) {
  joint.parent.updateWorldMatrix(true, false);
  const to = joint.parent.worldToLocal(target.clone()).sub(joint.position).normalize();
  const from = endLocal.clone().applyQuaternion(joint.quaternion).normalize();
  joint.quaternion.premultiply(new THREE.Quaternion().setFromUnitVectors(from, to));
  joint.updateWorldMatrix(false, true);
}

function plant(leg, group) {
  const start = leg.upper.getWorldPosition(V()), middle = leg.lower.getWorldPosition(V());
  const a = start.distanceTo(middle), b = middle.distanceTo(leg.foot.getWorldPosition(V()));
  const target = group.localToWorld(leg.anchor.clone()), axis = target.clone().sub(start);
  const distance = THREE.MathUtils.clamp(axis.length(), Math.abs(a - b) + 0.001, a + b - 0.001);
  axis.normalize();
  const pole = group.localToWorld(V(leg.sign * 0.8, 0.9, 1.1)).sub(start);
  pole.addScaledVector(axis, -pole.dot(axis)).normalize();
  const along = (a * a - b * b + distance * distance) / (2 * distance);
  const knee = start.clone().addScaledVector(axis, along).addScaledVector(pole, Math.sqrt(Math.max(0, a * a - along * along)));
  aim(leg.upper, leg.lower.position, knee); aim(leg.lower, leg.foot.position, start.addScaledVector(axis, distance));
  leg.foot.quaternion.copy(leg.foot.parent.getWorldQuaternion(new THREE.Quaternion()).invert())
    .multiply(group.quaternion).multiply(leg.rotation);
}

/** Native locomotion and attacks, with grounded contacts and an extended-arm spin. */
export class MonsterBossMotion {
  constructor(monster, degreeCatch) {
    this.monster = monster; this.group = monster.group; this.degreeCatch = degreeCatch;
    const find = pattern => { let found; this.group.traverse(node => { if (!found && pattern.test(node.name)) found = node; }); return found; };
    this.hips = find(/^hips_/);
    this.chest = find(/^chest_/);
    this.bones = []; this.group.updateWorldMatrix(true, true);
    this.group.traverse(node => { if (node.isBone) this.bones.push({ node, position: node.position.clone(), rotation: node.quaternion.clone() }); });
    this.arms = ['L', 'R'].map(side => ({ upper: find(new RegExp(`^${side}_arm_\\d+`)),
      lower: find(new RegExp(`^${side}_elbow_`)), hand: find(new RegExp(`^${side}_wrist_\\d+`)) }));
    this.legs = ['L', 'R'].map((side, i) => {
      const foot = find(new RegExp(`^${side}_ankle_\\d+`));
      return { upper: find(new RegExp(`^${side}_leg_`)), lower: find(new RegExp(`^${side}_knee_`)), foot,
        sign: i ? -1 : 1, anchor: this.group.worldToLocal(foot.getWorldPosition(V())),
        rotation: this.group.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(foot.getWorldQuaternion(new THREE.Quaternion())) };
    });
    const sampleRig = clone(monster.model), mixer = new THREE.AnimationMixer(sampleRig);
    const source = monster.animations?.[0];
    if (!source) throw new Error('Monster combat requires the supplied native animation.');
    mixer.clipAction(source).play();
    const sampleBones = this.bones.map(({ node }) => sampleRig.getObjectByName(node.name));
    const sample = (time, into = null) => {
      mixer.setTime(time);
      return sampleBones.map((bone, i) => {
        const pose = into?.[i] || { position: V(), rotation: new THREE.Quaternion() };
        pose.position.copy(bone.position); pose.rotation.copy(bone.quaternion);
        return pose;
      });
    };
    this.neutral = sample(0); this.raised = sample(11.2); this.ground = sample(11.48);
    this.windup = sample(12.5); this.release = sample(12.75);
    this.punchWindup = sample(6.5); this.punch = sample(7);
    this.launch = sample(7.5); this.tuck = sample(8); this.seated = sample(9);
    // Sample the original idle and walk on a separate rig: resetting the rendered
    // bones before AnimationMixer.update can leave its cached values unapplied.
    this.sampleRig = sampleRig; this.sampleMixer = mixer; this.sampleNative = sample;
    this.idlePose = sample(0); this.walkPose = sample(2);
    this.walkBase = sample(2);
    this.walkFeet = this.legs.map(leg => leg.anchor.clone());
    this.sprintFeet = this.legs.map(leg => leg.anchor.clone());
    this.sprintRotations = this.legs.map(leg => leg.rotation.clone());
    this.idleTime = 0; this.walkDistance = 0; this.walkWeight = 0; this.moveSpeed = 0;
    this.transitionFrom = this.bones.map(({ node }) => ({ position: node.position.clone(), rotation: node.quaternion.clone() }));
    this.transitionFeet = this.legs.map(leg => leg.anchor.clone());
    this.transitionTime = 1; this.previousKind = null; this.previousAge = 0;
    this.handVertices = [];
    this.group.traverse(mesh => {
      if (!mesh.isSkinnedMesh) return;
      const ids = mesh.geometry.attributes.skinIndex, weights = mesh.geometry.attributes.skinWeight;
      const vertices = [];
      for (let vertex = 0; vertex < ids.count; vertex++) {
        let influence = 0;
        for (let slot = 0; slot < 4; slot++) {
          const name = mesh.skeleton.bones[ids.getComponent(vertex, slot)]?.name;
          if (/^[LR]_(wrist|thumb|point|middle|ring|pink)/.test(name)) influence += weights.getComponent(vertex, slot);
        }
        if (influence > 0.5) vertices.push(vertex);
      }
      this.handVertices.push({ mesh, vertices });
    });
    // Fit actual fist and paper surfaces to the floor, not wrist joint heights.
    this._apply(this.ground, this.ground, 0); this._grip(1); this.group.updateWorldMatrix(true, true);
    let lowest = new THREE.Box3().setFromObject(degreeCatch.scroll, true).min.y;
    for (const { mesh, vertices } of this.handVertices) {
      mesh.skeleton.update();
      for (const vertex of vertices) lowest = Math.min(lowest, mesh.getVertexPosition(vertex, V()).applyMatrix4(mesh.matrixWorld).y);
    }
    const hip = this.hips.getWorldPosition(V()).add(V(0, this.group.position.y + 0.035 - lowest, 0));
    this.hips.position.copy(this.hips.parent.worldToLocal(hip));
    this.ground[this.bones.findIndex(saved => saved.node === this.hips)].position.copy(this.hips.position);
    // Lower the native crouch into a seated landing, while preserving its arm and torso poses.
    this._apply(this.seated, this.seated, 0); this.group.updateWorldMatrix(true, true);
    const seat = this.hips.getWorldPosition(V()).add(V(0, -0.78, 0));
    this.seated[this.bones.findIndex(saved => saved.node === this.hips)].position.copy(this.hips.parent.worldToLocal(seat.clone()));
    this.compressed = this.seated.map(pose => ({ position: pose.position.clone(), rotation: pose.rotation.clone() }));
    this.compressed[this.bones.findIndex(saved => saved.node === this.hips)].position.copy(
      this.hips.parent.worldToLocal(seat.clone().add(V(0, -0.12, 0))));
    this.chestReady = this._chestPose(0.68);
    this.chestStrike = this._chestPose(0);
    this.spinWide = this._wideSpinPose();
    for (const saved of this.bones) { saved.node.position.copy(saved.position); saved.node.quaternion.copy(saved.rotation); }
    this.impactPoint = V(); this.group.updateWorldMatrix(true, true);
  }

  _apply(a, b, alpha) {
    this.bones.forEach(({ node }, i) => {
      node.position.lerpVectors(a[i].position, b[i].position, alpha);
      node.quaternion.slerpQuaternions(a[i].rotation, b[i].rotation, alpha);
    });
  }

  _chestPose(pullback) {
    // Bake one stable bend plane into two poses; playback only blends these joint rotations.
    this._apply(this.neutral, this.neutral, 0);
    this.bones.forEach(({ node }, i) => {
      if (/^R_(arm_|elbow_|wrist_|thumb|point|middle|ring|pink)/.test(node.name)) {
        node.position.copy(this.punch[i].position); node.quaternion.copy(this.punch[i].rotation);
      }
    });
    this.group.updateWorldMatrix(true, true);
    const arm = this.arms[1], start = arm.upper.getWorldPosition(V()), middle = arm.lower.getWorldPosition(V());
    const target = this.group.worldToLocal(this.chest.getWorldPosition(V())).add(V(-0.35 - pullback * 0.5, 0.12, 0.85 + pullback));
    this.group.localToWorld(target);
    const a = start.distanceTo(middle), b = middle.distanceTo(arm.hand.getWorldPosition(V()));
    const axis = target.clone().sub(start), distance = THREE.MathUtils.clamp(axis.length(), Math.abs(a - b) + 0.01, a + b - 0.01);
    axis.normalize();
    const pole = this.group.localToWorld(V(-1.8, 1.8, 0.6)).sub(start);
    pole.addScaledVector(axis, -pole.dot(axis)).normalize();
    const along = (a * a - b * b + distance * distance) / (2 * distance);
    const elbow = start.clone().addScaledVector(axis, along).addScaledVector(pole, Math.sqrt(Math.max(0, a * a - along * along)));
    aim(arm.upper, arm.lower.position, elbow); aim(arm.lower, arm.hand.position, target);
    return this.bones.map(({ node }) => ({ position: node.position.clone(), rotation: node.quaternion.clone() }));
  }

  _grip(closed) {
    for (const [bone, rotation] of this.degreeCatch.closedFingers) {
      const rest = this.degreeCatch.pose.find(saved => saved.node === bone)?.rotation;
      if (rest) bone.quaternion.copy(rest).slerp(rotation, closed);
    }
  }

  _wideSpinPose() {
    this._apply(this.neutral, this.neutral, 0);
    this.group.updateWorldMatrix(true, true);
    // Drop into the pivot so the arms sweep broadly at the player's upper-body
    // height, instead of hanging diagonally from the monster's tall shoulders.
    const hips = this.hips.getWorldPosition(V()).add(V(0, -0.7, 0));
    this.hips.position.copy(this.hips.parent.worldToLocal(hips));
    this.group.updateWorldMatrix(true, true);
    for (const arm of this.arms) {
      const start = arm.upper.getWorldPosition(V()), elbow = arm.lower.getWorldPosition(V());
      const a = start.distanceTo(elbow), b = elbow.distanceTo(arm.hand.getWorldPosition(V()));
      const shoulder = this.group.worldToLocal(start.clone()), sign = Math.sign(shoulder.x);
      const wrist = this.group.getWorldQuaternion(new THREE.Quaternion()).invert()
        .multiply(arm.hand.getWorldQuaternion(new THREE.Quaternion()));
      const reach = (a + b) * 0.97;
      const drop = Math.min(reach * 0.65, Math.max(0, shoulder.y - 1.9));
      const target = this.group.localToWorld(shoulder.clone().add(V(sign * Math.sqrt(reach * reach - drop * drop), -drop, 0)));
      const axis = target.clone().sub(start).normalize();
      const pole = this.group.localToWorld(shoulder.clone().add(V(sign * 0.5, -0.1, -1))).sub(start);
      pole.addScaledVector(axis, -pole.dot(axis)).normalize();
      const along = (a * a - b * b + reach * reach) / (2 * reach);
      const bend = start.clone().addScaledVector(axis, along).addScaledVector(pole, Math.sqrt(Math.max(0, a * a - along * along)));
      aim(arm.upper, arm.lower.position, bend); aim(arm.lower, arm.hand.position, target);
      arm.hand.quaternion.copy(arm.hand.parent.getWorldQuaternion(new THREE.Quaternion()).invert())
        .multiply(this.group.getWorldQuaternion(new THREE.Quaternion())).multiply(wrist);
    }
    return this.bones.map(({ node }) => ({ position: node.position.clone(), rotation: node.quaternion.clone() }));
  }

  _sprintPose() {
    this._apply(this.neutral, this.neutral, 0);
    const phase = (this.walkDistance / SPRINT_CYCLE_DISTANCE) % 1;
    this.group.updateWorldMatrix(true, true);
    const hips = this.group.worldToLocal(this.hips.getWorldPosition(V()));
    // Flexed knees carry the weight; a short flight separates alternate push-offs.
    const half = phase % 0.5;
    const flight = half > SPRINT_STANCE ? Math.sin(Math.PI * (half - SPRINT_STANCE) / (0.5 - SPRINT_STANCE)) : 0;
    hips.set(0.04 * Math.sin(phase * Math.PI * 2), 1.73 + flight * 0.1, -0.3);
    this.hips.position.copy(this.hips.parent.worldToLocal(this.group.localToWorld(hips)));
    const leanAxis = V(1, 0, 0).applyQuaternion(this.hips.parent.getWorldQuaternion(new THREE.Quaternion()).invert());
    this.hips.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(leanAxis, 0.19));
    this.group.updateWorldMatrix(true, true);
    for (const [index, arm] of this.arms.entries()) {
      const shoulder = this.group.worldToLocal(arm.upper.getWorldPosition(V()));
      const drive = Math.cos(phase * Math.PI * 2 + index * Math.PI);
      // Contralateral arm drive, elbows bent rather than dangling by the thighs.
      const elbow = shoulder.clone().add(V(Math.sign(shoulder.x) * 0.12, -0.75, -drive * 0.7));
      aim(arm.upper, arm.lower.position, this.group.localToWorld(elbow));
      const forearm = V(0, 0.25, 0.72).applyQuaternion(this.group.quaternion);
      const hand = arm.lower.getWorldPosition(V()).add(forearm);
      aim(arm.lower, arm.hand.position, hand);
    }
    for (const [index, leg] of this.legs.entries()) {
      const p = (phase + index * 0.5) % 1, front = SPRINT_CYCLE_DISTANCE * SPRINT_STANCE / 2;
      const swing = p >= SPRINT_STANCE, t = swing ? (p - SPRINT_STANCE) / (1 - SPRINT_STANCE) : p / SPRINT_STANCE;
      const z = swing ? THREE.MathUtils.lerp(-front, front, smooth(t, 0, 1)) : front - SPRINT_CYCLE_DISTANCE * p;
      this.sprintFeet[index].set(leg.anchor.x * 0.85, leg.anchor.y + (swing ? Math.sin(Math.PI * t) * 0.72 : 0), -0.3 + z);
      const pitch = swing ? 0.15 * Math.sin(Math.PI * t) : -0.4 * smooth(t, 0.65, 1);
      this.sprintRotations[index].copy(leg.rotation).premultiply(new THREE.Quaternion().setFromAxisAngle(V(1, 0, 0), pitch));
    }
  }

  update(kind, age, dt = 0, angle = 0, closed = 1, airborne = false) {
    if (kind !== this.previousKind || age < this.previousAge - 0.01) {
      this.bones.forEach(({ node }, i) => {
        this.transitionFrom[i].position.copy(node.position);
        this.transitionFrom[i].rotation.copy(node.quaternion);
      });
      this.legs.forEach((leg, i) => this.transitionFeet[i].copy(this.group.worldToLocal(leg.foot.getWorldPosition(V()))));
      this.transitionTime = 0;
    }
    this.previousKind = kind; this.previousAge = age;
    this.transitionTime += dt;
    for (const saved of this.bones) { saved.node.position.copy(saved.position); saved.node.quaternion.copy(saved.rotation); }
    if (kind === 'idle' || kind === 'sprint') {
      this.idleTime += dt;
      this.walkWeight = THREE.MathUtils.damp(this.walkWeight, Math.min(1, this.moveSpeed / 2), 14, dt);
      // Ping-pong the complete breathing motion, avoiding a seam at the idle loop.
      this.sampleNative(0.83 * (1 - Math.cos(this.idleTime * Math.PI / 1.66)), this.idlePose);
      // Native walk: 2–3 s, two steps, about 3.72 world units per cycle.
      this.sampleNative(2 + (this.walkDistance / 3.72) % 1, this.walkPose);
      this._apply(this.idlePose, this.walkPose, this.walkWeight);
      if (kind === 'sprint') {
        this.bones.forEach(({ node }, i) => {
          this.walkBase[i].position.copy(node.position); this.walkBase[i].rotation.copy(node.quaternion);
        });
        this.legs.forEach((leg, i) => this.walkFeet[i].copy(this.group.worldToLocal(leg.foot.getWorldPosition(V()))));
        this._sprintPose();
        const runWeight = smooth(this.moveSpeed, 2, 7);
        this.bones.forEach(({ node }, i) => {
          node.position.lerpVectors(this.walkBase[i].position, node.position, runWeight);
          node.quaternion.slerp(this.walkBase[i].rotation, 1 - runWeight);
        });
      }
    }
    else {
      const frames = kind === 'smash' ? [[0, this.neutral], [0.5, this.raised], [0.65, this.raised],
        [0.9, this.ground], [1.08, this.ground], [1.6, this.neutral]]
        : kind === 'enrage' ? [[0, this.neutral], [0.25, this.chestReady], [0.4, this.chestStrike],
          [0.6, this.chestReady], [0.75, this.chestStrike], [0.95, this.chestReady],
          [1.1, this.chestStrike], [1.5, this.neutral]]
        : kind === 'spin' ? [[0, this.neutral], [0.18, this.spinWide],
          [0.76, this.spinWide], [0.95, this.neutral]]
        : kind === 'slam' ? [[0, this.neutral], [0.16, this.tuck], [0.28, this.launch],
          [0.48, this.tuck], [0.65, this.tuck], [1.05, this.seated], [1.12, this.compressed],
          [1.22, this.seated], [1.55, this.neutral]]
        : kind === 'throw' ? [[0, this.neutral], [0.4, this.windup], [0.8, this.release], [1.35, this.neutral]]
          : kind === 'dying' ? [[0, this.neutral], [0.45, this.tuck], [1.5, this.neutral]] : [[0, this.neutral], [0.65, this.neutral]];
      const time = Math.min(age, frames.at(-1)[0]); let index = 0;
      while (index < frames.length - 2 && time > frames[index + 1][0]) index++;
      const [start, a] = frames[index], [end, b] = frames[index + 1];
      this._apply(a, b, smooth(time, start, end));
    }
    // Blend from the pose actually visible at the handoff, not a neutral reset.
    const blend = smooth(this.transitionTime, 0, kind === 'sprint' ? 0.22 : 0.14);
    if (blend < 1) this.bones.forEach(({ node }, i) => {
      node.position.lerpVectors(this.transitionFrom[i].position, node.position, blend);
      node.quaternion.slerp(this.transitionFrom[i].rotation, 1 - blend);
    });
    if (kind === 'spin' && this.spinAnchor) {
      // Carry body weight over the foot that actually ended the sprint. Without
      // this transfer the old wide running stance can exceed the leg's reach.
      this.group.updateWorldMatrix(true, true);
      const offset = this.spinAnchor.clone().sub(this.legs[this.spinSupport].anchor).setY(-0.06).multiplyScalar(0.8 * blend);
      const worldOffset = offset.applyQuaternion(this.group.quaternion);
      this.hips.position.copy(this.hips.parent.worldToLocal(this.hips.getWorldPosition(V()).add(worldOffset)));
    }
    this.group.updateWorldMatrix(true, true);
    const seated = kind === 'slam' ? smooth(age, 0.65, 1.05) * (1 - smooth(age, 1.22, 1.55)) : 0;
    for (const [index, leg] of this.legs.entries()) {
      if (kind === 'dying') continue;
      // Extend the feet ahead of the hips for the body slam, then put them back for standing.
      let contact = seated > 0 ? { ...leg, anchor: leg.anchor.clone().add(V(leg.sign * 0.12, 0.28, 1.05).multiplyScalar(seated)) } : leg;
      if ((kind === 'idle' || kind === 'sprint') && this.walkWeight > 0.001) {
        const nativePosition = this.group.worldToLocal(leg.foot.getWorldPosition(V()));
        if (kind === 'sprint') {
          const runWeight = smooth(this.moveSpeed, 2, 7);
          nativePosition.copy(this.walkFeet[index]).lerp(this.sprintFeet[index], runWeight);
        }
        const nativeRotation = this.group.getWorldQuaternion(new THREE.Quaternion()).invert()
          .multiply(leg.foot.getWorldQuaternion(new THREE.Quaternion()));
        if (kind === 'sprint') nativeRotation.slerp(this.sprintRotations[index], smooth(this.moveSpeed, 2, 7));
        contact = { ...leg, anchor: nativePosition, rotation: nativeRotation };
      }
      if (kind === 'spin' && this.spinAnchor) {
        contact = { ...leg, anchor: index === this.spinSupport ? this.spinAnchor : leg.anchor.clone().add(
          V(0, 0.2 * Math.sin(Math.PI * smooth(age / 0.95, 0.08, 0.78)), 0)) };
      }
      if (kind === 'slam' && airborne) {
        const free = smooth(age, 0.28, 0.42) * (1 - seated);
        const nativePosition = this.group.worldToLocal(leg.foot.getWorldPosition(V()));
        const nativeRotation = this.group.getWorldQuaternion(new THREE.Quaternion()).invert()
          .multiply(leg.foot.getWorldQuaternion(new THREE.Quaternion()));
        contact = { ...leg, anchor: contact.anchor.clone().lerp(nativePosition, free),
          rotation: leg.rotation.clone().slerp(nativeRotation, free) };
      }
      if (blend < 1) contact = { ...contact,
        anchor: this.transitionFeet[index].clone().lerp(contact.anchor, blend) };
      plant(contact, this.group);
    }
    this._grip(closed); this.group.updateWorldMatrix(true, true);
    this.impactPoint.copy(this.arms[0].hand.getWorldPosition(V())).add(this.arms[1].hand.getWorldPosition(V())).multiplyScalar(0.5).setY(0);
  }

  dispose() {
    this.sampleMixer.stopAllAction(); this.sampleMixer.uncacheRoot(this.sampleRig);
    this.sampleRig.traverse(node => { if (node.isSkinnedMesh) node.skeleton.dispose(); });
    for (const saved of this.bones) { saved.node.position.copy(saved.position); saved.node.quaternion.copy(saved.rotation); }
  }
}
