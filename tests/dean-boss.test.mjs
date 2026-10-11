import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { DeanBoss } from '../src/enemies/DeanBoss.js';
import { Level3 } from '../src/levels/Level3.js';
import { Player } from '../src/player/Player.js';

function bossFixture() {
  const root = new THREE.Group();
  const dean = { group: new THREE.Group(), alive: true, actions: {}, _playAction() {},
    takeDamage(amount) { this.health = Math.max(0, this.health - amount); if (!this.health) this.alive = false; return !this.alive; } };
  dean.group.position.set(0, 1.2, -37);
  root.add(dean.group);
  const boss = new DeanBoss(root, dean);
  const player = { group: new THREE.Group(), ammo: 3, maxAmmo: 120, isDodging: false, health: 100,
    takeDamage(amount) { this.health -= amount; } };
  player.group.position.set(0, 0, 0);
  return { root, dean, boss, player, cleanup: () => boss.dispose() };
}

test('the Dean waits for every hut and zombie, then for the player at the center', () => {
  const level = new Level3(new THREE.Scene());
  const player = { group: new THREE.Group() };
  const house = { alive: true, update() {} }, zombie = { alive: true };
  level.houses = [house]; level.zombies = [zombie];
  const calls = [];
  level.bossFight = { phase: 'waiting', centerMarker: { visible: false },
    start() { calls.push('start'); this.phase = 'approach'; }, update() {} };
  try {
    level.update(0.05, player);
    assert.deepEqual(calls, []);
    house.alive = false; zombie.alive = false;
    player.group.position.z = 8;
    level.update(0.05, player);
    assert.equal(level.bossFight.centerMarker.visible, true);
    assert.deepEqual(calls, []);
    player.group.position.z = 0;
    level.update(0.05, player);
    assert.deepEqual(calls, ['start']);
  } finally { level.bossFight = null; level.houses = []; level.zombies = []; level.dispose(); }
});

test('the Dean runs off the platform, locks on, and can only be wounded during combat', () => {
  const f = bossFixture();
  try {
    assert.equal(f.boss.takeDamage(100), false);
    assert.equal(f.dean.health, 300);
    f.boss.start(f.player);
    assert.equal(f.player.ammo, 45);
    for (let frame = 0; frame < 80 && f.boss.phase !== 'combat'; frame++) f.boss.update(0.05, f.player);
    assert.equal(f.boss.phase, 'combat');
    assert.ok(f.dean.group.position.distanceTo(new THREE.Vector3(0, 0, -4)) < 0.1);
    assert.equal(f.boss.takeDamage(15), false);
    assert.equal(f.dean.health, 285);
    assert.equal(f.boss.takeDamage(285), true);
    assert.equal(f.boss.phase, 'defeated');
    assert.equal(f.boss.takeDamage(15), false);
  } finally { f.cleanup(); }
});

test('the approach cuts to the Dean, freezes control, then restores the selected camera before combat', () => {
  const scene = new THREE.Scene(), level = new Level3(scene), f = bossFixture();
  const input = { isDown: () => false, consumeKeyPress: () => false, flushMouseDelta() {} };
  const player = new Player(scene, input, new THREE.PerspectiveCamera(60, 1.5, 0.1, 500));
  player.toggleCamera();
  level.dean = f.dean; level.bossFight = f.boss;
  try {
    assert.equal(player.bodyMesh.visible, false);
    level.update(0.05, player);
    assert.equal(player.scriptedMovement, true);
    assert.equal(player.bodyMesh.visible, true);
    assert.ok(level.bossCutscene);
    for (let frame = 0; frame < 100 && level.bossCutscene; frame++) level.update(0.05, player);
    assert.equal(f.boss.phase, 'combat');
    assert.equal(level.bossCutscene, null);
    assert.equal(player.scriptedMovement, false);
    assert.equal(player.isFirstPerson, true);
    assert.equal(player.bodyMesh.visible, false);
    assert.ok(player.camera.position.distanceTo(player.group.position.clone().add(player.firstPersonOffset)) < 0.001);
  } finally {
    level.bossFight = null; level.dean = null; level.dispose(); f.cleanup(); player.dispose();
  }
});

test('at 40% health the Dean advances faster, chains attacks, and hits harder', () => {
  const f = bossFixture();
  try {
    f.boss.phase = 'combat';
    f.boss.takeDamage(179);
    assert.equal(f.boss.enraged, false);
    f.boss.takeDamage(1);
    assert.equal(f.dean.health, 120);
    assert.equal(f.boss.enraged, true);
    assert.ok(f.boss.enrageLight.intensity > 0);
    f.dean.group.position.set(0, 0, -10);
    f.boss.cooldown = 10;
    f.boss.update(0.1, f.player);
    assert.ok(f.dean.group.position.z > -9.4);
    f.dean.group.position.set(0, 0, -2);
    f.boss._beginMove(f.player);
    f.boss._updateMove(0.85, f.player);
    assert.equal(f.boss.move, null, 'The first attack finishes faster than its normal 1.05 seconds');
    assert.equal(f.boss.cooldown, 0.12);
    assert.ok(f.player.health < 90, 'Enraged strikes deal increased damage');
  } finally { f.cleanup(); }
});

