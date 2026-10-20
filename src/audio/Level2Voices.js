import { Level1Voices, loadVoiceAssets } from './Level1Voices.js';
import { LEVEL2_VOICE_CUES } from './level2VoiceCatalog.js';
import { SOPHOMORE_LAYOUT as layout, SPIKE_CORRIDOR_PUZZLE } from '../levels/SophomoreLayout.js';

export const loadLevel2VoiceAssets = () => loadVoiceAssets('./assets/audio/voices/level2/manifest.json', LEVEL2_VOICE_CUES);

/** Reuses the bounded voice scheduler; observes the room without changing its mechanics. */
export class Level2Voices extends Level1Voices {
  constructor(playback, options = {}) { super(playback, { ...options, catalog: LEVEL2_VOICE_CUES }); }

  _attach(level, player) {
    const retry = this.deathPending;
    super._attach(level, player);
    this.retry = retry;
    this.entered = false;
    this.last = this._snapshot(level, player);
    this.checkpointAge = 0;
    this.finalRoutePending = false;
    this.seenAmbush = false;
    this.readyAt = this.clock;
    this.memoryLastOffer = -Infinity;
    this.memoryLieStages = new Set();
  }

  _offer(id, options = {}) {
    // Start on a safe landing, but let the recording finish as Shaun moves on.
    super._offer(id, { ...options, continueWhile: () => this._canContinue(this.level, this.player) });
  }

  _canContinue(level, player) {
    return !!level && player.alive && !['entering', 'complete'].includes(level.phase);
  }

  _snapshot(level, player) {
    return { puzzle: level.puzzleIndex, phase: level.phase, health: player.health,
      wave: level.ambush?.currentWave ?? 0, cleared: !!(level.ambush?.cleared || level.ambushWasCleared),
      stage: level.stageIndex, expected: level.expectedIndex,
      x: player.group.position.x, z: player.group.position.z };
  }

  _memoryVoices(level, player, current, last) {
    if (this.running && !this.running.continueWhile()) this.cancel();
    const changed = current.phase !== last.phase || current.stage !== last.stage || current.puzzle !== last.puzzle;
    let cue = null;
    if (changed || !this.entered) {
      if (current.phase === 'watch') cue = current.stage > (last.stage ?? 0) ? 'memory_checkpoint' : 'memory_watch';
      if (current.phase === 'follow') cue = 'memory_follow';
      if (current.phase === 'failed') cue = 'memory_failed';
    }
    const landed = current.phase === 'follow' && current.expected !== last.expected && player.grounded;
    if ((landed || changed) && current.phase === 'follow' && player.grounded) {
      const lie = memoryLieDirection(level, player);
      if (lie && this.assets[`l2_manipulator_${lie}`]) cue = `memory_lie_${lie}`;
    }
    this.entered = true;
    const deceptive = cue?.startsWith('memory_lie_');
    if (cue && !this.running && this.clock - this.memoryLastOffer >= (deceptive ? 4 : 8)
      && (!deceptive || !this.memoryLieStages.has(current.stage))) {
      const phase = current.phase, stage = current.stage, expected = current.expected;
      const valid = () => player.alive && level.puzzleIndex === 2 && level.phase === phase
        && level.stageIndex === stage && (!cue.startsWith('memory_lie_') || level.expectedIndex === expected);
      this.readyAt = Math.min(this.readyAt, this.clock);
      super._offer(cue, { ttl: 3, replay: true, valid,
        continueWhile: () => this.level === level && this._canContinue(level, player) });
      this.memoryLastOffer = this.clock;
      if (deceptive) this.memoryLieStages.add(current.stage);
    }
    this._advance();
  }

  _canSpeak(level, player) {
    if (!player.alive || !player.grounded || player.isDodging || level.deanBladeIntro || player.scriptedMovement) return false;
    if (['watch', 'follow', 'failed', 'entering', 'complete', 'arrival', 'dean_arrival', 'dean_to_start', 'player_arrival', 'arrival_camera'].includes(level.phase)) return false;
    if (player.platformSupport?.bridge !== undefined) return false;
    const z = player.group.position.z;
    if (level.puzzleIndex === 0 && z <= layout.firstBladeZ + 3 && z >= layout.bladeDeckMinZ) return false;
    if (level.phase === 'dean_exit' || level.deanPassage && level.phase !== 'exit') return false;
    return true;
  }

  _safeLanding(level, player) {
    if (!this._canSpeak(level, player)) return false;
    if (player.platformSupport?.tile && !['exit'].includes(level.phase)) return false;
    const z = player.group.position.z;
    return z > layout.spikeCorridorMaxZ || z < layout.spikeCorridorMinZ;
  }

