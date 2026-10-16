const DEFAULT_VOLUME = 0.7;
const MAX_GROUP_VOICES = Object.freeze({ zombie: 4, player: 3, weapon: 5, pickup: 3 });
const STORY_CUE_SETTINGS = Object.freeze({
  deanReveal: Object.freeze({ duration: 0.9, volume: 0.095, cutoffStart: 1500, cutoffEnd: 190, bodyVolume: 0.075, bodyFrequency: 58, attack: 0.12, cooldown: 2 }),
  portalActivation: Object.freeze({ duration: 0.82, volume: 0.1, cutoffStart: 1900, cutoffEnd: 230, bodyVolume: 0.07, bodyFrequency: 62, attack: 0.09, cooldown: 1 }),
  portalEntry: Object.freeze({ duration: 1.05, volume: 0.12, cutoffStart: 2400, cutoffEnd: 150, bodyVolume: 0.09, bodyFrequency: 52, attack: 0.035, cooldown: 1 }),
  portalHum: Object.freeze({ frequency: 112, nearVolume: 0.09, referenceDistance: 9, maxDistance: 38 }),
});
const MUSIC_SCENES = Object.freeze({
  sophomore: {
    key: 'sophomore-room',
    layers: [
      { url: './assets/audio/music/dungeon-ambience.ogg', volume: 0.78, channel: 'ambience' },
      // Level2Music owns the score and its cue after the Dean clears the saws.
    ],
  },
  finalArena: {
    key: 'final-arena',
    layers: [],
  },
  finalHouseEmergence: {
    key: 'final-house-emergence',
    layers: [{ url: './assets/audio/music/tar.mp3', volume: 0.68, channel: 'music' }],
  },
  finalDean: {
    key: 'final-dean',
    layers: [
      { url: './assets/audio/music/lost-horror.ogg', volume: 0.72, channel: 'music' },
    ],
  },
});

export class AudioManager {
  constructor() {
    this.context = null;
    this.master = null;
    this.musicGain = null;
    this.ambienceGain = null;
    this.sfxGain = null;
    this.voiceGain = null;
    this.limiter = null;
    this.cache = new Map();
    this.bufferLevels = new WeakMap();
    this.themeSources = new Set();
    this.activeVoices = new Set();
    this.generatedEffects = new Set();
    this.portalHum = null;
    this.groupVoiceCounts = new Map();
    this.cooldowns = new Map();
    this.sfxGeneration = 0;
    this.themeKey = null;
    this.requestedThemeKey = null;
    this.themeRequest = 0;
    this.volume = DEFAULT_VOLUME;
    this.listenerPosition = { x: 0, y: 0, z: 0 };
  }

  ensureContext() {
    try {
      const AudioContextCtor = globalThis.AudioContext || globalThis.webkitAudioContext;
      if (!AudioContextCtor) return null;
      if (!this.context) {
        this.context = new AudioContextCtor();
        this.master = this.context.createGain();
        this.musicGain = this.context.createGain();
        this.ambienceGain = this.context.createGain();
        this.sfxGain = this.context.createGain();
        this.voiceGain = this.context.createGain();
        this.limiter = this.context.createDynamicsCompressor();
        this.limiter.threshold.value = -3;
        this.limiter.knee.value = 3;
        this.limiter.ratio.value = 12;
        this.limiter.attack.value = 0.003;
        this.limiter.release.value = 0.18;
        this.musicGain.gain.value = 0.88;
        this.ambienceGain.gain.value = 0.78;
        this.sfxGain.gain.value = 0.78;
        this.voiceGain.gain.value = 0.82;
        this.musicGain.connect(this.master);
        this.ambienceGain.connect(this.master);
        this.sfxGain.connect(this.master);
        this.voiceGain.connect(this.master);
        this.master.connect(this.limiter);
        this.limiter.connect(this.context.destination);
        this.setVolume(this.volume);
      }
      return this.context;
    } catch (error) {
      console.warn('[AudioManager] AudioContext unavailable.', error);
      return null;
    }
  }

  unlock() {
    const context = this.ensureContext();
    if (context?.state === 'suspended') context.resume().catch(() => {});
  }

