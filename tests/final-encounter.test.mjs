import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { readFileSync } from 'node:fs';
import { MudHouse, createHouseFragments } from '../src/props/MudHouse.js';
import { Level3, FINAL_ENCOUNTER_SECONDS } from '../src/levels/Level3.js';
import { LevelManager } from '../src/levels/LevelManager.js';
import { ArenaNavigation } from '../src/environment/ArenaNavigation.js';
import { Game } from '../src/core/Game.js';
import { WeaponCombat } from '../src/player/WeaponCombat.js';
import { Player } from '../src/player/Player.js';
import { Zombie } from '../src/enemies/Zombie.js';
import { DEGREE_BURN_TIMING } from '../src/enemies/DeanDegreeBurn.js';

function arrivalFixture(firstPerson = false) {
  const scene = new THREE.Scene(), level = new Level3(scene);
  level._createEntrancePortal();
  const input = { isDown: () => false, consumeKeyPress: () => false, flushMouseDelta() {} };
  const player = new Player(scene, input, new THREE.PerspectiveCamera(60, 1.5, 0.1, 500));
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.6, 1.8, 0.4), new THREE.MeshStandardMaterial());
  body.position.y = 0.9; player.bodyMesh.add(body);
  if (firstPerson) player.toggleCamera();
  const boss = new THREE.Group(); boss.position.set(0, 1.2, -37); level.root.add(boss);
  level.bossMarker = boss;
  level.houses = [{ alive: true, obstacle: { x: 100, z: 100, radius: 1 }, update() {}, dispose() {} }];
  level.preparePlayer(player);
  return { level, player, body, boss, cleanup() { level.dispose(); player.dispose(); } };
}

for (const firstPerson of [false, true]) {
  test(`only the player emerges in the desert, then regains a clear forward view (first person: ${firstPerson})`, () => {
    const f = arrivalFixture(firstPerson), { level, player, boss, body } = f;
    try {
      const bossPosition = boss.position.clone(), bossScale = boss.scale.clone();
      let enemyUpdates = 0;
      level.spawnRecords.push({}); level._updateZombie = () => enemyUpdates++;
      assert.equal(player.scriptedMovement, true);
      assert.equal(level.portalCinematicActive, true);
      assert.equal(player.group.visible, false);
      assert.ok(level.entrancePortal.light.color.r > level.entrancePortal.light.color.g);
      level.update(level.arrivalPassage.duration / 2, player);
      assert.equal(player.group.visible, true);
      assert.ok(player.group.scale.x > 0 && player.group.scale.x < 1);
      for (let frame = 0; level.arrivalPlayer && frame < 200; frame++) {
        player.update(1 / 60, level.getObstacles(), level.getWorldBounds());
        level.update(1 / 60, player);
      }
      assert.equal(player.scriptedMovement, false);
      assert.equal(level.portalCinematicActive, false);
      assert.equal(player.group.visible, true);
      assert.equal(player.group.scale.x, 1);
      assert.equal(body.material.opacity, 1);
      assert.equal(body.material.transparent, false);
      assert.equal(player.bodyMesh.visible, !firstPerson);
      assert.equal(player.isFirstPerson, firstPerson);
      assert.deepEqual(player.group.position.toArray(), level.spawnPoint.toArray());
      assert.ok(player.camera.position.z < level.entrancePortal.root.position.z - 2);
      if (!firstPerson) assert.ok(player.camera.position.z > player.group.position.z);
      assert.ok(player.getForwardDirection().z < -0.99);
      assert.deepEqual(boss.position.toArray(), bossPosition.toArray());
      assert.deepEqual(boss.scale.toArray(), bossScale.toArray());
      assert.equal(boss.visible, true);
      assert.equal(level.timeRemaining, 60);
      assert.equal(level.elapsed, 0);
      assert.equal(enemyUpdates, 0);
      level.update(0.25, player);
      assert.equal(level.timeRemaining, 59.75);
      assert.equal(enemyUpdates, 1);
    } finally { f.cleanup(); }
  });
}

