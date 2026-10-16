import * as THREE from 'three';

const find = (root, name) => root.getObjectByName(THREE.PropertyBinding.sanitizeNodeName(name));
const PIVOT = new THREE.Vector3(0, 0.415, 0);

/** Give the kit's oversized hand a wrist; its source rig joins the palm to the elbow bone. */
export function installDeanSupportWrist(dean) {
  const forearm = find(dean.group, 'LowerArm.R');
  if (!forearm || find(dean.group, 'DeanSupportWrist')) return;
  const wrist = new THREE.Bone(); wrist.name = 'DeanSupportWrist';
  const fingers = forearm.children.filter(node => /^(Index|Middle|Pinky|Thumb)1R$/.test(node.name));
  forearm.add(wrist);
  // Keep the original animation coordinates: the wrist rotates about PIVOT
  // using a compensating translation, so all existing finger tracks still fit.
  for (const finger of fingers) wrist.add(finger);
  dean.group.updateWorldMatrix(true, true);
  const position = new THREE.Vector3(), oldSkeletons = new Set();
  dean.group.traverse(mesh => {
    if (!mesh.isSkinnedMesh) return;
    const old = mesh.skeleton, armIndex = old.bones.indexOf(forearm);
    if (armIndex < 0) return;
    const geometry = mesh.geometry.clone(); mesh.geometry = geometry;
    const skeleton = new THREE.Skeleton([...old.bones, wrist], [...old.boneInverses.map(inverse => inverse.clone()), old.boneInverses[armIndex].clone()]);
    const handIndex = skeleton.bones.length - 1;
    const indices = geometry.attributes.skinIndex, weights = geometry.attributes.skinWeight;
    for (let vertex = 0; vertex < indices.count; vertex++) {
      position.fromBufferAttribute(geometry.attributes.position, vertex).applyMatrix4(mesh.bindMatrix).applyMatrix4(old.boneInverses[armIndex]);
      const blend = THREE.MathUtils.smoothstep(position.y, 0.37, 0.46);
      if (blend === 0) continue;
      const influences = []; let transferred = 0;
      for (let slot = 0; slot < 4; slot++) {
        const index = indices.getComponent(vertex, slot), weight = weights.getComponent(vertex, slot);
        if (index === armIndex) {
          transferred += weight * blend;
          if (weight * (1 - blend) > 0) influences.push([index, weight * (1 - blend)]);
        } else if (weight > 0) influences.push([index, weight]);
      }
      if (transferred === 0) continue;
      influences.push([handIndex, transferred]); influences.sort((a, b) => b[1] - a[1]);
      const total = influences.slice(0, 4).reduce((sum, entry) => sum + entry[1], 0);
      for (let slot = 0; slot < 4; slot++) {
        indices.setComponent(vertex, slot, influences[slot]?.[0] ?? 0);
        weights.setComponent(vertex, slot, (influences[slot]?.[1] ?? 0) / total);
      }
    }
    indices.needsUpdate = weights.needsUpdate = true;
    mesh.bind(skeleton, mesh.bindMatrix); oldSkeletons.add(old);
  });
  for (const skeleton of oldSkeletons) skeleton.dispose();
  dean._ownsGeometry = true;
}

/** A palm-down brace with a bounded wrist hinge and a fixed ground contact. Used only when baking. */
export class DeanSupportPose {
  constructor(rig) {
    this.rig = rig; this.upper = find(rig, 'UpperArm.R'); this.forearm = find(rig, 'LowerArm.R');
    this.wrist = find(rig, 'DeanSupportWrist');
    this.contact = rig.localToWorld(new THREE.Vector3(-0.7, 0.09, -0.94));
    this.floorY = rig.localToWorld(new THREE.Vector3()).y;
    this.palmOffset = new THREE.Vector3(0, 0.535, 0.025).sub(PIVOT);
    this.fingers = ['Index', 'Middle', 'Pinky', 'Thumb'].map((name, index) => ({
      nodes: [1, 2, 3].map(joint => find(rig, `${name}${joint}.R`)).filter(Boolean),
      direction: new THREE.Vector3([-0.16, 0, 0.22, -0.85][index], index === 3 ? 0.52 : 1, 0.035).normalize(),
    }));
    this.handVertices = [];
    rig.traverse(mesh => {
      if (!mesh.isSkinnedMesh) return;
      const handBones = new Set(mesh.skeleton.bones.map((bone, index) =>
        /^(DeanSupportWrist|(Index|Middle|Pinky|Thumb)[123]R)$/.test(bone.name) ? index : -1));
      handBones.delete(-1);
      const indices = mesh.geometry.attributes.skinIndex, weights = mesh.geometry.attributes.skinWeight, vertices = [];
      for (let vertex = 0; vertex < indices.count; vertex++) {
        let weight = 0;
        for (let slot = 0; slot < 4; slot++) if (handBones.has(indices.getComponent(vertex, slot))) weight += weights.getComponent(vertex, slot);
        if (weight > 0.4) vertices.push(vertex);
      }
      this.handVertices.push({ mesh, vertices });
    });
    this.a = new THREE.Vector3(); this.b = new THREE.Vector3(); this.c = new THREE.Vector3();
    this.target = new THREE.Vector3(); this.direction = new THREE.Vector3(); this.pole = new THREE.Vector3();
    this.elbow = new THREE.Vector3(); this.across = new THREE.Vector3(); this.normal = new THREE.Vector3();
    this.from = new THREE.Vector3(); this.to = new THREE.Vector3(); this.point = new THREE.Vector3();
    this.worldScale = new THREE.Vector3(); this.matrix = new THREE.Matrix4();
    this.parent = new THREE.Quaternion(); this.rotation = new THREE.Quaternion(); this.local = new THREE.Quaternion();
    this.palmRotation = new THREE.Quaternion(); this.actualPalm = new THREE.Quaternion();
  }

