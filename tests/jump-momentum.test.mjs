import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Player } from '../src/player/Player.js';

function playerWithInput() {
  const keys = new Set();
  const input = { isDown: key => keys.has(key), flushMouseDelta() {}, pointerLocked: true,
    mouseDeltaX: 0, mouseDeltaY: 0 };
  const player = new Player(new THREE.Scene(), input, new THREE.PerspectiveCamera());
  return { player, keys };
}

function jumpDistance(sprint, release = false, dt = 1 / 120) {
  const { player, keys } = playerWithInput();
  keys.add('KeyW'); if (sprint) keys.add('ShiftLeft');
  player.update(dt);
  const start = player.group.position.clone();
  keys.add('Space'); player.update(dt);
  if (release) keys.clear();
  for (let i = 0; !player.grounded && i < 300; i++) player.update(dt);
  assert.equal(player.grounded, true);
  return start.distanceTo(player.group.position);
}

test('a running jump gains distance and a sprint jump travels farther again', () => {
  const walk = jumpDistance(false), sprint = jumpDistance(true);
  assert.ok(walk > 8 * 0.7, 'a run-up provides extra forward reach');
  assert.ok(sprint > walk * 1.7, 'sprint momentum produces a stronger leap');
});

test('releasing forward and sprint in midair preserves the launch momentum', () => {
  const held = jumpDistance(true), released = jumpDistance(true, true);
  assert.ok(Math.abs(held - released) < 0.01);
});

test('turning in the air steers gradually and cannot add another sprint boost', () => {
  const { player, keys } = playerWithInput();
  keys.add('KeyW'); keys.add('ShiftLeft'); player.update(1 / 60);
  keys.add('Space'); player.update(1 / 60);
  const launchSpeed = Math.hypot(player.velocity.x, player.velocity.z);
  const before = player.velocity.clone();
  player.yaw = Math.PI / 2; player.update(1 / 60);
  assert.ok(Math.hypot(player.velocity.x - before.x, player.velocity.z - before.z) <= player.airAcceleration / 60 + 1e-6);
  assert.ok(player.velocity.z < -10, 'looking sideways does not instantly rotate momentum');
  for (let i = 0; i < 15; i++) player.update(1 / 60);
  assert.ok(Math.hypot(player.velocity.x, player.velocity.z) <= launchSpeed + 1e-6);
});

test('standing jumps remain vertical and platform landing resets airborne momentum', () => {
  const { player, keys } = playerWithInput();
  const platforming = { canMove: true, allowSprint: true, allowDodge: true, moveSpeed: 4.5, jumpVelocity: 7.2,
    surfaces: [{ minX: -20, maxX: 20, minZ: -20, maxZ: 20, y: 0 }] };
  keys.add('Space'); player.update(1 / 60, [], null, platforming);
  for (let i = 0; !player.grounded && i < 120; i++) player.update(1 / 60, [], null, platforming);
  assert.equal(player.group.position.x, 0); assert.equal(player.group.position.z, 0);
  assert.equal(player.grounded, true); assert.equal(player.airSpeedLimit, 0);
  player.reset(); assert.equal(player.airSpeedLimit, 0);
});

test('jump distance stays consistent at 30 and 120 frames per second', () => {
  assert.ok(Math.abs(jumpDistance(true, false, 1 / 30) - jumpDistance(true, false, 1 / 120)) < 0.6);
});
