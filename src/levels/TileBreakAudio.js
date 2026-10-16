/** Keep only the first two seconds, with short edge fades to avoid clicks. */
export function createTileBreakBuffer(context, decoded) {
  const length = Math.min(decoded.length, Math.floor(decoded.sampleRate * 2));
  const buffer = context.createBuffer(decoded.numberOfChannels, length, decoded.sampleRate);
  const attack = Math.max(1, Math.round(decoded.sampleRate * 0.003));
  const release = Math.max(1, Math.min(Math.round(decoded.sampleRate * 0.12), Math.floor(length / 2)));
  for (let channel = 0; channel < decoded.numberOfChannels; channel++) {
    const output = buffer.getChannelData(channel);
    output.set(decoded.getChannelData(channel).subarray(0, length));
    for (let i = 0; i < length; i++) {
      output[i] *= Math.min(1, i / attack) * Math.min(1, (length - 1 - i) / release);
    }
  }
  return buffer;
}

/** Preloaded impacts can overlap, so a new tile never cuts off an earlier break. */
export class TileBreakAudio {
  constructor(context) {
    this.context = context;
    this.voices = new Set();
    this.disposed = false;
    if (context) {
      this.output = context.createDynamicsCompressor();
      this.output.threshold.value = -6;
      this.output.knee.value = 18;
      this.output.ratio.value = 6;
      this.output.attack.value = 0.003;
      this.output.release.value = 0.12;
      this.output.connect(context.destination);
    }
    this.ready = this._prepare().catch(error => {
      if (!this.disposed) console.warn('[Tile audio] Could not prepare the brick impact:', error);
    });
  }

  async _prepare() {
    if (!this.context) return;
    const response = await fetch('./assets/audio/brick-wall-impact.mp3');
    if (!response.ok) throw new Error(`Audio request failed (${response.status})`);
    const decoded = await this.context.decodeAudioData(await response.arrayBuffer());
    if (!this.disposed) this.buffer = createTileBreakBuffer(this.context, decoded);
  }

  play(masterVolume = 0.7) {
    if (this.disposed || !this.buffer || masterVolume <= 0 || document.hidden) return;
    if (this.context.state === 'suspended') this.context.resume().catch(() => {});
    const source = this.context.createBufferSource();
    const gain = this.context.createGain();
    source.buffer = this.buffer;
    gain.gain.value = Math.min(1, Math.max(0, masterVolume)) * 0.8;
    source.connect(gain); gain.connect(this.output);
    const voice = { source, gain, end: this.context.currentTime + this.buffer.duration };
    this.voices.add(voice);
    source.onended = () => {
      source.disconnect(); gain.disconnect(); this.voices.delete(voice);
    };
    // A fresh source always starts at sample zero and ends at the trimmed buffer's end.
    source.start(this.context.currentTime);
  }

  pause() {
    if (!this.context) return;
    const now = this.context.currentTime;
    for (const voice of this.voices) {
      voice.gain.gain.cancelScheduledValues(now);
      voice.gain.gain.setTargetAtTime(0, now, 0.008);
      voice.source.stop(Math.min(now + 0.04, voice.end));
    }
  }

  dispose() {
    this.disposed = true;
    for (const voice of this.voices) {
      voice.source.stop(); voice.source.disconnect(); voice.gain.disconnect();
    }
    this.voices.clear(); this.output?.disconnect(); this.buffer = null;
  }
}
