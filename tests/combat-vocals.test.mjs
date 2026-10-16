import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Player } from '../src/player/Player.js';
import { Zombie } from '../src/enemies/Zombie.js';

function withAudio(testBody) {
  const previous = globalThis.__thesisAudioManager, calls = [];
  globalThis.__thesisAudioManager = {
    playRandom: (...args) => calls.push(['random', ...args]),
    playSfx: (...args) => calls.push(['sfx', ...args]),
  };
  try { testBody(calls); } finally { globalThis.__thesisAudioManager = previous; }
}

test('Shaun vocalizes only for real damage, with death replacing pain', () => withAudio(calls => {
  const player = new Player(new THREE.Scene(), { flushMouseDelta() {} }, new THREE.PerspectiveCamera());
  player.health = 20;
  player.takeDamage(0); player.isDodging = true; player.takeDamage(5);
  assert.equal(calls.length, 0);
  player.isDodging = false; player.takeDamage(5);
  assert.match(calls[0][1][0], /shaun-hurt/);
  player.takeDamage(20);
  assert.match(calls[1][1], /shaun-death/);
  player.takeDamage(5);
  assert.equal(calls.length, 2);
  assert.ok(player.deathSequence, 'the death vocal accompanies the visible death sequence');
  player.deathSequence.dispose();
}));

test('zombie hurt and death vocals are distinct and death fires once', () => withAudio(calls => {
  const zombie = Object.create(Zombie.prototype);
  Object.assign(zombie, { alive: true, health: 30, group: new THREE.Group(), actions: {}, speed: 2, attackTimer: 0 });
  zombie.takeDamage(10);
  assert.match(calls[0][1][0], /zombie\/hurt/);
  zombie.takeDamage(20);
  assert.match(calls[1][1][0], /zombie\/death/);
  zombie.die();
  assert.equal(calls.length, 2);
}));

test('grounded movement emits varied footsteps at the existing cadence, never while airborne or rolling', () => withAudio(calls => {
  const player = Object.create(Player.prototype);
  Object.assign(player, { stepTimer: 0, grounded: true, isDodging: false, bashTime: 0 });
  player._updateMovementAudio(0.016, true, 8);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'random');
  assert.equal(calls[0][1].length, 2);
  assert.ok(calls[0][1].every(path => path.includes('garybran-forest-step')));
  assert.equal(calls[0][2].category, 'sfx');
  assert.ok(player.stepTimer >= 0.22);

  player._updateMovementAudio(0.05, true, 8);
  assert.equal(calls.length, 1, 'cadence prevents duplicate frames from retriggering');
  player._updateMovementAudio(1, false, 0);
  assert.equal(player.stepTimer, 0, 'stopping clears a pending step');
  player.grounded = false;
  player._updateMovementAudio(0.1, true, 8);
  player.grounded = true; player.isDodging = true;
  player._updateMovementAudio(0.1, true, 8);
  assert.equal(calls.length, 1, 'jumps and rolls remain silent');
}));

test('Level 1 footstep voices cannot suppress a successful shared jump or roll exertion', () => withAudio(calls => {
  const player = Object.create(Player.prototype);
  player._playExertion();
  assert.equal(calls[0][2].group, 'player-vocal');
  assert.equal(calls[0][2].maxVoices, 1);
  calls.length = 0;
  Object.assign(player, { stepTimer: 0, grounded: true, isDodging: false, bashTime: 0 });
  player._updateMovementAudio(0.016, true, 8);
  player._playExertion();
  assert.equal(calls[0][2].group, 'player');
  assert.equal(calls[1][2].group, 'player-vocal');
}));

test('successful Level 1, Level 2, and Level 3 jump/roll paths share one exertion trigger', () => withAudio(calls => {
  const makeInput = pressed => ({
    pointerLocked: true, gamepadInUse: false, mouseDeltaX: 0, mouseDeltaY: 0,
    isDown: () => false, flushMouseDelta() {},
    consumeKeyPress: key => pressed.delete(key),
  });
  const playablePlatforming = { canMove: true, allowDodge: true, allowSprint: true, moveSpeed: 5, surfaces: [] };
  for (const [name, platforming] of [['Level 1', null], ['Level 2', playablePlatforming], ['Level 3', null]]) {
    const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera();
    const jump = new Player(scene, makeInput(new Set(['Space'])), camera);
    jump.update(1 / 60, [], null, platforming);
    assert.equal(calls.at(-1)[2].group, 'player-vocal', `${name} successful jump`);

    const roll = new Player(scene, makeInput(new Set(['KeyQ'])), camera);
    roll.update(1 / 60, [], null, platforming);
    assert.equal(calls.at(-1)[2].group, 'player-vocal', `${name} successful roll`);
  }
  const before = calls.length;
  const blocked = new Player(new THREE.Scene(), makeInput(new Set(['KeyQ'])), new THREE.PerspectiveCamera());
  blocked.update(1 / 60, [], null, { canMove: false, allowDodge: false, surfaces: [] });
  assert.equal(calls.length, before, 'failed actions do not vocalize');
}));

test('sword and dagger swings use the cleared Artninja whooshes only after a valid melee start', () => withAudio(calls => {
  const player = Object.create(Player.prototype);
  Object.assign(player, { weapon: 'sword', bashTime: 0, alive: true, isDodging: false, scriptedMovement: false, actions: {} });
  player.weaponPresentation = { bash() {}, update() {} }; player._playExertion = () => {};
  assert.equal(player.startMeleeAttack(), true);
  assert.match(calls[0][1][0], /artninja-sword-swing/);
  calls.length = 0; player.bashTime = 0; player.weapon = 'dagger';
  assert.equal(player.startMeleeAttack(), true);
  assert.match(calls[0][1][0], /artninja-sword-swing/);
}));
