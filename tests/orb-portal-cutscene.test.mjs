import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { OrbPortalCutscene } from '../src/levels/OrbPortalCutscene.js';

test('first-orb portal cutscene frames both emerging zombies, then restores play', () => {
  const camera = new THREE.PerspectiveCamera();
  camera.position.set(0, 2, 5);
  camera.lookAt(0, 1, 0);
  camera.updateMatrixWorld(true);
  const player = {
    camera, velocity: new THREE.Vector3(1, 0, 0), verticalVelocity: 2, isDodging: true,
    scriptedMovement: false, input: { flushMouseDelta() {} },
  };
  let portalUpdates = 0;
  const zombies = [
    { portalExit: {}, alive: true, group: { visible: true, position: new THREE.Vector3(-1, 0, 42) } },
    { portalExit: {}, alive: true, group: { visible: true, position: new THREE.Vector3(1, 0, 43) } },
  ];
  const level = {
    redPortalCenter: new THREE.Vector3(0, 2.5, 45), zombies,
    allowsShooting: true,
    _updatePortalExit(zombie) { assert.ok(zombie.portalExit); portalUpdates++; },
  };

  const cutscene = new OrbPortalCutscene(level, player);
  assert.equal(player.scriptedMovement, true);
  assert.equal(level.allowsShooting, false);
  const startX = camera.position.x;
  cutscene.update(0.25);
  assert.notEqual(camera.position.x, startX);
  for (let i = 0; i < 30; i++) cutscene.update(1 / 60);
  const beforeDescent = camera.position.z;
  zombies[0].group.position.z -= 2;
  zombies[1].group.position.z -= 2;
  cutscene.update(1 / 60);
  assert.ok(camera.position.z < beforeDescent, 'camera should follow the zombies down the stairs');
  cutscene.update(3.3);
  assert.ok(portalUpdates >= 4);
  assert.equal(player.scriptedMovement, false);
  assert.equal(level.allowsShooting, true);
  assert.equal(level.orbPortalCutscene, null);
  assert.deepEqual(camera.position.toArray(), [0, 2, 5]);
});
