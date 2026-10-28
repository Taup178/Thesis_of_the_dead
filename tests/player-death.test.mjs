import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { Player } from '../src/player/Player.js';
import { Zombie } from '../src/enemies/Zombie.js';
import { Game } from '../src/core/Game.js';
import { createSawSlice, getVisibleBodyBounds } from '../src/player/SawSlice.js';
import { getSophomoreSawContact, updateSophomoreGauntlet } from '../src/levels/SophomoreGauntlet.js';

function makePlayer() {
  return new Player(new THREE.Scene(), { flushMouseDelta() {} }, new THREE.PerspectiveCamera(60, 1, 0.1, 100));
}

async function loadRig(player) {
  // Use the shipped skin and animation data; textures do not affect these physics checks.
  const data = JSON.parse(await readFile(new URL('../public/assets/models/character/shaun.gltf', import.meta.url), 'utf8'));
  data.materials = data.materials.map(() => ({}));
  delete data.textures; delete data.images;
  globalThis.ProgressEvent ??= class { constructor(type, values) { Object.assign(this, values); } };
  const gltf = await new GLTFLoader().parseAsync(JSON.stringify(data), '');
  const rig = gltf.scene; player.bodyMesh.add(rig); rig.rotation.y = Math.PI;
  let bounds = new THREE.Box3().setFromObject(rig, true);
  const scale = 1.75 / bounds.getSize(new THREE.Vector3()).y;
  rig.scale.set(-scale, scale, scale);
  rig.updateMatrixWorld(true); bounds.setFromObject(rig, true); rig.position.y = -bounds.min.y;
  player.characterModel = rig; player.mixer = new THREE.AnimationMixer(rig); player.actions = {};
  for (const clip of gltf.animations) player.actions[clip.name] = player.mixer.clipAction(clip);
  player._playAnimation('Idle'); player.mixer.update(0.1);
}

test('a saw cuts a mirrored posed mesh into closed halves with conserved volume', () => {
  const body = new THREE.Group();
  const original = new THREE.MeshStandardMaterial();
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), original);
  mesh.scale.x = -1; body.add(mesh); body.position.set(4, 2, 6);
  const cap = new THREE.MeshStandardMaterial({ side: THREE.DoubleSide });
  const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -6);
  const halves = createSawSlice(body, plane, cap);
  let totalVolume = 0;
  for (const [side, half] of halves.entries()) {
    half.updateMatrixWorld(true);
    const surface = half.getObjectByName('SawCutSurface');
    assert.ok(surface.geometry.attributes.position.count >= 6, 'the cut is capped');
    let volume = 0;
    half.traverse(child => {
      if (!child.isMesh) return;
      const attribute = child.geometry.attributes.position;
      for (let i = 0; i < attribute.count; i += 3) {
        const points = [0, 1, 2].map(offset => new THREE.Vector3().fromBufferAttribute(attribute, i + offset));
        if (child !== surface) {
          for (const point of points) {
            point.applyMatrix4(child.matrixWorld);
            assert.ok(plane.distanceToPoint(point) * (side === 0 ? 1 : -1) >= -1e-5);
          }
        }
        // The cap lies on the pivot plane, so its signed volume contribution is zero.
        const [a, b, c] = [0, 1, 2].map(offset => new THREE.Vector3().fromBufferAttribute(attribute, i + offset));
        volume += a.dot(b.cross(c)) / 6;
      }
    });
    assert.ok(volume > 0, 'mirroring preserves outward winding'); totalVolume += volume;
  }
  assert.ok(Math.abs(totalVolume - 8) < 1e-5);
});

test('saw contact restores first touch from both sides and catches a sprint across the disk', () => {
  const blade = { z: 0, rotor: { position: { z: 0.14 } }, wheel: { position: new THREE.Vector3(0, 1.55, 0) } };
  const hit = getSophomoreSawContact(blade, new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, -1), 0);
  assert.ok(hit); assert.ok(Math.abs(hit.position.z - 0.66) < 1e-6);
  for (const z of [-0.65, 0.65]) {
    const position = new THREE.Vector3(1.5, 0, z);
    assert.ok(getSophomoreSawContact(blade, position, position, 0), 'the original edge contact kills immediately');
  }
  const clear = new THREE.Vector3(0, 0, 0.67);
  assert.equal(getSophomoreSawContact(blade, clear, clear, 0), null);
  assert.equal(getSophomoreSawContact(blade, new THREE.Vector3(3, 0, 0.5), new THREE.Vector3(3, 0, -0.5), 0), null);
  assert.equal(getSophomoreSawContact(blade, new THREE.Vector3(0, 4, 0.5), new THREE.Vector3(0, 4, -0.5), 0), null);
  blade.wheel.position.x = 2;
  assert.ok(getSophomoreSawContact(blade, new THREE.Vector3(0, 0, 0.14), new THREE.Vector3(0, 0, 0.14), -2));
});