test('retry during the desert entrance restores the player and releases portal resources once', () => {
  const f = arrivalFixture(true), { level, player, body } = f;
  try {
    const disposals = new Map();
    level.entrancePortal.root.traverse(node => {
      for (const resource of [node.geometry, node.material].filter(Boolean)) {
        disposals.set(resource, 0);
        resource.addEventListener('dispose', () => disposals.set(resource, disposals.get(resource) + 1));
      }
    });
    level.update(0.6, player);
    level.dispose(); level.dispose();
    assert.equal(player.scriptedMovement, false);
    assert.equal(player.group.visible, true);
    assert.equal(player.group.scale.x, 1);
    assert.equal(player.bodyMesh.visible, false);
    assert.equal(body.material.opacity, 1);
    assert.equal(body.material.transparent, false);
    assert.equal(body.material.depthWrite, true);
    assert.equal(player.group.position.y, 0);
    for (const count of disposals.values()) assert.equal(count, 1);
  } finally { f.cleanup(); }
});

// Use the actual supplied house mesh, without a DOM or texture/image decoder.
function fixture() {
  const base = new URL('../public/assets/models/desert/desert_building/', import.meta.url);
  const gltf = JSON.parse(readFileSync(new URL('scene.gltf', base)));
  const binary = readFileSync(new URL('scene.bin', base));
  const primitive = gltf.meshes[0].primitives[0], geometry = new THREE.BufferGeometry();
  const readAccessor = index => {
    const accessor = gltf.accessors[index], view = gltf.bufferViews[accessor.bufferView];
    const width = { SCALAR: 1, VEC2: 2, VEC3: 3 }[accessor.type];
    const types = { 5126: Float32Array, 5125: Uint32Array, 5123: Uint16Array };
    const ArrayType = types[accessor.componentType];
    const bytes = binary.subarray((view.byteOffset || 0) + (accessor.byteOffset || 0),
      (view.byteOffset || 0) + (accessor.byteOffset || 0) + accessor.count * width * ArrayType.BYTES_PER_ELEMENT);
    return new THREE.BufferAttribute(new ArrayType(Uint8Array.from(bytes).buffer), width);
  };
  for (const [attribute, name] of [['POSITION', 'position'], ['NORMAL', 'normal'], ['TEXCOORD_0', 'uv']]) {
    if (primitive.attributes[attribute] !== undefined) geometry.setAttribute(name, readAccessor(primitive.attributes[attribute]));
  }
  geometry.setIndex(readAccessor(primitive.indices));
  const material = new THREE.MeshStandardMaterial(), root = new THREE.Group();
  const fragments = createHouseFragments(new THREE.Mesh(geometry, material));
  const house = new MudHouse(root, fragments, material, new THREE.Vector3(), 0, null);
  return { house, root, fragments, geometry, cleanup: () => {
    house.dispose(); fragments.forEach(f => f.geometry.dispose()); geometry.dispose(); material.dispose();
  } };
}

test('the kit house keeps its surface triangles and has four clear, separate door exits', () => {
  const f = fixture();
  try {
    const area = geometry => {
      const positions = geometry.getAttribute('position'), indices = geometry.index;
      let sum = 0;
      for (let i = 0; i < (indices?.count || positions.count); i += 3) {
        const vertices = [0, 1, 2].map(k => new THREE.Vector3().fromBufferAttribute(positions, indices ? indices.getX(i + k) : i + k));
        sum += new THREE.Triangle(...vertices).getArea();
      }
      return sum;
    };
    const originalArea = area(f.geometry), fragmentArea = f.fragments.reduce((sum, p) => sum + area(p.geometry), 0);
    assert.ok(Math.abs(originalArea - fragmentArea) / originalArea < 0.0001, 'Fracturing preserves the visible surface');
    assert.equal(f.house.doors.length, 4);
    assert.equal(new Set(f.house.doors.map(d => d.end.toArray().join(','))).size, 4);
    assert.deepEqual(f.house.doors.map(d => d.delay), [0, 0.5, 1, 1.5]);
    f.root.updateMatrixWorld(true);
    for (const door of f.house.doors) {
      const origin = door.start.clone().add(new THREE.Vector3(0, 1, 0));
      const ray = new THREE.Raycaster(origin, door.direction, 0.01, door.start.distanceTo(door.end));
      assert.equal(ray.intersectObjects(f.house.shootableMeshes, false).length, 0, `Door ${door.index} must be an actual opening`);
    }
  } finally { f.cleanup(); }
});