test('a killing shot on the Dean completes Chapter 3 exactly once', () => {
  const level = new Level3(new THREE.Scene());
  const boss = new THREE.Group(), mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
  boss.add(mesh); level.bossMarker = boss;
  let health = 15, score = 0, defeated = false;
  level.bossFight = { phase: 'combat', takeDamage(amount) {
    if (defeated) return false;
    health = Math.max(0, health - amount); defeated = health === 0; return defeated;
  } };
  const player = { addScore(amount) { score += amount; } };
  try {
    assert.equal(level.handleBulletHit({ object: mesh }, 15, player), true);
    assert.equal(level.levelComplete, true);
    level.handleBulletHit({ object: mesh }, 15, player);
    assert.equal(score, 1000);
  } finally {
    level.bossFight = null; level.dispose(); mesh.geometry.dispose(); mesh.material.dispose();
  }
});

test('the Dean chooses close combos nearby and cycles ranged attacks when the player stays away', () => {
  const f = bossFixture();
  try {
    f.boss.phase = 'combat';
    const names = [];
    for (let index = 0; index < 3; index++) {
      f.dean.group.position.set(0, 0, -2);
      f.boss._beginMove(f.player);
      names.push(f.boss.move.name);
      assert.equal(f.boss.floorWarning.visible, true);
      f.boss._updateMove(10, f.player);
      assert.equal(f.boss.move, null);
    }
    const model = new THREE.Group();
    f.dean.group.add(model);
    f.boss.model = model;
    f.boss.modelRestY = 0;
    f.boss.modelRestPitch = 0;
    for (let index = 0; index < 4; index++) {
      f.dean.group.position.set(0, 0, -12);
      f.boss._beginMove(f.player);
      const name = f.boss.move.name;
      names.push(name);
      assert.equal(f.boss.floorWarning.visible, true);
      if (name === 'Fist slide') {
        assert.equal(f.boss.aimStrip.visible, true);
        f.player.isDodging = true;
        const health = f.player.health;
        f.boss._updateMove(0.55, f.player);
        f.boss._updateMove(0.4, f.player);
        assert.equal(f.player.health, health, 'Rolling through the slide avoids its fist');
        assert.equal(f.boss.slideStopped, false);
        assert.ok(f.boss.slideMarks.length > 0);
        assert.ok(model.rotation.x < -0.3, 'The Dean leans into the fist-first slide');
        f.player.isDodging = false;
        f.boss._updateMove(0.08, f.player);
        assert.ok(f.player.health < health, 'The sliding fist hits along its path');
        assert.equal(f.boss.slideStopped, true);
      }
      if (name === 'Shadow leap') {
        const previousCracks = f.boss.cracks.length;
        assert.equal(f.boss.shadow.visible, true);
        assert.deepEqual([f.boss.shadow.position.x, f.boss.shadow.position.z], [0, 0]);
        f.player.isDodging = true;
        const health = f.player.health;
        f.boss._updateMove(1.57, f.player);
        assert.equal(f.player.health, health, 'A roll avoids the landing impact');
        assert.equal(f.boss.shadow.visible, false);
        assert.ok(model.rotation.x > 0.9, 'The Dean lands sitting back on his butt');
        assert.equal(f.boss.cracks.length, previousCracks + 1, 'The landing fractures the ground');
        f.player.isDodging = false;
      }
      if (name === 'Ground smash') {
        f.dean.group.position.set(0, 0, -3);
        const previousCracks = f.boss.cracks.length;
        f.boss._updateMove(0.8, f.player);
        assert.equal(f.boss.rocks.length, 3);
        assert.equal(f.boss.cracks.length, previousCracks + 1, 'The ground visibly fractures under the smash');
        const firstZ = f.boss.rocks[1].mesh.position.z;
        f.boss._updateRocks(0.1, f.player);
        assert.ok(f.boss.rocks[1].mesh.position.z > firstZ);
        const health = f.player.health;
        f.boss._updateRocks(0.1, f.player);
        assert.ok(f.player.health < health, 'Incoming stone hits an undodged player');
      }
      f.boss._updateMove(10, f.player);
      assert.equal(f.boss.move, null);
      assert.equal(model.rotation.x, 0);
    }
    assert.deepEqual(names, ['Double jab', 'Sweeping hook', 'Charging uppercut',
      'Fist slide', 'Ground smash', 'Rush punches', 'Shadow leap']);
  } finally { f.cleanup(); }
});

test('while the player stays far away the Dean begins a ranged move before closing to melee', () => {
  const f = bossFixture();
  try {
    f.boss.phase = 'combat';
    f.dean.group.position.set(0, 0, -18);
    f.boss.cooldown = 0.05;
    f.boss.update(0.05, f.player);
    assert.equal(f.boss.move.name, 'Fist slide');
    assert.ok(flatDistanceForTest(f.dean.group.position, f.player.group.position) > 10);
  } finally { f.cleanup(); }
});

function flatDistanceForTest(a, b) { return Math.hypot(a.x - b.x, a.z - b.z); }
