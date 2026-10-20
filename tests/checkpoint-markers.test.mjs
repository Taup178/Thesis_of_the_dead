import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CheckpointMarker } from '../src/props/CheckpointMarker.js';
import { Level1 } from '../src/levels/Level1.js';
import { Level2 } from '../src/levels/Level2.js';
import { Level3 } from '../src/levels/Level3.js';

const player = () => ({ alive: true, grounded: true, group: new THREE.Group(),
  camera: new THREE.PerspectiveCamera(), health: 100 });

test('Level 1 exit glow waits for the Dean escape and every spawned or pending zombie', () => {
  const level = new Level1(new THREE.Scene()), p = player();
  level.exitCheckpoint = new CheckpointMarker(level.scene);
  p.group.position.x = 20;
  level.bossState = 'done';
  level.zombieReserve = [{ alive: true }];
  level.update(0.1, p, 0);
  assert.equal(level.exitCheckpoint.root.visible, false);
  level.zombieReserve = [];
  level.update(0.1, p, 0);
  assert.equal(level.exitCheckpoint.root.visible, true);
  assert.deepEqual(level.exitCheckpoint.root.position.toArray(), level.portalApproachPoint.toArray());
  level.playerAbsorption = {}; level._updatePlayerAbsorption = () => {};
  level.update(0.1, p, 0);
  assert.equal(level.exitCheckpoint.root.visible, false, 'portal travel removes the destination glow');
  level.exitCheckpoint.dispose();
});

test('Level 2 has a marker only at its ready exit, never in the obstacle or memory stages', () => {
  const level = new Level2(new THREE.Scene(), { puzzleIndex: 2 }), p = player();
  level.exitCheckpoint = new CheckpointMarker(level.root);
  level.portalApproachPoint = new THREE.Vector3(0, 0, -80);
  level._updateChase = level._updateDemonstration = level._updateExit = () => {};
  for (const phase of ['chase', 'watch', 'follow', 'dean_exit', 'exit', 'entering']) {
    level.phase = phase;
    level.update(0.1, p);
    assert.equal(level.exitCheckpoint.root.visible, phase === 'exit', phase);
  }
  level.exitCheckpoint.dispose();
});

test('the arena centre indicator requires both destroyed huts and cleared zombies', () => {
  const marker = new CheckpointMarker(new THREE.Group(), { radius: 4.5 });
  const level = Object.assign(Object.create(Level3.prototype), {
    elapsed: 0, timeRemaining: 60, targetHold: 0, spawnRecords: [],
    houses: [{ alive: true, update() {} }], zombies: [{ alive: true }],
    bossFight: { phase: 'waiting', centerMarker: marker.root, update() {} },
    _updateBossCutscene() {},
  });
  const p = player(); p.group.position.x = 20;
  level.update(0.1, p); assert.equal(marker.root.visible, false);
  level.houses[0].alive = false;
  level.update(0.1, p); assert.equal(marker.root.visible, false);
  level.zombies[0].alive = false;
  level.update(0.1, p); assert.equal(marker.root.visible, true);
  level.bossFight.phase = 'combat';
  level.update(0.1, p); assert.equal(marker.root.visible, false);
  marker.dispose();
});
