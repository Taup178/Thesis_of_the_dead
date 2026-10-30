import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { Player } from '../src/player/Player.js';
import { createDirectionalWalkClips } from '../src/player/DirectionalWalk.js';
import { FOOTSTEP_SOUNDS, footContacts } from '../src/player/Footsteps.js';
import { Level2 } from '../src/levels/Level2.js';
import { Level3 } from '../src/levels/Level3.js';

const data = JSON.parse(readFileSync(new URL('../public/assets/models/character/shaun.gltf', import.meta.url)));
data.materials = data.materials.map(() => ({})); delete data.images; delete data.textures;
globalThis.ProgressEvent ??= class {};
const rig = await new GLTFLoader().parseAsync(JSON.stringify(data), '');
const clips = [...rig.animations, ...createDirectionalWalkClips(rig.scene, rig.animations.find(c => c.name === 'Idle'))];

function fixture() {
  const player = new Player(new THREE.Scene(), { flushMouseDelta() {} }, new THREE.PerspectiveCamera());
  player.mixer = new THREE.AnimationMixer(rig.scene.clone(true));
  player.actions = Object.fromEntries(clips.map(clip => [clip.name, player.mixer.clipAction(clip)]));
  const sounds = [], preloads = [];
  globalThis.__thesisAudioManager = { playRandom: (files, options) => sounds.push({ files, options }), preload: files => preloads.push(files) };
  player.setFootstepSurface('grass');
  return { player, sounds, preloads };
}

test('each shipped gait has exactly two foot landings per cycle', () => {
  for (const clip of clips.filter(c => /^(Walk|Run$|Run_Gun|Strafe)/.test(c.name))) {
    const contacts = footContacts(clip);
    assert.equal(contacts.length, 2, clip.name);
    assert.ok(contacts.every(time => time >= 0 && time < clip.duration), clip.name);
  }
  const walk = footContacts(clips.find(c => c.name === 'Walk'));
  assert.ok(Math.abs(walk[0] - 0.1) < 0.03);
  assert.ok(Math.abs(walk[1] - 0.633) < 0.03);
});

test('walking, aiming, sprinting and strafing play eight sounds for four cycles at different frame rates', () => {
  for (const fps of [30, 60, 120]) for (const [name, speed, aiming] of [
    ['Walk', 8, false], ['Walk_Gun', 8, true], ['Run', 13.6, false],
    ['Run_Gun', 13.6, true], ['StrafeLeft', 8, true], ['WalkBackward', 8, true],
  ]) {
    const { player, sounds } = fixture();
    player.aimTime = aiming ? 1 : 0;
    player.velocity.set(name.includes('Strafe') ? -speed : 0, 0, name.includes('Strafe') ? 0 : name.includes('Backward') ? speed : -speed);
    player._updateLocomotion(0);
    assert.equal(player.currentActionName, name);
    const seconds = player.currentAction.getClip().duration * 4 / player.currentAction.getEffectiveTimeScale();
    const frames = Math.ceil(seconds * fps);
    for (let frame = 0; frame < frames; frame++) player._updateLocomotion(seconds / frames);
    assert.equal(sounds.length, 8, `${name} at ${fps} FPS`);
  }
});

test('only landing frames make sounds; stopping and non-walking states stay quiet', () => {
  const { player, sounds } = fixture();
  player.velocity.z = -8;
  player._updateLocomotion(0.05);
  assert.equal(sounds.length, 0, 'starting movement does not invent a step');
  player._updateLocomotion(0.05);
  assert.equal(sounds.length, 1, 'first visible landing');
  player._updateLocomotion(0.4);
  assert.equal(sounds.length, 1, 'no extra sounds between landings');
  player._updateLocomotion(0.15);
  assert.equal(sounds.length, 2, 'second visible landing');
  for (const state of [{ grounded: false }, { isDodging: true }, { bashTime: 1 }, { hitReactionTime: 1 }, { alive: false }]) {
    const original = Object.fromEntries(Object.keys(state).map(key => [key, player[key]]));
    Object.assign(player, state); player._updateLocomotion(1); Object.assign(player, original);
    assert.equal(sounds.length, 2, JSON.stringify(state));
  }
  player.velocity.set(0, 0, 0); player._updateLocomotion(2);
  assert.equal(sounds.length, 2);
});

