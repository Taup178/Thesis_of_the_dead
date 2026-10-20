import { LEVEL1_VOICE_CUES } from './level1VoiceCatalog.js';

const CUES = new Map(LEVEL1_VOICE_CUES.map(cue => [cue.id, cue]));
const MANIFEST_URL = './assets/audio/voices/level1/manifest.json';

/** Only explicitly registered chapter recordings can be requested. No guessed asset URLs. */
export async function loadLevel1VoiceAssets() {
  try {
    const base = new URL(MANIFEST_URL, globalThis.location.href);
    const response = await fetch(base);
    if (!response.ok) return {};
    const manifest = await response.json();
    if (manifest.version !== 1) return {};
    const known = new Set(LEVEL1_VOICE_CUES.flatMap(cue => cue.lines.map(line => line.id)));
    const assets = {};
    for (const [id, file] of Object.entries(manifest.clips || {})) {
      if (!known.has(id) || typeof file !== 'string') continue;
      const url = new URL(file, base);
      if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname.slice(0, base.pathname.lastIndexOf('/') + 1))) continue;
      assets[id] = url.href;
    }
    return assets;
  } catch { return {}; }
}

export class Level1Voices {
  constructor(playback, { assets = {}, onCaptions = () => {} } = {}) {
    this.playback = playback;
    this.assets = assets;
    this.onCaptions = onCaptions;
    this.clock = 0;
    this.heard = new Set();
    this.recent = [];
    this.deaths = 0;
    this.deathPending = false;
    this.epoch = 0;
    this.readyAt = 0;
    this.captions = new Map();
    this.running = null;
    this.pending = null;
    this.level = null;
  }

  resetSession() {
    this.leave();
    this.heard.clear(); this.recent = []; this.deaths = 0; this.deathPending = false;
    this.clock = 0; this.readyAt = 0;
  }

  leave() {
    this.cancel();
    this.playback.unload();
    this.level = null;
  }

  cancel() {
    this.epoch++;
    this.pending = null;
    this.running = null;
    this.playback.stop();
    this.captions.clear(); this._showCaptions();
    this.readyAt = Math.max(this.readyAt, this.clock + 3);
  }

  _showCaptions() {
    this.onCaptions(this.playback.settings.subtitles ? [...this.captions.values()] : []);
  }

  _attach(level, player) {
    this.leave();
    if (this.deathPending) { this.deaths++; this.deathPending = false; }
    this.level = level; this.player = player;
    this.last = { credits: level.creditsCollected, health: player.health, ammo: player.ammo,
      orb: false, boss: false, clear: false, x: player.group.position.x, z: player.group.position.z };
    this.idle = 0; this.hits = []; this.injuryReadyAt = 0;
    this.wakeSeen = false; this.wakeAt = null; this.firstPairPending = false;
    this.lastIdentity = null; this.identityRun = 0;
    // Empty manifests do no preloading and never start subtitle-only phantom speech.
    for (const url of new Set(Object.values(this.assets))) this.playback.load(url);
  }

  _offer(id, { delay = 0, ttl = 5, valid = () => true } = {}) {
    const cue = CUES.get(id);
    if (!cue) return;
    const available = cue.lines.filter(line => this.assets[line.id] && !this.heard.has(line.id));
    const lines = cue.alternatives ? available.slice(0, 1) : available;
    if (!lines.length || (!cue.alternatives && lines.length !== cue.lines.length)) return;
    if (this.running?.cue.id === id || this.pending?.cue.id === id) return;
    if (this.pending && this.pending.cue.priority > cue.priority) return;
    this.pending = { cue, lines, at: this.clock + delay, expires: this.clock + delay + ttl, valid };
  }