  update(dt, level, player, { active = true, blocked = false } = {}) {
    if (!level?.title?.includes('Sophomore Room') || !player) { if (this.level) this.leave(); return; }
    if (this.level !== level) this._attach(level, player);
    if (!player.alive) this.deathPending = true;
    const current = this._snapshot(level, player), last = this.last;
    // Keep observing phase transitions while muted/unsafe so obsolete dialogue cannot return later.
    this.last = current;
    if (current.phase === 'dean_exit') this.finalRoutePending = true;
    if (!active || blocked || !player.alive || !this.playback.settings.enabled || this.playback.settings.volume === 0) {
      if (this.pending || this.running || this.captions.size) this.cancel();
      this.wasBlocked = true; return;
    }
    this.clock += Math.max(0, Math.min(0.15, dt));
    if (this.wasBlocked) { this.readyAt = Math.max(this.readyAt, this.clock + 0.35); this.wasBlocked = false; }
    const speak = () => this._canSpeak(level, player);
    const safe = () => this._safeLanding(level, player);
    const moved = Math.hypot(current.x - last.x, current.z - last.z) > 0.01;
    this.idle = !moved && safe() ? this.idle + dt : 0;
    this.checkpointAge = current.puzzle === last.puzzle ? this.checkpointAge + dt : 0;

    if (current.puzzle === 2 && ['watch', 'follow', 'failed'].includes(current.phase)) {
      this._memoryVoices(level, player, current, last);
      return;
    }

    if (!speak()) {
      if (this.running && this._canContinue(level, player)) this._advance();
      else if (this.pending || this.running) this.cancel();
      return;
    }

    if (!this.entered) {
      this.entered = true;
      if (this.retry && [0, 1].includes(current.puzzle)) {
        this._offer('hazard_retry', { ttl: 8, valid: safe });
      } else if (current.puzzle === 0) {
        this._offer(this.heard.has('l1_manipulator_03') ? 'arrival' : 'saws_ready', { ttl: 8,
          valid: () => safe() && level.puzzleIndex === 0 });
      } else if (current.puzzle === 1) this._offer('bridge_reassure', { ttl: 8, valid: safe });
      else if (current.puzzle === SPIKE_CORRIDOR_PUZZLE) this._offer('spike_checkpoint', { ttl: 8, valid: safe });
    }
    if (current.puzzle === 0 && this.idle >= 15) this._offer('saws_ready', { valid: safe });
    if (current.puzzle === 1 && last.puzzle === 0) this._offer('saws_clear', { ttl: 4, valid: safe });
    if (current.puzzle === 1 && this.idle >= 12) this._offer('bridge_wait', { ttl: 2, valid: () => safe() && this.idle >= 12 });
    if (current.puzzle === SPIKE_CORRIDOR_PUZZLE && last.puzzle === 1) this._offer('spike_checkpoint', { ttl: 5, valid: safe });
    if (current.puzzle === SPIKE_CORRIDOR_PUZZLE && this.idle >= 10 && !level.ambush?.started) {
      this._offer('spike_observe', { ttl: 2, valid: () => safe() && !level.ambush?.started });
    }
    const arrivals = (level.ambush?.records || []).some(r => r.zombie.alive && r.zombie.group.visible && r.phase === 'jumping');
    if (arrivals && !this.seenAmbush) {
      this.seenAmbush = true;
      this._offer('ambush', { ttl: 1, valid: () => speak() && (level.ambush?.records || []).some(r => r.zombie.alive && r.zombie.group.visible && r.phase === 'jumping') });
    }
    if (current.wave === 2 && last.wave !== 2) this._offer('wave_gap', { ttl: 1.5,
      valid: () => safe() && !(level.ambush?.records || []).some(r => r.wave === 2 && r.zombie.alive && r.zombie.group.visible) });
    if (player.health < last.health) {
      if (player.health / player.maxHealth < 0.4 && last.health / player.maxHealth >= 0.4) {
        this._offer('low_health', { delay: 0.7, ttl: 3, valid: speak });
      } else if (this.clock >= this.injuryReadyAt) this._offer('spike_hurt', { delay: 0.7, ttl: 4, valid: safe });
    }
    if (current.cleared && !last.cleared) this._offer('ambush_clear', { delay: 2, ttl: 6, valid: safe });
    if (current.cleared && current.phase === 'chase' && this.idle >= 8 && !level.memoryApproachArmed) {
      this._offer('memory_rearm', { ttl: 3, valid: () => safe() && level.phase === 'chase' && !level.memoryApproachArmed });
    } else if (current.cleared && current.phase === 'chase' && this.idle >= 12 && this.idle < 15) {
      // The recorded "Fresh eyes" cannot fit the 0.9 s retry-to-demonstration window.
      // Use it only on the untimed entrance landing, never delay the demonstration.
      this._offer('memory_retry', { ttl: 2, valid: () => safe() && level.phase === 'chase' });
    } else if (current.cleared && current.phase === 'chase' && this.idle >= 15) {
      this._offer('memory_wait', { ttl: 3, valid: () => safe() && level.phase === 'chase' });
    }
    if (current.phase === 'exit' && this.finalRoutePending) {
      this.finalRoutePending = false;
      this._offer('final_route', { delay: 1, ttl: 8, valid: () => safe() && level.phase === 'exit' });
    }
    if (current.phase === 'exit' && this.idle >= 15) this._offer('exit_wait', { ttl: 3, valid: () => safe() && level.phase === 'exit' });
    this._advance();
    if (this.running?.cue.id === 'spike_hurt' || this.running?.cue.id === 'low_health') this.injuryReadyAt = this.clock + 35;
  }
}

/** Opposite of the actual next tile in the camera's horizontal frame; never guess on straight jumps. */
export function memoryLieDirection(level, player) {
  const next = level.pattern?.[level.expectedIndex];
  if (!next || !level.tilePosition) return null;
  const target = level.tilePosition(...next), origin = player.group.position;
  const yaw = Number.isFinite(player.yaw) ? player.yaw : 0;
  const dx = target.x - origin.x, dz = target.z - origin.z;
  const lateral = dx * Math.cos(yaw) - dz * Math.sin(yaw);
  const forward = -dx * Math.sin(yaw) - dz * Math.cos(yaw);
  if (forward <= 0 || Math.abs(lateral) < 0.5 || Math.abs(lateral) < Math.abs(forward) * 0.25) return null;
  return lateral > 0 ? 'left' : 'right';
}
