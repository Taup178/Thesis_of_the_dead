import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Level2 } from '../src/levels/Level2.js';
import { Player } from '../src/player/Player.js';

function withAudio(testBody) {
  const previous = globalThis.__thesisAudioManager, calls = [];
  globalThis.__thesisAudioManager = {
    playRandom: (...args) => calls.push(['random', ...args]),
    playSfx: (...args) => calls.push(['sfx', ...args]),
  };
  try { testBody(calls); } finally { globalThis.__thesisAudioManager = previous; }
}

function makePitLevel(overrides = {}) {
  return Object.assign(Object.create(Level2.prototype), {
    spikeHitCooldown: 0,
    spikeTipY: -3,
    puzzleIndex: 2,
    phase: 'chase',
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
    _updateLocalLighting() {},
    ...overrides,
  });
}

function makePlayer({ y = -3, health = 100, isDodging = false } = {}) {
  const player = new Player(new THREE.Scene(), { flushMouseDelta() {} }, new THREE.PerspectiveCamera(60, 1, 0.1, 100));
  Object.assign(player, {
    alive: true,
    health,
    isDodging,
    dodgeTimer: isDodging ? 0.25 : 0,
    dodgeProgress: isDodging ? 0.5 : 0,
    verticalVelocity: -5,
    velocity: new THREE.Vector3(0, -5, 0),
    actions: {},
    hitReactionDuration: 0.48,
    hitReactionTime: 0,
    damageFlashTime: 0,
    grounded: false,
    platformSupport: null,
    _updateCamera() {},
  });
  player.group.position.y = y;
  return player;
}

test('Level 2 pit death uses shared fatal damage once, even during a roll', () => withAudio(calls => {
  const level = makePitLevel();
  const player = makePlayer({ isDodging: true });
  let damageCalls = 0;
  const takeDamage = player.takeDamage.bind(player);
  player.takeDamage = amount => { damageCalls++; return takeDamage(amount); };

  Level2.prototype.update.call(level, 1 / 60, player);
  Level2.prototype.update.call(level, 1 / 60, player);

  assert.equal(damageCalls, 1, 'remaining in the pit cannot process a second death');
  assert.equal(player.health, 0);
  assert.equal(player.alive, false);
  assert.equal(player.isDodging, false, 'pit lethality overrides dodge immunity');
  assert.equal(level.phase, 'failed');
  assert.equal(calls.filter(([kind, path]) => kind === 'sfx' && /shaun-death/.test(path)).length, 1);
}));

test('Level 2 retracting-spike damage still uses its existing nonfatal shared amount', () => {
  const level = makePitLevel({
    spikeTipY: -10,
    retractingSpikes: { update() {}, hitsPlayer: () => true },
  });
  const player = makePlayer({ y: 0 });
  const damage = [];
  player.takeDamage = amount => damage.push(amount);

  Level2.prototype.update.call(level, 1 / 60, player);

  assert.deepEqual(damage, [20]);
  assert.equal(level.spikeHitCooldown, 0.8);
});

test('Level 2 pit failure retains the earned checkpoint snapshot', () => {
  const level = makePitLevel({
    phase: 'failed', puzzleIndex: 1, stageIndex: 2, seed: 1234,
  });
  const state = Level2.prototype.getRestartState.call(level);

  assert.equal(state.puzzleIndex, 1);
  assert.equal(state.stageIndex, 2);
  assert.notEqual(state.seed, 1234, 'a failed retry receives a fresh memory pattern seed');
});
