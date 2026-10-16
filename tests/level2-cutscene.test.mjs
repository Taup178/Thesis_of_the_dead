import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { DungeonTorches } from '../src/environment/DungeonTorches.js';
import { PortalEmergence } from '../src/props/RoomExitPortal.js';
import { Level2 } from '../src/levels/Level2.js';

test('torch lighting keeps a stable wall pair without cube shadow renders', () => {
  const torches = new DungeonTorches(new THREE.Group(), -100, 160);
  const camera = new THREE.Vector3(0, 2, 143);
  torches.update(0.016, camera);
  const pair = torches.lights.map(light => light.position.clone());
  for (let frame = 0; frame < 60; frame++) {
    camera.z = 143 + Math.sin(frame) * 0.05;
    torches.update(1 / 60, camera);
    assert.equal(torches.lights.length, 2);
    assert.ok(torches.lights.every(light => !light.castShadow));
    torches.lights.forEach((light, index) => assert.ok(light.position.equals(pair[index])));
  }
  camera.z = -90; torches.update(1 / 60, camera);
  assert.equal(torches.lights[0].position.z, torches.lights[1].position.z);
  assert.ok(Math.abs(torches.lights[0].position.z - camera.z) < torches.layout.spacing);
  const material = new THREE.MeshStandardMaterial(), originalHook = material.onBeforeCompile;
  const originalKey = material.customProgramCacheKey;
  torches.decorateMaterial(material); assert.notEqual(material.onBeforeCompile, originalHook);
  torches.dispose(); assert.equal(material.onBeforeCompile, originalHook);
  assert.equal(material.customProgramCacheKey, originalKey, 'leaving the room must release the player lighting hooks');
});

test('a warmed portal entrance replays and restores without repeated shader invalidation', () => {
  const actor = new THREE.Group(), material = new THREE.MeshStandardMaterial();
  actor.add(new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.8, 0.4), material));
  const destination = new THREE.Vector3(0, 0, 10); actor.position.copy(destination);
  const entrance = new PortalEmergence(actor, new THREE.Vector3(0, 2.2, 15));
  entrance.restore(); actor.position.copy(destination);
  entrance.restart(); const version = material.version;
  entrance.update(entrance.duration * 0.25); assert.equal(material.version, version);
  entrance.update(entrance.duration); assert.ok(actor.position.equals(destination));
  const restored = material.version;
  entrance.update(0.1); entrance.restore(); entrance.restore();
  assert.equal(material.version, restored, 'completed entrances must not invalidate shaders every frame');
  assert.equal(material.transparent, false);
});

test('Level 2 prepares the player portal before the cutscene and reuses it on emergence', async () => {
  const scene = new THREE.Scene(), level = new Level2(scene), camera = new THREE.PerspectiveCamera();
  level.torches = new DungeonTorches(level.root, -100, 160);
  level.entrancePortal = { center: new THREE.Vector3(0, 2.2, 160) };
  const group = new THREE.Group(), bodyMesh = new THREE.Group(); group.add(bodyMesh); scene.add(group);
  const material = new THREE.MeshStandardMaterial(); bodyMesh.add(new THREE.Mesh(new THREE.BoxGeometry(0.6, 1.8, 0.5), material));
  group.position.set(2, 0, 3); const original = group.position.clone();
  const player = { group, bodyMesh, mixer: { update() {} } };
  let warmed = false;
  const renderer = { compileAsync: async () => {}, render() { warmed = material.transparent && material.opacity < 1; } };
  await level.prepareShaders(renderer, camera, player);
  assert.ok(warmed); assert.ok(group.position.equals(original)); assert.equal(material.transparent, false);
  const entrance = level.preparedPlayerArrival;
  assert.ok(entrance);
  level.dean = { _playAction() {} }; level.bossMarker = new THREE.Group();
  level.phase = 'dean_to_start'; level.introTimer = 10;
  level._updateArrival(0.016, player);
  assert.equal(level.phase, 'player_arrival');
  assert.equal(level.playerArrival, entrance, 'the live cutscene must reuse the prepared entrance');
  assert.equal(level.preparedPlayerArrival, null);
});
