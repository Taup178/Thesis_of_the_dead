import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Level3 } from '../src/levels/Level3.js';
import { EndingCutscene } from '../src/levels/EndingCutscene.js';
import { VictoryPortals } from '../src/props/VictoryPortals.js';

test('both fate checkpoint indicators show for the choice and hide on entry', () => {
  const portals = new VictoryPortals(new THREE.Group());
  try {
    assert.ok(portals.indicators.every(marker => !marker.root.visible));
    portals.updateIndicators(.1, true);
    portals.indicators.forEach((marker, i) => {
      assert.equal(marker.root.visible, true);
      assert.equal(marker.root.position.x, portals.portals[i].center.x);
      assert.equal(marker.root.position.y, 0);
      assert.ok(marker.root.position.equals(portals.portals[i].approachPoint));
      assert.equal(marker.groundMaterial.color.getHex(), 0x88d2b5);
      assert.ok(marker.groundMaterial.opacity > 0);
    });
    portals.updateIndicators(0, false);
    assert.ok(portals.indicators.every(marker => !marker.root.visible));
  } finally { portals.dispose(); }
  assert.ok(portals.indicators.every(marker => marker.resources.size === 0));
});

function fixture(choice) {
  const scene = new THREE.Scene(), level = new Level3(scene), group = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(1, 2, 1), new THREE.MeshBasicMaterial()); group.add(body); scene.add(group);
  const player = { group, camera: new THREE.PerspectiveCamera(), bodyMesh: body, grounded: true, alive: true,
    velocity: new THREE.Vector3(), scriptedMovement: false, mixer: { update() {} } };
  const portal = x => ({ center: new THREE.Vector3(x, 2.2, 0), approachPoint: new THREE.Vector3(x, 0, 0), update() {} });
  level.victoryPortals = { portals: [portal(-7), portal(7)] };
  const scroll = new THREE.Group(); group.add(scroll);
  level.degreeVictory = { scroll, keepHolding() {} };
  group.position.set(choice === 'red' ? -7 : 7, 0, 0);
  return { level, player, scene, body };
}

test('red ending burns in a pure black void without the room or a visible floor', () => {
  const f = fixture('red');
  const assets = { couch: new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial()),
    bed: new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial()) };
  const ending = new EndingCutscene(f.player, 'red', assets);
  try {
    assert.equal(ending.floor.visible, false);
    assert.ok(ending.furniture.every(root => !root.visible));
    assert.equal(ending.scene.fog, null);
    for (const time of [0, 6, 10, 17, 22]) {
      ending.time = time; ending.update(0);
      assert.equal(ending.scene.background.getHex(), 0x000000);
    }
    ending.time = 10; ending.update(0);
    assert.ok(ending.fireUniforms.strength.value > 0);
  } finally { ending.dispose(); f.body.geometry.dispose(); f.body.material.dispose(); }
});

