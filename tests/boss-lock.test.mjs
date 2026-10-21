import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Player } from '../src/player/Player.js';
import { Level3 } from '../src/levels/Level3.js';
import { KEY_TO_PAD, PAD } from '../src/core/Gamepad.js';
import { Game } from '../src/core/Game.js';
import { getEnemyLockTargets, getEnemyPinPosition } from '../src/player/EnemyLockOn.js';

function fixture() {
  const scene = new THREE.Scene(), keys = new Set();
  const input = { isDown: key => keys.has(key), pointerLocked: true, mouseDeltaX: 0, mouseDeltaY: 0,
    flushMouseDelta() { this.mouseDeltaX = this.mouseDeltaY = 0; } };
  const player = new Player(scene, input, new THREE.PerspectiveCamera()), boss = new THREE.Group();
  scene.add(boss); boss.position.set(0, 0, -12);
  player.setBossLockTarget(boss, 2.2); player.toggleBossLock();
  return { player, boss, keys, input };
}

function assertAim(player, boss) {
  const target = boss.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 2.2, 0));
  const direction = target.sub(player.camera.position).normalize();
  assert.ok(player.camera.getWorldDirection(new THREE.Vector3()).dot(direction) > 0.99999, 'crosshair stays on the boss');
}

test('boss lock centers a moving and airborne boss while strafing in either camera view', () => {
  const { player, boss, keys, input } = fixture();
  keys.add('KeyD');
  for (let frame = 0; frame < 60; frame++) {
    boss.position.set(Math.sin(frame / 20) * 6, Math.sin(frame / 60 * Math.PI) * 3, -12);
    input.mouseDeltaX = 100; input.mouseDeltaY = 100;
    player.update(1 / 60); assertAim(player, boss);
  }
  assert.ok(player.group.position.x > 3, 'strafe movement stays available');
  player.toggleCamera(); assertAim(player, boss);
  boss.position.y = 5; player.update(1 / 60); assertAim(player, boss);
  assert.equal(KEY_TO_PAD.KeyL, PAD.LOCK_ON);
});

test('dodges keep their chosen direction while the camera follows the locked boss', () => {
  const { player, boss, keys } = fixture();
  keys.add('KeyD'); keys.add('KeyQ'); player.update(1 / 60);
  const dodge = player.dodgeDirection.clone(); keys.clear();
  for (let frame = 0; frame < 15; frame++) {
    boss.position.x += 0.4; player.update(1 / 60);
    assert.ok(player.dodgeDirection.distanceTo(dodge) < 1e-6);
    assertAim(player, boss);
  }
  assert.equal(player.isDodging, true);
});

test('unlocking restores mouse aim and unavailable bosses or resets clear the lock', () => {
  const { player, boss, input } = fixture();
  player.toggleBossLock(); assert.equal(player.lockOnTarget, null);
  const before = player.yaw; input.mouseDeltaX = 30; player.update(1 / 60);
  assert.ok(player.yaw < before);
  player.toggleBossLock(); assert.equal(player.lockOnTarget, boss);
  player.setBossLockTarget(null); assert.equal(player.lockOnTarget, null);
  player.toggleBossLock(); assert.equal(player.lockOnTarget, null);
  player.setBossLockTarget(boss, 2.2); player.toggleBossLock(); player.reset();
  assert.equal(player.lockOnTarget, null); assert.equal(player.bossLockAvailable, null);
});

test('Level 3 offers only the current live combat boss', () => {
  const level = { dean: { group: new THREE.Group(), alive: true }, bossFight: { phase: 'waiting' } };
  const target = () => Level3.prototype.getLockOnTarget.call(level);
  assert.equal(target(), null);
  level.bossFight.phase = 'combat'; assert.equal(target().object, level.dean.group);
  level.deanDefeated = true; assert.equal(target(), null);
  level.monsterFight = { group: new THREE.Group(), phase: 'combat', alive: true };
  assert.equal(target().object, level.monsterFight.group);
  level.monsterFight.phase = 'dying'; assert.equal(target(), null);
});

test('lock switches automatically to the next living enemy and pins the animated head', () => {
  const { player, boss } = fixture();
  const next = new THREE.Group(), head = new THREE.Bone(); head.name = 'Head'; head.position.set(0, 1.7, 0); next.add(head);
  next.position.set(3, 0, -10); player.scene.add(next);
  const first = { group: boss, alive: true }, second = { group: next, alive: true };
  const hidden = { group: new THREE.Group(), alive: true }; hidden.group.visible = false;
  const level = { zombies: [first, second, hidden], dean: { group: new THREE.Group(), alive: true } };
  const game = { player, currentLevel: level };
  assert.equal(getEnemyLockTargets(level).length, 2, 'guides and hidden enemies are excluded');
  Game.prototype._syncEnemyLock.call(game); assert.equal(player.lockOnTarget, boss);
  first.alive = false; Game.prototype._syncEnemyLock.call(game);
  assert.equal(player.lockOnTarget, next, 'death transfers the lock without another button press');
  const pin = getEnemyPinPosition(game.enemyLockDescriptor, new THREE.Vector3());
  assert.ok(pin.distanceTo(new THREE.Vector3(3, 2.1, -10)) < 1e-6);
  head.position.y += 0.5;
  assert.ok(getEnemyPinPosition(game.enemyLockDescriptor, pin).y > 2.5, 'pin follows animation');
  second.alive = false; Game.prototype._syncEnemyLock.call(game);
  assert.equal(player.lockOnTarget, null, 'last enemy death clears the pin and lock');
});
