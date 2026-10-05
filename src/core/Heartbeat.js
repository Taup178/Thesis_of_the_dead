/** Gameplay-driven blur: wake-up clears gradually, low health brings it back. */
export function getDistressEffects(player, intro, active) {
  if (!active || !player?.alive) return { blur: 0, distress: 0 };
  const ratio = player.health / player.maxHealth;
  const distress = ratio < 0.4 ? Math.min(1, Math.max(0, (0.4 - ratio) / 0.4)) : 0;
  const progress = intro && !intro.done ? Math.min(1, Math.max(0, intro.time / intro.duration)) : 1;
  const wakeBlur = 1 - progress * progress * (3 - 2 * progress);
  return { blur: Math.max(wakeBlur, distress > 0 ? 0.35 + distress * 0.65 : 0), distress };
}

/** Synthesized low, paired thumps; no audio downloads or looping timers. */
export class Heartbeat {
  constructor() {
    this.context = null;
    this.voices = new Set();
    this.nextBeat = 0;
  }

  unlock() {
    try {
      const AudioContext = globalThis.AudioContext || globalThis.webkitAudioContext;
      if (!AudioContext) return;
      if (!this.context) {
        this.context = new AudioContext();
        this.master = this.context.createGain();
        this.master.gain.value = 0;
        this.master.connect(this.context.destination);
      }
      if (this.context.state === 'suspended') this.context.resume().catch(() => {});
    } catch { /* Audio unavailable: visual feedback still works. */ }
  }

  update(distress, volume) {
    if (distress <= 0 || volume <= 0 || this.context?.state !== 'running') {
      this.stop();
      return;
    }
    const now = this.context.currentTime;
    this.master.gain.setTargetAtTime(volume * (0.35 + distress * 0.35), now, 0.025);
    if (now < this.nextBeat) return;
    this._thump(now, 78, 0.9);
    this._thump(now + 0.16, 65, 0.7);
    this.nextBeat = now + 60 / (85 + distress * 55);
  }

  _thump(time, frequency, amplitude) {
    const oscillator = this.context.createOscillator();
    const envelope = this.context.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(frequency, time);
    oscillator.frequency.exponentialRampToValueAtTime(38, time + 0.14);
    envelope.gain.setValueAtTime(0, time);
    envelope.gain.linearRampToValueAtTime(amplitude, time + 0.012);
    envelope.gain.exponentialRampToValueAtTime(0.001, time + 0.14);
    oscillator.connect(envelope);
    envelope.connect(this.master);
    this.voices.add(oscillator);
    oscillator.onended = () => {
      oscillator.disconnect(); envelope.disconnect(); this.voices.delete(oscillator);
    };
    oscillator.start(time);
    oscillator.stop(time + 0.16);
  }

  stop() {
    if (this.context && this.master) {
      this.master.gain.cancelScheduledValues(this.context.currentTime);
      this.master.gain.setValueAtTime(0, this.context.currentTime);
      for (const voice of this.voices) voice.stop();
      this.voices.clear();
    }
    this.nextBeat = 0;
  }
}
