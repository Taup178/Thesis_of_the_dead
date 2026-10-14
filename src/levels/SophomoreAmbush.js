import * as THREE from 'three';
import { Zombie } from '../enemies/Zombie.js';
import { SOPHOMORE_LAYOUT as layout } from './SophomoreLayout.js';

export const AMBUSH_WAVES = 4, ZOMBIES_PER_WAVE = 3;
const TOTAL = AMBUSH_WAVES * ZOMBIES_PER_WAVE;
const ARRIVAL_INTERVAL = 0.65, WAVE_PAUSE = 2, JUMP_DURATION = 1.65, GRAVITY = -20;

/** A finite ambush from the pit edges; the memory tiles remain outside its combat area. */
export class SophomoreAmbush {
  constructor(level, { createZombie = (position, path) => new Zombie(level.scene, position, path) } = {}) {
    this.level = level; this.createZombie = createZombie;
    this.records = []; this.started = false; this.currentWave = 0;
    this.time = 0; this.nextArrival = 0; this.disposed = false;
  }

  load() {
    if (this.ready) return this.ready;
    const variants = ['Basic', 'Chubby'];
    this.records = Array.from({ length: TOTAL }, (_, index) => {
      const side = index % 2 === 0 ? -1 : 1;
      const zombie = this.createZombie(new THREE.Vector3(side * 8.4, -12, layout.spikeCorridorMaxZ - 4),
        `./assets/models/zombies/Zombie_${variants[index % variants.length]}.gltf`);
      zombie.speed = 3.2; zombie.group.visible = false;
      zombie.group.name = `SpikeAmbushZombie_${index + 1}`;
      this.level.root.add(zombie.group); this.level.zombies.push(zombie);
      return { zombie, index, side, wave: Math.floor(index / ZOMBIES_PER_WAVE), phase: 'waiting', jumpTime: 0 };
    });
    this.ready = Promise.all(this.records.map(record => record.zombie.ready));
    return this.ready;
  }

  get remaining() { return this.records.filter(record => record.zombie.alive).length; }
  get cleared() { return this.started && this.records.length === TOTAL && this.remaining === 0; }

  start() {
    if (this.started || this.disposed || this.records.length !== TOTAL) return false;
    this.started = true; this.time = 0; this.nextArrival = 0;
    return true;
  }

  _launch(record, player) {
    const z = THREE.MathUtils.clamp(player.group.position.z - 3 - (record.index % ZOMBIES_PER_WAVE) * 1.2,
      layout.spikeCorridorMinZ + 3, layout.spikeCorridorMaxZ - 3);
    record.from = new THREE.Vector3(record.side * 8.4, this.level.spikeTipY, z);
    record.to = new THREE.Vector3(record.side * 6.2, 0, z - 0.6);
    record.launchVelocity = (record.to.y - record.from.y - 0.5 * GRAVITY * JUMP_DURATION ** 2) / JUMP_DURATION;
    record.phase = 'jumping'; record.jumpTime = 0;
    record.justLaunched = true;
    const zombie = record.zombie;
    zombie.group.position.copy(record.from);
    zombie.group.lookAt(record.to.x, record.from.y, record.to.z);
    const jump = zombie.actions.Jump;
    if (jump) {
      jump.setLoop(THREE.LoopOnce, 1); jump.clampWhenFinished = true;
      jump.setEffectiveTimeScale(jump.getClip().duration / JUMP_DURATION);
    }
    zombie._playAction(jump ? 'Jump' : zombie.actions.Run ? 'Run' : 'Walk', 0.08, true);
  }

  _updateJump(record, dt) {
    const zombie = record.zombie;
    record.jumpTime = Math.min(JUMP_DURATION, record.jumpTime + dt);
    const t = record.jumpTime;
    zombie.group.position.lerpVectors(record.from, record.to, t / JUMP_DURATION);
    zombie.group.position.y = record.from.y + record.launchVelocity * t + 0.5 * GRAVITY * t * t;
    // They rise from the actual underground pit, without appearing in midair.
    if (zombie.group.position.y > -1.8) zombie.group.visible = true;
    zombie.mixer?.update(dt);
    if (t < JUMP_DURATION) return;
    zombie.group.position.copy(record.to);
    record.phase = zombie.alive ? 'active' : 'dead';
    if (zombie.alive) zombie._playAction('Walk', 0.08);
  }

