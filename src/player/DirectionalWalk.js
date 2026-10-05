import * as THREE from 'three';

export const DIRECTIONAL_STEP_LENGTH = 0.36;

/** Build in-place footwork on this rig while preserving its authored aiming pose. */
export function createDirectionalWalkClips(model, idleClip) {
  if (!idleClip) return [];
  const mixer = new THREE.AnimationMixer(model);
  mixer.clipAction(idleClip).play(); mixer.update(0);
  model.updateWorldMatrix(true, true);
  const legs = ['L', 'R'].map(side => ({
    upper: model.getObjectByName(`UpperLeg${side}`),
    lower: model.getObjectByName(`LowerLeg${side}`),
    foot: model.getObjectByName(`Foot${side}`),
  }));
  if (legs.some(leg => !leg.upper || !leg.lower || !leg.foot)) { mixer.stopAllAction(); return []; }
  const bones = [];
  model.traverse(node => { if (node.isBone) bones.push(node); });
  const rest = bones.map(bone => ({ bone, position: bone.position.clone(), rotation: bone.quaternion.clone() }));
  for (const leg of legs) {
    leg.base = leg.foot.getWorldPosition(new THREE.Vector3());
    leg.footMatrix = leg.foot.matrixWorld.clone();
    leg.hip = leg.upper.getWorldPosition(new THREE.Vector3());
    const knee = leg.lower.getWorldPosition(new THREE.Vector3());
    leg.thighLength = leg.hip.distanceTo(knee);
    leg.shinLength = knee.distanceTo(leg.base);
    // This rig's feet are independent Root children, not children of the shins.
    leg.shinEndLocal = leg.lower.worldToLocal(leg.base.clone());
  }
  const centerX = (legs[0].base.x + legs[1].base.x) / 2;
  const body = model.getObjectByName('Body');
  const bodyBase = body?.getWorldPosition(new THREE.Vector3());
  const translatedBones = [...legs.map(leg => leg.foot), ...(body ? [body] : [])];
  const restore = () => {
    for (const pose of rest) { pose.bone.position.copy(pose.position); pose.bone.quaternion.copy(pose.rotation); }
    model.updateWorldMatrix(true, true);
  };
  const clips = [];
  const directions = { StrafeLeft: [-1, 0], StrafeRight: [1, 0], WalkBackward: [0, 1],
    WalkForwardLeft: [-1, -1], WalkForwardRight: [1, -1], WalkBackwardLeft: [-1, 1], WalkBackwardRight: [1, 1] };
  for (const [name, [x, z]] of Object.entries(directions)) {
    const direction = new THREE.Vector3(x, 0, z).normalize();
    const times = [], rotations = new Map(bones.map(bone => [bone, []]));
    const positions = new Map(translatedBones.map(bone => [bone, []]));
    for (let sample = 0; sample <= 32; sample++) {
      restore(); times.push(sample / 32 * 0.6);
      if (body) {
        // A small knee bend leaves enough reach for a grounded side-step.
        body.position.copy(body.parent.worldToLocal(bodyBase.clone().add(new THREE.Vector3(0, -0.08, 0))));
        body.updateWorldMatrix(false, true);
      }
      for (let index = 0; index < legs.length; index++) {
        const leg = legs[index];
        // Use the rendered foot positions: Shaun's rig is mirrored for his gun grip.
        const leading = x ? Math.sign(leg.base.x - centerX) === Math.sign(x) : index === 0;
        const phase = (sample / 32 + (leading ? 0 : 0.5)) % 1;
        const swing = phase < 0.5;
        const t = swing ? phase * 2 : (phase - 0.5) * 2;
        const stride = DIRECTIONAL_STEP_LENGTH;
        // A lateral shuffle steps outward then brings the other foot in, without crossing.
        const offset = x ? (leading ? stride / 2 : -stride / 2) : 0;
        const travel = swing ? -stride / 2 + stride * THREE.MathUtils.smoothstep(t, 0, 1)
          : stride / 2 - stride * t;
        const target = leg.base.clone().addScaledVector(direction, travel + offset);
        target.y += swing ? Math.sin(t * Math.PI) * 0.12 : 0;
        poseLeg(leg, target);
      }
      for (const bone of bones) rotations.get(bone).push(...bone.quaternion.toArray());
      for (const bone of translatedBones) positions.get(bone).push(...bone.position.toArray());
    }
    const tracks = idleClip.tracks.filter(track => !track.name.endsWith('.quaternion')
      && !translatedBones.some(bone => track.name === `${bone.name}.position`)).map(track => {
      const copy = track.clone();
      // Keep the gun stance and root stationary during the new gait.
      const stride = copy.getValueSize();
      copy.times = new Float32Array([0, 0.6]);
      copy.values = new Float32Array([...copy.values.slice(0, stride), ...copy.values.slice(0, stride)]);
      return copy;
    });
    for (const bone of bones) tracks.push(new THREE.QuaternionKeyframeTrack(`${bone.name}.quaternion`, times, rotations.get(bone)));
    for (const bone of translatedBones) tracks.push(new THREE.VectorKeyframeTrack(`${bone.name}.position`, times, positions.get(bone)));
    clips.push(new THREE.AnimationClip(name, 0.6, tracks));
  }
  restore(); mixer.stopAllAction(); mixer.uncacheRoot(model);
  return clips;
}

function aimBone(bone, child, target) {
  const localTarget = bone.parent.worldToLocal(target.clone()).sub(bone.position).normalize();
  const current = child.position.clone().applyQuaternion(bone.quaternion).normalize();
  bone.quaternion.premultiply(new THREE.Quaternion().setFromUnitVectors(current, localTarget));
  bone.updateWorldMatrix(false, true);
}

function poseLeg(leg, target) {
  const hip = leg.upper.getWorldPosition(new THREE.Vector3());
  const delta = target.clone().sub(hip);
  const distance = Math.min(delta.length(), (leg.thighLength + leg.shinLength) * 0.995);
  const axis = delta.normalize();
  // Knees bend toward the character's forward (-Z), even when stepping backward.
  const bend = new THREE.Vector3(0, 0, -1).addScaledVector(axis, axis.z).normalize();
  const along = (leg.thighLength ** 2 - leg.shinLength ** 2 + distance ** 2) / (2 * distance);
  const height = Math.sqrt(Math.max(0, leg.thighLength ** 2 - along ** 2));
  const knee = hip.clone().addScaledVector(axis, along).addScaledVector(bend, height);
  aimBone(leg.upper, leg.lower, knee);
  const reachable = hip.clone().addScaledVector(axis, distance);
  aimBone(leg.lower, { position: leg.shinEndLocal }, reachable);
  const matrix = leg.foot.parent.matrixWorld.clone().invert().multiply(leg.footMatrix);
  matrix.decompose(new THREE.Vector3(), leg.foot.quaternion, new THREE.Vector3());
  leg.foot.position.copy(leg.foot.parent.worldToLocal(reachable));
  leg.foot.updateWorldMatrix(false, true);
}
