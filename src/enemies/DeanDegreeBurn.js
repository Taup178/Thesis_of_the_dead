import * as THREE from 'three';
import { DegreeBurnEffects } from '../props/DegreeBurnEffects.js';
import { DEAN_LAUGH_FALLBACK_SECONDS, laughAmplitude } from './DeanLaughAudio.js';

export const createDegreeBurnTiming = laughEnd => Object.freeze({ laughEnd, raiseStart: Math.max(0, laughEnd - 1),
  raiseEnd: laughEnd, ignite: laughEnd, consumed: laughEnd + 3.8, end: laughEnd + 4.8 });
export const DEGREE_BURN_TIMING = createDegreeBurnTiming(DEAN_LAUGH_FALLBACK_SECONDS);
const smooth = THREE.MathUtils.smoothstep;
const LAUGH_VOLUME = 0.25;
const bone = (root, name) => root.getObjectByName(THREE.PropertyBinding.sanitizeNodeName(name)) || root.getObjectByName(name);

/** Laugh, raise the degree above his head, then let it ignite and turn to ash. */
export class DeanDegreeBurn {
  constructor(root, dean, scroll, grip, audioContext = null, laughClip = null) {
    this.dean = dean; this.scroll = scroll; this.grip = grip;
    this.time = 0; this.done = false; this.phase = 'laugh'; this.disposed = false;
    this.laughClip = laughClip; this.timing = createDegreeBurnTiming(laughClip?.buffer.duration ?? DEAN_LAUGH_FALLBACK_SECONDS);
    this.bones = new Map();
    this.rest = [];
    for (const name of ['Torso', 'Abdomen', 'Head', 'Neck', 'Eyelid.L', 'Eyelid.R', 'Shoulder.L', 'Shoulder.R', 'UpperArm.L', 'LowerArm.L']) {
      const node = bone(dean.group, name);
      if (node) { this.bones.set(name, node); this.rest.push({ node, position: node.position.clone(), rotation: node.quaternion.clone() }); }
    }
    this.left = [bone(dean.group, 'LowerArm.L'), bone(dean.group, 'UpperArm.L')].filter(Boolean);
    this.scrollRest = scroll.getWorldPosition(new THREE.Vector3());
    this.leftSide = this.left.length ? Math.sign(this.left[1]?.getWorldPosition(new THREE.Vector3()).x - dean.group.position.x) || 1 : -1;
    const face = bone(dean.group, 'Head')?.getWorldPosition(new THREE.Vector3()) || dean.group.position;
    const leftEdge = scroll.localToWorld(new THREE.Vector3(-0.43, 0, 0));
    const rightEdge = scroll.localToWorld(new THREE.Vector3(0.43, 0, 0));
    const edgeSign = leftEdge.distanceToSquared(face) > rightEdge.distanceToSquared(face) ? -1 : 1;
    this.effects = new DegreeBurnEffects(root, scroll, edgeSign);
    this.sound = new DegreeBurnSound(audioContext, laughClip, this.timing);
    this._bakeRaisePoses();
    this.cameraFace = new THREE.Vector3(); this.cameraHold = new THREE.Vector3(); this.cameraPosition = new THREE.Vector3();
    dean._playAction?.('Idle');
  }

  _restorePose() {
    for (const pose of this.rest) { pose.node.position.copy(pose.position); pose.node.quaternion.copy(pose.rotation); }
  }

  _bakeRaisePoses() {
    // Solve the arm once while loading. Playback only interpolates two stored joint rotations.
    this.raisePoses = [];
    const target = new THREE.Vector3(this.leftSide * 0.62, 2.8, 0.45)
      .applyQuaternion(this.dean.group.quaternion).add(this.dean.group.position);
    for (let sample = 0; sample <= 48; sample++) {
      this._restorePose(); this.dean.group.updateMatrixWorld(true);
      this._reach(this.left, this.scroll, this.scrollRest.clone().lerp(target, sample / 48));
      this.raisePoses.push(this.left.map(joint => joint.quaternion.clone()));
    }
    this._restorePose(); this.dean.group.updateMatrixWorld(true);
  }