test('forward gait keeps natural cadence and resumes after a slowed cinematic action', () => {
  const { player } = fixture();
  player.carryingDegree = true;
  const walk = player.actions.Walk;
  walk.play();
  walk.setEffectiveTimeScale(.2); walk.setLoop(THREE.LoopOnce, 1);
  walk.clampWhenFinished = true; walk.paused = true;
  player.currentAction = walk; player.currentActionName = 'Walk';
  for (const speed of [1.8, 4, 8]) {
    player.velocity.set(0, 0, -speed);
    player._updateLocomotion(0);
    assert.equal(player.currentAction, walk);
    assert.equal(walk.getEffectiveTimeScale(), THREE.MathUtils.clamp(speed / player.moveSpeed, .65, 1.35));
    assert.equal(walk.loop, THREE.LoopRepeat);
    assert.equal(walk.paused, false);
    assert.equal(walk.clampWhenFinished, false);
  }
  const before = walk.time;
  player._updateLocomotion(1 / 60);
  assert.ok(walk.time > before, 'carrying the degree must not freeze the walking cycle');
  player.velocity.z = -player.moveSpeed * player.sprintMultiplier;
  player._updateLocomotion(0);
  assert.equal(player.currentActionName, 'Run');
  assert.equal(player.currentAction.getEffectiveTimeScale(), 1, 'sprinting uses the native run cadence');
  player.velocity.set(player.moveSpeed, 0, 0);
  player._updateLocomotion(0);
  assert.ok(player.currentAction.getEffectiveTimeScale() <= 1.35, 'side steps must not become rapid mechanical shuffles');
});

test('surface changes preload once and use separate grass, stone and sand single-step assets', () => {
  const { player, sounds, preloads } = fixture();
  player.velocity.z = -8;
  const volumes = {};
  for (const surface of ['grass', 'stone', 'sand']) {
    player.setFootstepSurface(surface); player.setFootstepSurface(surface);
    player._updateLocomotion(1);
    assert.equal(sounds.at(-1).files, FOOTSTEP_SOUNDS[surface]);
    volumes[surface] = sounds.at(-1).options.volume;
    for (const file of FOOTSTEP_SOUNDS[surface]) assert.ok(existsSync(`public/${file.slice(2)}`), file);
  }
  assert.equal(preloads.length, 3);
  assert.ok(Math.abs(volumes.grass / volumes.sand - 1.8) < 1e-6, 'grass footsteps keep their volume boost');
  assert.ok(Math.abs(volumes.stone / volumes.sand - 2) < 1e-6, 'level 2 tile footsteps have a 6 dB volume boost');
  player.reset(); assert.equal(player.footstepSurface, 'sand');
  delete globalThis.__thesisAudioManager;
});

test('entering and restarting level 2 replaces grass with stone, then level 3 selects sand', () => {
  const { player, sounds } = fixture();
  const level2 = new Level2(new THREE.Scene(), { puzzleIndex: 1 });
  Object.defineProperty(level2, 'spawnPoint', { value: new THREE.Vector3() });
  Object.assign(level2, { bladeSurface: {},
    bossMarker: new THREE.Group(), dean: { _playAction() {} },
    getObstacles: () => [], _updateLocalLighting() {}, _deanStepPosition: () => new THREE.Vector3() });
  level2.preparePlayer(player);
  player.velocity.z = -5; player._updateLocomotion(1);
  assert.equal(sounds.at(-1).files, FOOTSTEP_SOUNDS.stone);
  player.reset();
  assert.equal(player.footstepSurface, 'stone', 'respawns retain the current floor');
  level2.preparePlayer(player);
  player.velocity.z = -5; player._updateLocomotion(1);
  assert.equal(sounds.at(-1).files, FOOTSTEP_SOUNDS.stone);
  const level3 = new Level3(new THREE.Scene(), { arenaCleared: true });
  Object.defineProperty(level3, 'spawnPoint', { value: new THREE.Vector3() });
  level3.getObstacles = () => [];
  level3.preparePlayer(player);
  player.velocity.z = -8; player._updateLocomotion(1);
  assert.equal(sounds.at(-1).files, FOOTSTEP_SOUNDS.sand);
  delete globalThis.__thesisAudioManager;
});
