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
    for (let frame = 0; frame <= 49 * 60; frame++) {
      const time = frame / 60;
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
      if (previous) wrists.forEach((wrist, i) => assert.ok(wrist.distanceTo(previous[i]) < 0.006,
        `no IK popping: hand ${i} at ${time.toFixed(2)}s moved ${wrist.distanceTo(previous[i]).toFixed(4)}m`));
      previous = wrists;
    }
    for (const { mesh, bone } of f.opening.jointLining.parts) {
      assert.ok(mesh.position.distanceTo(bone.getWorldPosition(new THREE.Vector3())) < 1e-7);
    }
  } finally { f.dispose(); }
});

test('seated rocking continues forward and back at a brisk pace with smaller sideways sway', () => {
  const f = setup();
  try {
    const pose = f.opening.pose;
    const samples = [];
    let previous = null;
    for (let frame = 0; frame <= 49 * 60; frame++) {
      const time = frame / 60;
      pose.update(time);
      const head = pose.head.getWorldPosition(new THREE.Vector3());
      samples.push({ time, head });
      assert.ok(Math.abs(head.x) < 0.1, 'head stays above the supported pelvis');
      if (previous) assert.ok(head.distanceTo(previous) < 0.004, 'no sudden jerks while rocking');
      previous = head;
    }
    for (let start = 9; start <= 45; start += 4) {
      const window = samples.filter(sample => sample.time >= start && sample.time <= start + 4);
      const forward = window.map(sample => sample.head.z);
      const sideways = window.map(sample => sample.head.x);
      const forwardRange = Math.max(...forward) - Math.min(...forward);
      const sidewaysRange = Math.max(...sideways) - Math.min(...sideways);
      assert.ok(forwardRange > 0.04, `visible forward/back rocking throughout ${start}–${start + 4}s`);
      assert.ok(sidewaysRange > 0.015 && sidewaysRange < forwardRange, 'sideways movement complements the rocking');
      let reversals = 0;
      for (let i = 2; i < forward.length; i++) {
        if ((forward[i] - forward[i - 1]) * (forward[i - 1] - forward[i - 2]) < 0) reversals++;
      }
      assert.ok(reversals >= 3 && reversals <= 5, 'roughly two full rocking cycles per four seconds');
    }
    pose.update(12.3);
    const first = pose.head.getWorldPosition(new THREE.Vector3());
    pose.update(28); pose.update(12.3);
    assert.ok(pose.head.getWorldPosition(new THREE.Vector3()).distanceTo(first) < 1e-7, 'seeking never accumulates bone rotations');
  } finally { f.dispose(); }
});

test('annoyance adds brief head shakes and hand pressure while palms stay beside the ears', () => {
  const f = setup();
  try {
    const pose = f.opening.pose;
    const yaw = [], distances = [], directions = [];
    for (let frame = 0; frame <= 96; frame++) {
      pose.update(10.2 + frame / 60);
      const head = pose.head.getWorldPosition(new THREE.Vector3());
      const inverse = pose.head.getWorldQuaternion(new THREE.Quaternion()).invert();
      yaw.push(pose.head.rotation.y);
      pose.limbs.forEach((limb, index) => {
        const offset = limb.finger.getWorldPosition(new THREE.Vector3()).sub(head);
        assert.ok(offset.length() > 0.28 && offset.length() < 0.4, 'palms stay outside the head');
        if (index === 0) distances.push(offset.length());
        const direction = offset.applyQuaternion(inverse).normalize();
        directions[index] ??= direction.clone();
        assert.ok(direction.distanceTo(directions[index]) < 0.01, 'hands follow the turning head');
      });
    }
    assert.ok(Math.max(...yaw) - Math.min(...yaw) > 0.1, 'visible but restrained head shake');
    assert.ok(Math.max(...yaw) - Math.min(...yaw) < 0.3, 'head shake stays small');
    assert.ok(Math.max(...distances) - Math.min(...distances) > 0.008, 'hands briefly press closer to the ears');
    pose.update(13);
    assert.ok(Math.abs(pose.head.rotation.y) < 0.01, 'head shake settles between gestures');
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
