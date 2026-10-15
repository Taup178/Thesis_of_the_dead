// Measured from the planted feet of Zombie_Arm's Run clip at the Dean's 1.25 scale.
export const DEAN_RUN_CLIP_SPEED = 2.925;
export const DEAN_RUN_SPEED = 4.8;
const RAMP_DURATION = 0.4;

/** Grounded travel: ease into the stride, cruise, then settle at the portal. */
export function getDeanRunDuration(distance) {
  return distance / DEAN_RUN_SPEED + Math.min(RAMP_DURATION, distance / DEAN_RUN_SPEED);
}

export function sampleDeanRun(distance, time) {
  const ramp = Math.min(RAMP_DURATION, distance / DEAN_RUN_SPEED);
  const duration = getDeanRunDuration(distance);
  const t = Math.max(0, Math.min(duration, time));
  if (ramp === 0) return 0;
  if (t < ramp) return DEAN_RUN_SPEED * t * t / (2 * ramp);
  if (t > duration - ramp) {
    const remaining = duration - t;
    return distance - DEAN_RUN_SPEED * remaining * remaining / (2 * ramp);
  }
  return DEAN_RUN_SPEED * (t - ramp / 2);
}
