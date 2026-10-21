import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Player } from '../src/player/Player.js';

function fixture() {
  const keys = new Set();
  const input = { isDown: key => keys.has(key), flushMouseDelta() {}, mouseDeltaX: 0, mouseDeltaY: 0 };
  const player = new Player(new THREE.Scene(), input, new THREE.PerspectiveCamera());
  const advance = frames => { for (let i = 0; i < frames; i++) player.update(1 / 60); };
  return { player, keys, advance };
}

test('an early second dodge press chains quickly and uses the new direction', () => {
  const { player, keys, advance } = fixture();
  keys.add('KeyQ'); advance(1); keys.delete('KeyQ'); advance(20);
  keys.add('KeyD'); keys.add('KeyQ'); advance(1); keys.delete('KeyQ');
  let recoveryFrames = 0;
  while (player.dodgeDirection.x < 0.9 && recoveryFrames < 20) { advance(1); recoveryFrames++; }
  assert.ok(player.isDodging, 'buffered press starts the next roll');
  assert.ok(recoveryFrames < 13, 'no long cooldown between follow-up dodges');
  assert.ok(player.dodgeDirection.x > 0.9, 'follow-up roll uses the current movement direction');
  advance(45); assert.equal(player.isDodging, false, 'one press queues only one dodge');
});

test('holding Q does not auto-roll and reset clears pending input', () => {
  const { player, keys, advance } = fixture();
  keys.add('KeyQ'); advance(60); assert.equal(player.isDodging, false);
  keys.delete('KeyQ'); advance(1); keys.add('KeyQ'); advance(1);
  assert.equal(player.isDodging, true);
  player.dodgeBufferTimer = 0.2; player.reset();
  assert.equal(player.dodgeBufferTimer, 0);
});