test('graphics changed during an ending do not restore the previous high resolution', () => {
  const f = fixture('blue'), ending = new EndingCutscene(f.player, 'blue');
  let ratio = 2;
  const renderer = { toneMappingExposure: 1, _graphicsRevision: 1,
    getSize: target => target.set(1280, 720), getPixelRatio: () => ratio,
    setPixelRatio: value => { ratio = value; }, render() {} };
  ending.render(renderer, 'medium'); assert.equal(ratio, 1);
  // Selecting Medium also requests 1, exactly matching the cinematic cap.
  renderer._graphicsRevision++; ratio = 1;
  ending.render(renderer, 'medium'); ending.dispose();
  assert.equal(ratio, 1, 'cleanup respects the new graphics setting');
  f.body.geometry.dispose(); f.body.material.dispose();
});
for (const choice of ['red', 'blue']) test(`${choice} rendering bounds pixel cost and restores the display ratio`, () => {
  const f = fixture(choice), ending = new EndingCutscene(f.player, choice);
  let ratio = 2, resizes = 0;
  const size = new THREE.Vector2(1920, 1080);
  const renderer = { toneMappingExposure: 1, getSize: target => target.copy(size),
    getPixelRatio: () => ratio, setPixelRatio: value => { ratio = value; resizes++; }, render() {} };

  ending.render(renderer, 'high');
  assert.ok(size.x * ratio <= 2560 && size.y * ratio <= 1440);
  assert.ok(size.y * ratio > 720, 'High preserves detail above the old 720p limit');
  ending.render(renderer, 'high'); assert.equal(resizes, 1, 'steady playback does not resize each frame');
  size.set(960, 540); ending.render(renderer, 'high'); assert.equal(ratio, 1.5);
  ending.dispose(); assert.equal(ratio, 2);
  f.body.geometry.dispose(); f.body.material.dispose();
});
for (const choice of ['red', 'blue']) test(`${choice} portal waits for passage and plays exactly its own ending`, () => {
  const f = fixture(choice), { level, player } = f;
  const originalMaterial = f.body.material; const sounds = [];
  level.audioManager = { playSfx: url => sounds.push(url), _playDesignedCue() {} };
  level._updateDestiny(0, player); assert.equal(level.destinyChoice, choice);
  assert.equal(level.degreeVictory.scroll.visible, true);
  assert.ok(level.destinyPassage); assert.equal(level.endingCutscene, undefined); assert.equal(level.levelComplete, false);
  const passage = level.destinyPassage;
  level._updateDestiny(passage.duration / 2, player); assert.equal(level.endingCutscene, undefined);
  level._updateDestiny(passage.duration + .2, player); const ending = level.endingCutscene;
  assert.equal(level.degreeVictory.scroll.visible, false);
  assert.equal(ending.choice, choice); assert.equal(level.levelComplete, false); assert.equal(player.scriptedMovement, true);
  for (let i = 0; i < 45; i++) level._updateDestiny(.1, player);
  assert.equal(ending.phase, choice === 'red' ? 'recognition' : 'release'); assert.equal(level.levelComplete, false);
  // No update while paused means the scene clock and its effects do not advance.
  const paused = ending.time; ending.update(0); assert.equal(ending.time, paused);
  for (let i = 0; i < 25; i++) level._updateDestiny(.1, player);
  assert.equal(ending.phase, choice === 'red' ? 'engulf' : 'release');
  if (choice === 'red') assert.ok(ending.fireUniforms.strength.value > 0);
  for (let i = 0; i < 200 && !level.levelComplete; i++) level._updateDestiny(.1, player);
  assert.equal(level.levelComplete, true); assert.equal(level.endingCutscene, ending);
  if (choice === 'red') {
    assert.equal(player.group.visible, false, 'body and attached degree disappear');
    assert.equal(sounds.filter(url => url.includes('red-ending-fire-scream')).length, 1);
    assert.equal(sounds.filter(url => url.includes('shaun-death')).length, 0);
  }
  assert.equal(level.getCompletionText(), choice === 'red' ? "You weren't paying attention all along." : 'At last, the voices are quiet.');
  ending.dispose(); ending.dispose(); assert.equal(player.group.parent, f.scene);
  assert.equal(f.body.material, originalMaterial); assert.equal(player.group.visible, true);
  f.body.geometry.dispose(); f.body.material.dispose();
});

test('red run covers real distance and ignition mix starts once at eight seconds', () => {
  const f = fixture('red'); const ending = new EndingCutscene(f.player, 'red'); const sounds = [];
  ending.audio = { playSfx: url => { sounds.push({ url, time: ending.time }); }, _playDesignedCue() {} };
  for (let i = 0; i < 79; i++) ending.update(.1);
  const start = f.player.group.position.clone();
  for (let i = 0; i < 32; i++) ending.update(.1);
  assert.ok(f.player.group.position.distanceTo(start) > 2);
  const mix = sounds.filter(sound => sound.url.includes('red-ending-fire-scream'));
  assert.equal(mix.length, 1); assert.ok(mix[0].time >= 8 && mix[0].time < 8.2);
  assert.ok(ending.fireUniforms.strength.value > 0);
  ending.dispose(); f.body.geometry.dispose(); f.body.material.dispose();
});


test('blue ending uses simple light and walks Shaun to the bedside', () => {
  const f = fixture('blue'); const initialScale = f.body.scale.y;
  f.body.receiveShadow = true;
  f.level._updateDestiny(0, f.player);
  const passage = f.level.destinyPassage; f.level._updateDestiny(passage.duration + .2, f.player);
  const scene = f.level.endingCutscene;
  scene.update(.1);
  assert.equal(scene.volume, undefined); assert.equal(scene.light.castShadow, true);
  const lights = []; scene.scene.traverse(node => { if (node.isLight) lights.push(node); });
  assert.deepEqual(lights, [scene.light], 'one focused spotlight matches the opening');
  assert.deepEqual(scene.light.position.toArray(), [.8, 3.8, 3.2]);
  assert.equal(scene.light.intensity, 150);
  assert.equal(f.body.receiveShadow, false, 'the face avoids hard self-shadow strips');
  let passes = 0;
  scene.render({ toneMappingExposure: 1, render() { passes++; } });
  assert.equal(passes, 1, 'blue ending renders its geometry once');
  const start = f.player.group.position.clone();
  for (let i = 0; i < 130; i++) scene.update(.1);
  assert.ok(f.player.group.position.distanceTo(start) > 1);
  assert.ok(f.player.group.position.distanceTo(scene.bedside) < .01);
  assert.equal(scene.phase, 'rest');
  const bedsidePosition = f.player.group.position.clone(); scene.update(0);
  assert.ok(f.player.group.position.equals(bedsidePosition), 'pause does not slide Shaun at the bedside');
  scene.dispose(); assert.equal(f.body.scale.y, initialScale);
  assert.equal(f.body.receiveShadow, true, 'cleanup restores gameplay shadows');
  f.body.geometry.dispose(); f.body.material.dispose();
});

