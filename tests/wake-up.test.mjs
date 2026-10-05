import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import { Level1 } from '../src/levels/Level1.js';
import { Player } from '../src/player/Player.js';
import { DreamMotionBlur } from '../src/shaders/DreamMotionBlur.js';

// Exercise the supplied mesh and animation without a browser texture decoder.
globalThis.ProgressEvent ??= class { constructor(type, values) { this.type = type; Object.assign(this, values); } };
const asset = JSON.parse(readFileSync(new URL('../public/assets/models/character/shaun.gltf', import.meta.url), 'utf8'));
asset.materials = asset.materials.map(() => ({ pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1] } }));
const character = await new GLTFLoader().parseAsync(JSON.stringify(asset), '');

function setup(firstPerson = false) {
  const scene = new THREE.Scene(), level = new Level1(scene);
  const input = { pointerLocked: true, mouseDeltaX: 0, mouseDeltaY: 0, isDown: () => true, flushMouseDelta() {} };
  const player = new Player(scene, input, new THREE.PerspectiveCamera(60, 1.5, 0.1, 500));
  const model = clone(character.scene); model.rotation.y = Math.PI; player.bodyMesh.add(model);
  player.mixer = new THREE.AnimationMixer(model);
  player.actions = Object.fromEntries(character.animations.map(clip => [clip.name, player.mixer.clipAction(clip)]));
  player._playAnimation('Idle_Gun', 'Idle'); player.mixer.update(0.2);
  if (firstPerson) player.toggleCamera();
  const height = new THREE.Box3().setFromObject(player.bodyMesh, true).getSize(new THREE.Vector3()).y;
  level._createCredits(1); level.credits[0].mesh.position.set(0, 1.5, 0);
  level.preparePlayer(player);
  return { scene, level, player, height, cleanup() { level.dispose(); player.dispose(); } };
}

for (const firstPerson of [false, true]) {
  test(`the actual Shaun model wakes from a grounded pose and restores the camera (first person: ${firstPerson})`, () => {
    const f = setup(firstPerson), { level, player } = f;
    try {
      player.group.updateMatrixWorld(true);
      const prone = new THREE.Box3().setFromObject(player.bodyMesh, true);
      assert.ok(prone.getSize(new THREE.Vector3()).y < f.height * 0.8, 'The fallen pose is lower than standing, including its bent legs');
      const head = player.bodyMesh.getObjectByName('Head');
      assert.ok(head.getWorldPosition(new THREE.Vector3()).y < f.height * 0.5, 'The head rests near the ground');
      assert.ok(prone.min.y >= -0.001 && prone.min.y < 0.05);
      assert.equal(player.scriptedMovement, true);
      assert.equal(player.bodyMesh.visible, true);
      let minimumY = Infinity;
      for (let frame = 0; !level.wakeUpIntro.done && frame < 250; frame++) {
        player.update(1 / 60);
        level.update(1 / 60, player, frame / 60);
        player.group.updateMatrixWorld(true);
        minimumY = Math.min(minimumY, new THREE.Box3().setFromObject(player.bodyMesh, true).min.y);
      }
      assert.equal(level.wakeUpIntro.done, true);
      assert.ok(minimumY >= -0.05, 'The rising animation stays above the ground');
      assert.equal(level.creditsCollected, 0, 'Gameplay waits until the player stands');
      assert.equal(player.scriptedMovement, false);
      assert.equal(player.isFirstPerson, firstPerson);
      assert.equal(player.bodyMesh.visible, !firstPerson);
      assert.deepEqual(player.bodyMesh.position.toArray(), [0, 0, 0]);
      assert.deepEqual(player.group.position.toArray(), [0, 0, 0]);
      assert.ok(player.getForwardDirection().z < -0.98);
    } finally { f.cleanup(); }
  });
}

test('restarting while waking restores the model and first-person visibility', () => {
  const f = setup(true);
  try {
    f.level.update(1.3, f.player, 1.3);
    f.level.dispose();
    assert.equal(f.player.scriptedMovement, false);
    assert.equal(f.player.bodyMesh.visible, false);
    assert.deepEqual(f.player.bodyMesh.position.toArray(), [0, 0, 0]);
    assert.equal(f.player.currentActionName, 'Idle_Gun');
  } finally { f.cleanup(); }
});

test('motion blur bypasses rendering when off and clears history after pause, resize and camera cuts', () => {
  let direct = 0, composited = 0;
  const effect = Object.create(DreamMotionBlur.prototype);
  effect.renderer = { render() { direct++; } };
  effect.composer = { render() { composited++; }, setSize(w, h) { assert.deepEqual([w, h], [800, 600]); } };
  effect.blur = { uniforms: { damp: { value: 0 } } };
  effect.reset(); effect.render(1 / 60, true);
  assert.equal(effect.blur.uniforms.damp.value, 0);
  effect.render(1 / 60, true);
  assert.ok(effect.blur.uniforms.damp.value > 0 && effect.blur.uniforms.damp.value < 1);
  effect.render(1 / 60, false);
  assert.equal(direct, 1); assert.equal(composited, 2);
  effect.render(1 / 60, true);
  assert.equal(effect.blur.uniforms.damp.value, 0);
  effect.setSize(800, 600); effect.render(1 / 60, true);
  assert.equal(effect.blur.uniforms.damp.value, 0);
  effect.reset(); effect.render(1 / 60, true);
  assert.equal(effect.blur.uniforms.damp.value, 0);
});
