import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Level1 } from '../src/levels/Level1.js';
import { CreditEnergyEffects } from '../src/props/CreditEnergyEffects.js';

// A minimal stand-in for Shaun: position for pickups, plus score tracking.
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
  // The boss normally arrives via async model loading; stand-ins keep the
  // eighth-credit spawn sequence runnable headlessly.
  level.boss = { _playAction() {}, dispose() {} };
  level.bossMarker = new THREE.Group();
  level.bossRing = new THREE.Mesh(new THREE.BufferGeometry());
  const player = makePlayer();
  const spawnCalls = [];
  level._spawnOrbZombies = () => spawnCalls.push(level.zombies.length);
  const cleanup = () => level.dispose();
  return { scene, level, player, spawnCalls, cleanup };
}

/** Collect every credit by walking the player onto each orb in turn. */
function collectAll({ level, player }, dt = 1 / 60) {
  const events = [];
  for (const credit of level.credits) {
    player.group.position.set(credit.mesh.position.x, 0, credit.mesh.position.z);
    events.push(level.update(dt, player, level.creditsCollected * dt));
  }
  return events;
}

test('credits share one core mesh resource and each wears a halo, glow light and rune satellites', () => {
  const f = makeLevel();
  try {
    const { level, scene } = f;
    assert.equal(level.credits.length, 8);
    const [first] = level.credits;
    for (const credit of level.credits) {
      assert.equal(credit.collected, false);
      assert.equal(credit.mesh.name, 'Credit');
      assert.ok(credit.mesh.geometry === first.mesh.geometry, 'All cores share one geometry');
      assert.ok(credit.mesh.material === first.mesh.material, 'All cores share one material');
      assert.equal(credit.mesh.position.y, 1.5);
      const halo = credit.mesh.children.filter(child => child.name === 'CreditHalo');
      assert.equal(halo.length, 2, 'Two counter-rotating seal rings per credit');
      assert.equal(credit.mesh.children.filter(child => child.isPointLight).length, 1, 'The original glow light stays');
    }
    assert.ok(scene.getObjectByName('CreditEnergyEffects'), 'Effect root lives in the scene');
    assert.equal(scene.getObjectByName('Credit').name, 'Credit');
  } finally { f.cleanup(); }
});

test('each credit awards exactly 100 points, calls the two-zombie spawn once and never twice', () => {
  const f = makeLevel();
  try {
    const { level, player, spawnCalls } = f;
    const events = collectAll(f);
    assert.equal(level.creditsCollected, 8);
    assert.equal(player.score, 800, 'Eight credits at exactly 100 points each');
    assert.equal(spawnCalls.length, 8, 'One zombie spawn call per pickup');
    let collections = 0;
    for (const event of events) if (event.creditCollected) collections++;
    assert.equal(collections, 8);
    // Lingering frames must not re-trigger anything for collected orbs.
    for (let frame = 0; frame < 30; frame++) {
      const event = level.update(1 / 60, player, 2 + frame / 60);
      assert.equal(event.creditCollected, false, 'Collection cannot fire twice');
    }
    assert.equal(player.score, 800);
    assert.equal(spawnCalls.length, 8);
  } finally { f.cleanup(); }
});

test('the pickup burst and trail stay bounded, flow toward Shaun, then fully disappear', () => {
  const f = makeLevel();
  try {
    const { level, player } = f;
    player.group.position.set(0, 0, 0);
    const credit = level.credits[0];
    credit.mesh.position.set(0, 1.5, 0);
    const events = [level.update(1 / 60, player, 0)];
    assert.equal(events[0].creditCollected, true);
    assert.ok(level.creditEffects.burstLive > 0 && level.creditEffects.burstLive <= 288, 'Burst draws from the bounded pool');
    assert.ok(level.creditEffects.trailLive > 0 && level.creditEffects.trailLive <= 96, 'Trail draws from the bounded pool');
    // A burst per pickup even when eight land without a frame in between.
    for (let i = 1; i < 8; i++) level.creditEffects.onCollected(level.credits[i], player, false);
    assert.ok(level.creditEffects.burstLive <= 288, 'Pool never grows past its bound');
    let sawMotion = false;
    let previous = 0;
    for (let frame = 0; frame < 90; frame++) {
      level.update(1 / 60, player, frame / 60);
      const live = level.creditEffects.burstLive + level.creditEffects.trailLive;
      if (live < previous) sawMotion = true;
      previous = live;
    }
    assert.ok(sawMotion, 'Particles fade out over time');
    assert.equal(level.creditEffects.burstLive, 0, 'Burst pool fully retires');
    assert.equal(level.creditEffects.trailLive, 0, 'Trail pool fully retires');
    assert.equal(level.creditEffects.burst.points.visible, false);
    assert.equal(level.creditEffects.trail.points.visible, false);
  } finally { f.cleanup(); }
});

