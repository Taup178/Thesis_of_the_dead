import * as THREE from 'three';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const X = V(1, 0, 0);

function aim(bone, localEnd, target) {
  bone.parent.updateWorldMatrix(true, false);
  const desired = bone.parent.worldToLocal(target.clone()).sub(bone.position).normalize();
  const current = localEnd.clone().applyQuaternion(bone.quaternion).normalize();
  bone.quaternion.premultiply(new THREE.Quaternion().setFromUnitVectors(current, desired));
  bone.updateWorldMatrix(false, true);
}

function chain(upper, lower, endLocal, target, bendPoint) {
  const hip = upper.getWorldPosition(V()), elbow = lower.getWorldPosition(V());
  const end = lower.localToWorld(endLocal.clone());
  const a = hip.distanceTo(elbow), b = elbow.distanceTo(end);
  const delta = target.clone().sub(hip);
  const distance = THREE.MathUtils.clamp(delta.length(), Math.abs(a - b) + 0.001, (a + b) * 0.995);
  const axis = delta.normalize();
  const bend = bendPoint.clone().sub(hip);
  bend.addScaledVector(axis, -bend.dot(axis)).normalize();
  const along = (a * a - b * b + distance * distance) / (2 * distance);
  const joint = hip.clone().addScaledVector(axis, along)
    .addScaledVector(bend, Math.sqrt(Math.max(0, a * a - along * along)));
  aim(upper, lower.position, joint);
  aim(lower, endLocal, hip.addScaledVector(axis, distance));
}

/** Contact-aware pose for the supplied rig, including its independently parented feet. */
export class OpeningPose {
  constructor(model, idleClip, { seatY = 0.5, seatZ = 0.02, handClip } = {}) {
    this.model = model; this.seatY = seatY; this.seatZ = seatZ;
    if (idleClip) {
      const mixer = new THREE.AnimationMixer(model);
      mixer.clipAction(idleClip).play(); mixer.update(0.01);
      const pose = [];
      model.traverse(node => { if (node.isBone) pose.push([node, node.position.clone(), node.quaternion.clone(), node.scale.clone()]); });
      mixer.stopAllAction(); mixer.uncacheRoot(model);
      for (const [node, position, quaternion, scale] of pose) {
        node.position.copy(position); node.quaternion.copy(quaternion); node.scale.copy(scale);
      }
    }
    this.bones = [];
    model.traverse(node => {
      if (node.isBone) this.bones.push({ node, position: node.position.clone(), quaternion: node.quaternion.clone() });
    });
    this.handPose = [];
    if (handClip) {
      const mixer = new THREE.AnimationMixer(model);
      mixer.clipAction(handClip).play(); mixer.update(0.6);
      model.traverse(node => {
        if (node.isBone && /^(Index|Middle|Pinky|Thumb)[123][LR]$/.test(node.name)) {
          this.handPose.push({ node, quaternion: node.quaternion.clone() });
        }
      });
      mixer.stopAllAction(); mixer.uncacheRoot(model);
      for (const { node, position, quaternion } of this.bones) {
        node.position.copy(position); node.quaternion.copy(quaternion);
      }
    }
    this.hips = model.getObjectByName('Hips');
    this.head = model.getObjectByName('Head');
    this.abdomen = model.getObjectByName('Abdomen');
    this.torso = model.getObjectByName('Torso');
    if (!this.hips || !this.head) throw new Error('Opening requires Shaun\'s head and hips rig.');
    model.updateMatrixWorld(true);
    const hip = this.hips.getWorldPosition(V());
    model.position.add(V(-hip.x, seatY + 0.07 - hip.y, seatZ - hip.z));
    model.updateMatrixWorld(true);
    this.basePosition = model.position.clone();
    this.footHeight = 0.07;
    this.limbs = ['L', 'R'].map(side => {
      const upper = model.getObjectByName(`UpperLeg${side}`), lower = model.getObjectByName(`LowerLeg${side}`);
      const foot = model.getObjectByName(`Foot${side}`);
      const arm = model.getObjectByName(`UpperArm${side}`), forearm = model.getObjectByName(`LowerArm${side}`);
      const finger = model.getObjectByName(`Middle1${side}`);
      const sign = Math.sign(upper.getWorldPosition(V()).x) || 1;
      return { upper, lower, foot, arm, forearm, finger, sign,
        shinEnd: lower.worldToLocal(foot.getWorldPosition(V())), footMatrix: foot.matrixWorld.clone() };
    });
    this.update(0);
    // A hip joint is not the underside of the body. Fit the actual deformed
    // seat-contact vertices, then solve the legs again with the soles grounded.
    for (let iteration = 0; iteration < 2; iteration++) {
      const hip = this.hips.getWorldPosition(V());
      let seatBottom = Infinity, sole = Infinity;
      model.traverse(mesh => {
        if (!mesh.isSkinnedMesh) return;
        mesh.skeleton.update();
        const indices = mesh.geometry.attributes.skinIndex;
        const weights = mesh.geometry.attributes.skinWeight;
        for (let i = 0; i < mesh.geometry.attributes.position.count; i++) {
          const point = mesh.getVertexPosition(i, V()).applyMatrix4(mesh.matrixWorld);
          let pelvisWeight = 0;
          for (let component = 0; component < 4; component++) {
            const name = mesh.skeleton.bones[indices.getComponent(i, component)]?.name;
            if (name === 'Hips' || name === 'Body') pelvisWeight += weights.getComponent(i, component);
          }
          if (Math.abs(point.x) < 0.24 && point.z > hip.z - 0.2 && point.z < hip.z + 0.1
            && point.y > seatY - 0.25 && point.y < hip.y + 0.2 && pelvisWeight > 0.5) seatBottom = Math.min(seatBottom, point.y);
          if (point.z > seatZ + 0.2 && point.y < 0.25) sole = Math.min(sole, point.y);
        }
      });
      if (Number.isFinite(seatBottom)) this.basePosition.y += seatY + 0.004 - seatBottom;
      if (Number.isFinite(sole)) this.footHeight += 0.006 - sole;
      this.update(0);
    }
  }

