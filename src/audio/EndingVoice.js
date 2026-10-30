export class EndingVoice {
  constructor(playback, asset, captions = () => {}) {
    this.playback = playback; this.asset = asset; this.captions = captions;
    this.state = 'ready'; this.disposed = false;
    if (asset) this.preload = playback.load(asset);
  }
  start() {
    if (this.state !== 'ready') return;
    if (!this.asset || !this.playback.settings.enabled || this.playback.settings.volume === 0) {
      this.state = 'finished'; return;
    }
    this.state = 'loading';
    this.playback.play(this.asset, {
      identity: 'protector',
      isCurrent: () => !this.disposed && this.state === 'loading',
      onStart: handle => {
        this.handle = handle; this.state = 'playing';
        if (this.playback.settings.subtitles) this.captions([{ text: 'Go on, Shaun. You can rest now.', label: 'The Protector', identity: 'protector' }]);
      },
      onEnd: () => { this.handle = null; this.captions([]); if (!this.disposed) this.state = 'finished'; },
    }).then(handle => {
      if (this.disposed) handle?.stop();
      else if (!handle && this.state === 'loading') this.state = 'finished';
    });
  }
  dispose() {
    this.disposed = true; this.state = 'disposed'; this.handle?.stop(); this.handle = null; this.captions([]);
  }
}