test('saw kills keep roll immunity and cannot damage an already dead player', () => {
  const player = makePlayer();
  const wheel = new THREE.Group(), rotor = new THREE.Group(); wheel.position.y = 1.55; rotor.position.z = 0.14;
  const level = { phase: 'chase', puzzleIndex: 0, blades: [{ wheel, rotor, z: 0, phase: 0, hitCooldown: 0 }] };
  player.group.position.z = 0.14;
  player.isDodging = true; updateSophomoreGauntlet(level, 0.01, player);
  assert.equal(player.alive, true);
  player.isDodging = false; updateSophomoreGauntlet(level, 0.01, player);
  assert.equal(player.alive, false); assert.equal(player.deathSequence.type, 'saw');
  const death = player.deathSequence;
  player.takeDamage(100); assert.equal(player.deathSequence, death);
  player.dispose();
});

test('the shipped rig collapses, sliced pieces settle, and checkpoint reset releases death resources', async () => {
  const player = makePlayer(); await loadRig(player);
  player.isFirstPerson = true; player.bodyMesh.visible = false;
  player.health = 10;
  player.takeDamage(10, { type: 'blunt', source: new THREE.Vector3(-1, 0, 0) });
  assert.equal(player.alive, false); assert.equal(player.bodyMesh.visible, true);
  assert.equal(player.currentActionName, 'Death'); assert.equal(player.updateDeath(0.05), false);
  assert.ok(player.deathSequence.direction.x > 0.9);
  for (let i = 0; i < 65; i++) player.updateDeath(0.05);
  assert.equal(player.deathSequence.done, true);
  let bounds = getVisibleBodyBounds(player.bodyMesh);
  assert.ok(bounds.min.y >= -0.001, 'the body stays above the floor');
  const head = player.characterModel.getObjectByName('Head').getWorldPosition(new THREE.Vector3());
  const foot = player.characterModel.getObjectByName('FootL').getWorldPosition(new THREE.Vector3());
  assert.ok(Math.abs(head.y - foot.y) < 0.3, 'the spine and legs finish horizontal');
  assert.ok(player.group.position.x > 0, 'the final blow carries the body away from its source');
  player.reset(new THREE.Vector3(0, 0, 0));
  assert.equal(player.alive, true); assert.equal(player.bodyMesh.visible, false);
  assert.equal(player.deathSequence, null); assert.equal(player.currentActionName, 'Idle');

  player._playAnimation('Run'); player.mixer.update(0.3);
  player.group.updateMatrixWorld(true);
  const torso = player.characterModel.getObjectByName('Torso');
  const pose = torso.quaternion.clone();
  const cutZ = torso.getWorldPosition(new THREE.Vector3()).z;
  player.takeDamage(100, { type: 'saw', point: new THREE.Vector3(0, 1, cutZ), cutNormal: new THREE.Vector3(0, 0, 1) });
  assert.deepEqual(torso.quaternion.toArray(), pose.toArray(), 'slicing preserves the pose at impact');
  const death = player.deathSequence;
  assert.equal(death.pieces.length, 2);
  for (const piece of death.pieces) assert.ok(piece.mesh.getObjectByName('SawCutSurface'), 'actual skin has a filled cross section');
  for (let i = 0; i < 65; i++) player.updateDeath(0.05);
  for (const piece of death.pieces) {
    bounds.setFromObject(piece.mesh, true);
    assert.ok(bounds.min.y >= -0.001); assert.ok(bounds.max.y < 1.1, 'each slice falls flat');
    assert.equal(piece.grounded, true);
  }
  let disposed = 0, originalDisposed = 0;
  for (const geometry of death.geometries) geometry.addEventListener('dispose', () => disposed++);
  player.bodyMesh.traverse(mesh => { if (mesh.isMesh) mesh.geometry.addEventListener('dispose', () => originalDisposed++); });
  player.reset(new THREE.Vector3(3, 0, 2));
  assert.equal(disposed, death.geometries.size); assert.equal(originalDisposed, 0);
  assert.equal(player.scene.getObjectByName('PlayerDeathEffects'), undefined);
  assert.equal(player.bodyMesh.visible, false); assert.equal(player.health, 100);
  player.dispose();
});

