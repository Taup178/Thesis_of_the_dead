/** Crossfade the tail into the opening, retaining the complete intro on first play. */
export function createMusicLoopBuffer(context, decoded) {
  const overlap = Math.min(Math.round(decoded.sampleRate * 1.5), Math.floor(decoded.length / 4));
  const buffer = context.createBuffer(decoded.numberOfChannels, decoded.length, decoded.sampleRate);
  for (let channel = 0; channel < decoded.numberOfChannels; channel++) {
    const input = decoded.getChannelData(channel), output = buffer.getChannelData(channel);
    output.set(input);
    for (let i = 0; i < overlap; i++) {
      const angle = i / Math.max(1, overlap - 1) * Math.PI / 2;
      output[output.length - overlap + i] = input[input.length - overlap + i] * Math.cos(angle)
        + input[i] * Math.sin(angle);
    }
  }
  return { buffer, loopStart: overlap / decoded.sampleRate };
}

function musicNormalization(buffer) {
  let sum = 0, count = 0, peak = 0;
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const samples = buffer.getChannelData(channel);
    for (let i = 0; i < samples.length; i++) {
      peak = Math.max(peak, Math.abs(samples[i]));
      if (i % 16 === 0) { sum += samples[i] ** 2; count++; }
    }
  }
  // Consistent music loudness with headroom for overlapping effects.
  return Math.min(2, 0.16 / Math.max(0.001, Math.sqrt(sum / Math.max(1, count))), 0.9 / Math.max(0.001, peak));
}

/** The score shares the effects' audio clock, with smooth ducking and resumable loops. */
export class Level2Music {
  constructor(context) {
    this.context = context;
    this.enabled = false; this.disposed = false; this.resuming = false;
    this.offset = 0; this.targetVolume = 0; this.voices = new Set();
    this.onGesture = () => this.play();
    this.onVisibility = () => { if (document.hidden) this.pause(); };
    document.addEventListener('pointerdown', this.onGesture, { passive: true });
    document.addEventListener('keydown', this.onGesture);
    document.addEventListener('visibilitychange', this.onVisibility);
    if (context) {
      this.normalization = context.createGain();
      this.presence = context.createBiquadFilter();
      this.presence.type = 'peaking'; this.presence.frequency.value = 2400;
      this.presence.Q.value = 0.8; this.presence.gain.value = -2.5;
      this.output = context.createGain(); this.output.gain.value = 0;
      this.normalization.connect(this.presence); this.presence.connect(this.output);
      this.output.connect(context.destination);
    }
    this.ready = this._prepare().catch(error => {
      if (!this.disposed) console.warn('[Level 2 music] Could not prepare Fangs:', error);
    });
  }

  async _prepare() {
    if (!this.context) return;
    const response = await fetch('./assets/audio/fangs.mp3');
    if (!response.ok) throw new Error(`Audio request failed (${response.status})`);
    const decoded = await this.context.decodeAudioData(await response.arrayBuffer());
    if (this.disposed) return;
    const loop = createMusicLoopBuffer(this.context, decoded);
    this.buffer = loop.buffer; this.loopStart = loop.loopStart;
    this.normalization.gain.value = musicNormalization(this.buffer);
  }

  update(masterVolume, ducking = 0) {
    if (this.disposed || document.hidden || !this.output) return;
    this.enabled = true;
    const target = Math.min(1, Math.max(0, masterVolume)) * 0.5
      * (1 - 0.58 * Math.min(1, Math.max(0, ducking)));
    if (Math.abs(target - this.targetVolume) > 0.0005 || (target === 0 && this.targetVolume !== 0)) {
      // Fast, gentle reduction; a slower recovery avoids pumping between impacts.
      this.output.gain.setTargetAtTime(target, this.context.currentTime, target < this.targetVolume ? 0.08 : 0.7);
      this.targetVolume = target;
    }
    this.play();
  }

  play() {
    if (!this.enabled || this.disposed || document.hidden || !this.buffer || !this.context) return;
    if (this.context.state === 'suspended') {
      if (!this.resuming) {
        this.resuming = true;
        this.context.resume().catch(() => {}).finally(() => { this.resuming = false; });
      }
      return;
    }
    if (this.context.state !== 'running' || this.source) return;
    const source = this.context.createBufferSource(), gain = this.context.createGain();
    const now = this.context.currentTime;
    source.buffer = this.buffer; source.loop = true;
    source.loopStart = this.loopStart; source.loopEnd = this.buffer.duration;
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(1, now + (this.hasPlayed ? 0.65 : 2.4));
    source.connect(gain); gain.connect(this.normalization);
    const voice = { source, gain }; this.voices.add(voice);
    source.onended = () => {
      source.disconnect(); gain.disconnect(); this.voices.delete(voice);
      if (this.disposed && this.voices.size === 0) this._disconnect();
    };
    this.startedAt = now; this.source = source; this.voice = voice;
    this.hasPlayed = true; source.start(now, this.offset);
  }

  pause() {
    this.enabled = false;
    if (!this.source) return;
    const now = this.context.currentTime, duration = this.buffer.duration;
    const position = this.offset + now - this.startedAt;
    this.offset = position < duration ? position : this.loopStart + (position - duration) % (duration - this.loopStart);
    const gain = this.voice.gain.gain;
    gain.cancelAndHoldAtTime(now);
    gain.linearRampToValueAtTime(0, now + 0.08);
    this.source.stop(now + 0.1);
    this.source = null; this.voice = null;
  }

  _disconnect() {
    this.normalization?.disconnect(); this.presence?.disconnect(); this.output?.disconnect();
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true; this.pause(); this.buffer = null;
    document.removeEventListener('pointerdown', this.onGesture);
    document.removeEventListener('keydown', this.onGesture);
    document.removeEventListener('visibilitychange', this.onVisibility);
    if (this.voices.size === 0) this._disconnect();
  }
}
