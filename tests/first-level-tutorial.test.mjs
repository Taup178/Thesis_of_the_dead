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

test('third wave offers the lock guide only when a target can be locked', () => {
  const calls = [], note = { classList: { add(){}, remove(){} }, setAttribute(){} };
  const game = { state: 'playing', STATE: {PLAYING:'playing'},
    currentLevel: {title:'Chapter 1: The Freshman Woods', creditsCollected: 2, zombies: []},
    player: {alive:true, group:{position:new THREE.Vector3()}, bossLockAvailable: new THREE.Group(), lockOnTarget:null},
    combat: {firstZombieHit:false}, firstLevelTutorialSeen:new Set(), firstLevelHintQueue:[],
    firstLevelTutorialBlocking:false, firstLevelTutorialInventoryPause:false,
    fieldNote:note, fieldNoteTitle:{},fieldNoteDetail:{},fieldNotePrompt:{},input:{gamepadInUse:false},
    audio:{pause(){calls.push('pause');},resume(){}}, };
  game._queueFirstLevelHint = Game.prototype._queueFirstLevelHint.bind(game);
  game._updateFirstLevelTutorial = Game.prototype._updateFirstLevelTutorial.bind(game);
  Game.prototype._checkFirstLevelTutorial.call(game, {}, .1);
  assert.equal(game.firstLevelTutorialSeen.has('lock'), false);
  game.currentLevel.creditsCollected = 3; game.player.bossLockAvailable = null;
  Game.prototype._checkFirstLevelTutorial.call(game, {}, .1);
  assert.equal(game.firstLevelTutorialSeen.has('lock'), false);
  game.player.bossLockAvailable = new THREE.Group();
  Game.prototype._checkFirstLevelTutorial.call(game, {}, .1);
  assert.equal(game.firstLevelTutorialActive.id, 'lock');
  assert.equal(game.fieldNotePrompt.textContent, 'PRESS L TO LOCK ON');
  assert.deepEqual(calls, ['pause']);
  game.input = {consumeKeyPress: key => key === 'KeyL', pressedKeys:new Set(), flushMouseDelta(){}};
  assert.equal(Game.prototype._handleFirstLevelTutorialControl.call(game), false);
  assert.ok(game.input.pressedKeys.has('KeyL'), 'acknowledgement reaches the existing lock action');
  Game.prototype._checkFirstLevelTutorial.call(game, {}, .1);
  assert.equal(game.firstLevelHintQueue.length, 0, 'guide is offered only once');
});

test('queued lock guide waits for an available target and displays gamepad control', () => {
  const game = { state:'playing',STATE:{PLAYING:'playing'}, currentLevel:{title:'Freshman Woods'},
    player:{bossLockAvailable:null,lockOnTarget:null},input:{gamepadInUse:true},
    firstLevelTutorialBlocking:false,firstLevelTutorialInventoryPause:false,
    firstLevelHintQueue:[{id:'lock',title:'Focus your aim',detail:'Lock on',control:'KeyL',prompt:'PRESS L TO LOCK ON'}],
    fieldNote:{classList:{add(){},remove(){}},setAttribute(){}},fieldNoteTitle:{},fieldNoteDetail:{},fieldNotePrompt:{},audio:{pause(){}} };
  Game.prototype._updateFirstLevelTutorial.call(game, .1);
  assert.equal(game.firstLevelTutorialBlocking,false);
  game.player.bossLockAvailable = new THREE.Group();
  Game.prototype._updateFirstLevelTutorial.call(game, .1);
  assert.equal(game.fieldNotePrompt.textContent,'PRESS R3 TO LOCK ON');
});