test('pit deaths keep the shipped body, dropped weapon, blood and both camera modes at the spikes', async () => {
  const floorY = -11;
  for (const firstPerson of [false, true]) {
    const player = makePlayer(); await loadRig(player);
    try {
      player.isFirstPerson = firstPerson;
      player.bodyMesh.visible = !firstPerson;
      player.group.position.set(0, floorY, 95);
      player.cameraGroundY = -Infinity;
      player.platformSupport = null;
      player.pitch = -0.85;
      player._updateCamera();
      player.takeDamage(100, { type: 'pit', floorY });
      const death = player.deathSequence;
      assert.ok(death.droppedWeapons.length > 0, 'the real rig releases its weapon');
      for (let i = 0; i < 50; i++) {
        player.updateDeath(0.05);
        assert.ok(player.camera.position.y < -4, 'the camera never returns to the upper deck');
        for (const stain of death.stains) assert.ok(Math.abs(stain.mesh.position.y - floorY) < 0.02);
        for (const { mesh } of death.droppedWeapons) {
          assert.ok(new THREE.Box3().setFromObject(mesh, true).max.y < -8, 'the weapon stays below the deck');
        }
      }
      const body = getVisibleBodyBounds(player.bodyMesh);
      assert.ok(body.min.y >= floorY - 0.001 && body.max.y < floorY + 1.5,
        `the body settles at the spikes: ${body.min.y} to ${body.max.y}, firstPerson=${firstPerson}`);
      for (const { mesh } of death.droppedWeapons) {
        assert.ok(Math.abs(new THREE.Box3().setFromObject(mesh, true).min.y - floorY) < 0.04);
      }
      const screen = body.getCenter(new THREE.Vector3()).project(player.camera);
      assert.ok(Math.abs(screen.x) < 1 && Math.abs(screen.y) < 1 && Math.abs(screen.z) < 1,
        'the settled body is inside the death camera frame');
      assert.equal(death.done, true);
    } finally { player.dispose(); }
  }
});

test('a zombie punch deals damage at contact and misses if the player backs away', () => {
  const zombie = new Zombie(new THREE.Scene(), new THREE.Vector3());
  // Test combat timing without starting an asset fetch.
  zombie._loaded = true;
  const target = new THREE.Vector3(0, 0, 1);
  assert.equal(zombie.update(0.01, target).hit, false);
  assert.equal(zombie.update(0.2, target).hit, false);
  assert.equal(zombie.update(0.1, target).hit, true);
  assert.equal(zombie.update(0.05, target).hit, false);
  zombie.attackTimer = 0; zombie.damageCooldown = 0;
  assert.equal(zombie.update(0.01, target).hit, false);
  assert.equal(zombie.update(0.3, new THREE.Vector3(0, 0, 3)).hit, false);
  zombie.dispose();
});

test('Game waits for the death presentation before opening the retry screen', () => {
  let finished = false, overlays = 0, effectFrames = 0;
  const game = { player: { updateDeath: () => finished },
    currentLevel: { updateDeathEffects: () => effectFrames++ },
    _updateHUD() {}, gameOver: () => overlays++ };
  Game.prototype._updatePlayerDeath.call(game, 0.05);
  assert.equal(overlays, 0); assert.equal(effectFrames, 1);
  finished = true; Game.prototype._updatePlayerDeath.call(game, 0.05);
  assert.equal(overlays, 1);
});

test('repeated Level 3 death and shader warmup preserve Shaun’s forward-facing rig', async () => {
  const player = makePlayer(); await loadRig(player);
  player.input = { flushMouseDelta() {}, isDown: key => key === 'KeyW', consumeKeyPress: () => false,
    pointerLocked: true, mouseDeltaX: 0, mouseDeltaY: 0, moveAxisX: 0, moveAxisY: 0 };
  const { Level3 } = await import('../src/levels/Level3.js');
  const level = new Level3(player.scene);
  try {
    for (let attempt = 0; attempt < 4; attempt++) {
      player.takeDamage(1000);
      for (let frame = 0; frame < 30; frame++) player.deathSequence.update(.1);
      await level.prepareShaders({ compileAsync: async () => {} }, player.camera, player);
      player.reset(new THREE.Vector3());
      player.yaw = .7; player.update(.1);
      const movement = player.velocity.clone().setY(0).normalize();
      const expected = new THREE.Vector3(-Math.sin(player.yaw), 0, -Math.cos(player.yaw));
      assert.ok(movement.dot(expected) > .999, `retry ${attempt}: movement follows view`);
      assert.ok(Math.abs(player.characterModel.rotation.y - Math.PI) < 1e-6, `retry ${attempt}: model orientation remains intact`);
      assert.ok(player.bodyMesh.quaternion.angleTo(new THREE.Quaternion()) < 1e-6, `retry ${attempt}: body has no residual turn`);
      assert.ok(Math.abs(player.group.rotation.y - player.yaw) < 1e-6, `retry ${attempt}: body faces view`);
    }
  } finally { player.dispose(); }
});
