import { MathUtils } from 'three';
import { SOPHOMORE_LAYOUT as layout } from './SophomoreLayout.js';

/** Loud at the first saw, then recedes through the blade corridor to its exit. */
export function getSawScrapeVolume(position, blades, masterVolume) {
  if (!blades?.length) return 0;
  const firstZ = Math.max(...blades.map(blade => blade.z));
  const lastZ = Math.min(...blades.map(blade => blade.z));
  // Treat the bank as one sound bed, so individual sweeps do not pump the volume.
  const distance = Math.hypot(Math.max(0, Math.abs(position.x) - 4.25), position.y,
    Math.max(0, position.z - firstZ, lastZ - position.z));
  const proximity = 1 - MathUtils.smoothstep(distance, 4, 28);
  const progress = MathUtils.smoothstep(position.z, layout.bladeDeckMinZ, layout.firstBladeZ);
  return MathUtils.clamp(masterVolume, 0, 1) * proximity * progress * 0.8;
}

/** Trim quiet padding and overlap the tail with the head to make a seamless cycle. */
export function createSeamlessScrapeBuffer(context, buffer) {
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i));
  const block = Math.max(1, Math.round(buffer.sampleRate * 0.01));
  const energy = [];
  for (let start = 0; start < buffer.length; start += block) {
    const end = Math.min(start + block, buffer.length);
    let sum = 0;
    for (const channel of channels) for (let i = start; i < end; i++) sum += channel[i] ** 2;
    energy.push(sum / ((end - start) * channels.length));
  }
  const peakEnergy = energy.reduce((peak, value) => Math.max(peak, value), 0);
  if (peakEnergy < 1e-12) return buffer;
  const threshold = peakEnergy * 0.001;
  const first = energy.findIndex(value => value > threshold);
  let last = energy.length - 1;
  while (last > first && energy[last] <= threshold) last--;
  const start = Math.max(0, (first - 1) * block);
  const end = Math.min(buffer.length, (last + 2) * block);
  const length = end - start;
  const overlap = Math.min(Math.round(buffer.sampleRate * 0.22), Math.floor(length / 4));
  if (overlap < 2) return buffer;
  const result = context.createBuffer(channels.length, length - overlap, buffer.sampleRate);
  let peak = 0;
  channels.forEach((input, channel) => {
    const output = result.getChannelData(channel);
    output.set(input.subarray(start + overlap, end));
    for (let i = 0; i < overlap; i++) {
      const angle = i / (overlap - 1) * Math.PI / 2;
      output[output.length - overlap + i] = input[end - overlap + i] * Math.cos(angle)
        + input[start + i] * Math.sin(angle);
    }
    for (const value of output) peak = Math.max(peak, Math.abs(value));
  });
  if (peak > 0.97) {
    for (let channel = 0; channel < result.numberOfChannels; channel++) {
      const samples = result.getChannelData(channel);
      for (let i = 0; i < samples.length; i++) samples[i] *= 0.97 / peak;
    }
  }
  return result;
}

/** A sample-accurate loop; gain ramps run on the audio clock, independently of frames. */
export class SawScrapeAudio {
  constructor(context = null) {
    const AudioContext = globalThis.AudioContext || globalThis.webkitAudioContext;
    this.context = context || (AudioContext ? new AudioContext() : null);
    this.ownsContext = !context;
    this.enabled = false;
    this.disposed = false;
    this.resuming = false;
    this.offset = 0;
    this.targetVolume = 0;
    this.onGesture = () => this.play(true);
    this.onVisibility = () => { if (document.hidden) this.pause(); };
    document.addEventListener('pointerdown', this.onGesture, { passive: true });
    document.addEventListener('keydown', this.onGesture);
    document.addEventListener('visibilitychange', this.onVisibility);
    if (this.context) {
      this.output = this.context.createGain();
      this.output.gain.value = 0;
      this.output.connect(this.context.destination);
    }
    this.ready = this._prepare().catch(error => {
      if (!this.disposed) console.warn('[Saw audio] Could not prepare the scrape loop:', error);
    });
  }

  async _prepare() {
    if (!this.context) return;
    const response = await fetch('./assets/audio/concrete-scrape-loop.mp3');
    if (!response.ok) throw new Error(`Audio request failed (${response.status})`);
    const decoded = await this.context.decodeAudioData(await response.arrayBuffer());
    if (!this.disposed) this.buffer = createSeamlessScrapeBuffer(this.context, decoded);
  }

  update(_dt, position, blades, running, masterVolume) {
    if (this.disposed || document.hidden || !this.output) return;
    this.enabled = true;
    const target = running ? getSawScrapeVolume(position, blades, masterVolume) : 0;
    if (Math.abs(target - this.targetVolume) > 0.0005 || (target === 0 && this.targetVolume !== 0)) {
      this.targetVolume = target;
      this.output.gain.setTargetAtTime(target, this.context.currentTime, 0.28);
    }
    // Keep the loop's clock running through fades rather than repeatedly pausing it.
    if (target > 0 || this.source) this.play();
  }

  play(fromGesture = false) {
    if (!this.enabled || this.disposed || document.hidden || !this.buffer || !this.context) return;
    if (this.context.state === 'suspended' && (!this.resuming || fromGesture)) {
      this.resuming = true;
      this.context.resume().catch(() => {}).finally(() => { this.resuming = false; });
    }
    if (this.source) return;
    const source = this.context.createBufferSource();
    source.buffer = this.buffer;
    source.loop = true;
    source.connect(this.output);
    source.onended = () => source.disconnect();
    this.startedAt = this.context.currentTime;
    source.start(this.startedAt, this.offset);
    this.source = source;
  }

  pause() {
    this.enabled = false;
    if (!this.context || !this.output) return;
    const now = this.context.currentTime;
    this.targetVolume = 0;
    this.output.gain.cancelScheduledValues(now);
    this.output.gain.setTargetAtTime(0, now, 0.01);
    if (this.source) {
      this.offset = (this.offset + now - this.startedAt) % this.buffer.duration;
      this.source.stop(now + 0.06);
      this.source = null;
    }
  }

  dispose() {
    this.disposed = true;
    this.pause();
    document.removeEventListener('pointerdown', this.onGesture);
    document.removeEventListener('keydown', this.onGesture);
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.output?.disconnect();
    if (this.ownsContext && this.context) this.context.close().catch(() => {});
    this.buffer = null;
  }
}