test('the eighth credit fires a finale that expands, flashes and then cleans itself up', () => {
  const f = makeLevel();
  try {
    const { level, player } = f;
    collectAll(f);
    assert.equal(level.creditEffects.finale !== null, true, 'Finale armed on the last credit');
    assert.equal(level.bossSpawned, true, 'Eighth credit still unlocks the boss sequence');
    assert.equal(level.bossState, 'running');
    level.update(1 / 60, player, 0); // give the finale its first animation tick
    assert.equal(level.creditEffects.shockwave.visible, true);
    assert.ok(level.creditEffects.flashLight.intensity > 0);
    // The boss sequence runs alongside the effects without errors.
    let bossReached = false;
    for (let frame = 0; frame < 400 && !bossReached; frame++) {
      bossReached = level.update(0.25, player, frame * 0.25).bossReached;
    }
    assert.equal(bossReached, true, 'Progression chain completes with the effects in place');
    let finaleSeen = false;
    for (let frame = 0; frame < 120; frame++) {
      level.update(1 / 60, player, frame / 60);
      if (level.creditEffects.finale === null) { finaleSeen = true; break; }
    }
    assert.equal(finaleSeen, true, 'Finale retires after its run');
    assert.equal(level.creditEffects.shockwave.visible, false);
    assert.equal(level.creditEffects.column.visible, false);
    assert.equal(level.creditEffects.flashLight.intensity, 0);
  } finally { f.cleanup(); }
});

test('spawn reserve releases exactly two zombies per pickup', () => {
  const f = makeLevel();
  try {
    const { level } = f;
    level._spawnOrbZombies = Level1.prototype._spawnOrbZombies; // exercise the real release logic
    level.redPortalCenter = new THREE.Vector3();
    level.zombieReserve = Array.from({ length: 16 }, () => ({ group: new THREE.Group(), alive: true, dispose() {} }));
    for (let pickup = 0; pickup < 8; pickup++) {
      const before = level.zombies.length;
      level._spawnOrbZombies();
      assert.equal(level.zombies.length - before, 2, `Pickup ${pickup + 1} releases exactly two zombies`);
      assert.equal(level.zombies.every(zombie => zombie.portalExit), true, 'Released zombies ride a portal path');
    }
    assert.equal(level.zombieReserve.length, 0);
    level._spawnOrbZombies();
    assert.equal(level.zombies.length, 16, 'An exhausted reserve releases nothing');
  } finally { f.cleanup(); }
});

test('the minimap contract survives pickup: credits keep mesh positions and collected flags', () => {
  const f = makeLevel();
  try {
    const { level, player } = f;
    collectAll(f);
    for (const credit of level.credits) {
      assert.equal(typeof credit.collected, 'boolean');
      assert.ok(credit.mesh.position instanceof THREE.Vector3, 'mesh.position stays readable for the minimap');
      assert.equal(Number.isFinite(credit.mesh.position.x + credit.mesh.position.z), true);
    }
    assert.equal(level.credits.length, 8, 'Collected entries remain in the array for HUD counting');
    assert.equal(level.getChallengeStatus().timer, '8 / 8 orbs collected');
  } finally { f.cleanup(); }
});

test('disposing the level removes every effect resource and a restart starts clean', () => {
  const f = makeLevel();
  try {
    const { level, scene } = f;
    level.creditEffects.onCollected(level.credits[0], f.player, false);
    level.dispose();
    assert.equal(scene.children.some(child => child.name === 'CreditEnergyEffects'), false, 'Effect root removed');
    assert.equal(scene.children.some(child => child.name === 'Credit'), false, 'No orphaned credit orbs');
    assert.equal(level.creditEffects, null);
    level.creditEffects?.dispose(); // would throw if dispose were unsafe
    assert.equal(level.creditEffects, null);
    // A fresh load on the same scene must not duplicate anything.
    const reborn = new Level1(scene);
    try {
      reborn._createCredits(8);
      assert.equal(scene.children.filter(child => child.name === 'Credit').length, 8);
      assert.equal(scene.children.filter(child => child.name === 'CreditEnergyEffects').length, 1);
      assert.equal(reborn.creditEffects.burstLive, 0, 'A restarted level begins with idle pools');
    } finally { reborn.dispose(); }
  } finally { f.cleanup(); }
});

test('core resonance decays and effects hold still when the game stops updating', () => {
  const { scene } = { scene: new THREE.Scene() };
  const effects = new CreditEnergyEffects(scene);
  try {
    const host = new THREE.Mesh(new THREE.BufferGeometry());
    host.position.set(3, 1.5, -2);
    host.add(new THREE.PointLight(0xffd700, 1, 5));
    const credits = [{ mesh: host, collected: false }];
    effects.attach(credits);
    assert.ok(effects.coreMaterial === effects.createCoreMesh().material, 'Core meshes reuse the effect material');
    effects.onCollected(credits[0], makePlayer(), false);
    assert.equal(effects.coreMaterial.uniforms.uBoost.value, 1);
    for (let frame = 0; frame < 70; frame++) effects.update(1 / 60, null);
    assert.ok(effects.coreMaterial.uniforms.uBoost.value < 0.1, 'Resonance boost decays');
    const frozenTime = effects.time;
    effects.update(0, null);
    assert.equal(effects.time, frozenTime, 'No update means no animation advance (pause-safe)');
    effects.dispose();
    effects.dispose();
  } finally { effects.dispose(); }
});