test('house damage sheds sections progressively and collapses once into lasting rubble', () => {
  const f = fixture();
  try {
    const h = f.house, counts = [];
    for (let stage = 1; stage <= 3; stage++) {
      assert.equal(h.takeDamage(25), false);
      assert.equal(h.health, 100 - 25 * stage); assert.equal(h.damageStage, stage);
      counts.push(h.pieces.filter(p => p.detached).length);
      assert.ok(h.bursts.length > 0); assert.ok(h.debris.length > 0);
    }
    assert.ok(counts[0] > 0 && counts[1] > counts[0] && counts[2] > counts[1]);
    assert.equal(h.takeDamage(25), true); assert.equal(h.alive, false);
    assert.equal(h.shootableMeshes.length, 0); assert.equal(h.takeDamage(15), false);
    for (let i = 0; i < 300; i++) h.update(1 / 60);
    assert.equal(h.bursts.length, 0); assert.equal(h.debris.length, 0);
    assert.ok(h.pieces.every(p => p.detached && p.mesh.position.y < 0.5));
    assert.ok(h.pieces.every(p => p.mesh.parent === h.root && p.mesh.visible), 'Rubble persists');
  } finally { f.cleanup(); }
});

test('each door releases one zombie along the doorway before normal combat; destruction preserves survivors', () => {
  const f = fixture(), level = new Level3(new THREE.Scene());
  try {
    level.houses = [f.house]; level.navigation = new ArenaNavigation([]);
    const records = f.house.doors.map(door => ({ house: f.house, door, phase: 'waiting', progress: 0,
      zombie: { alive: true, group: new THREE.Group(), _playAction() {}, update() { return { hit: false }; }, speed: 2 }, route: [], routeTime: 0 }));
    const player = { group: { position: new THREE.Vector3(0, 0, 20) }, takeDamage() {} };
    level.elapsed = 1.1;
    records.forEach(record => level._updateZombie(record, 0.1, player));
    assert.deepEqual(records.map(r => r.phase), ['exiting', 'waiting', 'waiting', 'waiting']);
    const first = records[0];
    assert.ok(first.zombie.group.position.distanceTo(first.door.start) > 0);
    assert.ok(first.zombie.group.position.distanceTo(first.door.end) > 2);
    f.house.takeDamage(100);
    records.forEach(record => level._updateZombie(record, 0.1, player));
    assert.ok(records.every(r => r.phase === 'exiting' && r.zombie.alive));
    for (let i = 0; i < 130; i++) for (const record of records) level._updateZombie(record, 1 / 60, player);
    assert.ok(records.every(r => r.phase === 'hunting'));
    assert.equal(records.length, 4);
  } finally { level.houses = []; level.dispose(); f.cleanup(); }
});

test('kills spawn four from the original hut once per death, until that hut is destroyed', async t => {
  t.mock.method(Zombie.prototype, '_loadModel', async function () { this._loaded = true; });
  const level = new Level3(new THREE.Scene());
  const makeHouse = index => ({ index, alive: true, update() {}, dispose() {},
    doors: Array.from({ length: 4 }, (_, i) => ({ index: i, delay: i * 0.5,
      start: new THREE.Vector3(index * 20, 0, 0), end: new THREE.Vector3(index * 20, 0, 5),
      direction: new THREE.Vector3(0, 0, 1) })) });
  level.houses = [makeHouse(0), makeHouse(1)];
  level.navigation = new ArenaNavigation([]);
  const player = { group: { position: new THREE.Vector3(0, 0, 30) }, takeDamage() {} };
  try {
    level._createSpawns();
    await Promise.all(level.zombies.map(zombie => zombie.ready));
    level.elapsed = 10;
    const original = level.spawnRecords[0];
    original.zombie.takeDamage(15);
    level.update(0.1, player);
    assert.equal(level.zombies.length, 8, 'Nonlethal damage does not spawn a wave');
    original.zombie.takeDamage(15);
    level.update(0.1, player);
    const wave = level.spawnRecords.slice(8);
    assert.equal(wave.length, 4);
    assert.ok(wave.every(record => record.house === original.house));
    assert.equal(new Set(wave.map(record => record.door)).size, 4);
    assert.deepEqual(wave.map(record => record.phase), ['exiting', 'waiting', 'waiting', 'waiting']);
    level.update(0.1, player);
    assert.equal(level.zombies.length, 12, 'A corpse cannot repeatedly spawn waves');
    wave[0].zombie.takeDamage(30);
    level.update(0.1, player);
    assert.equal(level.zombies.length, 16, 'Replacements also produce four zombies');
    assert.ok(level.spawnRecords.slice(12).every(record => record.house === original.house));
    original.house.alive = false;
    wave[1].zombie.takeDamage(30);
    level.update(0.1, player);
    assert.equal(level.zombies.length, 16, 'Destroyed huts cannot reinforce');
    assert.ok(wave[2].zombie.alive, 'Destroying the hut preserves existing survivors');
    level.spawnRecords[4].zombie.takeDamage(30);
    level.update(0.1, player);
    assert.equal(level.zombies.length, 20, 'Other standing huts still reinforce');
    assert.ok(level.spawnRecords.slice(16).every(record => record.house === level.houses[1]));
  } finally { level.dispose(); }
  assert.equal(level.spawnRecords.length, 0);
  assert.equal(level.zombies.length, 0);
});

