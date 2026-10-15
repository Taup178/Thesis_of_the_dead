// The former third-party laugh recording was removed because its redistribution rights
// could not be established. Keep this duration so the existing failure cinematic and
// its animation timing remain unchanged while no unverified audio is fetched or played.
export const DEAN_LAUGH_FALLBACK_SECONDS = 311040 / 44100;

export async function loadDeanLaugh(context) {
  void context;
  return null;
}

export function laughAmplitude(clip, time) {
  if (!clip || time < 0 || time >= clip.buffer.duration) return 0;
  const frame = time / clip.envelopeStep, index = Math.floor(frame), fraction = frame - index;
  const p0 = clip.envelope[Math.max(0, index - 1)] ?? 0, p1 = clip.envelope[index] ?? 0;
  const p2 = clip.envelope[index + 1] ?? 0, p3 = clip.envelope[index + 2] ?? 0;
  const value = 0.5 * (2 * p1 + (-p0 + p2) * fraction
    + (2 * p0 - 5 * p1 + 4 * p2 - p3) * fraction ** 2 + (-p0 + 3 * p1 - 3 * p2 + p3) * fraction ** 3);
  return Math.max(0, Math.min(1, value));
}
