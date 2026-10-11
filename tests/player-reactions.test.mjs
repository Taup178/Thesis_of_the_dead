import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import { Player } from '../src/player/Player.js';
import { SurvivorWeapon } from '../src/player/SurvivorWeapon.js';
import { createDirectionalWalkClips } from '../src/player/DirectionalWalk.js';

globalThis.ProgressEvent ??= class { constructor(type, values) { this.type = type; Object.assign(this, values); } };
const asset = JSON.parse(readFileSync(new URL('../public/assets/models/character/shaun.gltf', import.meta.url), 'utf8'));
asset.materials = asset.materials.map(() => ({ pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1] } }));
const character = await new GLTFLoader().parseAsync(JSON.stringify(asset), '');

function setup(firstPerson = false, withWeapons = false) {
  const scene = new THREE.Scene();
  const input = { keys: {}, pointerLocked: false, mouseDeltaX: 0, mouseDeltaY: 0,
    isDown(key) { return !!this.keys[key]; }, flushMouseDelta() {} };
  const player = new Player(scene, input, new THREE.PerspectiveCamera(60, 1.5, 0.1, 500));
  const model = clone(character.scene);
  model.rotation.y = Math.PI;
  player.bodyMesh.add(model);
  player.mixer = new THREE.AnimationMixer(model);
  player.actions = Object.fromEntries(character.animations.map(clip => [clip.name, player.mixer.clipAction(clip)]));
  player._playAnimation('Idle_Gun', 'Idle');
  player.mixer.update(0.2);
  if (withWeapons) {
    player.characterModel = model;
    player.animations = character.animations;
    player.weaponPresentation = new SurvivorWeapon(player);
  }
  if (firstPerson) player.toggleCamera();
  return { player, input, cleanup() { player.dispose(); } };
}

test('real Shaun hit clip plays on damage, visibly recoils, and yields to locomotion', () => {
  const f = setup(true), { player } = f;
  try {
    player.takeDamage(18);
    assert.equal(player.health, 82);
    assert.equal(player.currentActionName, 'HitReact');
    assert.equal(player.actions.HitReact.loop, THREE.LoopOnce);
    assert.equal(player.damageFlashTime, 0.35);
    player.update(0.12);
    assert.equal(player.currentActionName, 'HitReact');
    assert.ok(player.camera.position.y < player.firstPersonOffset.y, 'Camera recoils in first person');
    assert.ok(player.damageFlashTime < 0.35);
    player.takeDamage(7);
    assert.equal(player.health, 75);
    assert.ok(player.actions.HitReact.time < 0.01, 'A new impact restarts the pose');
    player.update(0.5);
    assert.equal(player.currentActionName, 'Idle');
    assert.equal(player.damageFlashTime, 0);
  } finally { f.cleanup(); }
});

