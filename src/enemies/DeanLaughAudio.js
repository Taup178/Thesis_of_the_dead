// This private, optional local asset is intentionally ignored by Git. A clean public
// checkout falls back to this original duration without failing the cinematic.
export const DEAN_LAUGH_URL = './assets/audio/dean-laugh.mp3';
export const DEAN_LAUGH_FALLBACK_SECONDS = 311040 / 44100;
const ENVELOPE_STEP = 0.025;
let loaded;

export async function loadDeanLaugh(context) {
  if (!context?.decodeAudioData) return null;
  if (!loaded) loaded = (async () => {
    const response = await fetch(DEAN_LAUGH_URL);
    if (!response.ok) return null;
    const buffer = await context.decodeAudioData(await response.arrayBuffer());
    const stride = Math.max(1, Math.round(buffer.sampleRate * ENVELOPE_STEP));
    const envelope = new Float32Array(Math.ceil(buffer.length / stride));
    const channels = Array.from({ length: buffer.numberOfChannels }, (_, index) => buffer.getChannelData(index));
    let maximum = 0.001;
    for (let frame = 0; frame < envelope.length; frame++) {
      const start = frame * stride, end = Math.min(buffer.length, start + stride);
      let sum = 0;
      for (const channel of channels) for (let sample = start; sample < end; sample++) sum += channel[sample] ** 2;
      envelope[frame] = Math.sqrt(sum / ((end - start) * channels.length));
    }
    const raw = envelope.slice();
    for (let frame = 0; frame < envelope.length; frame++) {
      let sum = 0;
      for (let offset = -2; offset <= 2; offset++) sum += raw[Math.max(0, Math.min(raw.length - 1, frame + offset))] * (3 - Math.abs(offset));
      envelope[frame] = sum / 9;
      maximum = Math.max(maximum, envelope[frame]);
    }
    for (let frame = 0; frame < envelope.length; frame++) envelope[frame] /= maximum;
    return { buffer, envelope, envelopeStep: stride / buffer.sampleRate };
  })().catch(() => null);
  return loaded;
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
