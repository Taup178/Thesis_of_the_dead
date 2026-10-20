const STORAGE_KEY = 'thesis-internal-voices-v1';
export const DEFAULT_VOICE_SETTINGS = Object.freeze({ enabled: true, volume: 0.7, mode: 'headphones', subtitles: true });
// Quiet, increasingly dark reflections create fading internal repetition.
const ECHO = Object.freeze({
  tormentor: { delay: 0.28, wet: 0.2, decay: 0.28, cutoff: 1700, drift: 0.06 },
  anxious: { delay: 0.17, wet: 0.13, decay: 0.25, cutoff: 2100, drift: -0.04 },
  manipulator: { delay: 0.34, wet: 0.23, decay: 0.3, cutoff: 1400, drift: -0.07 },
  protector: { delay: 0.24, wet: 0.06, decay: 0.2, cutoff: 2300, drift: 0 },
});

export function voiceSettings(value = {}) {
  return {
    enabled: value.enabled !== false,
    volume: Number.isFinite(value.volume) ? Math.max(0, Math.min(1, value.volume)) : DEFAULT_VOICE_SETTINGS.volume,
    mode: ['headphones', 'stereo', 'centered'].includes(value.mode) ? value.mode : DEFAULT_VOICE_SETTINGS.mode,
    subtitles: value.subtitles !== false,
  };
}

export function loadVoiceSettings() {
  try { return voiceSettings(JSON.parse(globalThis.localStorage?.getItem(STORAGE_KEY) || '{}')); }
  catch { return { ...DEFAULT_VOICE_SETTINGS }; }
}

export function saveVoiceSettings(value) {
  try { globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(value)); } catch { /* Storage is optional. */ }
}

/** Short, head-relative recordings on the game's existing audio clock and mixer. */
export class InternalVoices {
  constructor(audio) {
    this.audio = audio;
    this.settings = loadVoiceSettings();
    this.buffers = new Map();
    this.active = new Set();
    this.generation = 0;
    this.pending = new Set();
  }

  configure(value) {
    this.settings = voiceSettings({ ...this.settings, ...value });
    saveVoiceSettings(this.settings);
    if (!this.settings.enabled || this.settings.volume === 0) this.stop();
    const context = this.audio.context;
    if (context && this.audio.internalVoiceGain) {
      this.audio.internalVoiceGain.gain.setTargetAtTime(this.settings.volume * 0.65, context.currentTime, 0.03);
    }
  }

  async load(url) {
    if (!url) return null;
    if (!this.buffers.has(url)) {
      const context = this.audio.ensureContext();
      if (!context) return null;
      // Cache the promise too: preload and simultaneous requests must not decode twice.
      this.buffers.set(url, (async () => {
        try {
          const response = await fetch(url);
          if (!response.ok) return null;
          return await context.decodeAudioData(await response.arrayBuffer());
        } catch { return null; }
      })());
    }
    return this.buffers.get(url);
  }