test('navigation reaches the player around multiple houses with no segment through a wall', () => {
  const nav = new ArenaNavigation([{ x: 0, z: 0, radius: 4.45 }, { x: 8, z: 11, radius: 4.45 }]);
  for (const start of [{ x: 0, z: -9 }, { x: -8, z: -5 }, { x: 15, z: -5 }]) {
    const goal = { x: 8, z: 24 }, route = nav.route(start, goal);
    assert.ok(route.length > 1); assert.deepEqual(route.at(-1), goal);
    let previous = start;
    for (const point of route) { assert.ok(nav.clear(previous, point)); previous = point; }
  }
});

test('nearest bullet hit damages a house, blocks the zombie behind it, and cannot award destruction twice', () => {
  const f = fixture(), level = new Level3(new THREE.Scene());
  try {
    level.houses = [f.house]; level.navigation = new ArenaNavigation(level.getObstacles());
    const dummy = new THREE.Mesh(new THREE.BoxGeometry(1, 2, 1), new THREE.MeshBasicMaterial());
    dummy.position.set(1.4, 1, -7); level.scene.add(dummy); level.scene.add(f.root);
    let zombieHits = 0, score = 0;
    level.zombies = [{ alive: true, group: dummy, takeDamage() { zombieHits++; return false; } }];
    const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
    camera.position.set(1.4, 1.7, 12); camera.lookAt(1.4, 1.7, 0); camera.updateMatrixWorld(true);
    const combat = new WeaponCombat(level.scene);
    const fakeGame = { currentLevel: level, scene: level.scene, camera, combat,
      input: { isMouseButtonDown: () => true, pointerLocked: true }, player: { camera, alive: true, ammo: 30, maxAmmo: 120, bashTime: 0,
        getMuzzleWorldPosition: () => camera.position.clone(), addScore(value) { score += value; } },
      _getShotTargets: Game.prototype._getShotTargets };
    for (let i = 0; i < 7; i++) Game.prototype._handleShooting.call(fakeGame, 0.3);
    assert.equal(f.house.health, 0); assert.equal(score, 400); assert.equal(zombieHits, 0);
    Game.prototype._handleShooting.call(fakeGame, 0.3); assert.equal(score, 400);
    assert.equal(zombieHits, 1, 'The zombie becomes exposed after the house collapses');
    assert.equal(level.getObstacles().length, 0);
    assert.equal(level.getTargetStatus().destroyed, true);
    combat.dispose(); dummy.geometry.dispose(); dummy.material.dispose(); dummy.removeFromParent();
  } finally { level.zombies = []; level.houses = []; level.dispose(); f.cleanup(); }
});

