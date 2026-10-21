import { Level1Voices, loadLevel1VoiceAssets } from './Level1Voices.js';
import { Level2Voices, loadLevel2VoiceAssets } from './Level2Voices.js';
import { Level3Voices, loadLevel3VoiceAssets } from './Level3Voices.js';

/** Chapter adapters share the mixer and heard-line history, with one active scheduler. */
export class ChapterVoices {
  constructor(playback, options) {
    this.first = new Level1Voices(playback, options);
    this.second = new Level2Voices(playback, options);
    this.third = new Level3Voices(playback, options);
    this.second.heard = this.first.heard;
    this.third.heard = this.first.heard;
    this.active = null;
  }

  _chapter(level) {
    if (level?.title?.includes('Freshman Woods')) return this.first;
    if (level?.title?.includes('Sophomore Room')) return this.second;
    if (level?.title?.includes('Final Encounter')) return this.third;
    return null;
  }

  async loadForLevel(level) {
    this.leave();
    const chapter = this._chapter(level);
    if (!chapter) return;
    chapter.assets = await (chapter === this.first ? loadLevel1VoiceAssets()
      : chapter === this.second ? loadLevel2VoiceAssets() : loadLevel3VoiceAssets());
  }

  update(dt, level, player, options) {
    const chapter = this._chapter(level);
    if (chapter !== this.active) { this.leave(); this.active = chapter; }
    chapter?.update(dt, level, player, options);
  }

  cancel() { this.active?.cancel(); }
  leave() { this.active?.leave(); this.active = null; }
  resetSession() { this.first.resetSession(); this.second.resetSession(); this.third.resetSession(); this.active = null; }
}
