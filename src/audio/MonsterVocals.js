const BASE = './assets/audio/voices/monster/';
const IDS = ['intro', 'taunt-01', 'taunt-02', 'taunt-03', 'enrage', 'rush', 'growl-01', 'growl-02', 'attack-roar', 'death'];
export const MONSTER_VOCAL_ASSETS = IDS.map(id => `${BASE}${id}.ogg`);
const COMBAT_LINES = ['growl-01', 'taunt-01', 'growl-02', 'taunt-02', 'taunt-03'];

/** The creature speaks from the arena, with breathing room for the internal voices. */
export class MonsterVocals {
  constructor(audio, position) {
    this.audio = audio; this.position = position; this.clock = 0; this.generation = 0;
    this.running = false; this.dead = false; this.source = null; this.pending = false;
    this.nextAt = 2; this.eventReadyAt = 0; this.line = 0; this.releaseDuck = null;
  }

  start() { this.running = true; this.introPending = true; }
  get playing() { return this.pending || !!this.source; }

  _otherDialogue() {
    return !!(this.audio?.internalVoices?.active?.size || this.audio?.internalVoices?.pending?.size
      || (this.audio?.dialogueDuckOwners?.size ?? 0) > (this.releaseDuck ? 1 : 0));
  }

  update(dt) {
    this.clock += Math.max(0, dt);
    if (!this.running || this.dead) return;
    if (this._otherDialogue()) {
      if (this.source || this.pending) this._cancel();
      this.nextAt = Math.max(this.nextAt, this.clock + 1);
      return;
    }
    if (this.source || this.pending) return;
    if (this.enrageUntil > this.clock) {
      this.enrageUntil = 0; this._play('enrage'); this.nextAt = this.clock + 8; return;
    }
    if (this.clock < this.nextAt) return;
    const id = this.introPending ? 'intro' : COMBAT_LINES[this.line++ % COMBAT_LINES.length];
    this.introPending = false;
    this._play(id);
    this.nextAt = this.clock + (id.startsWith('growl') ? 6 : 10);
  }

  attack(kind) {
    if (!this.running || this.dead || this.pending || this.source || this._otherDialogue()
      || this.clock < this.eventReadyAt || this.introPending) return;
    this._play(kind === 'rush' ? 'rush' : 'attack-roar');
    this.eventReadyAt = this.clock + 10; this.nextAt = Math.max(this.nextAt, this.clock + 7);
  }

  enrage() {
    if (this.dead) return;
    this.enrageUntil = this.clock + 4;
    if (!this._otherDialogue()) this._cancel();
  }

  die() {
    if (this.dead) return;
    this.dead = true; this.running = false; this.enrageUntil = 0;
    this._cancel(); this._play('death');
  }

  _play(id) {
    if (!this.audio?.playSfx) return;
    const token = ++this.generation;
    this.pending = true;
    const finish = () => {
      if (token !== this.generation) return;
      this.source = null; this.pending = false;
      this.releaseDuck?.(); this.releaseDuck = null;
    };
    let playback;
    try {
      playback = this.audio.playSfx(`${BASE}${id}.ogg`, {
        category: 'voice', group: id === 'death' ? 'monster-death' : 'monster-vocal', maxVoices: 1,
        position: this.position, referenceDistance: 18, maxDistance: 70,
        volume: id === 'death' ? 1 : 0.9, pitch: 1,
      });
    } catch { finish(); return; }
    Promise.resolve(playback).then(source => {
      if (!source) { finish(); return; }
      if (token !== this.generation || (id !== 'death' && this._otherDialogue())) {
        try { source.stop(); } catch { /* It may already have ended. */ }
        finish(); return;
      }
      this.pending = false; this.source = source;
      this.releaseDuck = this.audio.acquireDialogueDucking?.() ?? null;
      if (source.addEventListener) source.addEventListener('ended', finish, { once: true });
      else {
        const cleanup = source.onended;
        source.onended = (...args) => { cleanup?.(...args); finish(); };
      }
    }).catch(finish);
  }

  _cancel() {
    this.generation++;
    const source = this.source; this.source = null; this.pending = false;
    this.releaseDuck?.(); this.releaseDuck = null;
    try { source?.stop(); } catch { /* Already stopped by the shared mixer. */ }
  }

  stop() { this.running = false; this.enrageUntil = 0; this._cancel(); }
}