test('one-minute timer triggers a laugh before burning the degree, then a retry only after the animation', () => {
  const scene = new THREE.Scene(), level = new Level3(scene), manager = new LevelManager(scene);
  try {
    assert.equal(manager._getLevelClass(2), Level3); assert.equal(manager.totalLevels, 3);
    level.houses = [{ alive: true, update() {}, dispose() {} }];
    assert.equal(level.timeRemaining, FINAL_ENCOUNTER_SECONDS); assert.equal(level.getChallengeStatus().timer, '01:00');
    const player = { alive: true };
    level.update(29.5, player); assert.equal(level.getChallengeStatus().timer, '00:31');
    const event = level.update(30.5, player);
    assert.equal(level.getChallengeStatus().timer, '00:00'); assert.equal(level.timerExpired, true);
    assert.equal(level.levelComplete, false); assert.equal(event.levelComplete, false); assert.equal(player.alive, true);
    assert.equal(level.degreeBurn.phase, 'laugh'); assert.equal(level.degreeBurn.effects.progress, 0);
    assert.equal(level.getRestartState(), null, 'A timeout does not award the cleared-arena checkpoint');
    level.update(DEGREE_BURN_TIMING.laughEnd - 0.1, player);
    assert.equal(level.degreeBurn.phase, 'raise'); assert.equal(level.degreeBurn.effects.progress, 0);
    level.update(1.5, player);
    assert.equal(level.degreeBurn.phase, 'burn'); assert.ok(level.degreeBurn.effects.progress > 0);
    assert.equal(player.alive, true, 'The game-over screen must not interrupt the burn');
    level.update(5, player);
    assert.equal(level.degreeBurn.done, true); assert.equal(player.alive, false);
    assert.equal(level.degreeScroll.visible, false); assert.match(level.failureReason, /burned your degree/);
    const retry = new Level3(scene); assert.equal(retry.timeRemaining, 60); retry.dispose();
  } finally { level.dispose(); }
});

function degreeBurnFixture() {
  const base = new URL('../public/assets/models/zombies/', import.meta.url);
  const asset = JSON.parse(readFileSync(new URL('Zombie_Arm.gltf', base)));
  const buffers = asset.buffers.map(buffer => buffer.uri.startsWith('data:')
    ? Buffer.from(buffer.uri.split(',')[1], 'base64') : readFileSync(new URL(buffer.uri, base)));
  const nodes = asset.nodes.map(node => {
    const group = new THREE.Group(); group.name = THREE.PropertyBinding.sanitizeNodeName(node.name || '');
    if (node.translation) group.position.fromArray(node.translation);
    if (node.rotation) group.quaternion.fromArray(node.rotation);
    if (node.scale) group.scale.fromArray(node.scale);
    return group;
  });
  asset.nodes.forEach((node, index) => node.children?.forEach(child => nodes[index].add(nodes[child])));
  const idle = asset.animations.find(animation => animation.name === 'Idle');
  for (const channel of idle.channels) {
    const sampler = idle.samplers[channel.sampler], accessor = asset.accessors[sampler.output];
    const view = asset.bufferViews[accessor.bufferView], bytes = buffers[view.buffer];
    const offset = (view.byteOffset || 0) + (accessor.byteOffset || 0);
    const width = channel.target.path === 'rotation' ? 4 : 3;
    const values = Array.from({ length: width }, (_, index) => bytes.readFloatLE(offset + index * 4));
    const target = nodes[channel.target.node];
    if (channel.target.path === 'rotation') target.quaternion.fromArray(values);
    else if (channel.target.path === 'translation') target.position.fromArray(values);
    else if (channel.target.path === 'scale') target.scale.fromArray(values);
  }
  const scene = new THREE.Scene(), level = new Level3(scene), boss = new THREE.Group();
  boss.position.set(0, 1.2, -37); boss.scale.setScalar(1.6);
  asset.scenes[asset.scene].nodes.forEach(index => boss.add(nodes[index])); level.root.add(boss);
  level.bossMarker = boss; level.dean = { group: boss, _playAction() {}, dispose() {} };
  level._attachDegree(); level.houses = [{ alive: true, update() {}, dispose() {} }];
  const input = { isDown: () => false, consumeKeyPress: () => false, flushMouseDelta() {} };
  const player = new Player(scene, input, new THREE.PerspectiveCamera(60, 1.5, 0.1, 500));
  player.toggleCamera(); player.group.position.z = 31;
  return { level, player, cleanup() { level.dispose(); player.dispose(); } };
}

