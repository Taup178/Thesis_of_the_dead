import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Player } from '../src/player/Player.js';
import { WeaponCombat } from '../src/player/WeaponCombat.js';

function setup() {
  const scene = new THREE.Scene(), presses = new Set();
  const input = { pointerLocked: true, mouseDeltaX: 0, mouseDeltaY: 0, shooting: false, secondary: false,
    isDown: () => false, flushMouseDelta() {}, consumeKeyPress: key => presses.delete(key),
    isMouseButtonDown(button = 0) { return button === 2 ? this.secondary : this.shooting; } };
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 200), player = new Player(scene, input, camera);
  player.toggleCamera(); player.getMuzzleWorldPosition = () => new THREE.Vector3(0, 1.1, -0.5);
  const combat = new WeaponCombat(scene), level = { zombies: [], allowsShooting: true }, cover = [];
  const zombie = (x, z) => {
    const group = new THREE.Group(), mesh = new THREE.Mesh(new THREE.BoxGeometry(0.8, 2, 0.8), new THREE.MeshBasicMaterial());
    mesh.position.y = 1; group.add(mesh); group.position.set(x, 0, z); scene.add(group);
    const enemy = { group, health: 30, alive: true, takeDamage(damage) {
      if (!this.alive) return false; this.health = Math.max(0, this.health - damage); this.alive = this.health > 0; return !this.alive;
    } };
    level.zombies.push(enemy); return enemy;
  };
  const targets = () => { scene.updateMatrixWorld(true); return [...level.zombies.filter(z => z.alive).map(z => z.group.children[0]), ...cover]; };
  const step = (dt = 1 / 60) => { player.update(dt); combat.update(dt, player, level, input, targets); };
  const cleanup = () => { player.dispose(); combat.dispose(); for (const object of [...level.zombies.map(z => z.group.children[0]), ...cover]) { object.geometry.dispose(); object.material.dispose(); } };
  return { scene, player, combat, level, input, presses, cover, zombie, targets, step, cleanup };
}

test('shots spend ammo and travel visibly before a single impact, including large frame steps', () => {
  const f = setup();
  try {
    const enemy = f.zombie(0, -10); f.player.ammo = 1; f.input.shooting = true; f.step(0);
    assert.equal(f.player.ammo, 0); assert.equal(f.combat.projectiles.length, 1); assert.equal(enemy.health, 30);
    f.input.shooting = false; f.step(0.04);
    assert.ok(f.combat.projectiles[0].mesh.position.z < -2); assert.equal(enemy.health, 30);
    f.step(0.2); assert.equal(enemy.health, 15); assert.equal(f.combat.projectiles.length, 0);
    f.step(0.2); assert.equal(enemy.health, 15);
  } finally { f.cleanup(); }
});

test('bullets and gun strikes cannot hit through cover, including a muzzle beyond the wall', () => {
  const f = setup();
  try {
    const enemy = f.zombie(0, -1.8), wall = new THREE.Mesh(new THREE.BoxGeometry(2, 3, 0.1), new THREE.MeshBasicMaterial());
    wall.position.set(0, 1, -0.7); f.scene.add(wall); f.cover.push(wall);
    f.player.getMuzzleWorldPosition = () => new THREE.Vector3(0, 1.1, -1);
    f.input.shooting = true; f.step(0.05); f.input.shooting = false;
    assert.equal(enemy.health, 30); assert.equal(f.combat.projectiles.length, 0);
    f.presses.add('KeyF'); f.step(); f.step(0.3); assert.equal(enemy.health, 30);
  } finally { f.cleanup(); }
});

test('F bashes at the animation contact time without spending ammo or hitting distant/backward enemies', () => {
  const f = setup();
  try {
    const close = f.zombie(0, -1.6), behind = f.zombie(0, 1), far = f.zombie(0, -5);
    f.presses.add('KeyF'); f.step(); assert.equal(f.player.bashTime, 0.6); assert.equal(close.health, 30);
    f.step(0.1); assert.equal(close.health, 30);
    f.step(0.13); assert.equal(close.alive, false); assert.equal(behind.health, 30); assert.equal(far.health, 30);
    assert.equal(f.player.ammo, 30); assert.equal(f.player.score, 200);
    f.step(0.1); assert.equal(f.player.score, 200);
  } finally { f.cleanup(); }
});