  setVolume(value) {
    const volume = Number(value);
    this.volume = Number.isFinite(volume) ? Math.min(1, Math.max(0, volume)) : 0;
    if (!this.master || !this.context) return;
    this.master.gain.setTargetAtTime(this.volume, this.context.currentTime, 0.06);
  }

  setListenerPosition(position) {
    if (!position) return;
    this.listenerPosition = { x: position.x || 0, y: position.y || 0, z: position.z || 0 };
  }

  _assetUrl(source) {
    if (!source) return source;
    if (/^(https?:|blob:)/.test(source) || source.startsWith('./') || source.startsWith('/')) return source;
    return `./assets/audio/${source}`;
  }

  async _loadBuffer(source) {
    const url = this._assetUrl(source);
    if (this.cache.has(url)) return this.cache.get(url);
    const context = this.ensureContext();
    if (!context) return null;
    const response = await fetch(url, { cache: 'force-cache' });
    if (!response.ok) throw new Error(`Failed to load audio: ${url} (${response.status})`);
    const buffer = await context.decodeAudioData((await response.arrayBuffer()).slice(0));
    this.cache.set(url, buffer);
    return buffer;
  }

  preload(sources) {
    return Promise.all((Array.isArray(sources) ? sources : [sources]).filter(Boolean).map(async source => {
      try { await this._loadBuffer(source); }
      catch (error) { console.warn('[AudioManager] Audio preload failed.', error); }
    }));
  }

