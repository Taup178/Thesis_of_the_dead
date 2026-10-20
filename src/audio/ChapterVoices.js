import { Level1Voices, loadLevel1VoiceAssets } from './Level1Voices.js';
import { Level2Voices, loadLevel2VoiceAssets } from './Level2Voices.js';

/** Two chapter adapters share the mixer and heard-line history, never two active schedulers. */
export class ChapterVoices {
  constructor(playback, options) {
    this.first = new Level1Voices(playback, options);
    this.second = new Level2Voices(playback, options);
    this.second.heard = this.first.heard;
    this.active = null;
  }

  _chapter(level) {
    if (level?.title?.includes('Freshman Woods')) return this.first;
    if (level?.title?.includes('Sophomore Room')) return this.second;
    return null;
  }

  async loadForLevel(level) {
    this.leave();
    const chapter = this._chapter(level);
    if (!chapter) return;
    chapter.assets = await (chapter === this.first ? loadLevel1VoiceAssets() : loadLevel2VoiceAssets());
  }

  update(dt, level, player, options) {
    const chapter = this._chapter(level);
    if (chapter !== this.active) { this.leave(); this.active = chapter; }
    chapter?.update(dt, level, player, options);
  }

  cancel() { this.active?.cancel(); }
  leave() { this.active?.leave(); this.active = null; }
  resetSession() { this.first.resetSession(); this.second.resetSession(); this.active = null; }
}