test('empty clicks bash with a cooldown and never produce a bullet or negative ammo', () => {
  const f = setup();
  try {
    f.player.ammo = 0; f.input.shooting = true; f.zombie(0, -1.7);
    for (let i = 0; i < 25; i++) f.step();
    assert.equal(f.combat.kills, 1); assert.equal(f.player.ammo, 0); assert.equal(f.combat.projectiles.length, 0);
    assert.ok(f.combat.bashCooldown > 0);
  } finally { f.cleanup(); }
});

test('only some zombies drop ammo, collection is bounded, and retries clear remaining pickups', () => {
  const f = setup();
  try {
    const a = f.zombie(3, -4), b = f.zombie(3, -4);
    f.combat.damageZombie(a, 30, f.player); assert.equal(f.combat.pickups.length, 0);
    f.combat.damageZombie(b, 30, f.player); assert.equal(f.combat.pickups.length, 1);
    f.combat.damageZombie(b, 30, f.player); assert.equal(f.player.score, 400);
    f.combat.updatePickups(0.1, f.player); assert.equal(f.player.ammo, 30);
    f.player.group.position.copy(b.group.position); f.player.ammo = 118;
    f.combat.updatePickups(0.1, f.player); assert.equal(f.player.ammo, 120); assert.equal(f.combat.pickups[0].amount, 10);
    f.player.ammo = 100; f.combat.updatePickups(0.1, f.player);
    assert.equal(f.player.ammo, 110); assert.equal(f.combat.pickups.length, 0);
    f.combat.dropAmmo(new THREE.Vector3()); f.combat.reset(); f.player.reset(new THREE.Vector3());
    assert.equal(f.combat.pickups.length, 0); assert.equal(f.player.ammo, 30);
  } finally { f.cleanup(); }
});

test('the memory room and portal travel prevent shooting and melee', () => {
  const f = setup();
  try {
    f.input.shooting = true; f.presses.add('KeyF'); f.level.allowsShooting = false; f.step();
    assert.equal(f.player.ammo, 30); assert.equal(f.player.bashTime, 0);
    f.level.allowsShooting = true; f.player.scriptedMovement = true; f.step();
    assert.equal(f.combat.projectiles.length, 0); assert.equal(f.player.bashTime, 0);
  } finally { f.cleanup(); }
});

test('rolling blocks new shots and cancels a pending gun bash', () => {
  const f = setup();
  try {
    f.input.shooting = true;
    f.player.isDodging = true;
    f.combat.pendingBash = 0.1;
    f.combat.update(0.2, f.player, f.level, f.input, f.targets);
    assert.equal(f.combat.pendingBash, null);
    assert.equal(f.player.ammo, 30);
    assert.equal(f.combat.projectiles.length, 0);
    assert.equal(f.combat.fire(f.player, f.targets()), false);
  } finally { f.cleanup(); }
});

test('single and dual pistols spend one and two rounds and launch separate projectiles', () => {
  const f = setup();
  try {
    f.player.equipWeapon('pistol');
    f.input.shooting = true; f.step(0);
    assert.equal(f.player.ammo, 29);
    assert.equal(f.combat.projectiles.length, 1);
    assert.equal(f.combat.projectiles[0].damage, 22);
    f.player.equipWeapon('dual');
    f.combat.shootCooldown = 0;
    f.step(0);
    assert.equal(f.player.ammo, 27);
    assert.equal(f.combat.projectiles.length, 3);
    assert.equal(f.combat.projectiles[1].damage, 14);
    assert.equal(f.combat.projectiles[2].damage, 14);
    f.input.shooting = false; f.input.secondary = true;
    f.combat.shootCooldown = 0;
    f.step(0);
    assert.equal(f.player.ammo, 26, 'Right click fires only one of the dual pistols');
    assert.equal(f.combat.projectiles.length, 4);
  } finally { f.cleanup(); }
});

test('sword reaches farther than dagger and both strike without ammunition', () => {
  const f = setup();
  try {
    const enemy = f.zombie(0, -2.4); enemy.health = 100;
    f.player.equipWeapon('dagger');
    f.input.shooting = true; f.step(0.01); f.step(0.17);
    assert.equal(enemy.health, 100, 'The dagger cannot reach the distant target');
    f.input.shooting = false; f.step(0.5);
    f.player.equipWeapon('sword');
    f.input.shooting = true; f.step(0.01); f.step(0.29);
    assert.equal(enemy.health, 55, 'The sword lands its longer slash');
    assert.equal(f.player.ammo, 30);
    assert.equal(f.combat.projectiles.length, 0);
  } finally { f.cleanup(); }
});
