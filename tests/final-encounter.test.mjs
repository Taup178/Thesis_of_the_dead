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
      assert.equal(player.group.visible, false);
      assert.ok(level.entrancePortal.light.color.r > level.entrancePortal.light.color.g);
      level.update(0.75, player);
      assert.equal(player.group.visible, true);
      assert.ok(player.group.scale.x > 0 && player.group.scale.x < 1);
      for (let frame = 0; level.arrivalPlayer && frame < 200; frame++) {
        player.update(1 / 60, level.getObstacles(), level.getWorldBounds());
        level.update(1 / 60, player);
      }
      assert.equal(player.scriptedMovement, false);
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
      assert.equal(level.timeRemaining, 150);
      assert.equal(level.elapsed, 0);
      assert.equal(enemyUpdates, 0);
      level.update(0.25, player);
      assert.equal(level.timeRemaining, 149.75);
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

test('timer starts at 2:30, reaches zero without a story failure, and clearing combat does not finish the level', () => {
  const scene = new THREE.Scene(), level = new Level3(scene), manager = new LevelManager(scene);
  try {
    assert.equal(manager._getLevelClass(2), Level3); assert.equal(manager.totalLevels, 3);
    assert.equal(level.timeRemaining, FINAL_ENCOUNTER_SECONDS); assert.equal(level.getChallengeStatus().timer, '02:30');
    const player = { alive: true };
    level.update(89.5, player); assert.equal(level.getChallengeStatus().timer, '01:01');
    const event = level.update(80, player);
    assert.equal(level.getChallengeStatus().timer, '00:00'); assert.equal(level.timerExpired, true);
    assert.equal(level.levelComplete, false); assert.equal(event.levelComplete, false); assert.equal(player.alive, true);
    level.update(20, player); assert.equal(level.timeRemaining, 0);
    const retry = new Level3(scene); assert.equal(retry.timeRemaining, 150); retry.dispose();
  } finally { level.dispose(); }
});

test('house disposal releases transient resources once without disposing shared kit fragments', () => {
  const f = fixture(); let fragmentDisposals = 0, materialDisposals = 0;
  f.fragments.forEach(p => p.geometry.addEventListener('dispose', () => fragmentDisposals++));
  f.house.material.addEventListener('dispose', () => materialDisposals++);
  f.house.takeDamage(30); f.house.dispose(); f.house.dispose();
  assert.equal(fragmentDisposals, 0); assert.equal(materialDisposals, 1);
  assert.equal(f.root.children.length, 0); f.cleanup();
});