  _reach(joints, effector, target) {
    for (let iteration = 0; iteration < 12; iteration++) {
      for (const joint of joints) {
        joint.updateWorldMatrix(true, true);
        const center = joint.getWorldPosition(new THREE.Vector3());
        const from = effector.getWorldPosition(new THREE.Vector3()).sub(center).normalize();
        const to = target.clone().sub(center).normalize();
        const rotation = new THREE.Quaternion().setFromUnitVectors(from, to);
        const angle = new THREE.Quaternion().angleTo(rotation);
        const correction = new THREE.Quaternion().slerp(rotation, Math.min(1, 0.22 / Math.max(0.001, angle)));
        const parent = joint.parent.getWorldQuaternion(new THREE.Quaternion());
        joint.quaternion.premultiply(parent.clone().invert().multiply(correction).multiply(parent));
      }
      if (effector.getWorldPosition(new THREE.Vector3()).distanceTo(target) < 0.003) break;
    }
  }

  _pose() {
    this._restorePose();
    const t = this.time, laughing = 1 - smooth(t, this.timing.laughEnd - 0.22, this.timing.laughEnd);
    const breath = (this.laughClip ? laughAmplitude(this.laughClip, t)
      : Math.pow(Math.max(0, Math.sin((t - 0.18) * 20)), 2)) * smooth(t, 0, 0.12) * laughing;
    const torso = this.bones.get('Torso'), abdomen = this.bones.get('Abdomen'), head = this.bones.get('Head');
    if (torso) { torso.rotation.x += -0.06 * laughing + 0.13 * breath; torso.position.y += 0.035 * breath; }
    if (abdomen) abdomen.rotation.x += 0.035 * breath;
    if (head) { head.rotation.x += -0.14 * laughing + 0.12 * breath; head.rotation.z += Math.sin(t * 4) * 0.02 * breath; }
    for (const side of ['L', 'R']) {
      const eyelid = this.bones.get(`Eyelid.${side}`);
      if (eyelid) eyelid.rotation.x += 0.18 * laughing;
      const shoulder = this.bones.get(`Shoulder.${side}`);
      if (shoulder) { shoulder.position.y += 0.016 * breath; shoulder.rotation.z += (side === 'L' ? 1 : -1) * 0.055 * breath; }
    }
    const raise = smooth(t, this.timing.raiseStart, this.timing.raiseEnd);
    const frame = raise * 48, index = Math.min(47, Math.floor(frame)), alpha = frame - index;
    this.left.forEach((joint, arm) => joint.quaternion.slerpQuaternions(this.raisePoses[index][arm], this.raisePoses[index + 1][arm], alpha));
    if (head && raise > 0) head.rotation.x -= 0.08 * raise; // Follow the raised degree with his eyes.
    this.grip?.();
    this.dean.group.updateMatrixWorld(true);
    if (!this.ignitionSelected && t >= this.timing.ignite) {
      const face = head?.getWorldPosition(new THREE.Vector3()) || this.dean.group.position;
      const leftEdge = this.scroll.localToWorld(new THREE.Vector3(-0.43, 0, 0));
      const rightEdge = this.scroll.localToWorld(new THREE.Vector3(0.43, 0, 0));
      this.effects.edgeSign = leftEdge.distanceToSquared(face) > rightEdge.distanceToSquared(face) ? -1 : 1;
      this.effects.uniforms.degreeEdge.value = this.effects.edgeSign;
      this.ignitionSelected = true;
    }
  }

