import { Level1Voices, loadVoiceAssets } from './Level1Voices.js';
import { LEVEL3_VOICE_CUES } from './level3VoiceCatalog.js';

export const loadLevel3VoiceAssets = () => loadVoiceAssets('./assets/audio/voices/level3/manifest.json', LEVEL3_VOICE_CUES);

/** Observe the final encounter; dialogue never advances a fight or delays a cinematic. */
export class Level3Voices extends Level1Voices {
  constructor(playback, options = {}) { super(playback, { ...options, catalog: LEVEL3_VOICE_CUES }); }

  _attach(level, player) {
    const retry = this.deathPending;
    super._attach(level, player);
    this.retry = retry; this.offered = new Set(); this.phaseAge = 0;
    this.last = this._snapshot(level, player); this.readyAt = this.clock;
  }

  _phase(level) {
    if (level.destinyChoice) return `${level.destinyChoice}_choice`;
    if (level.degreeBurn) return level.degreeBurn.time >= level.degreeBurn.timing.ignite ? 'burn_flames' : 'burn_raise';
    if (level.monsterFight) {
      if (level.monsterFight.phase === 'combat') return 'monster_combat';
      if (level.monsterFight.phase === 'dying') return 'monster_dying';
      if (level.degreeVictory?.taken) return level.victoryPortals?.time >= 1.9 ? 'portals' : 'degree_taken';
      if (level.monsterFight.phase === 'defeated') return 'monster_fallen';
    }
    if (level.transformation) {
      const { time, timing } = level.transformation;
      if (time >= timing.scrollCatch + 0.25) return 'monster_reveal';
      return time >= timing.fallEnd + 0.6 ? 'transformation' : 'dean_fallen';
    }
    if (level.bossCutscene || level.bossFight && level.bossFight.phase !== 'waiting') return 'boss_intro';
    if (level.arenaCleared) return 'arena_clear';
    return level.arrivalPlayer ? 'arrival_camera' : 'arena';
  }

  _snapshot(level, player) {
    return { phase: this._phase(level), health: player.health, time: level.timeRemaining,
      houses: (level.houses || []).filter(house => house.alive).length,
      emerged: !!level.houseEmergenceCuePlayed,
      enraged: !!level.monsterFight?.enraged };
  }

  _offerEvent(id, { story = false, valid = () => true, continueWhile = valid, ...options } = {}) {
    if (this.offered.has(id) || !valid()) return;
    super._offer(id, { valid, continueWhile, ...options });
    if (this.pending?.cue.id === id) {
      this.pending.mandatory = story;
      this.offered.add(id);
    }
  }

  update(dt, level, player, { active = true, blocked = false } = {}) {
    if (!level?.title?.includes('Final Encounter') || !player) { if (this.level) this.leave(); return; }
    if (this.level !== level) this._attach(level, player);
    if (!player.alive) this.deathPending = true;
    const current = this._snapshot(level, player), last = this.last;
    this.last = current;
    if (!active || blocked || !player.alive || !this.playback.settings.enabled || this.playback.settings.volume === 0) {
      if (this.pending || this.running || this.captions.size) this.cancel();
      this.wasBlocked = true; return;
    }
    // Choice dialogue may already have finished during the portal passage. Replay
    // the actual registered recording once in the room so the retreat is audible.
    if (level.endingCutscene && this.endingScene !== level.endingCutscene) {
      this.endingScene = level.endingCutscene;
      this.cancel();
      this._queueStory(level.destinyChoice === 'blue' ? 'blue_choice' : 'red_choice', true, { trackHistory: false });
      this.readyAt = this.clock;
    }
    const step = Math.max(0, Math.min(0.15, dt));
    this.clock += step;
    this.phaseAge = current.phase === last.phase ? this.phaseAge + step : 0;
    if (this.running && !this.running.continueWhile()) this.cancel();
    if (this.pending && !this.pending.valid()) this.pending = null;
    const phase = current.phase;
    const during = (...phases) => () => this.level === level && player.alive && phases.includes(this._phase(level));
    const combat = during('arena', 'boss_intro', 'monster_combat');
    const arena = during('arena');

    // These are the events currently on screen, including a direct boss/victory preview.
    // A preview never replays skipped houses, a deadline, or the Dean's first fall.
    if (phase === 'arena') {
      this._offerEvent(this.retry ? 'retry' : 'arrival', { story: true, ttl: 6, valid: arena });
      const emerging = (level.spawnRecords || []).some(record => ['emerging', 'exiting', 'active'].includes(record.phase)
        && record.zombie?.alive && record.zombie.group.visible);
      if (current.emerged && emerging) this._offerEvent('emergence', { ttl: 3, valid: () => arena() &&
        (level.spawnRecords || []).some(record => record.zombie?.alive && record.zombie.group.visible) });
      if (current.houses < last.houses) this._offerEvent('house_destroyed', { ttl: 3, valid: arena });
      if (current.time <= 30 && current.time > 15 && last.time > 30) this._offerEvent('half_time', { ttl: 3, valid: arena });
      if (current.time <= 15 && current.time > 0 && last.time > 15) {
        this._offerEvent('time_low', { story: true, ttl: 2, valid: () => arena() && level.timeRemaining > 0 });
      }
    } else if (phase !== 'arrival_camera' && phase !== 'monster_dying') {
      const continuing = phase === 'dean_fallen' ? during('dean_fallen', 'transformation')
        : phase === 'degree_taken' ? during('degree_taken', 'portals')
          : phase === 'monster_reveal' ? during('monster_reveal', 'monster_combat') : during(phase);
      this._offerEvent(phase, { story: true, ttl: 4, valid: during(phase), continueWhile: continuing });
    }
    if (phase === 'degree_taken' && this.phaseAge >= 1.2) {
      this._offerEvent('degree_held', { story: true, ttl: 5, valid: during('degree_taken', 'portals') });
    }
    if (phase === 'monster_combat' && current.enraged && level.monsterFight.state === 'enrage') {
      this._offerEvent('monster_enrage', { story: true, ttl: 2, valid: during('monster_combat') });
    }
    if (combat() && current.health < last.health && current.health / player.maxHealth < 0.4) {
      this._offerEvent('low_health', { delay: 0.5, ttl: 3, valid: combat });
    }
    this._advance();
  }
}