test('degree burn raises the degree above the actual Dean head, ignites itself and consumes it with localized fire and ash', () => {
  const f = degreeBurnFixture(), { level, player } = f;
  try {
    level.timeRemaining = 0.01; level.update(0.02, player);
    const burn = level.degreeBurn;
    const rightArm = level.bossMarker.getObjectByName(THREE.PropertyBinding.sanitizeNodeName('UpperArm.R'));
    const rightArmRest = rightArm.quaternion.clone();
    assert.equal(player.scriptedMovement, true); assert.equal(level.degreeBurnCinematicActive, true);
    assert.equal(level.allowsShooting, false);
    level.update(DEGREE_BURN_TIMING.raiseEnd - 0.01, player);
    assert.equal(burn.effects.progress, 0, 'The paper stays intact until the raised hand settles');
    assert.equal(burn.phase, 'raise');
    const head = level.bossMarker.getObjectByName('Head').getWorldPosition(new THREE.Vector3());
    const heldDegree = level.degreeScroll.getWorldPosition(new THREE.Vector3());
    assert.ok(heldDegree.y > head.y + 0.1, 'The degree is held visibly above his head');
    assert.ok(rightArm.quaternion.equals(rightArmRest), 'The free arm stays relaxed');
    assert.equal(level.root.getObjectByName('DeanDegreeLighter'), undefined);
    level.update(DEGREE_BURN_TIMING.ignite + 0.02 - burn.time, player);
    level.update(0.6, player);
    assert.ok(burn.effects.progress > 0 && burn.effects.progress < 1);
    assert.ok(burn.effects.light.intensity > 0);
    assert.ok(burn.effects.light.position.distanceTo(burn.effects.edgePosition().add(new THREE.Vector3(0, 0.08, 0))) < 1e-6);
    const screen = burn.effects.flame.position.clone().project(player.camera);
    assert.ok(Math.abs(screen.x) < 0.9 && Math.abs(screen.y) < 0.9, 'The actual burn remains clearly visible in the shot');
    assert.ok(burn.effects.life.some(life => life > 0), 'The burn sheds visible ash and embers');
    const shader = { uniforms: {}, vertexShader: THREE.ShaderLib.standard.vertexShader, fragmentShader: THREE.ShaderLib.standard.fragmentShader };
    [...burn.effects.materials.values()][0].onBeforeCompile(shader);
    assert.equal(shader.uniforms.burnProgress, burn.effects.uniforms.burnProgress);
    assert.ok(shader.fragmentShader.includes('burnDistance<0.)discard'), 'The paper is consumed rather than just tinted black');
    level.update(DEGREE_BURN_TIMING.consumed - burn.time + 0.1, player);
    assert.equal(level.degreeScroll.visible, false); assert.equal(player.alive, true);
    assert.equal(burn.phase, 'ash'); assert.equal(burn.effects.light.intensity, 0);
    level.update(1, player);
    assert.equal(player.alive, false); assert.equal(player.scriptedMovement, false);
  } finally { f.cleanup(); }
});

test('clearing the arena saves a checkpoint that restores rubble and skips the timed phase and portal on retry', () => {
  const f = fixture(), restored = fixture(), scene = new THREE.Scene(), level = new Level3(scene);
  const player = new Player(scene, { isDown: () => false, flushMouseDelta() {} }, new THREE.PerspectiveCamera());
  let retry;
  try {
    level.houses = [f.house];
    level.timeRemaining = 12; level.update(0.5, player);
    assert.equal(level.getRestartState(), null);
    f.house.takeDamage(100); level.update(0.1, player);
    const checkpoint = level.getRestartState();
    assert.equal(checkpoint.arenaCleared, true); assert.equal(checkpoint.timeRemaining, 11.5);
    level.update(100, player);
    assert.equal(level.timeRemaining, 11.5); assert.equal(level.degreeBurn, null);
    retry = new Level3(scene, checkpoint); retry.houses = [restored.house];
    retry._restoreClearedArena(); retry._createSpawns(); retry._createEntrancePortal(); retry.preparePlayer(player);
    assert.equal(retry.zombies.length, 0); assert.ok(retry.houses.every(house => !house.alive));
    assert.equal(retry.arrivalPlayer, undefined); assert.equal(player.scriptedMovement, false);
    assert.deepEqual(player.group.position.toArray(), [0, 0, 8]); assert.equal(player.ammo, 45);
    assert.equal(retry.entrancePortal.root.position.z, 38.5);
    retry.update(100, player); assert.equal(retry.degreeBurn, null);
    assert.equal(retry.getRestartState().arenaCleared, true);
  } finally { if (retry) { retry.houses = []; retry.dispose(); } level.houses = []; level.dispose(); player.dispose(); f.cleanup(); restored.cleanup(); }
});