  update(dt, level, player, { active = true, blocked = false, events = {} } = {}) {
    if (!level?.title?.includes('Freshman Woods') || !player) {
      if (this.level) this.leave();
      return;
    }
    if (this.level !== level) this._attach(level, player);
    if (!player.alive) this.deathPending = true;
    if (!active || blocked || !player.alive || !this.playback.settings.enabled || this.playback.settings.volume === 0) {
      if (this.pending || this.running || this.captions.size) this.cancel();
      this.wasBlocked = true;
      return;
    }
    this.clock += Math.max(0, Math.min(0.15, dt));
    if (this.wasBlocked) { this.readyAt = Math.max(this.readyAt, this.clock + 3); this.wasBlocked = false; }
    const now = this.clock, last = this.last, position = player.group.position;
    const enemies = (level.zombies || []).filter(z => z.alive && z.group.visible && !z.portalExit);
    const nearest = enemies.reduce((d, z) => Math.min(d, Math.hypot(z.group.position.x - position.x, z.group.position.z - position.z)), Infinity);
    const quiet = nearest > 10;
    const moving = Math.hypot(position.x - last.x, position.z - last.z) > 0.01 || !player.grounded;
    const intro = level.wakeUpIntro && !level.wakeUpIntro.done;
    const orb = !!level.orbPortalCutscene, boss = !!level.bossCutscene;
    const normal = () => !level.bossCutscene && !level.orbPortalCutscene && !level.portalCinematicActive && player.alive;
    const safe = () => normal() && player.grounded && this.nearest > 10;
    this.nearest = nearest;
    this.idle = !moving && quiet && normal() && !intro ? this.idle + dt : 0;

    if (events.firstCreditCollected) this.firstPairPending = true;
    if (intro || orb || level.portalCinematicActive) {
      if (this.running || this.pending) this.cancel();
    } else {
      if (!this.wakeSeen) {
        this.wakeSeen = true; this.wakeAt = now;
        this._offer(this.deaths >= 2 ? 'repeat_retry' : this.deaths === 1 ? 'retry' : 'wake', { delay: 1.5, ttl: 5, valid: normal });
      }
      if (boss && !last.boss && (this.running || this.pending)) this.cancel();
      if (events.deanReveal) this._offer('dean_reveal', { delay: 0.8, ttl: 4, valid: () => !!level.bossCutscene });
      if (!boss) {
        if (this.firstPairPending && last.orb) {
          this.firstPairPending = false;
          this._offer('first_pair', { delay: 0.5, ttl: 1, valid: () => normal() && level.zombies.length >= 2 && level.zombies.slice(0, 2).every(z => z.alive && z.group.visible) });
        }
        if (level.creditsCollected === 0 && now - this.wakeAt > 14) this._offer('first_doubt', { valid: safe });
        const count = level.creditsCollected;
        if (count !== last.credits && count !== 8) {
          const cue = { 2: 'credit_cost', 4: 'progress', 6: 'late_doubt' }[count];
          if (cue) this._offer(cue, { delay: 1, ttl: 8, valid: safe });
        }
        if (count >= 2 && this.idle >= 25) this._offer('rest_exchange', { ttl: 2, valid: () => safe() && this.idle >= 25 });
        if (nearest <= 6 && (this.previousNearest ?? Infinity) > 6) this._offer('near_threat', { ttl: 1, valid: () => normal() && this.nearest <= 6 });

        if (player.health < last.health && player.health > 0) {
          this.hits = this.hits.filter(t => now - t < 30); this.hits.push(now);
          if (player.health / player.maxHealth < 0.4 && last.health / player.maxHealth >= 0.4) {
            this._offer('low_health', { delay: 0.7, ttl: 3, valid: normal });
          } else if (now >= this.injuryReadyAt) {
            this._offer(this.hits.length >= 3 && player.health > 35 ? 'repeated_hurt' : 'hurt', {
              delay: 0.7, ttl: 4, valid: this.hits.length >= 3 ? safe : normal,
            });
          }
        }
        if (last.ammo > 0 && player.ammo === 0 && !['sword', 'dagger'].includes(player.weapon)) {
          this._offer('empty_gun', { ttl: 2, valid: () => normal() && player.ammo === 0 && !player.isDodging && !(player.bashTime > 0) });
        }
        if (last.boss && level.bossState === 'done') this._offer('dean_gone', {
          delay: 2, ttl: 7, valid: () => normal() && level.remainingZombies > 0,
        });
        if (level.bluePortalUnlocked && !last.clear) this._offer('clear', { delay: 2, ttl: 8, valid: () => normal() && level.bluePortalUnlocked });
        if (level.bluePortalUnlocked && level.portalApproachPoint) {
          const d = Math.hypot(position.x - level.portalApproachPoint.x, position.z - level.portalApproachPoint.z);
          if (d < 10 && d > 2.2) this._offer('portal_approach', { ttl: 2, valid: () => safe() && level.bluePortalUnlocked });
        }
      }
    }
    this.previousNearest = nearest;
    this.last = { credits: level.creditsCollected, health: player.health, ammo: player.ammo, orb, boss,
      clear: level.bluePortalUnlocked, x: position.x, z: position.z };
    this._advance();
  }

  _advance() {
    if (this.running) {
      const run = this.running;
      if (!run.valid()) { this.cancel(); return; }
      const next = run.lines[run.index];
      const audioNow = this.playback.audio?.context?.currentTime ?? this.clock;
      if (!run.loading && next && audioNow >= run.nextAt) this._playLine(run, next);
      if (!run.loading && !next && run.handles.size === 0) {
        this.running = null; this.readyAt = this.clock + 14;
      }
      return;
    }
    const pending = this.pending;
    if (!pending) return;
    if (pending.expires < this.clock || !pending.valid()) { this.pending = null; return; }
    this.recent = this.recent.filter(t => this.clock - t < 60);
    if (this.clock < pending.at || this.clock < this.readyAt || this.recent.length >= 3) return;
    if (pending.lines[0].identity === this.lastIdentity && this.identityRun >= 2) { this.pending = null; return; }
    this.pending = null;
    this.running = { ...pending, index: 0, nextAt: this.clock, handles: new Set(), loading: false, started: false };
    this._playLine(this.running, pending.lines[0]);
  }

  async _playLine(run, line) {
    const epoch = this.epoch;
    run.loading = true;
    const handle = await this.playback.play(this.assets[line.id], {
      pan: line.pan, volume: run.cue.overlap ? 0.7 : 1, identity: line.identity,
      isCurrent: () => this.epoch === epoch && this.running === run && run.valid(),
      onStart: playing => {
        if (!run.started) {
          run.started = true; this.recent.push(this.clock);
          if (line.identity === this.lastIdentity) this.identityRun++;
          else { this.lastIdentity = line.identity; this.identityRun = 1; }
          if (['hurt', 'repeated_hurt', 'low_health'].includes(run.cue.id)) this.injuryReadyAt = this.clock + 35;
        }
        this.heard.add(line.id); run.handles.add(playing);
        this.captions.set(playing, { identity: line.identity, label: line.label, text: line.text }); this._showCaptions();
        run.index++;
        run.nextAt = (this.playback.audio?.context?.currentTime ?? this.clock) + Math.max(0, playing.duration - run.cue.overlap);
      },
      onEnd: playing => {
        run.handles.delete(playing); this.captions.delete(playing); this._showCaptions();
      },
    });
    if (this.epoch !== epoch || this.running !== run) { handle?.stop(); return; }
    run.loading = false;
    if (!handle) this.cancel();
  }
}
