import * as THREE from 'three';
import { clone } from 'three/addons/utils/SkeletonUtils.js';

const smooth = THREE.MathUtils.smoothstep;
const bone = (root, name) => root.getObjectByName(THREE.PropertyBinding.sanitizeNodeName(name));
const guardL = [0.32, 0.96, 0.26], guardR = [-0.32, 0.96, 0.26];
const pose = (time, left = guardL, right = guardR, twist = 0, lean = 0, crouch = 0) => ({ time, left, right, twist, lean, crouch });
const sequences = {
  'Double jab': [pose(0), pose(0.19, [0.4, 0.98, 0.06], guardR, -0.16),
    pose(0.34, [0.12, 1.02, 0.64], guardR, 0.23, 0.06), pose(0.48),
    pose(0.65, guardL, [-0.1, 1.02, 0.7], -0.28, 0.08), pose(0.82), pose(1.05)],
  'Sweeping hook': [pose(0), pose(0.32, guardL, [-0.62, 0.98, 0.04], 0.35, -0.05),
    pose(0.55, guardL, [0.25, 1.02, 0.58], -0.48, 0.08),
    pose(0.73, guardL, [0.45, 0.91, 0.24], -0.55, 0.06), pose(1.15)],
  'Charging uppercut': [pose(0), pose(0.34, guardL, [-0.38, 0.48, 0.12], 0.24, 0.12, 0.05),
    pose(0.6, guardL, [-0.16, 1.24, 0.54], -0.24, -0.08), pose(0.8), pose(1.2)],
  'Fist slide': [pose(0), pose(0.43, guardL, [-0.34, 0.7, -0.02], 0.2),
    pose(0.65, [0.4, 0.83, 0.08], [-0.08, 0.75, 0.7], -0.18),
    pose(1.45, [0.4, 0.83, 0.08], [-0.08, 0.75, 0.7], -0.18), pose(2.05)],
  'Rush punches': [pose(0), pose(0.3, [0.42, 0.94, 0.05], guardR, -0.2),
    pose(0.55, [0.1, 1.02, 0.67], guardR, 0.26, 0.08), pose(0.73),
    pose(0.97, guardL, [-0.12, 1.02, 0.68], -0.26, 0.08), pose(1.15),
    pose(1.39, [0.08, 1.02, 0.7], guardR, 0.3, 0.09), pose(1.64), pose(2)],
  'Ground smash': [pose(0), pose(0.38, [0.34, 1.43, 0.03], [-0.34, 1.43, 0.03], 0, -0.16),
    pose(0.62, [0.22, 1.45, 0.09], [-0.22, 1.45, 0.09], 0, -0.18),
    pose(0.78, [0.22, 0.1, 0.54], [-0.22, 0.1, 0.54], 0, 0.95, 0.09),
    pose(0.95, [0.24, 0.16, 0.5], [-0.24, 0.16, 0.5], 0, 0.86, 0.08), pose(1.4), pose(1.75)],
};

