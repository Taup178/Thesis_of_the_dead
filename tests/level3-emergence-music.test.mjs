import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Level3 } from '../src/levels/Level3.js';

test('Level 3 emits the house-zombie music cue once when the first zombie exits', () => {
  const level = Object.assign(Object.create(Level3.prototype), {
    transformationPreview: false, bossPreview: false, resumeArena: false,
    dean: null, entrancePortal: null, arrivalPlayer: null, failed: false,
    degreeBurn: null, degreeBurnCutscene: null, transformation: null,
    elapsed: 0, timeRemaining: 60, arenaCleared: false, targetHold: 0,
    houseEmergenceCuePlayed: false, houseEmergenceCuePending: false,
    houses: [{ alive: true, update() {} }],
    zombies: [{ alive: true, mixer: null, group: new THREE.Group(), _playAction() {} }],
    spawnRecords: [{
      phase: 'waiting', releaseAt: 0, progress: 0,
      house: { alive: true }, zombie: null,
      door: { start: new THREE.Vector3(), end: new THREE.Vector3(0, 0, 2), direction: new THREE.Vector3(0, 0, 1) },
    }],
    _updateBossCutscene() {},
  });
  level.spawnRecords[0].zombie = level.zombies[0];
  let dustPulses = 0;
  level.spawnRecords[0].house.emitEmergenceDust = () => dustPulses++;
  const player = { alive: true, group: new THREE.Group() };

  const first = level.update(1 / 60, player);
  assert.equal(first.houseZombiesEmerging, true);
  assert.equal(level.spawnRecords[0].phase, 'exiting');
  assert.equal(level.zombies[0].group.visible, true);
  assert.equal(dustPulses, 1);

  const next = level.update(1 / 60, player);
  assert.equal(next.houseZombiesEmerging, false);
  assert.equal(dustPulses, 1, 'dust is pulsed, not allocated every frame');
  for (let frame = 0; frame < 130 && level.spawnRecords[0].phase === 'exiting'; frame++) level.update(1 / 60, player);
  assert.ok(dustPulses >= 8 && dustPulses <= 10, 'red dust keeps pumping throughout emergence');
  assert.equal(level.spawnRecords[0].phase, 'hunting');
  const count = dustPulses;
  level.spawnRecords[0].zombie.alive = false;
  level.spawnRecords[0].deathHandled = true;
  level.update(1 / 60, player);
  assert.equal(dustPulses, count, 'dead zombies stop emitting');
});
