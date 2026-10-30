import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Player } from '../src/player/Player.js';
import { WeaponCombat } from '../src/player/WeaponCombat.js';

function fixture() {
  const scene = new THREE.Scene();
  const player = new Player(scene, { flushMouseDelta() {} }, new THREE.PerspectiveCamera());
  player.getMuzzleWorldPosition = () => new THREE.Vector3();
  player.weaponPresentation = null;
  const combat = new WeaponCombat(scene);
  return { player, combat };
}

test('firing an empty SMG leaves pistol ammunition intact and switching never refills either pool', () => {
  const { player, combat } = fixture();
  try {
    player.ammo = 1;
    assert.equal(combat.fire(player, []), true);
    assert.equal(player.ammo, 0);
    assert.equal(player.getAmmo('pistol'), 30);
    assert.equal(player.equipWeapon('pistol'), true);
    combat.shootCooldown = 0;
    assert.equal(combat.fire(player, []), true);
    assert.equal(player.ammo, 29);
    player.equipWeapon('dual');
    combat.shootCooldown = 0;
    assert.equal(combat.fire(player, []), true);
    assert.equal(player.ammo, 27, 'dual pistols consume two pistol rounds');
    player.equipWeapon('smg');
    assert.equal(player.ammo, 0);
    combat.shootCooldown = 0;
    assert.equal(combat.fire(player, []), false);
    assert.equal(player.getAmmo('dual'), 27);
  } finally { combat.dispose(); }
});

test('pickups refill the equipped gun only; retry resets both reserves', () => {
  const { player, combat } = fixture();
  try {
    player.ammo = 0;
    player.equipWeapon('pistol'); player.ammo = 2;
    combat.dropAmmo(player.group.position);
    combat.updatePickups(.1, player);
    assert.equal(player.ammo, 14);
    assert.equal(player.getAmmo('smg'), 0);
    player.equipWeapon('smg');
    combat.dropAmmo(player.group.position);
    combat.updatePickups(.1, player);
    assert.equal(player.ammo, 12);
    assert.equal(player.getAmmo('pistol'), 14);
    player.ensureAmmo(45);
    assert.equal(player.getAmmo('smg'), 45);
    assert.equal(player.getAmmo('pistol'), 45);
    player.reset(new THREE.Vector3());
    assert.equal(player.getAmmo('smg'), 30);
    assert.equal(player.getAmmo('pistol'), 30);
  } finally { combat.dispose(); }
});
