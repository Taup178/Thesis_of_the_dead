import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Game } from '../src/core/Game.js';
import { WeaponCombat } from '../src/player/WeaponCombat.js';

test('Level 1 field notes are queued by combat and world events, not a fixed tutorial sequence', () => {
  const visible = new Set();
  const fieldNote = {
    classList: { add: (...values) => values.forEach(value => visible.add(value)), remove: (...values) => values.forEach(value => visible.delete(value)) },
    setAttribute() {},
  };
  const zombie = { alive: true, group: { visible: true, position: new THREE.Vector3(7, 0, 0) } };
  const game = {
    state: 'playing', STATE: { PLAYING: 'playing' },
    currentLevel: { title: 'Chapter 1: The Freshman Woods', zombies: [zombie] },
    combat: { firstZombieHit: true },
    player: { alive: true, group: { position: new THREE.Vector3() } },
    firstLevelTutorialSeen: new Set(), firstLevelHintQueue: [], firstLevelHintTime: 0,
    firstLevelTutorialBlocking: false, firstLevelTutorialInventoryPause: false,
    fieldNote, fieldNoteTitle: { textContent: '' }, fieldNoteDetail: { textContent: '' }, fieldNotePrompt: { textContent: '' },
    audio: { pause() { this.paused = true; }, resume() { this.paused = false; } },
  };
  game._queueFirstLevelHint = Game.prototype._queueFirstLevelHint.bind(game);
  game._updateFirstLevelTutorial = Game.prototype._updateFirstLevelTutorial.bind(game);

  Game.prototype._checkFirstLevelTutorial.call(game, {}, 0.016);
  assert.ok(game.firstLevelTutorialSeen.has('loadout'), 'first zombie hit triggers the weapon guide');
  assert.ok(game.firstLevelTutorialSeen.has('roll'), 'a nearby threat triggers the roll guide independently');
  assert.equal(game.fieldNoteTitle.textContent, 'First blood');
  assert.equal(game.fieldNotePrompt.textContent, 'PRESS 1 TO OPEN INVENTORY');
  assert.equal(game.firstLevelTutorialBlocking, true, 'the guide pauses gameplay until its control is pressed');
  assert.equal(game.audio.paused, true);

  // Acknowledge the first guide to simulate pressing 1 and returning from inventory.
  game.firstLevelTutorialBlocking = false;
  game.firstLevelTutorialActive = null;
  zombie.group.position.set(2, 0, 0);
  Game.prototype._checkFirstLevelTutorial.call(game, { firstCreditCollected: true }, 0.016);
  assert.ok(game.firstLevelTutorialSeen.has('strike'), 'close range triggers the strike guide');
  assert.equal(game.firstLevelTutorialSeen.has('jump'), false, 'the jump guide is not shown');
  assert.deepEqual(game.firstLevelHintQueue.map(hint => hint.title), ['Too close for a clean shot']);
});

test('the first successful firearm hit on a zombie is exposed as a one-time combat event', () => {
  const combat = Object.create(WeaponCombat.prototype);
  Object.assign(combat, { rewarded: new WeakSet(), kills: 0, firstZombieHit: false });
  const zombie = { alive: true, takeDamage() { return false; }, group: { position: new THREE.Vector3() } };
  combat.damageZombie(zombie, 15, { weapon: 'smg', addScore() {} });
  assert.equal(combat.firstZombieHit, true);
  assert.equal(combat.kills, 0, 'a hit does not count as a kill');
});

test('a paused loadout guide opens inventory on 1 and a move guide performs its requested action', () => {
  const calls = [];
  const loadout = {
    firstLevelTutorialBlocking: true,
    firstLevelTutorialActive: { id: 'loadout', control: 'Digit1' },
    firstLevelTutorialInventoryPause: false,
    input: { consumeKeyPress: code => code === 'Digit1', flushMouseDelta() {}, pressedKeys: new Set() },
    fieldNote: { classList: { remove() {} }, setAttribute() {} },
    audio: { resume: () => calls.push('resume') },
    _openWeaponWheel: () => calls.push('open inventory'),
  };
  assert.equal(Game.prototype._handleFirstLevelTutorialControl.call(loadout), true);
  assert.equal(loadout.firstLevelTutorialBlocking, false);
  assert.equal(loadout.firstLevelTutorialInventoryPause, true);
  assert.deepEqual(calls, ['resume', 'open inventory']);

  const roll = {
    firstLevelTutorialBlocking: true,
    firstLevelTutorialActive: { id: 'roll', control: 'KeyQ' },
    input: { consumeKeyPress: code => code === 'KeyQ', flushMouseDelta() {}, pressedKeys: new Set() },
    fieldNote: { classList: { remove() {} }, setAttribute() {} },
    audio: { resume: () => calls.push('resume') },
  };
  assert.equal(Game.prototype._handleFirstLevelTutorialControl.call(roll), false);
  assert.ok(roll.input.pressedKeys.has('KeyQ'), 'the acknowledged roll press is passed through to gameplay');
});
