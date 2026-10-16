import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { Level2 } from '../src/levels/Level2.js';

function makePlayer() {
  const group = new THREE.Group();
  return {
    alive: true,
    grounded: true,
    scriptedMovement: false,
    group,
    bodyMesh: new THREE.Group(),
    velocity: new THREE.Vector3(),
    camera: new THREE.PerspectiveCamera(),
    mixer: null,
    weaponPresentation: { update() {} },
    _playAnimation() {},
  };
}

function makeLevel(overrides = {}) {
  return Object.assign(Object.create(Level2.prototype), {
    spikeHitCooldown: 0,
    spikeTipY: -10,
    puzzleIndex: 2,
    phase: 'complete',
    levelComplete: false,
    tiles: [[], []],
    retractingSpikes: null,
    exitPortal: null,
    entrancePortal: null,
    blades: null,
    earlyMemoryHop: null,
    ambush: null,
    dean: null,
    degreeGrip: null,
    portalActive: false,
    portalArrivalPending: false,
    portalActivationPending: false,
    portalPassagePending: false,
    portalEntryPending: false,
    _updateLocalLighting() {},
    ...overrides,
  });
}

test('Level 2 portal events are consumed once and remain silent while inactive', () => {
  const level = makeLevel();
  const player = makePlayer();
  let events = Level2.prototype.update.call(level, 1 / 60, player);
  assert.equal(events.portalArrival, false);
  assert.equal(events.portalActivated, false);
  assert.equal(events.portalPassage, false);
  assert.equal(events.portalEntry, false);

  level.portalArrivalPending = true;
  events = Level2.prototype.update.call(level, 1 / 60, player);
  assert.equal(events.portalArrival, true);
  assert.equal(Level2.prototype.update.call(level, 1 / 60, player).portalArrival, false);
});

test('the final memory route activates the exit portal once and exposes its hum lifecycle', () => {
  const tile = { i: 0, j: 0, timer: null };
  const level = makeLevel({
    patterns: [[[0, 0]]], stageIndex: 0, expectedIndex: 0, creditsCollected: 0,
    tiles: [[tile]], dean: { _playAction() {} },
  });
  const player = { addScore() {} };

  Level2.prototype._onTileLanding.call(level, tile, player);
  assert.equal(level.phase, 'dean_exit');
  assert.equal(level.portalActive, true);
  assert.equal(level.portalActivationPending, true);

  level.phase = 'complete';
  const events = Level2.prototype.update.call(level, 1 / 60, makePlayer());
  assert.equal(events.portalActivated, true);
  assert.equal(Level2.prototype.update.call(level, 1 / 60, makePlayer()).portalActivated, false);
});

test('Dean and Shaun portal passages each emit one event, and Shaun entry stops the active hum', () => {
  const exitPortal = { center: new THREE.Vector3(0, 2, 0), update() {} };
  const deanGroup = new THREE.Group();
  const player = makePlayer();
  const level = makeLevel({
    phase: 'dean_exit', exitPortal, portalApproachPoint: new THREE.Vector3(),
    bossMarker: deanGroup, dean: { _playAction() {} },
  });

  Level2.prototype._updateExit.call(level, 0, player);
  assert.equal(level.portalPassagePending, true);
  level.phase = 'complete';
  assert.equal(Level2.prototype.update.call(level, 1 / 60, player).portalPassage, true);

  level.phase = 'exit';
  level.portalActive = true;
  player.group.position.set(0, 0, 0);
  Level2.prototype._updateExit.call(level, 0, player);
  assert.equal(level.phase, 'entering');
  assert.equal(level.portalActive, false);
  assert.equal(level.portalEntryPending, true);
  level.phase = 'complete';
  assert.equal(Level2.prototype.update.call(level, 1 / 60, player).portalEntry, true);
});

test('checkpoint construction resets Level 2 portal-audio state', () => {
  const level = new Level2(new THREE.Scene(), { puzzleIndex: 2, stageIndex: 1, seed: 7 });
  assert.equal(level.portalActive, false);
  assert.equal(level.portalArrivalPending, false);
  assert.equal(level.portalActivationPending, false);
  assert.equal(level.portalPassagePending, false);
  assert.equal(level.portalEntryPending, false);
  level.dispose();
});

test('Game routes Level 2 arrival and Dean passage events through the established portal cue', () => {
  const source = readFileSync('src/core/Game.js', 'utf8');
  assert.match(source, /events\.portalArrival \|\| events\.portalPassage/);
  assert.match(source, /events\.portalEntry[\s\S]*stopPortalHum/);
});
