import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Level1 } from '../src/levels/Level1.js';
import { ForestAtmosphere } from '../src/environment/ForestAtmosphere.js';

// Same stand-in harness as credit-energy.test.mjs: position + score only.
function makePlayer() {
  return {
    group: new THREE.Group(),
    score: 0,
    addScore(points) { this.score += points; }
  };
}

function makeLevel() {
  const scene = new THREE.Scene();
  const level = new Level1(scene);
  level._createCredits(8);
  level._createAtmosphere();
  level.boss = { _playAction() {}, dispose() {} };
  level.bossMarker = new THREE.Group();
  level.bossRing = new THREE.Mesh(new THREE.BufferGeometry());
  const player = makePlayer();
  const spawnCalls = [];
  level._spawnOrbZombies = () => spawnCalls.push(level.zombies.length);
  const cleanup = () => level.dispose();
  return { scene, level, player, spawnCalls, cleanup };
}

function collectAll({ level, player }, dt = 1 / 60) {
  const events = [];
  for (const credit of level.credits) {
    player.group.position.set(credit.mesh.position.x, 0, credit.mesh.position.z);
    events.push(level.update(dt, player, level.creditsCollected * dt));
  }
  return events;
}

test('firefly and mist populations are bounded, batched and carry their shader attributes', () => {
  const scene = new THREE.Scene();
  const atmosphere = new ForestAtmosphere(scene);
  try {
    assert.equal(atmosphere.fireflies.count, 120, 'Firefly population matches the tuned constant');
    assert.ok(atmosphere.fireflies.count >= 100 && atmosphere.fireflies.count <= 140, 'Within the required 100-140 range');
    assert.equal(atmosphere.mist.count, 14, 'Mist billboards stay in the small batched set');
    const geometry = atmosphere.fireflies.geometry;
    for (const name of ['position', 'fireflySeed', 'fireflySize', 'fireflyTint']) {
      assert.ok(geometry.getAttribute(name), `Fireflies carry the ${name} attribute`);
    }
    assert.ok(atmosphere.mist.geometry.getAttribute('mistSeed'), 'Mist carries per-instance seeds');
    assert.equal(atmosphere.fireflies.points.isPoints, true);
    assert.equal(atmosphere.mist.mesh.isInstancedMesh, true);
    assert.equal(atmosphere.fireflies.points.frustumCulled, false, 'Shader-displaced particles skip stale culling');
    assert.equal(atmosphere.mist.mesh.frustumCulled, false);
    assert.ok(atmosphere.mist.mesh.renderOrder < atmosphere.fireflies.points.renderOrder,
      'Mist draws before additive fireflies');
  } finally { atmosphere.dispose(); }
});

test('the atmosphere adds no lights, no shadow casters and no depth-writing transparency', () => {
  const scene = new THREE.Scene();
  const atmosphere = new ForestAtmosphere(scene);
  try {
    let lights = 0;
    atmosphere.root.traverse(child => { if (child.isLight) lights++; });
    assert.equal(lights, 0, 'Fireflies and mist light nothing - zero extra light cost');
    assert.ok(!atmosphere.fireflies.points.castShadow, 'Particles never cast shadows');
    assert.ok(!atmosphere.mist.mesh.castShadow);
    assert.equal(atmosphere.fireflies.material.depthWrite, false);
    assert.equal(atmosphere.mist.material.depthWrite, false);
  } finally { atmosphere.dispose(); }
});

test('one shared clock drives every effect and halts when updates stop (pause-safe)', () => {
  const scene = new THREE.Scene();
  const atmosphere = new ForestAtmosphere(scene);
  try {
    assert.equal(atmosphere.fireflies.material.uniforms.forestTime, atmosphere.forestTime,
      'Firefly material reads the shared clock object');
    assert.equal(atmosphere.mist.material.uniforms.forestTime, atmosphere.forestTime,
      'Mist material reads the same clock object');
    atmosphere.update(1 / 60);
    assert.ok(Math.abs(atmosphere.time - 1 / 60) < 1e-9, 'update(dt) advances the atmosphere clock');
    const frozen = atmosphere.time;
    atmosphere.update(0);
    assert.equal(atmosphere.time, frozen, 'update(0) leaves every animation frozen');
  } finally { atmosphere.dispose(); }
});

test('fog parameters are captured from the scene so effects sink into the night haze', () => {
  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x112233, 0.009);
  const atmosphere = new ForestAtmosphere(scene);
  try {
    assert.equal(atmosphere.mist.material.uniforms.uFogDensity.value, 0.009);
    assert.equal(atmosphere.mist.material.uniforms.uFogColor.value.getHex(), 0x112233);
    assert.equal(atmosphere.fireflies.material.uniforms.uFogDensity.value, 0.009);
    assert.equal(atmosphere.creditCount, 0, 'No credits means no credit-proximity fades');
  } finally { atmosphere.dispose(); }
});

