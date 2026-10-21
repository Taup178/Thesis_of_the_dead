import * as THREE from 'three';
import { clone } from 'three/addons/utils/SkeletonUtils.js';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const smooth = THREE.MathUtils.smootherstep;

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

/** Preserve the artist's native arm poses; constrain only the foot contacts. */
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
    const sample = time => {
      mixer.setTime(time);
      return this.bones.map(({ node }) => {
        const bone = sampleRig.getObjectByName(node.name);
        return { position: bone.position.clone(), rotation: bone.quaternion.clone() };
      });
    };
    this.neutral = sample(0); this.raised = sample(11.2); this.ground = sample(11.48);
    this.windup = sample(12.5); this.release = sample(12.75);
    this.punchWindup = sample(6.5); this.punch = sample(7);
    this.launch = sample(7.5); this.tuck = sample(8); this.seated = sample(9);
    mixer.stopAllAction(); mixer.uncacheRoot(sampleRig);
    sampleRig.traverse(node => { if (node.isSkinnedMesh) node.skeleton.dispose(); });
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

  update(kind, age, dt = 0, angle = 0, closed = 1, airborne = false) {
    for (const saved of this.bones) { saved.node.position.copy(saved.position); saved.node.quaternion.copy(saved.rotation); }
    if (kind === 'idle') this.monster.mixer?.update(dt);
    else {
      const frames = kind === 'smash' ? [[0, this.neutral], [0.5, this.raised], [0.65, this.raised],
        [0.9, this.ground], [1.08, this.ground], [1.6, this.neutral]]
        : kind === 'enrage' ? [[0, this.neutral], [0.25, this.chestReady], [0.4, this.chestStrike],
          [0.6, this.chestReady], [0.75, this.chestStrike], [0.95, this.chestReady],
          [1.1, this.chestStrike], [1.5, this.neutral]]
        : kind === 'spin' ? [[0, this.neutral], [0.2, this.punchWindup], [0.35, this.punch],
          [0.72, this.punch], [0.95, this.neutral]]
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
    this.group.updateWorldMatrix(true, true);
    const seated = kind === 'slam' ? smooth(age, 0.65, 1.05) * (1 - smooth(age, 1.22, 1.55)) : 0;
    for (const leg of this.legs) {
      if (kind === 'dying') continue;
      // Extend the feet ahead of the hips for the body slam, then put them back for standing.
      let contact = seated > 0 ? { ...leg, anchor: leg.anchor.clone().add(V(leg.sign * 0.12, 0.28, 1.05).multiplyScalar(seated)) } : leg;
      if (kind === 'slam' && airborne) {
        const free = smooth(age, 0.28, 0.42) * (1 - seated);
        const nativePosition = this.group.worldToLocal(leg.foot.getWorldPosition(V()));
        const nativeRotation = this.group.getWorldQuaternion(new THREE.Quaternion()).invert()
          .multiply(leg.foot.getWorldQuaternion(new THREE.Quaternion()));
        contact = { ...leg, anchor: contact.anchor.clone().lerp(nativePosition, free),
          rotation: leg.rotation.clone().slerp(nativeRotation, free) };
      }
      plant(contact, this.group);
    }
    this._grip(closed); this.group.updateWorldMatrix(true, true);
    this.impactPoint.copy(this.arms[0].hand.getWorldPosition(V())).add(this.arms[1].hand.getWorldPosition(V())).multiplyScalar(0.5).setY(0);
  }

  dispose() {
    for (const saved of this.bones) { saved.node.position.copy(saved.position); saved.node.quaternion.copy(saved.rotation); }
  }
}
