import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Level3 } from '../src/levels/Level3.js';
import { WeaponCombat } from '../src/player/WeaponCombat.js';

test('each boss releases supplies once at every crossed health milestone', () => {
  const level = new Level3(new THREE.Scene());
  const player = { group: new THREE.Group() };
  player.group.position.z = 10;
  for (const maxHealth of [300, 600]) {
    const boss = { group: new THREE.Group(), maxHealth, health: maxHealth };
    let before = boss.health;
    boss.health = maxHealth * .8;
    level._queueBossAmmo(boss, before, player);
    const count = level.bossAmmoDrops.length;
    assert.equal(count, maxHealth === 300 ? 1 : 5);
    level._queueBossAmmo(boss, before, player);
    assert.equal(level.bossAmmoDrops.length, count, 'repeat notifications cannot duplicate supplies');
    before = boss.health; boss.health = maxHealth * .19;
    level._queueBossAmmo(boss, before, player);
    assert.equal(level.bossAmmoDrops.length, count + 3, 'a big hit awards every crossed threshold');
    level._queueBossAmmo(boss, boss.health, player);
    assert.equal(level.bossAmmoDrops.length, count + 3, 'no damage gives no drops');
  }
  assert.equal(level.hasUnlimitedAmmo('smg'), false);
  assert.equal(level.hasUnlimitedAmmo('dual'), false);
  for (const drop of level.bossAmmoDrops) {
    assert.equal(drop.amount, 12);
    assert.ok(drop.position.clone().setY(0).length() > 3, 'supplies land outside the boss body');
  }
  level.dispose();
});

test('boss supplies fly out, land, and restore only finite carried ammo', () => {
  const combat = new WeaponCombat(new THREE.Scene());
  const player = { group: new THREE.Group(), alive: true, ammo: 115, maxAmmo: 120 };
  player.group.position.z = 3.5;
  try {
    combat.dropAmmo(player.group.position, { origin: new THREE.Vector3(0, 2, 0), amount: 12 });
    combat.updatePickups(.3, player);
    assert.equal(player.ammo, 115, 'airborne supplies must be collected after landing');
    assert.ok(combat.pickups[0].group.position.y > 1);
    combat.updatePickups(.4, player);
    assert.equal(player.ammo, 120);
    assert.equal(combat.pickups[0].amount, 7, 'unused bullets stay available');
    player.ammo = 110; combat.updatePickups(.1, player);
    assert.equal(player.ammo, 117);
    assert.equal(combat.pickups.length, 0);
  } finally { combat.dispose(); }
});