  _normalizedGain(buffer, category) {
    let levels = this.bufferLevels.get(buffer);
    if (!levels) {
      let sumSquares = 0;
      let peak = 0;
      let samples = 0;
      const stride = Math.max(1, Math.floor(buffer.length / 120000));
      for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
        const data = buffer.getChannelData(channel);
        for (let i = 0; i < data.length; i += stride) {
          const sample = Math.abs(data[i]);
          sumSquares += sample * sample;
          peak = Math.max(peak, sample);
          samples++;
        }
      }
      levels = { rms: Math.sqrt(sumSquares / Math.max(1, samples)), peak };
      this.bufferLevels.set(buffer, levels);
    }
    if (levels.rms < 0.0001 || levels.peak < 0.0001) return 1;
    const targetRms = category === 'music' || category === 'ambience' ? 0.115 : 0.16;
    const peakCeiling = 0.88;
    const gainLimit = category === 'music' || category === 'ambience' ? 4 : 2.5;
    return Math.min(gainLimit, targetRms / levels.rms, peakCeiling / levels.peak);
  }

  _reserveVoice(group, maxVoices) {
    const count = this.groupVoiceCounts.get(group) || 0;
    if (count >= maxVoices) return false;
    this.groupVoiceCounts.set(group, count + 1);
    return true;
  }

  _releaseVoice(group) {
    const count = this.groupVoiceCounts.get(group) || 0;
    if (count <= 1) this.groupVoiceCounts.delete(group);
    else this.groupVoiceCounts.set(group, count - 1);
  }

  async playSfx(sources, options = {}) {
    const context = this.ensureContext();
    if (!context) return null;
    const candidates = Array.isArray(sources) ? sources : [sources];
    const chosen = candidates[Math.floor(Math.random() * candidates.length)];
    if (!chosen) return null;
    const group = options.group || options.category || 'sfx';
    const maxVoices = options.maxVoices ?? MAX_GROUP_VOICES[group] ?? 8;
    const now = context.currentTime;
    if (options.cooldownKey) {
      const readyAt = this.cooldowns.get(options.cooldownKey) || 0;
      if (readyAt > now) return null;
      this.cooldowns.set(options.cooldownKey, now + Math.max(0, options.cooldown || 0));
    }
    if (!this._reserveVoice(group, maxVoices)) return null;

    const generation = this.sfxGeneration;
    let reserved = true;
    try {
      const buffer = await this._loadBuffer(chosen);
      if (!buffer || generation !== this.sfxGeneration) return null;
      const category = options.category || 'sfx';
      const channel = category === 'voice' ? this.voiceGain : this.sfxGain;
      const source = context.createBufferSource();
      const gain = context.createGain();
      source.buffer = buffer;
      source.playbackRate.value = Number(options.pitch ?? 1);
      let attenuation = 1;
      if (options.position) {
        const position = options.position;
        const distance = Math.hypot(
          (position.x || 0) - this.listenerPosition.x,
          (position.y || 0) - this.listenerPosition.y,
          (position.z || 0) - this.listenerPosition.z,
        );
        const maxDistance = options.maxDistance ?? 34;
        if (distance >= maxDistance) return null;
        const reference = options.referenceDistance ?? 3;
        attenuation = 1 / (1 + (distance / reference) ** 2);
      }
      gain.gain.value = this._normalizedGain(buffer, category)
        * Math.max(0, Number(options.volume ?? 1)) * attenuation;
      source.connect(gain);
      gain.connect(channel);
      const voice = { source, gain, group };
      this.activeVoices.add(voice);
      reserved = false;
      source.onended = () => {
        source.disconnect();
        gain.disconnect();
        this.activeVoices.delete(voice);
        this._releaseVoice(group);
      };
      source.start(context.currentTime + Math.max(0, Number(options.delay ?? 0)));
      return source;
    } catch (error) {
      console.warn('[AudioManager] Audio playback failed.', error);
      return null;
    } finally {
      if (reserved) this._releaseVoice(group);
    }
  }

  playRandom(sources, options = {}) {
    return this.playSfx(sources, options);
  }

  _playDesignedCue(key, { duration, volume = 0.05, cutoffStart = 1400, cutoffEnd = 500,
    bodyVolume = 0, bodyFrequency = 72, attack = 0.01, cooldown = 0.2 } = {}) {
    this.unlock();
    const context = this.ensureContext();
    if (!context?.createBuffer || !context?.createBufferSource || !context?.createBiquadFilter || !context?.createGain) return null;
    const now = context.currentTime;
    const readyAt = this.cooldowns.get(key) || 0;
    if (readyAt > now) return null;
    this.cooldowns.set(key, now + cooldown);
    try {
      const frames = Math.max(1, Math.ceil(context.sampleRate * duration));
      const buffer = context.createBuffer(1, frames, context.sampleRate);
      const samples = buffer.getChannelData(0);
      for (let i = 0; i < samples.length; i++) samples[i] = Math.random() * 2 - 1;

      const noise = context.createBufferSource();
      noise.buffer = buffer;
      const filter = context.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(cutoffStart, now);
      filter.frequency.linearRampToValueAtTime(cutoffEnd, now + duration);
      const noiseGain = context.createGain();
      noiseGain.gain.setValueAtTime(0.0001, now);
      noiseGain.gain.linearRampToValueAtTime(volume, now + attack);
      noiseGain.gain.linearRampToValueAtTime(0.0001, now + duration);
      noise.connect(filter); filter.connect(noiseGain); noiseGain.connect(this.sfxGain);

      const sources = [noise], nodes = [noise, filter, noiseGain];
      if (bodyVolume > 0 && context.createOscillator) {
        const body = context.createOscillator();
        const bodyGain = context.createGain();
        body.type = 'sine';
        body.frequency.setValueAtTime(bodyFrequency, now);
        bodyGain.gain.setValueAtTime(0.0001, now);
        bodyGain.gain.linearRampToValueAtTime(bodyVolume, now + Math.min(attack, 0.025));
        bodyGain.gain.linearRampToValueAtTime(0.0001, now + duration);
        body.connect(bodyGain); bodyGain.connect(this.sfxGain);
        sources.push(body); nodes.push(body, bodyGain);
      }
      const effect = { sources, nodes };
      this.generatedEffects.add(effect);
      let remaining = sources.length;
      const cleanup = () => {
        remaining--;
        if (remaining > 0) return;
        nodes.forEach(node => node.disconnect());
        this.generatedEffects.delete(effect);
      };
      sources.forEach(source => { source.onended = cleanup; source.start(now); source.stop(now + duration + 0.02); });
      return effect;
    } catch (error) {
      console.warn('[AudioManager] Designed cue playback failed.', error);
      return null;
    }
  }

  playUiHover() { return this._playDesignedCue('ui-hover', { duration: 0.07, volume: 0.12, cutoffStart: 1450, cutoffEnd: 720, attack: 0.004, cooldown: 0.045 }); }
  playUiConfirm() { return this._playDesignedCue('ui-confirm', { duration: 0.2, volume: 0.34, cutoffStart: 1150, cutoffEnd: 240, bodyVolume: 0.24, bodyFrequency: 68, attack: 0.008, cooldown: 0.12 }); }
  playCreditPickup() { return this._playDesignedCue('credit-pickup', { duration: 0.24, volume: 0.06, cutoffStart: 1450, cutoffEnd: 330, bodyVolume: 0.05, bodyFrequency: 88, attack: 0.006, cooldown: 0.1 }); }
  playDeanReveal() { return this._playDesignedCue('dean-reveal', STORY_CUE_SETTINGS.deanReveal); }
  playPortalActivation() { return this._playDesignedCue('portal-activation', STORY_CUE_SETTINGS.portalActivation); }
  playPortalEntry() { return this._playDesignedCue('portal-entry', STORY_CUE_SETTINGS.portalEntry); }
  playFinalCreditMilestone() { return this._playDesignedCue('final-credit', { duration: 0.48, volume: 0.07, cutoffStart: 1000, cutoffEnd: 220, bodyVolume: 0.06, bodyFrequency: 66, attack: 0.02, cooldown: 1 }); }

  startPortalHum(position) {
    if (this.portalHum) return this.updatePortalHum(position);
    this.unlock();
    const context = this.ensureContext();
    if (!context?.createOscillator || !context?.createGain) return null;
    try {
      const oscillator = context.createOscillator(), gain = context.createGain();
      oscillator.type = 'sine'; oscillator.frequency.setValueAtTime(STORY_CUE_SETTINGS.portalHum.frequency, context.currentTime);
      gain.gain.setValueAtTime(0.0001, context.currentTime);
      oscillator.connect(gain); gain.connect(this.ambienceGain);
      this.portalHum = { oscillator, gain, position: null };
      oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); if (this.portalHum?.oscillator === oscillator) this.portalHum = null; };
      oscillator.start();
      return this.updatePortalHum(position);
    } catch (error) { console.warn('[AudioManager] Portal hum failed.', error); return null; }
  }

  updatePortalHum(position) {
    if (!this.portalHum || !position || !this.context) return null;
    this.portalHum.position = position;
    const distance = Math.hypot((position.x || 0) - this.listenerPosition.x, (position.y || 0) - this.listenerPosition.y, (position.z || 0) - this.listenerPosition.z);
    const { nearVolume, referenceDistance, maxDistance } = STORY_CUE_SETTINGS.portalHum;
    const volume = distance >= maxDistance ? 0.0001 : nearVolume / (1 + (distance / referenceDistance) ** 2);
    this.portalHum.gain.gain.setTargetAtTime(volume, this.context.currentTime, 0.08);
    return this.portalHum.oscillator;
  }

  stopPortalHum(fadeSeconds = 0.12) {
    if (!this.portalHum || !this.context) return;
    const { oscillator, gain } = this.portalHum, now = this.context.currentTime;
    gain.gain.cancelScheduledValues(now); gain.gain.setValueAtTime(gain.gain.value, now);
    gain.gain.linearRampToValueAtTime(0.0001, now + fadeSeconds);
    try { oscillator.stop(now + fadeSeconds + 0.02); } catch {}
  }

  async playTheme(key, sources, options = {}) {
    const items = (Array.isArray(sources) ? sources : [sources]).filter(Boolean)
      .map(source => typeof source === 'string' ? { url: source } : source);
    return this._startMusicScene(key, items.map(item => ({
      url: item.url,
      volume: Number(item.volume ?? options.volume ?? 0.75),
      channel: item.channel || 'music',
    })));
  }

  async _startMusicScene(key, layers, fadeSeconds = 1.25) {
    if (this.themeKey === key || this.requestedThemeKey === key) return null;
    const context = this.ensureContext();
    if (!context) return null;
    this.requestedThemeKey = key;
    const request = ++this.themeRequest;
    const loaded = await Promise.all(layers.map(async layer => {
      try {
        const buffer = await this._loadBuffer(layer.url);
        return buffer ? { ...layer, buffer } : null;
      } catch (error) {
        console.warn(`[AudioManager] Music layer unavailable: ${layer.url}`, error);
        return null;
      }
    }));
    if (request !== this.themeRequest) return null;
    if (!loaded.some(Boolean)) {
      this.requestedThemeKey = null;
      return null;
    }

    this.stopTheme(fadeSeconds);
    const startAt = context.currentTime;
    const endAt = startAt + fadeSeconds;
    for (const layer of loaded.filter(Boolean)) {
      const source = context.createBufferSource();
      const gain = context.createGain();
      const bus = layer.channel === 'ambience' ? this.ambienceGain : this.musicGain;
      const level = this._normalizedGain(layer.buffer, layer.channel);
      source.buffer = layer.buffer;
      source.loop = true;
      gain.gain.setValueAtTime(0, startAt);
      gain.gain.linearRampToValueAtTime(level * layer.volume, endAt);
      source.connect(gain);
      gain.connect(bus);
      const track = { source, gain, key };
      this.themeSources.add(track);
      source.onended = () => {
        source.disconnect();
        gain.disconnect();
        this.themeSources.delete(track);
      };
      source.start(startAt);
    }
    this.themeKey = key;
    this.requestedThemeKey = key;
    return key;
  }

  stopTheme(fadeSeconds = 0.8) {
    if (!this.context) return;
    this.themeRequest++;
    const now = this.context.currentTime;
    const endAt = now + Math.max(0, fadeSeconds);
    for (const track of this.themeSources) {
      track.gain.gain.cancelScheduledValues(now);
      track.gain.gain.setValueAtTime(track.gain.gain.value, now);
      track.gain.gain.linearRampToValueAtTime(0, endAt);
      try { track.source.stop(endAt + 0.02); } catch {}
    }
    this.themeKey = null;
    this.requestedThemeKey = null;
  }

  setLevelTheme(levelName) {
    const title = String(levelName || '').toLowerCase();
    if (title.includes('freshman')) {
      this.stopTheme(0);
      return this.preload('./assets/audio/music/rannsaka.mp3').then(() => null);
    }
    if (title.includes('sophomore')) return this._startMusicScene(MUSIC_SCENES.sophomore.key, MUSIC_SCENES.sophomore.layers);
    if (title.includes('final')) return this.setFinalEncounterPhase('arena');
    this.stopTheme();
    return null;
  }

  restartLevelTheme(levelName) {
    this.stopTheme(0);
    return this.setLevelTheme(levelName);
  }

  setFinalEncounterPhase(phase) {
    const scene = phase === 'boss' ? MUSIC_SCENES.finalDean
      : phase === 'house-emergence' ? MUSIC_SCENES.finalHouseEmergence : MUSIC_SCENES.finalArena;
    return this._startMusicScene(scene.key, scene.layers);
  }

  pause() {
    this.stopEffects();
    if (this.context?.state === 'running') this.context.suspend().catch(() => {});
  }

  resume() {
    if (this.context?.state === 'suspended') this.context.resume().catch(() => {});
  }

  stopAll() {
    this.stopTheme(0.15);
    this.stopEffects();
    this.stopPortalHum(0.05);
  }

  stopEffects() {
    this.sfxGeneration++;
    for (const voice of this.activeVoices) {
      try { voice.source.stop(); } catch {}
    }
    for (const effect of this.generatedEffects) {
      for (const source of effect.sources || [effect.oscillator]) {
        try { source.stop(); } catch {}
      }
    }
  }

  dispose() {
    this.stopAll();
    if (this.context && this.context.state !== 'closed') this.context.close().catch(() => {});
    this.context = null;
    this.master = null;
    this.musicGain = null;
    this.ambienceGain = null;
    this.sfxGain = null;
    this.voiceGain = null;
    this.limiter = null;
  }
}

export function getGlobalAudioManager() {
  if (!globalThis.__thesisAudioManager) globalThis.__thesisAudioManager = new AudioManager();
  return globalThis.__thesisAudioManager;
}