test('blue layered pose does not accumulate while paused and render exposure is restored on failure', () => {
  const f = fixture('blue');
  const torso = new THREE.Bone(); torso.name = 'Torso'; f.body.add(torso); f.player.characterModel = f.body;
  const initial = torso.quaternion.clone(), ending = new EndingCutscene(f.player, 'blue');
  ending.time = 7; ending.update(0); const paused = torso.quaternion.clone();
  for (let i = 0; i < 100; i++) ending.update(0);
  assert.ok(torso.quaternion.angleTo(paused) < 1e-6, 'pause must not keep bending the torso');
  const renderer = { toneMappingExposure: 1.7, render() { throw new Error('render interrupted'); } };
  assert.throws(() => ending.render(renderer, 'low'), /render interrupted/);
  assert.equal(renderer.toneMappingExposure, 1.7);
  ending.dispose(); assert.ok(torso.quaternion.angleTo(initial) < 1e-6);
  f.body.geometry.dispose(); f.body.material.dispose();
});

test('red flames follow the animated torso down and material dissolution is reversible', () => {
  const f = fixture('red');
  const torso = new THREE.Bone(); torso.name = 'Torso'; torso.position.y = 1.4; f.body.add(torso); f.player.characterModel = f.body;
  const original = f.body.material, ending = new EndingCutscene(f.player, 'red');
  ending.time = 10; ending.update(0);
  const standing = ending.fireEffects.offset[4 * 3 + 1];
  torso.position.y = .2; ending.update(0);
  assert.ok(ending.fireEffects.offset[4 * 3 + 1] < standing - 1);
  ending.time = 17; ending.update(0);
  assert.ok(ending.dissolveUniforms.ash.value > 0);
  assert.equal(original.onBeforeCompile, new THREE.MeshBasicMaterial().onBeforeCompile, 'shared source material is untouched');
  ending.dispose(); assert.equal(f.body.material, original);
  f.body.geometry.dispose(); f.body.material.dispose();
});

test('blue ending waits for the actual voice and two seconds of silence before proceeding', () => {
  const f = fixture('blue'), ending = new EndingCutscene(f.player, 'blue');
  ending.finalVoice = { state: 'loading', dispose() {} }; ending.time = 17;
  for (let i = 0; i < 60; i++) ending.update(.1);
  assert.equal(ending.time, 17); assert.equal(ending.done, false);
  ending.finalVoice.state = 'playing'; ending.update(.1); assert.equal(ending.time, 17);
  ending.finalVoice.state = 'finished';
  for (let i = 0; i < 19; i++) ending.update(.1);
  assert.equal(ending.time, 17); assert.equal(ending.done, false);
  for (let i = 0; i < 100 && !ending.done; i++) ending.update(.1);
  assert.equal(ending.done, true); ending.dispose(); f.body.geometry.dispose(); f.body.material.dispose();
});

test('entering the blue portal during a dodge restores an upright body before the ending', () => {
  const f = fixture('blue');
  f.player.isDodging = true; f.player.dodgeProgress = .25; f.player.dodgeTimer = .3;
  f.body.position.set(0, .85, -.85); f.body.rotation.set(-Math.PI / 2, .4, 0);
  f.level._updateDestiny(0, f.player);
  assert.equal(f.player.isDodging, false);
  assert.equal(f.player.dodgeProgress, 0);
  assert.deepEqual(f.body.position.toArray(), [0, 0, 0]);
  assert.ok(f.body.quaternion.angleTo(new THREE.Quaternion()) < 1e-6);
  f.level._updateDestiny(f.level.destinyPassage.duration + .2, f.player);
  const ending = f.level.endingCutscene;
  for (let i = 0; i < 80; i++) ending.update(.1);
  assert.ok(f.body.quaternion.angleTo(new THREE.Quaternion()) < 1e-6);
  ending.dispose(); f.body.geometry.dispose(); f.body.material.dispose();
});