  update(dt, camera, volume = 0.7) {
    if (this.disposed || this.done) return;
    const audioTime = this.sound.getLaughTime();
    this.time = Math.min(this.timing.end, audioTime !== null && this.time < this.timing.laughEnd
      ? Math.max(this.time, audioTime) : this.time + dt);
    this.phase = this.time < this.timing.raiseStart ? 'laugh'
      : this.time < this.timing.ignite ? 'raise' : this.time < this.timing.consumed ? 'burn' : 'ash';
    this._pose();
    const fireTime = this.time - this.timing.ignite;
    const progress = THREE.MathUtils.clamp(fireTime / (this.timing.consumed - this.timing.ignite), 0, 1);
    this.effects.update(dt, fireTime, progress);
    this.sound.update(this.time, progress, volume);
    if (camera) {
      const boss = this.dean.group.position;
      // Frame the planned raised hand; do not feed each laugh bob back into the camera.
      const hold = this.cameraHold.set(this.leftSide * 0.62, 2.8, 0.45)
        .applyQuaternion(this.dean.group.quaternion).add(boss);
      const face = this.cameraFace.copy(boss); face.y += 2.25;
      const aim = face.lerp(hold, smooth(this.time, this.timing.raiseStart - 0.05, this.timing.ignite + 0.25) * 0.6);
      const blend = smooth(this.time, this.timing.raiseStart, this.timing.ignite + 0.25);
      this.cameraPosition.set(boss.x + 2.8 - 0.5 * blend, boss.y + 1.8 + 0.45 * blend, boss.z + 3.6 - 0.3 * blend);
      camera.position.copy(this.cameraPosition); camera.lookAt(aim); camera.updateMatrixWorld(true);
    }
    this.done = this.time >= this.timing.end;
    if (this.done) this.sound.stop();
  }

  dispose() {
    if (this.disposed) return; this.disposed = true;
    this.sound.stop(); this.effects.dispose();
    for (const pose of this.rest) { pose.node.position.copy(pose.position); pose.node.quaternion.copy(pose.rotation); }
  }
}

/** Play the supplied laugh unchanged, then add quiet paper crackle. */
class DegreeBurnSound {
  constructor(context, clip, timing) {
    this.context = context; this.clip = clip; this.timing = timing;
    this.voices = new Set(); this.nextCrackle = 0; this.laughStartedAt = null; this.laughSource = null;
    this.crackleIndex = 0;
    this.crackleBuffers = context?.createBuffer ? Array.from({ length: 4 }, () => {
      const buffer = context.createBuffer(1, Math.ceil(context.sampleRate * 0.14), context.sampleRate), data = buffer.getChannelData(0);
      let previous = 0;
      for (let i = 0; i < data.length; i++) { previous = (previous + (Math.random() * 2 - 1) * 0.12) / 1.12; data[i] = previous * (Math.random() > 0.996 ? 2 : 0.5); }
      return buffer;
    }) : [];
  }
  getLaughTime() {
    return this.laughStartedAt !== null && this.clip
      ? Math.min(this.clip.buffer.duration, Math.max(0, this.context.currentTime - this.laughStartedAt)) : null;
  }
  update(time, progress, volume) {
    if (this.context?.state !== 'running') return;
    volume = THREE.MathUtils.clamp(volume, 0, 1);
    if (this.clip && time < this.timing.laughEnd && this.laughStartedAt === null) {
      const source = this.context.createBufferSource(), gain = this.context.createGain();
      source.buffer = this.clip.buffer; source.loop = false; source.playbackRate.value = 1;
      gain.gain.value = volume * LAUGH_VOLUME; source.connect(gain); gain.connect(this.context.destination);
      this.laughSource = source; this.laughGain = gain; this.voices.add(source);
      this.laughStartedAt = this.context.currentTime - time;
      source.onended = () => {
        source.disconnect(); gain.disconnect(); this.voices.delete(source);
        if (this.laughSource === source) { this.laughSource = null; this.laughGain = null; }
      };
      source.start(this.context.currentTime, time);
    }
    if (this.laughGain) this.laughGain.gain.setValueAtTime(volume * LAUGH_VOLUME, this.context.currentTime);
    if (volume <= 0 || !this.crackleBuffers.length || time < this.timing.ignite || progress >= 1 || time < this.nextCrackle) return;
    this.nextCrackle = time + 0.12;
    const source = this.context.createBufferSource(), gain = this.context.createGain();
    source.buffer = this.crackleBuffers[this.crackleIndex++ % this.crackleBuffers.length];
    gain.gain.value = volume * 0.12 * (1 - progress * 0.6); source.connect(gain); gain.connect(this.context.destination);
    this.voices.add(source); source.onended = () => { source.disconnect(); gain.disconnect(); this.voices.delete(source); }; source.start();
  }
  stop() {
    for (const voice of this.voices) { try { voice.stop(); } catch {} }
    this.voices.clear(); this.laughSource = null; this.laughGain = null; this.laughStartedAt = null;
  }
}
