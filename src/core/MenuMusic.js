/** Stream the menu song; retry browser-blocked playback on a real user gesture. */
export class MenuMusic {
  constructor(audio, volumeControl) {
    this.audio = audio;
    this.active = false;
    this.pending = false;
    this.audio.loop = true;
    this.audio.volume = Number(volumeControl.value) / 100;
    this.onGesture = () => this.play();
    this.onVolume = () => {
      this.audio.volume = Number(volumeControl.value) / 100;
      if (this.audio.volume === 0) this.audio.pause();
      else this.play();
    };
    this.onVisibility = () => {
      if (document.hidden) this.audio.pause();
      else this.play();
    };
    document.addEventListener('pointerdown', this.onGesture, { capture: true, passive: true });
    document.addEventListener('keydown', this.onGesture, { capture: true });
    document.addEventListener('visibilitychange', this.onVisibility);
    volumeControl.addEventListener('input', this.onVolume);
  }

  setActive(active) {
    this.active = active;
    this.audio.autoplay = active && !document.hidden && this.audio.volume > 0;
    if (active) this.play();
    else {
      this.audio.pause();
      this.audio.currentTime = 0;
    }
  }

  play() {
    if (!this.active || document.hidden || this.audio.volume === 0 || !this.audio.paused || this.pending) return;
    this.pending = true;
    this.audio.play().then(() => {
      // Starting a level or switching tabs may happen while play() is pending.
      if (!this.active || document.hidden || this.audio.volume === 0) this.audio.pause();
    }).catch(() => {
      // Autoplay restrictions leave the menu usable; the next gesture retries.
    }).finally(() => { this.pending = false; });
  }
}