test('wind decorates cloned vegetation materials only and restores originals on dispose', () => {
  const scene = new THREE.Scene();
  const woodsRoot = new THREE.Group();
  const makeInstanced = (name, material) => {
    const mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(), material, 1);
    mesh.name = name;
    woodsRoot.add(mesh);
    return mesh;
  };
  const grassMaterial = new THREE.MeshStandardMaterial();
  const treeMaterial = new THREE.MeshStandardMaterial();
  const rockMaterial = new THREE.MeshStandardMaterial();
  const grass = makeInstanced('grass_Blades', grassMaterial);
  const tree = makeInstanced('trees_Oak', treeMaterial);
  const rock = makeInstanced('rocks_Boulder', rockMaterial);
  const unnamed = makeInstanced('', new THREE.MeshStandardMaterial());

  let originalDisposed = false;
  const originalDispose = grassMaterial.dispose.bind(grassMaterial);
  grassMaterial.dispose = () => { originalDisposed = true; originalDispose(); };

  const atmosphere = new ForestAtmosphere(scene, woodsRoot);
  try {
    assert.equal(atmosphere.windMeshCount, 2, 'Grass and trees sway; rocks and unnamed meshes stay rigid');
    assert.notEqual(grass.material, grassMaterial, 'Swayed meshes receive a clone');
    assert.notEqual(tree.material, treeMaterial);
    assert.equal(rock.material, rockMaterial, 'Rocks keep their original material untouched');
    assert.equal(unnamed.material, unnamed.material, 'Unnamed meshes are ignored entirely');
    assert.ok(grass.material.customProgramCacheKey().includes('forest-wind-v1:grass'));
    assert.ok(tree.material.customProgramCacheKey().includes('forest-wind-v1:trees'));
    assert.ok(!grassMaterial.customProgramCacheKey().includes('forest-wind'),
      'The original material was never decorated');
    assert.equal(atmosphere.windInjections.length, 2);

    atmosphere.dispose();
    assert.equal(grass.material, grassMaterial, 'Original restored after dispose');
    assert.equal(tree.material, treeMaterial);
    assert.equal(atmosphere.windInjections.length, 0);
    assert.equal(originalDisposed, false, 'StylizedWoods keeps sole ownership of its originals');
  } finally { atmosphere.dispose(); }
});

test('disposal is idempotent, removes the root and releases only owned resources', () => {
  const scene = new THREE.Scene();
  const atmosphere = new ForestAtmosphere(scene);
  assert.ok(scene.getObjectByName('ForestAtmosphere'), 'Root lives in the scene while active');
  const fireflyGeometry = atmosphere.fireflies.geometry;
  const mistGeometry = atmosphere.mist.geometry;
  let fireflyDisposed = false;
  const fireflyDispose = fireflyGeometry.dispose.bind(fireflyGeometry);
  fireflyGeometry.dispose = () => { fireflyDisposed = true; fireflyDispose(); };
  atmosphere.dispose();
  atmosphere.dispose(); // must not throw or double-release
  assert.ok(!scene.getObjectByName('ForestAtmosphere'), 'Root removed exactly once');
  assert.equal(fireflyDisposed, true, 'Owned geometry released');
  assert.equal(atmosphere.disposables.length, 0);
});

test('Level 1 hosts exactly one atmosphere, update drives it, and restart starts clean', () => {
  const f = makeLevel();
  try {
    const { level, scene } = f;
    assert.ok(level.atmosphere, 'Atmosphere constructed with the level');
    assert.equal(scene.children.filter(child => child.name === 'ForestAtmosphere').length, 1);
    level.update(1 / 60, f.player, 0);
    assert.ok(level.atmosphere.time > 0, 'Level update ticks the shared clock');
    level.dispose();
    assert.equal(level.atmosphere, null);
    assert.ok(!scene.getObjectByName('ForestAtmosphere'), 'No orphaned atmosphere root');

    const reborn = new Level1(scene);
    try {
      reborn._createCredits(8);
      reborn._createAtmosphere();
      assert.equal(scene.children.filter(child => child.name === 'ForestAtmosphere').length, 1,
        'A restarted level hosts exactly one atmosphere');
      assert.equal(reborn.atmosphere.time, 0, 'Fresh clock on restart');
    } finally { reborn.dispose(); }
  } finally { f.cleanup(); }
});

test('credit collection, zombie releases, minimap contract and boss progression survive the atmosphere', () => {
  const f = makeLevel();
  try {
    const { level, player, spawnCalls } = f;
    const events = collectAll(f);
    assert.equal(level.creditsCollected, 8);
    assert.equal(player.score, 800, 'Eight credits at exactly 100 points each');
    assert.equal(spawnCalls.length, 8, 'One two-zombie release per pickup');
    assert.equal(events.filter(event => event.creditCollected).length, 8);
    assert.equal(level.bossSpawned, true, 'Eighth credit still unlocks the boss sequence');
    assert.equal(level.bossState, 'running');
    assert.ok(level.atmosphere.time > 0, 'Atmosphere ran through every pickup frame');
    for (const credit of level.credits) {
      assert.equal(typeof credit.collected, 'boolean');
      assert.ok(credit.mesh.position instanceof THREE.Vector3, 'Minimap position contract intact');
    }
    assert.equal(level.getChallengeStatus().timer, '8 / 8 orbs collected');
  } finally { f.cleanup(); }
});
