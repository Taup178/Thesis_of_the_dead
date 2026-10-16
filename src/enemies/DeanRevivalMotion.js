import * as THREE from 'three';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import { installDeanSupportWrist, DeanSupportPose } from './DeanSupportHand.js';

const smooth = THREE.MathUtils.smoothstep;
const BODY_PHASES = [[0, 1.3], [0.1, 0.82], [0.32, 0.63], [0.56, 0.48], [0.8, 0.25], [1, 0]];
const PELVIS_PHASES = [[0, 1.3], [0.16, 0.8], [0.46, 0.58], [0.78, 0.24], [1, 0]];
const LEG_PHASES = [[0, 1.3], [0.06, 0.8], [0.35, 0.52], [0.7, 0.2], [1, 0]];

function poseTime(u, phases, duration) {
  for (let index = 1; index < phases.length; index++) {
    const previous = phases[index - 1], next = phases[index];
    if (u <= next[0]) return THREE.MathUtils.lerp(previous[1], next[1], smooth(u, previous[0], next[0])) * duration / 1.3;
  }
  return 0;
}

/** Bake a supported rise: gather the legs, push with the free palm, then settle upright. */
export function createDeanRevivalClip(dean, duration) {
  installDeanSupportWrist(dean);
  const death = dean.actions?.Death?.getClip(), idle = dean.actions?.Idle?.getClip();
  const source = dean.group.children[0];
  if (!death || !idle || !source) return null;
  const rig = clone(source);
  const find = name => rig.getObjectByName(THREE.PropertyBinding.sanitizeNodeName(name));
  const bindings = death.tracks.map(track => {
    const dot = track.name.lastIndexOf('.'), name = track.name.slice(0, dot);
    const node = find(name), property = track.name.slice(dot + 1);
    const rest = idle.tracks.find(candidate => candidate.name === track.name);
    return node && ['position', 'quaternion', 'scale'].includes(property) ? {
      name, property, node, track, sample: track.createInterpolant(), idle: rest?.createInterpolant(), values: [],
    } : null;
  }).filter(Boolean);
  if (!bindings.length) return null;
  const wrist = find('DeanSupportWrist');
  if (wrist) for (const property of ['position', 'quaternion']) bindings.push({
    name: wrist.name, property, node: wrist,
    track: { name: `${wrist.name}.${property}` },
    sample: { evaluate: () => property === 'position' ? [0, 0, 0] : [0, 0, 0, 1] }, values: [],
  });
  const reset = [];
  rig.traverse(node => reset.push({ node, position: node.position.clone(), rotation: node.quaternion.clone(), scale: node.scale.clone() }));
  const center = new THREE.Vector3(), from = new THREE.Vector3(), to = new THREE.Vector3();
  const current = new THREE.Vector3(), goal = new THREE.Vector3();
  const turn = new THREE.Quaternion(), parent = new THREE.Quaternion(), local = new THREE.Quaternion();
  const idleRotation = new THREE.Quaternion(), idleVector = new THREE.Vector3();
  // Capture the actual stance from the idle, including the rig's nonstandard axes.
  for (const binding of bindings) if (binding.idle) binding.node[binding.property].fromArray(binding.idle.evaluate(0));
  rig.updateMatrixWorld(true);
  const feet = ['L', 'R'].map(side => {
    const foot = find(`Foot.${side}`), knee = find(`LowerLeg.${side}`);
    if (!foot || !knee) return null;
    // This kit parents its feet separately from the shins. Use a virtual ankle
    // for the leg solve, and move the independent foot bone onto its ground mark.
    const endpoint = new THREE.Object3D();
    endpoint.position.copy(foot.getWorldPosition(new THREE.Vector3()));
    knee.worldToLocal(endpoint.position); knee.add(endpoint);
    return { foot, endpoint, joints: [knee, find(`UpperLeg.${side}`)].filter(Boolean),
      target: foot.getWorldPosition(new THREE.Vector3()), rotation: foot.getWorldQuaternion(new THREE.Quaternion()) };
  }).filter(Boolean);
  const supportPose = new DeanSupportPose(rig);
  const torso = find('Torso'), head = find('Head');
  function reach(joints, effector, target) {
    for (let iteration = 0; iteration < 12; iteration++) {
      if (effector.getWorldPosition(current).distanceToSquared(target) < 0.000004) break;
      for (const joint of joints) {
        joint.updateWorldMatrix(true, true); joint.getWorldPosition(center);
        effector.getWorldPosition(from).sub(center).normalize(); to.copy(target).sub(center).normalize();
        turn.setFromUnitVectors(from, to); local.identity().slerp(turn, 0.75);
        joint.parent.getWorldQuaternion(parent);
        turn.copy(parent).invert().multiply(local).multiply(parent);
        joint.quaternion.premultiply(turn);
      }
    }
    rig.updateMatrixWorld(true);
  }
  const times = [], count = Math.ceil(duration * 30);
  for (let frame = 0; frame <= count; frame++) {
    const u = frame / count;
    for (const pose of reset) {
      pose.node.position.copy(pose.position); pose.node.quaternion.copy(pose.rotation); pose.node.scale.copy(pose.scale);
    }
    for (const binding of bindings) {
      // Each body region contributes at its own time instead of rewinding the whole fall.
      const legs = /Leg|Foot/.test(binding.name), pelvis = /Hips|Root/.test(binding.name);
      const sampleTime = poseTime(u, legs ? LEG_PHASES : pelvis ? PELVIS_PHASES : BODY_PHASES, death.duration);
      const value = binding.node[binding.property]; value.fromArray(binding.sample.evaluate(sampleTime));
      const settle = smooth(u, 0.74, 1);
      if (binding.idle && settle > 0) {
        if (binding.property === 'quaternion') value.slerp(idleRotation.fromArray(binding.idle.evaluate(0)), settle);
        else value.lerp(idleVector.fromArray(binding.idle.evaluate(0)), settle);
      }
    }
    const effort = smooth(u, 0.06, 0.25) * (1 - smooth(u, 0.62, 0.92));
    if (torso) { torso.rotation.z += 0.1 * effort; torso.rotation.x += 0.11 * effort; }
    if (head) head.rotation.x -= 0.1 * smooth(u, 0.04, 0.2) * (1 - smooth(u, 0.65, 1));
    rig.updateMatrixWorld(true);
    const support = smooth(u, 0.06, 0.23) * (1 - smooth(u, 0.43, 0.68));
    supportPose.apply(support);
    const planted = smooth(u, 0.18, 0.45);
    for (const foot of feet) {
      foot.foot.getWorldPosition(goal).lerp(foot.target, planted);
      current.copy(goal); foot.foot.parent.worldToLocal(current); foot.foot.position.copy(current);
      reach(foot.joints, foot.endpoint, goal);
      foot.foot.getWorldQuaternion(turn).slerp(foot.rotation, planted);
      foot.foot.parent.getWorldQuaternion(parent).invert();
      foot.foot.quaternion.copy(parent).multiply(turn);
    }
    for (const binding of bindings) binding.node[binding.property].toArray(binding.values, binding.values.length);
    times.push(u * duration);
  }
  const tracks = bindings.map(binding => binding.property === 'quaternion'
    ? new THREE.QuaternionKeyframeTrack(binding.track.name, times, binding.values)
    : new THREE.VectorKeyframeTrack(binding.track.name, times, binding.values));
  return new THREE.AnimationClip('Dean Grounded Revival', duration, tracks);
}
