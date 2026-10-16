import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Level1 } from '../src/levels/Level1.js';

test('Level 1 marks the final Credit and Dean reveal exactly once at actual collection time', () => {
  const scene = new THREE.Scene();
  const first = { mesh: new THREE.Object3D(), collected: false };
  const final = { mesh: new THREE.Object3D(), collected: false };
  first.mesh.position.set(0, 0, 0);
  final.mesh.position.set(10, 0, 0);
  scene.add(first.mesh, final.mesh);
  const level = Object.create(Level1.prototype);
  Object.assign(level, {
    scene, credits: [first, final], creditsCollected: 0, creditEffects: { update() {}, onCollected() {} },
    zombies: [], bossState: 'waiting', spawnDelay: 0, nightSky: null, wakeUpIntro: null,
    redPortalMixer: null, redPortalLight: null, portalMixer: null, playerAbsorption: null,
    portalRoot: null, portalLight: null, levelComplete: false,
  });
  let reveals = 0;
  level._spawnOrbZombies = () => {};
  level._spawnBoss = () => { reveals++; level.bossState = 'revealed'; };
  const player = { group: new THREE.Object3D(), addScore() {} };

  let events = level.update(0, player, 0);
  assert.equal(events.creditCollected, true);
  assert.equal(events.finalCreditCollected, false);
  assert.equal(events.deanReveal, false);
  assert.equal(reveals, 0);

  player.group.position.x = 10;
  events = level.update(0, player, 0);
  assert.equal(events.creditCollected, true);
  assert.equal(events.finalCreditCollected, true);
  assert.equal(events.deanReveal, true);
  assert.equal(reveals, 1);

  events = level.update(0, player, 0);
  assert.equal(events.creditCollected, false);
  assert.equal(events.deanReveal, false);
  assert.equal(reveals, 1);
});

test('Level 1 objective text follows Credit and portal progression states', () => {
  const level = Object.create(Level1.prototype);
  Object.assign(level, { creditsCollected: 3, credits: Array.from({ length: 8 }), bossState: 'waiting', playerAbsorption: null });
  assert.equal(level.getChallengeStatus().title, 'Collect Academic Credits (3/8)');
  level.creditsCollected = 8;
  assert.equal(level.getChallengeStatus().detail, 'All Academic Credits collected! The Dean has appeared.');
  level.bossState = 'done';
  assert.equal(level.getChallengeStatus().title, 'Follow the Dean into the green portal');
});
