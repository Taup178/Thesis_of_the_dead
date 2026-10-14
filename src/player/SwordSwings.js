import * as THREE from 'three';

export const SWORD_COMBO_WINDOW = 0.75;
export const SWORD_ATTACKS = Object.freeze([
  { clip: 'SwordSlash1', source: 'Slash', duration: 0.62, contact: 0.28, chainAt: 0.43, cooldown: 0.68, damage: 45, reach: 3.1, arc: 0.25,
    poses: [[0.12, 0.04, 0.04, -0.1, -0.5, -0.15], [-0.1, -0.03, -0.14, 0.12, 0.45, 0.18], [-0.17, -0.06, -0.06, 0.18, 0.65, 0.25]] },
  { clip: 'SwordStab', source: 'Stab', duration: 0.54, contact: 0.22, chainAt: 0.36, cooldown: 0.6, damage: 45, reach: 3.4, arc: 0.82,
    poses: [[-0.18, 0.08, 0.08, 0, 0, 0], [-0.18, 0.08, -0.6, 0, 0, 0], [-0.18, 0.08, -0.38, 0, 0, 0]] },
  { clip: 'SwordTurningSlash', source: 'Slash', duration: 0.9, contact: 0.7, cooldown: 0.97, damage: 60, reach: 3.1, arc: 0.1,
    spin: true,
    poses: [[0.12, -0.03, 0.06, 0.04, -0.65, -0.04], [-0.18, -0.04, -0.16, 0.04, 0.65, 0.03], [-0.22, -0.07, -0.06, 0.06, 0.85, 0.04]] },
]);

// Use the kit's authored slash and thrust, preserving its shoulder, elbow, wrist and finger motion.
export function createSwordSwingClips(animations) {
  return SWORD_ATTACKS.flatMap(attack => {
    const source = animations.find(clip => clip.name === attack.source);
    if (!source) return [];
    const clip = source.clone(); clip.name = attack.clip;
    if (attack.spin) {
      // Release the authored slash near the end of the turn, when the player faces forward again.
      const sourceContact = SWORD_ATTACKS[0].contact / SWORD_ATTACKS[0].duration;
      const contact = attack.contact / attack.duration;
      for (const track of clip.tracks) {
        for (let sample = 0; sample < track.times.length; sample++) {
          const t = track.times[sample] / clip.duration;
          track.times[sample] = clip.duration * (t <= sourceContact
            ? t / sourceContact * contact : contact + (t - sourceContact) / (1 - sourceContact) * (1 - contact));
        }
      }
    }
    return [clip];
  });
}

export function getSwordBodyTurn(attack, progress) {
  return attack.spin ? Math.PI * 2 * THREE.MathUtils.smoothstep(progress, 0.08, 0.78) : 0;
}

export function getSwordThrustWeight(attack, progress) {
  if (attack.source !== 'Stab') return 0;
  const contact = attack.contact / attack.duration;
  const release = contact + (1 - contact) * 0.28;
  return THREE.MathUtils.smoothstep(progress, 0, contact * 0.62)
    * (1 - THREE.MathUtils.smoothstep(progress, release, 1));
}

export function getSwordSpinLevelWeight(attack, progress) {
  return attack.spin ? THREE.MathUtils.smoothstep(progress, 0, 0.18)
    * (1 - THREE.MathUtils.smoothstep(progress, 0.84, 1)) : 0;
}

/** Wind-up, contact, follow-through and recovery, tied to the actual hit time. */
export function getSwordViewPose(attack, progress) {
  return interpolateSwordPose(attack, progress, [[0, 0, 0, 0, 0, 0], ...attack.poses, [0, 0, 0, 0, 0, 0]]);
}

function interpolateSwordPose(attack, progress, poses) {
  const contact = attack.contact / attack.duration;
  const times = [0, contact * 0.62, contact, contact + (1 - contact) * 0.28, 1];
  const t = THREE.MathUtils.clamp(progress, 0, 1);
  const segment = times.findIndex((end, index) => index > 0 && t <= end);
  const alpha = THREE.MathUtils.smoothstep(t, times[segment - 1], times[segment]);
  return poses[segment - 1].map((value, axis) => THREE.MathUtils.lerp(value, poses[segment][axis], alpha));
}