test('loadouts show the correct weapons on both rigs and dual pistols have separate muzzles', () => {
  const f = setup(false, true), { player } = f;
  try {
    assert.equal(player.currentActionName, 'Idle_Gun');
    player.update(0.2);
    assert.equal(player.currentActionName, 'Idle', 'Shaun relaxes when he is not firing');
    for (const id of ['pistol', 'dual', 'sword', 'dagger', 'smg']) {
      assert.equal(player.equipWeapon(id), true);
      const world = player.weaponPresentation.worldWeapons;
      const view = player.weaponPresentation.viewWeapons;
      for (const weapons of [world, view]) {
        assert.equal(weapons.smg.visible, id === 'smg');
        assert.equal(weapons.pistolRight.visible, id === 'pistol' || id === 'dual');
        assert.equal(weapons.pistolLeft.visible, id === 'dual');
        assert.equal(weapons.sword.visible, id === 'sword');
        assert.equal(weapons.dagger.visible, id === 'dagger');
      }
    }
    player.equipWeapon('dual');
    const right = player.getMuzzleWorldPosition('right');
    const left = player.getMuzzleWorldPosition('left');
    assert.ok(right.distanceTo(left) > 0.05, 'Each pistol fires from its own hand');
    assert.ok(player.weaponPresentation.armGeometries.every(({ node, dual }) => node.geometry === dual));
    player.input.pointerLocked = true;
    player.input.isMouseButtonDown = () => true;
    player.update(0.2);
    assert.equal(player.currentActionName, 'Idle_Gun', 'Firing raises the gun stance');
    const rightAim = new THREE.Vector3(0, 0, -1).transformDirection(player.weaponPresentation.worldWeapons.pistolRight.matrixWorld);
    const leftAim = new THREE.Vector3(0, 0, -1).transformDirection(player.weaponPresentation.worldWeapons.pistolLeft.matrixWorld);
    assert.ok(rightAim.z < -0.6 && leftAim.z < -0.6, 'Both pistol barrels face forward');
    const rightMuzzle = player.getMuzzleWorldPosition('right');
    const leftMuzzle = player.getMuzzleWorldPosition('left');
    assert.ok(Math.abs(rightMuzzle.y - leftMuzzle.y) < 0.12, 'The left arm raises to match the right');
    player.equipWeapon('sword'); player.update(0.2);
    const bladeDirection = new THREE.Vector3(0, 0, -1).transformDirection(player.weaponPresentation.worldWeapons.sword.matrixWorld);
    assert.ok(bladeDirection.z < -0.6, 'The sword points forward from the grip');
  } finally { f.cleanup(); }
});

test('relaxed stance keeps sideways, backward and diagonal footwork', () => {
  const f = setup(), { player, input } = f;
  try {
    const relaxed = createDirectionalWalkClips(player.bodyMesh.children[0],
      character.animations.find(clip => clip.name === 'Idle'), 'Relaxed');
    for (const clip of relaxed) player.actions[clip.name] = player.mixer.clipAction(clip);
    input.keys.KeyA = true; player.update(0.1);
    assert.equal(player.currentActionName, 'RelaxedStrafeLeft');
    input.keys.KeyA = false; input.keys.KeyS = true; player.update(0.1);
    assert.equal(player.currentActionName, 'RelaxedWalkBackward');
    input.keys.KeyS = false; input.keys.KeyW = input.keys.KeyD = true; player.update(0.1);
    assert.equal(player.currentActionName, 'RelaxedWalkForwardRight');
  } finally { f.cleanup(); }
});

test('Space rolls the actual Shaun model, avoids damage during the roll, then recovers', () => {
  const f = setup(), { player, input } = f;
  try {
    input.keys.Space = true;
    player.update(0.1);
    assert.equal(player.isDodging, true);
    assert.equal(player.currentActionName, 'Duck');
    assert.ok(player.bodyMesh.rotation.x < -0.5, 'Shaun tumbles forward');
    assert.ok(player.bodyMesh.position.y > 0, 'The tumble rotates around the torso');
    const torso = new THREE.Vector3(0, 0.85, 0).applyEuler(player.bodyMesh.rotation).add(player.bodyMesh.position);
    assert.ok(torso.distanceTo(new THREE.Vector3(0, 0.85, 0)) < 1e-5, 'The torso stays at the roll pivot');
    assert.ok(player.group.position.z < -1, 'A standing roll moves forward');
    player.takeDamage(30);
    assert.equal(player.health, 100, 'The active roll dodges the hit');
    for (let i = 0; i < 4; i++) player.update(0.1);
    assert.equal(player.isDodging, false);
    assert.equal(player.bodyMesh.rotation.x, 0);
    assert.equal(player.bodyMesh.position.y, 0);
    player.update(1);
    assert.equal(player.isDodging, false, 'Holding Space cannot start repeated rolls');
    input.keys.Space = false;
    player.update(0.01);
    input.keys.Space = true;
    player.update(0.01);
    assert.equal(player.isDodging, true, 'Releasing and pressing starts the next roll');
  } finally { f.cleanup(); }
});