/** Bake arm trajectories once at load time; combat uses the ordinary animation mixer. */
export function installDeanAttackMotion(dean) {
  if (!dean.mixer || !dean.actions.Idle || !dean.group.children[0]) return [];
  const rig = clone(dean.group.children[0]);
  const mixer = new THREE.AnimationMixer(rig);
  mixer.clipAction(dean.actions.Idle.getClip()).play();
  mixer.update(0);
  const names = ['Torso', 'Abdomen', 'Hips', 'UpperArm.L', 'LowerArm.L', 'UpperArm.R', 'LowerArm.R'];
  const joints = names.map(name => bone(rig, name));
  const hands = ['L', 'R'].map(side => bone(rig, `Middle1.${side}`));
  if (joints.some(joint => !joint) || hands.some(hand => !hand)) { mixer.stopAllAction(); return []; }
  const rest = [];
  rig.traverse(node => rest.push({ node, position: node.position.clone(), quaternion: node.quaternion.clone() }));
  const center = new THREE.Vector3(), from = new THREE.Vector3(), to = new THREE.Vector3();
  const rotation = new THREE.Quaternion(), parent = new THREE.Quaternion(), correction = new THREE.Quaternion();
  const axisX = new THREE.Vector3(1, 0, 0), axisY = new THREE.Vector3(0, 1, 0);
  function turn(joint, axis, angle) {
    joint.updateWorldMatrix(true, false);
    joint.parent.getWorldQuaternion(parent).invert();
    rotation.setFromAxisAngle(axis, angle);
    correction.copy(parent).multiply(rotation).multiply(parent.invert());
    joint.quaternion.premultiply(correction);
  }
  function reach(arm, hand, target) {
    for (let iteration = 0; iteration < 10; iteration++) {
      for (const joint of arm) {
        joint.updateWorldMatrix(true, true);
        joint.getWorldPosition(center);
        hand.getWorldPosition(from).sub(center).normalize();
        to.copy(target).sub(center).normalize();
        rotation.setFromUnitVectors(from, to);
        correction.identity().slerp(rotation, 0.65);
        joint.parent.getWorldQuaternion(parent);
        joint.quaternion.premultiply(parent.clone().invert().multiply(correction).multiply(parent));
      }
    }
  }
  const installed = [];
  for (const [name, frames] of Object.entries(sequences)) {
    const duration = frames.at(-1).time, count = Math.ceil(duration * 30);
    const times = [], values = joints.map(() => []), hipPositions = [];
    let frame = 0;
    for (let sample = 0; sample <= count; sample++) {
      const time = sample / count * duration;
      while (frame < frames.length - 2 && time > frames[frame + 1].time) frame++;
      const a = frames[frame], b = frames[frame + 1], alpha = smooth(time, a.time, b.time);
      for (const saved of rest) { saved.node.position.copy(saved.position); saved.node.quaternion.copy(saved.quaternion); }
      const lean = THREE.MathUtils.lerp(a.lean, b.lean, alpha);
      turn(joints[0], axisY, THREE.MathUtils.lerp(a.twist, b.twist, alpha));
      turn(joints[0], axisX, lean);
      turn(joints[1], axisX, lean * 0.2);
      // The pelvis and legs have separate parents in this rig. Lower the pelvis in world Y;
      // using its local Y would push it backwards because the native bones are rotated.
      joints[2].parent.getWorldQuaternion(parent).invert();
      joints[2].position.add(new THREE.Vector3(0, -THREE.MathUtils.lerp(a.crouch, b.crouch, alpha), 0).applyQuaternion(parent));
      rig.updateMatrixWorld(true);
      hands.forEach((hand, side) => {
        const key = side ? 'right' : 'left';
        const target = rig.localToWorld(new THREE.Vector3().fromArray(a[key]).lerp(new THREE.Vector3().fromArray(b[key]), alpha));
        reach([joints[side ? 6 : 4], joints[side ? 5 : 3]], hand, target);
      });
      times.push(time);
      joints.forEach((joint, index) => joint.quaternion.toArray(values[index], values[index].length));
      joints[2].position.toArray(hipPositions, hipPositions.length);
    }
    const overridden = new Set(joints.map(joint => `${joint.name}.quaternion`));
    overridden.add(`${joints[2].name}.position`);
    const tracks = dean.actions.Idle.getClip().tracks.filter(track => !overridden.has(track.name)).map(track => track.clone());
    joints.forEach((joint, index) => tracks.push(new THREE.QuaternionKeyframeTrack(`${joint.name}.quaternion`, times, values[index])));
    tracks.push(new THREE.VectorKeyframeTrack(`${joints[2].name}.position`, times, hipPositions));
    const clip = new THREE.AnimationClip(`Dean ${name}`, duration, tracks);
    // The source idle is longer than some moves. Trim it so all attacks end on their own clock.
    clip.trim();
    const action = dean.mixer.clipAction(clip).setLoop(THREE.LoopOnce, 1);
    action.clampWhenFinished = true;
    dean.actions[clip.name] = action;
    installed.push(clip);
  }
  mixer.stopAllAction();
  return installed;
}
