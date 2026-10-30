import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { MudHouse } from '../src/props/MudHouse.js';

test('houses show full health before aiming, lose fill on hits and hide it on destruction', () => {
  const geometry = new THREE.BoxGeometry(4, 4, 4), material = new THREE.MeshStandardMaterial();
  const house = new MudHouse(new THREE.Group(), [{ geometry, center: new THREE.Vector3(0, 2, 0) }],
    material, new THREE.Vector3(12, 0, -20), 0, {});
  house.emitEmergenceDust(house.doors[0]);
  const dust = house.bursts[0];
  assert.equal(dust.points.material.color.getHex(), 0xd52920);
  assert.ok(dust.velocities.every(v => v.dot(house.doors[0].direction) > 1.9), 'dust pumps out of the doorway');
  house.update(2);
  assert.equal(house.bursts.length, 0, 'spawn dust fades and frees its particles');
  // Particle bursts are unrelated to the health display.
  house._burst = house._chips = () => {};
  try {
    assert.equal(house.healthBar.visible, true);
    assert.equal(house.healthBar.fraction, 1);
    assert.ok(house.healthBar.position.y > 4, 'gauge sits above the roof');
    assert.equal(house.healthBar.material.depthTest, true, 'walls can occlude the gauge');
    const original = house.healthBar.material.map.image.data.slice();
    house.takeDamage(25);
    assert.equal(house.healthBar.fraction, .75);
    assert.notDeepEqual(house.healthBar.material.map.image.data, original);
    house.takeDamage(75);
    assert.equal(house.healthBar.visible, false);
  } finally { house.dispose(); geometry.dispose(); material.dispose(); }
  assert.equal(house.healthBar.parent, null);
});