test('disposing a degree burn during ignition restores control and disposes its temporary effects exactly once', () => {
  const f = degreeBurnFixture();
  try {
    f.level.timeRemaining = 0; f.level.update(0, f.player); f.level.update(DEGREE_BURN_TIMING.ignite + 0.35, f.player);
    const burn = f.level.degreeBurn, disposals = new Map();
    for (const resource of [burn.effects.flameGeometry, burn.effects.particleGeometry, burn.effects.flameMaterial,
      ...burn.effects.materials.values()]) {
      disposals.set(resource, 0); resource.addEventListener('dispose', () => disposals.set(resource, disposals.get(resource) + 1));
    }
    const time = burn.time; f.level.pauseEffects();
    assert.equal(burn.time, time, 'Pause does not advance the laugh or fire');
    f.level.dispose(); f.level.dispose();
    assert.equal(f.player.scriptedMovement, false); assert.equal(f.player.isFirstPerson, true);
    assert.equal(burn.effects.root.parent, null);
    for (const count of disposals.values()) assert.equal(count, 1);
  } finally { f.cleanup(); }
});

test('laugh cutscene prepares arm poses and shaders during loading and plays without extra shadow passes or repeated arm solving', async () => {
  const f = degreeBurnFixture();
  try {
    f.level.laughClip = { buffer: { duration: 2.4 }, envelopeStep: 0.1,
      envelope: new Float32Array([0, 1, 0.25, 0, 0.8, 0.2, 0, 1, 0.1, 0, 0.9, 0.1, 0, 0.8, 0.1, 0, 1, 0.1, 0, 0.9, 0.1, 0, 0.5, 0]) };
    const compiled = [];
    await f.level.prepareCinematics({ async compileAsync() {
      compiled.push(f.level.preparedDegreeBurn.effects.root.visible);
    } }, f.player.camera);
    const prepared = f.level.preparedDegreeBurn;
    assert.deepEqual(compiled, [true, false], 'Fire and normal lighting shaders are prepared before gameplay');
    assert.equal(prepared.effects.root.visible, false);
    assert.equal(prepared.effects.light.castShadow, false, 'The fire does not render six new shadow views');
    prepared._reach = () => assert.fail('Playback must not rerun the inverse-kinematics solver');
    let mixerUpdates = 0;
    f.level.dean.mixer = { update() { mixerUpdates++; } };
    f.level.timeRemaining = 0; f.level.update(0, f.player);
    assert.equal(f.level.degreeBurn, prepared, 'Starting the cutscene reuses its prepared effects and poses');
    const updatesAtStart = mixerUpdates;
    const torso = f.level.bossMarker.getObjectByName('Torso');
    const shoulder = f.level.bossMarker.getObjectByName(THREE.PropertyBinding.sanitizeNodeName('Shoulder.R'));
    let minChest = Infinity, maxChest = -Infinity, minShoulder = Infinity, maxShoulder = -Infinity;
    for (let frame = 0; frame < 300; frame++) {
      f.level.update(1 / 60, f.player);
      if (f.level.degreeBurn.time < 1.3) {
        minChest = Math.min(minChest, torso.position.y); maxChest = Math.max(maxChest, torso.position.y);
        minShoulder = Math.min(minShoulder, shoulder.position.y); maxShoulder = Math.max(maxShoulder, shoulder.position.y);
        assert.ok(f.player.camera.position.distanceTo(new THREE.Vector3(2.8, 3, -33.4)) < 1e-6,
          'The camera holds steady while the body laughs');
      }
    }
    assert.ok(maxChest - minChest > 0.02, 'The chest visibly follows the laugh pulses');
    assert.ok(maxShoulder - minShoulder > 0.01, 'The shoulders visibly rise and settle with the laugh');
    assert.equal(mixerUpdates, updatesAtStart, 'The idle mixer does not overwrite the laugh pose every frame');
  } finally { f.cleanup(); }
});