  _turn(joint, current, desired) {
    this.from.copy(current).sub(this.a).normalize(); this.to.copy(desired).sub(this.a).normalize();
    this.rotation.setFromUnitVectors(this.from, this.to); joint.parent.getWorldQuaternion(this.parent);
    this.local.copy(this.parent).invert().multiply(this.rotation).multiply(this.parent);
    joint.quaternion.premultiply(this.local); joint.updateWorldMatrix(false, true);
  }

  _solve(goal) {
    this.upper.getWorldPosition(this.a); this.forearm.getWorldPosition(this.b);
    this.c.copy(PIVOT); this.forearm.localToWorld(this.c);
    const upperLength = this.a.distanceTo(this.b), lowerLength = this.b.distanceTo(this.c);
    this.forearm.getWorldScale(this.worldScale);
    this.target.copy(this.palmOffset).multiply(this.worldScale).applyQuaternion(this.actualPalm);
    this.target.subVectors(goal, this.target); this.direction.copy(this.target).sub(this.a);
    const distance = THREE.MathUtils.clamp(this.direction.length(), Math.abs(upperLength - lowerLength) + 0.001, upperLength + lowerLength - 0.001);
    this.direction.normalize(); this.target.copy(this.a).addScaledVector(this.direction, distance);
    this.pole.set(-0.65, 0.4, -1.45); this.rig.localToWorld(this.pole); this.pole.sub(this.a);
    this.pole.addScaledVector(this.direction, -this.pole.dot(this.direction)).normalize();
    const along = (upperLength ** 2 - lowerLength ** 2 + distance ** 2) / (2 * distance);
    this.elbow.copy(this.a).addScaledVector(this.direction, along)
      .addScaledVector(this.pole, Math.sqrt(Math.max(0, upperLength ** 2 - along ** 2)));
    this._turn(this.upper, this.b, this.elbow);
    this.forearm.getWorldPosition(this.b); this.direction.copy(this.target).sub(this.b).normalize();
    this.across.set(1, 0, 0).applyQuaternion(this.palmRotation);
    this.across.addScaledVector(this.direction, -this.across.dot(this.direction)).normalize();
    this.normal.crossVectors(this.across, this.direction).normalize();
    this.rotation.setFromRotationMatrix(this.matrix.makeBasis(this.across, this.direction, this.normal));
    this.forearm.parent.getWorldQuaternion(this.parent).invert();
    this.forearm.quaternion.copy(this.parent).multiply(this.rotation); this.forearm.updateWorldMatrix(false, true);
    this.local.copy(this.rotation).invert().multiply(this.palmRotation);
    const angle = 2 * Math.acos(Math.min(1, Math.abs(this.local.w)));
    this.wrist.quaternion.identity().slerp(this.local, Math.min(1, 1.13 / Math.max(0.001, angle)));
    this.wrist.position.copy(PIVOT).sub(this.point.copy(PIVOT).applyQuaternion(this.wrist.quaternion));
    this.wrist.updateWorldMatrix(false, true); this.wrist.getWorldQuaternion(this.actualPalm);
  }

  apply(weight) {
    if (!this.wrist || !this.upper || !this.forearm || weight <= 0) return;
    const saved = [this.upper, this.forearm, this.wrist, ...this.fingers.flatMap(finger => finger.nodes)]
      .map(node => ({ node, rotation: node.quaternion.clone() }));
    this.direction.set(-0.65, 0, 0.75).normalize(); this.rig.getWorldQuaternion(this.parent);
    this.direction.applyQuaternion(this.parent); this.normal.set(0, -1, 0).applyQuaternion(this.parent);
    this.across.crossVectors(this.direction, this.normal).normalize();
    this.palmRotation.setFromRotationMatrix(this.matrix.makeBasis(this.across, this.direction, this.normal));
    this.actualPalm.copy(this.palmRotation);
    const goal = this.contact.clone();
    for (let pass = 0; pass < 6; pass++) {
      this._solve(goal);
      this._solve(goal);
      for (const finger of this.fingers) for (let index = 0; index < finger.nodes.length; index++) {
        const joint = finger.nodes[index]; joint.getWorldPosition(this.a);
        const next = finger.nodes[index + 1];
        if (next) next.getWorldPosition(this.c);
        else { this.c.set(0, 0.1, 0); joint.localToWorld(this.c); }
        this.b.copy(finger.direction).applyQuaternion(this.actualPalm).add(this.a);
        this._turn(joint, this.c, this.b);
      }
      // Blend from the authored arm, including the approach and the release.
      for (const pose of saved) pose.node.quaternion.slerpQuaternions(pose.rotation, pose.node.quaternion.clone(), weight);
      this.wrist.position.copy(PIVOT).sub(this.point.copy(PIVOT).applyQuaternion(this.wrist.quaternion));
      this.rig.updateMatrixWorld(true);
      let lowest = Infinity;
      for (const { mesh, vertices } of this.handVertices) for (const vertex of vertices) {
        mesh.getVertexPosition(vertex, this.point); mesh.localToWorld(this.point); lowest = Math.min(lowest, this.point.y);
      }
      if (weight < 0.5 || !Number.isFinite(lowest)) break;
      const lift = this.floorY + 0.008 - lowest;
      if (Math.abs(lift) < 0.003) break;
      goal.y += THREE.MathUtils.clamp(lift / weight, -0.12, 0.12);
    }
  }
}
