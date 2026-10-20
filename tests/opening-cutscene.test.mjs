import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import { Player } from '../src/player/Player.js';
import { Level1 } from '../src/levels/Level1.js';

globalThis.ProgressEvent ??= class {};
async function parse(path) {
  const url = new URL(path, import.meta.url);
  const asset = JSON.parse(readFileSync(url, 'utf8'));
  asset.materials = asset.materials.map(() => ({ doubleSided: true, pbrMetallicRoughness: {} }));
  for (const buffer of asset.buffers) {
    if (!buffer.uri.startsWith('data:')) buffer.uri = `data:application/octet-stream;base64,${readFileSync(new URL(buffer.uri, url)).toString('base64')}`;
  }
  return new GLTFLoader().parseAsync(JSON.stringify(asset), '');
}
const [character, couch, bed] = await Promise.all([
  parse('../public/assets/models/character/shaun.gltf'),
  parse('../public/assets/models/opening/old_couch/scene.gltf'),
  parse('../public/assets/models/opening/bed__bedside_table/scene.gltf'),
]);

function setup() {
  const scene = new THREE.Scene(), level = new Level1(scene);
  const camera = new THREE.PerspectiveCamera(60, 1.6, 0.1, 500);
  const player = new Player(scene, { flushMouseDelta() {}, isDown: () => false }, camera);
  const model = clone(character.scene);
  const scale = 1.75 / new THREE.Box3().setFromObject(model, true).getSize(new THREE.Vector3()).y;
  model.scale.set(-scale, scale, scale); model.rotation.y = Math.PI;
  player.bodyMesh.add(model); player.characterModel = model;
  player.animations = character.animations;
  player.mixer = new THREE.AnimationMixer(model);
  player.actions = Object.fromEntries(character.animations.map(clip => [clip.name, player.mixer.clipAction(clip)]));
  player._playAnimation('Idle'); player.mixer.update(0.01);
  let stops = 0;
  level.audioManager = { internalVoices: { active: new Set(), pending: new Set(), stop() { stops++; } } };
  level.openingAssets = { couch: clone(couch.scene), bed: clone(bed.scene) };
  level._createCredits(1); level.credits[0].mesh.position.set(40, 1.5, 40);
  level.preparePlayer(player);
  return { scene, level, player, opening: level.openingIntro, get stops() { return stops; },
    dispose() { level.dispose(); player.dispose(); } };
}

test('opening isolates one light and real furniture, and shows headphone advice before the episode card', () => {
  const f = setup();
  try {
    const opening = f.opening;
    assert.equal(opening.scene.children.filter(node => node.isLight).length, 1);
    assert.equal(f.scene.children.includes(opening.actor), false);
    assert.equal(opening.actor.getObjectByName('SMG').visible, false);
    opening.time = 1.8; assert.match(opening.cardText, /headphones/); assert.equal(opening.cardOpacity, 1);
    opening.time = 5.4; assert.match(opening.cardText, /psychological episode/); assert.equal(opening.cardOpacity, 1);
    assert.equal(f.player.camera.fov < 60, true);
    assert.deepEqual(f.level.getRestartState(), { skipOpening: true });
  } finally { f.dispose(); }
});

test('actual rig retains seated hips and planted feet while hands follow the ears smoothly', () => {
  const f = setup();
  try {
    const pose = f.opening.pose;
    let previous = null;
    const hips = pose.hips.getWorldPosition(new THREE.Vector3());
    const feet = pose.limbs.map(limb => limb.foot.getWorldPosition(new THREE.Vector3()));
    for (let time = 0; time <= 34; time += 0.2) {
      pose.update(time); f.opening.jointLining.update();
      assert.ok(pose.hips.getWorldPosition(new THREE.Vector3()).distanceTo(hips) < 1e-7);
      const head = pose.head.getWorldPosition(new THREE.Vector3());
      const wrists = pose.limbs.map((limb, index) => {
        assert.ok(limb.foot.getWorldPosition(new THREE.Vector3()).distanceTo(feet[index]) < 1e-7);
        const wrist = limb.finger.getWorldPosition(new THREE.Vector3());
        assert.ok(wrist.distanceTo(head) < 0.4 && wrist.distanceTo(head) > 0.25);
        assert.ok(limb.lower.getWorldPosition(new THREE.Vector3()).z > hips.z + 0.15, 'knees point forward');
        return wrist;
      });
      if (previous) wrists.forEach((wrist, i) => assert.ok(wrist.distanceTo(previous[i]) < 0.04, 'no IK popping'));
      previous = wrists;
    }
    for (const { mesh, bone } of f.opening.jointLining.parts) {
      assert.ok(mesh.position.distanceTo(bone.getWorldPosition(new THREE.Vector3())) < 1e-7);
    }
  } finally { f.dispose(); }
});

test('skip fades to the existing forest wake, restores the camera and leaves the real character intact', () => {
  const f = setup();
  try {
    const geometry = f.player.characterModel.getObjectByProperty('isSkinnedMesh', true).geometry;
    let disposed = false; geometry.addEventListener('dispose', () => { disposed = true; });
    f.opening.time = 12; f.opening.skip();
    assert.equal(f.stops, 1);
    for (let i = 0; i < 9; i++) f.level.update(0.15, f.player, i * 0.15);
    assert.equal(f.level.openingCinematicActive, false);
    assert.ok(f.level.wakeUpIntro && !f.level.wakeUpIntro.done);
    assert.equal(f.player.camera.fov, 60);
    assert.equal(disposed, false, 'opening disposal must not dispose the real character');
    for (let i = 0; i < 25; i++) f.level.update(0.15, f.player, i * 0.15);
    assert.equal(f.level.wakeUpIntro.done, true);
    assert.equal(f.player.scriptedMovement, false);
  } finally { f.dispose(); }
});