test('supplied laugh plays unchanged for its decoded duration, follows the audio clock, and resumes at the paused sample', async t => {
  const original = readFileSync(new URL('../Zombie_Kit/Sounds/Cod zombies _ evil laugh [qfidRRBhFb4].mp3', import.meta.url));
  const served = readFileSync(new URL('../public/assets/audio/dean-laugh.mp3', import.meta.url));
  assert.deepEqual(served, original, 'The supplied recording must be copied without editing or recompression');
  const samples = new Float32Array(2425); samples.fill(0.5, 0, 800); samples.fill(0.25, 1000, 2000);
  const buffer = { duration: 2.425, sampleRate: 1000, length: samples.length, numberOfChannels: 1,
    getChannelData() { return samples; } };
  const sources = [], context = { state: 'running', currentTime: 0, sampleRate: 1000, destination: {},
    async decodeAudioData(bytes) { assert.deepEqual(Buffer.from(bytes), served); return buffer; },
    createBufferSource() {
      const source = { playbackRate: { value: 0 }, connect() {}, disconnect() {},
        start(when, offset) { this.when = when; this.offset = offset; },
        stop() { this.stopped = true; this.onended?.(); } };
      sources.push(source); return source;
    },
    createGain() { return { gain: { value: 0, setValueAtTime(value) { this.value = value; } }, connect() {}, disconnect() {} }; } };
  context.createBuffer = (channels, length, sampleRate) => {
    const data = new Float32Array(length);
    return { duration: length / sampleRate, getChannelData() { return data; } };
  };
  t.mock.method(globalThis, 'fetch', async url => {
    assert.equal(url, './assets/audio/dean-laugh.mp3');
    return { ok: true, async arrayBuffer() { return served.buffer.slice(served.byteOffset, served.byteOffset + served.byteLength); } };
  });
  const f = degreeBurnFixture();
  try {
    f.level.audioContext = context; await f.level.prepareAudio();
    f.level.timeRemaining = 0; f.level.update(0, f.player);
    const burn = f.level.degreeBurn;
    assert.equal(burn.timing.laughEnd, buffer.duration);
    assert.equal(sources[0].buffer, buffer); assert.equal(sources[0].playbackRate.value, 1);
    assert.equal(sources[0].loop, false); assert.equal(sources[0].offset, 0);
    context.currentTime = 1; f.level.update(0.01, f.player);
    assert.equal(burn.time, 1, 'Frame-rate caps do not slow the laugh animation relative to the recording');
    assert.equal(burn.phase, 'laugh'); assert.equal(burn.effects.progress, 0);
    context.currentTime = 1.125; f.level.pauseEffects();
    assert.equal(burn.time, 1.125); assert.equal(sources[0].stopped, true);
    context.currentTime = 50; f.level.update(0, f.player);
    assert.equal(sources.length, 2); assert.equal(sources[1].offset, 1.125);
    context.currentTime = 50 + (buffer.duration - 1.125) - 0.001; f.level.update(0.01, f.player);
    assert.equal(burn.phase, 'raise', 'The hand starts lifting during the last second of the recording');
    assert.ok(f.level.degreeScroll.getWorldPosition(new THREE.Vector3()).y > burn.scrollRest.y + 0.5);
    assert.equal(sources.length, 2, 'Burning audio must not overlap the laugh');
    context.currentTime += 0.001001; f.level.update(0.01, f.player);
    assert.equal(burn.time, buffer.duration); assert.equal(burn.phase, 'burn');
    assert.equal(sources.length, 3, 'The first burning sound begins exactly when the laugh finishes');
    assert.notEqual(sources[2].buffer, buffer);
    assert.equal(burn.effects.progress, 0, 'The degree cannot ignite until after the full laugh recording');
    assert.ok(f.level.laughClip.envelope.length > 0, 'Head and shoulder motion uses the actual recording envelope');
  } finally { f.cleanup(); }
});

test('house disposal releases transient resources once without disposing shared kit fragments', () => {
  const f = fixture(); let fragmentDisposals = 0, materialDisposals = 0;
  f.fragments.forEach(p => p.geometry.addEventListener('dispose', () => fragmentDisposals++));
  f.house.material.addEventListener('dispose', () => materialDisposals++);
  f.house.takeDamage(30); f.house.dispose(); f.house.dispose();
  assert.equal(fragmentDisposals, 0); assert.equal(materialDisposals, 1);
  assert.equal(f.root.children.length, 0); f.cleanup();
});