  update(time) {
    const model = this.model;
    for (const { node, position, quaternion } of this.bones) {
      node.position.copy(position); node.quaternion.copy(quaternion);
    }
    model.position.copy(this.basePosition);
    const rock = Math.sin(time * 2.35) * 0.045 + Math.sin(time * 1.13) * 0.012;
    this.abdomen?.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(X, 0.12 + rock));
    this.torso?.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(X, 0.06 + rock * 0.45));
    this.head.quaternion.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(0.08 + rock * 0.2, Math.sin(time * 0.8) * 0.025, 0)));
    for (const { node, quaternion } of this.handPose) node.quaternion.copy(quaternion);
    if (this.torso) this.torso.position.y += Math.sin(time * 3.1) * 0.0025;
    model.updateMatrixWorld(true);
    for (const leg of this.limbs) {
      const { sign } = leg;
      const ankle = V(sign * 0.18, this.footHeight, this.seatZ + 0.34);
      chain(leg.upper, leg.lower, leg.shinEnd, ankle, V(sign * 0.23, 0.4, this.seatZ + 0.7));
      // Foot bones belong to Root, not the shin; plant them independently.
      leg.foot.position.copy(leg.foot.parent.worldToLocal(ankle.clone()));
      const matrix = leg.foot.parent.matrixWorld.clone().invert().multiply(leg.footMatrix);
      matrix.decompose(V(), leg.foot.quaternion, V());
    }
    model.updateMatrixWorld(true);
    const head = this.head.getWorldPosition(V());
    for (const arm of this.limbs) {
      const wrist = head.clone().add(V(arm.sign * 0.33, 0.10, 0.08));
      chain(arm.arm, arm.forearm, arm.finger.position, wrist,
        head.clone().add(V(arm.sign * 0.5, -0.36, 0.30)));
      // Preserve the authored finger pose. Independently aiming each finger
      // collapses the supplied glove mesh and tears its atlas seams.
    }
    model.updateMatrixWorld(true);
    this.focus = head.clone().add(V(0, 0.18, 0.04));
  }
}