  async play(url, { pan = 0, volume = 1, identity, isCurrent = () => true, onStart = () => {}, onEnd = () => {} } = {}) {
    const context = this.audio.ensureContext();
    if (!context || context.state !== 'running' || !this.settings.enabled || this.settings.volume === 0
      || this.active.size + this.pending.size >= 2 || !url) return null;
    const generation = this.generation;
    const request = {};
    this.pending.add(request);
    let source, gain, panner, output, releaseDuck, handle;
    const reflections = [], effectNodes = [];
    let finished = false;
    const finish = (disconnect = true) => {
      if (disconnect) {
        source?.disconnect(); gain?.disconnect(); panner?.disconnect(); output?.disconnect();
        reflections.forEach(tap => tap.source.disconnect());
        effectNodes.forEach(node => node.disconnect());
      }
      if (finished) return;
      finished = true;
      if (handle) this.active.delete(handle);
      releaseDuck?.();
      if (handle?.started) onEnd(handle);
    };
    try {
      const buffer = await this.load(url);
      if (!buffer || generation !== this.generation || !isCurrent() || context.state !== 'running'
        || !this.settings.enabled || this.settings.volume === 0) return null;
      source = context.createBufferSource(); source.buffer = buffer;
      gain = context.createGain();
      const now = context.currentTime;
      const level = Math.max(0, Math.min(1, volume));
      output = context.createGain(); output.connect(this.audio.internalVoiceGain);
      // Dialogue is mastered separately. Do not boost quiet whispers to the SFX RMS target.
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(level, now + 0.02);
      source.connect(gain);
      const position = Math.max(-0.8, Math.min(0.8, Number(pan) || 0));
      if (this.settings.mode === 'headphones' && context.createPanner) {
        panner = context.createPanner(); panner.panningModel = 'HRTF'; panner.rolloffFactor = 0;
        // AudioManager does not move AudioContext.listener: these offsets remain head-relative.
        if (panner.positionX) {
          panner.positionX.value = position;
          panner.positionY.value = 0;
          panner.positionZ.value = -0.35;
        } else panner.setPosition(position, 0, -0.35);
      } else if (this.settings.mode !== 'centered' && context.createStereoPanner) {
        panner = context.createStereoPanner(); panner.pan.value = position;
      }
      if (panner) { gain.connect(panner); panner.connect(output); }
      else gain.connect(output);

      const echo = ECHO[identity];
      if (echo?.drift && panner) {
        const lateral = panner.positionX || panner.pan;
        // Small, slow proximity changes; never spin a voice around the listener.
        if (lateral?.setValueAtTime && lateral.linearRampToValueAtTime) {
          lateral.setValueAtTime(position, now);
          lateral.linearRampToValueAtTime(position + echo.drift, now + Math.max(0.5, buffer.duration * 0.85));
        }
      }
      if (echo) {
        for (let index = 0; index < 2; index++) {
          const repeated = context.createBufferSource(); repeated.buffer = buffer;
          const wet = context.createGain();
          wet.gain.value = level * echo.wet * echo.decay ** index;
          repeated.connect(wet); effectNodes.push(wet);
          let tail = wet;
          if (context.createBiquadFilter) {
            const filter = context.createBiquadFilter(); filter.type = 'lowpass';
            filter.frequency.value = echo.cutoff / (1 + index * 0.35);
            tail.connect(filter); tail = filter; effectNodes.push(filter);
          }
          if (this.settings.mode !== 'centered' && context.createStereoPanner) {
            const reflectionPan = context.createStereoPanner();
            reflectionPan.pan.value = index === 0 ? -position * 0.9 : position * 0.5;
            tail.connect(reflectionPan); tail = reflectionPan; effectNodes.push(reflectionPan);
          }
          tail.connect(output);
          reflections.push({ source: repeated, delay: echo.delay * (index + 1) });
        }
      }

      handle = {
        source, duration: buffer.duration, tailDuration: echo ? echo.delay * 2 : 0, started: false,
        stop: () => {
          if (finished) return;
          // Release ownership immediately, even if pause suspends the clock before onended.
          output.gain.cancelScheduledValues(context.currentTime);
          output.gain.setTargetAtTime(0, context.currentTime, 0.01);
          try { source.stop(context.currentTime + 0.04); } catch {}
          for (const tap of reflections) { try { tap.source.stop(context.currentTime + 0.04); } catch {} }
          finish(false);
        },
      };
      let remaining = 1 + reflections.length;
      const ended = () => { if (--remaining === 0) finish(); };
      source.onended = ended;
      reflections.forEach(tap => { tap.source.onended = ended; });
      source.start(now);
      reflections.forEach(tap => tap.source.start(now + tap.delay));
      handle.started = true;
      this.active.add(handle);
      releaseDuck = this.audio.acquireDialogueDucking();
      onStart(handle);
      return handle;
    } catch {
      try { source?.stop(); } catch {}
      reflections.forEach(tap => { try { tap.source.stop(); } catch {} });
      finish();
      return null;
    } finally {
      this.pending.delete(request);
    }
  }

  stop() {
    this.generation++;
    this.pending.clear();
    for (const handle of [...this.active]) handle.stop();
  }

  unload() {
    this.stop();
    this.buffers.clear();
  }
}
