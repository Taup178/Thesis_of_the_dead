import * as THREE from 'three';

const V = () => new THREE.Vector3();

/** Fit the parchment and every digit to Shaun's actual hand, in arm-local space. */
export function fitShaunDegreeGrip(player, arm, grip, scrollScale, fingers) {
  const model = player.characterModel;
  const saved = fingers.map(({ node }) => node.quaternion.clone());
  for (const { node, open } of fingers) node.quaternion.copy(open);
  arm.updateWorldMatrix(true, true);
  const localPoint = node => arm.worldToLocal(node.getWorldPosition(V()));
  // This rig's first finger bones all start at the wrist. Their second joints
  // locate the knuckles; using the first joints gives a zero-width palm.
  const knuckles = ['Index2L', 'Middle2L', 'Pinky2L'].map(name => localPoint(model.getObjectByName(name)));
  const wrist = localPoint(model.getObjectByName('Middle1L'));
  const center = knuckles.reduce((sum, point) => sum.add(point), V()).divideScalar(knuckles.length);
  const across = knuckles[0].clone().sub(knuckles[2]).normalize();
  const forward = center.clone().sub(wrist);
  forward.addScaledVector(across, -forward.dot(across)).normalize();
  const normal = V().crossVectors(forward, across).normalize();
  const gun = model.getObjectByName('SMG');
  if (gun && localPoint(gun).sub(center).dot(normal) < 0) normal.negate();
  const unit = Math.abs(arm.getWorldScale(V()).x);
  const width = knuckles[0].distanceTo(knuckles[2]) * unit;
  const paperFit = THREE.MathUtils.clamp(width * 3.8, 0.62, 0.7) / (0.85 * Math.abs(scrollScale.x));
  const paperRadius = width * 0.3;
  const radialFit = paperRadius / (0.105 * Math.abs(scrollScale.y));
  grip.position.copy(center).addScaledVector(forward, -0.012)
    .addScaledVector(normal, paperRadius / unit + 0.016);
  // Keep a right-handed basis even when the palm normal was flipped.
  const rollForward = V().crossVectors(across, normal).normalize();
  grip.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(across, normal, rollForward));
  const radius = paperRadius / unit + 0.022;
  const contacts = [];
  for (const name of ['Index', 'Middle', 'Pinky', 'Thumb']) {
    const joints = [1, 2, 3].map(i => model.getObjectByName(`${name}${i}L`)).filter(Boolean);
    const points = joints.map(localPoint);
    const terminal = joints.at(-1);
    // The supplied hand has no fingertip bones. Measure the tip from the skin
    // so its final joint also bends around the roll, including the thumb.
    let tipLength = 0;
    model.traverse(mesh => {
      if (!mesh.isSkinnedMesh) return;
      mesh.skeleton.update();
      const skin = mesh.geometry.attributes.skinIndex, weights = mesh.geometry.attributes.skinWeight;
      const boneIndex = mesh.skeleton.bones.indexOf(terminal);
      if (boneIndex < 0) return;
      for (let i = 0; i < skin.count; i++) {
        let weight = 0;
        for (let k = 0; k < 4; k++) if (skin.getComponent(i, k) === boneIndex) weight += weights.getComponent(i, k);
        if (weight < 0.5) continue;
        const vertex = terminal.worldToLocal(mesh.getVertexPosition(i, V()).applyMatrix4(mesh.matrixWorld));
        tipLength = Math.max(tipLength, vertex.y);
      }
    });
    const tip = new THREE.Vector3(0, tipLength, 0);
    points.push(arm.worldToLocal(terminal.localToWorld(tip.clone())));
    const lengths = points.slice(1).map((p, i) => p.distanceTo(points[i]));
    const base = points[0].clone().sub(grip.position);
    const lane = points[1].clone().sub(grip.position).dot(across);
    const y = base.dot(normal), z = base.dot(forward), distance = Math.hypot(y, z);
    const firstLengthSq = lengths[0] ** 2 - (lane - base.dot(across)) ** 2;
    const cosine = THREE.MathUtils.clamp((distance ** 2 + radius ** 2 - firstLengthSq) / (2 * distance * radius), -1, 1);
    const direction = name === 'Thumb' ? -1 : 1;
    let angle = Math.atan2(y, z) + direction * Math.acos(cosine);
    for (let i = 0; i < joints.length; i++) {
      if (i) angle += direction * 2 * Math.asin(Math.min(0.99, lengths[i] / (2 * radius)));
      const target = grip.position.clone().addScaledVector(across, lane)
        .addScaledVector(normal, Math.sin(angle) * radius).addScaledVector(forward, Math.cos(angle) * radius);
      const joint = joints[i], end = joints[i + 1]?.position ?? tip;
      const desired = joint.parent.worldToLocal(arm.localToWorld(target)).sub(joint.position).normalize();
      const current = end.clone().applyQuaternion(joint.quaternion).normalize();
      joint.quaternion.premultiply(new THREE.Quaternion().setFromUnitVectors(current, desired));
      joint.updateWorldMatrix(false, true);
      fingers.find(pose => pose.node === joint).closed.copy(joint.quaternion);
    }
    contacts.push({ joints, tip });
  }
  fingers.forEach(({ node }, i) => node.quaternion.copy(saved[i]));
  arm.updateWorldMatrix(true, true);
  return { paperFit, radialFit, contacts };
}