  update(dt, player) {
    if (this.disposed || !this.started) return;
    const canFight = player.alive && !player.scriptedMovement && !this.level.deanBladeIntro &&
      ['dean_challenge', 'chase'].includes(this.level.phase);
    const canPursue = canFight || (player.alive && !player.scriptedMovement && this.level.phase === 'failed');
    if (canFight) {
      this.time += dt;
      let wave = this.records.filter(record => record.wave === this.currentWave);
      if (wave.every(record => !record.zombie.alive) && this.currentWave < AMBUSH_WAVES - 1) {
        this.currentWave++;
        this.nextArrival = this.time + WAVE_PAUSE;
        wave = this.records.filter(record => record.wave === this.currentWave);
      }
      const waiting = wave.find(record => record.zombie.alive && record.phase === 'waiting');
      if (waiting && this.time >= this.nextArrival) {
        this._launch(waiting, player);
        this.nextArrival = this.time + ARRIVAL_INTERVAL;
      }
    }
    for (const record of this.records) {
      const zombie = record.zombie;
      if (record.phase === 'jumping') {
        if (canPursue || !zombie.alive) this._updateJump(record, record.justLaunched ? 0 : dt);
        record.justLaunched = false;
      } else if (!zombie.alive) {
        record.phase = 'dead'; zombie.mixer?.update(dt);
      } else if (record.phase === 'active' && canPursue) {
        const edgeZ = this.level.startSurface.minZ + 0.45;
        const farEdgeZ = this.level.bridgeExitSurface.maxZ - 0.5;
        const target = new THREE.Vector3(THREE.MathUtils.clamp(player.group.position.x, -6.45, 6.45), 0,
          THREE.MathUtils.clamp(player.group.position.z, edgeZ, farEdgeZ));
        const beyondEdge = target.x !== player.group.position.x || target.z !== player.group.position.z;
        let result = { hit: false };
        if (beyondEdge) {
          // Follow to the visible cliff edge, then idle there instead of walking into an invisible barrier.
          zombie.mixer?.update(dt);
          zombie.damageCooldown = Math.max(0, zombie.damageCooldown - dt);
          zombie.attackTimer = Math.max(0, zombie.attackTimer - dt);
          const direction = target.clone().sub(zombie.group.position); direction.y = 0;
          const distance = direction.length();
          zombie.group.lookAt(player.group.position.x, zombie.group.position.y, player.group.position.z);
          if (zombie.attackTimer === 0) {
            if (distance > 0.1) {
              zombie.group.position.addScaledVector(direction.normalize(), Math.min(distance, zombie.speed * dt));
              zombie._playAction('Walk');
            } else zombie._playAction('Idle');
          }
        } else result = zombie.update(dt, player.group.position);
        const position = zombie.group.position;
        position.x = THREE.MathUtils.clamp(position.x, -6.45, 6.45);
        position.z = THREE.MathUtils.clamp(position.z, edgeZ, farEdgeZ);
        position.y = 0; // Spikes do not interrupt the zombies' movement.
        if (result.hit && player.group.position.y >= -0.6 && player.group.position.y < 1.8) {
          player.takeDamage(result.damage);
          if (!player.alive) this.level._fail(player, 'The zombies overwhelmed you. Retry from your spike checkpoint.');
        }
      }
    }
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    const owned = new Set(this.records.map(record => record.zombie));
    for (const zombie of owned) { zombie.group.removeFromParent(); zombie.dispose(); }
    this.level.zombies = this.level.zombies.filter(zombie => !owned.has(zombie));
    this.records = [];
  }
}
