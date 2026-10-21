import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Level3 } from '../src/levels/Level3.js';
import { WeaponCombat } from '../src/player/WeaponCombat.js';
import { monsterFixture } from './helpers/monster-fixture.mjs';
import { VictoryPortals } from '../src/props/VictoryPortals.js';

test('Level 3 selects each boss song and stops music after the degree pickup cutscene', () => {
  const level = new Level3(new THREE.Scene());
  try {
    assert.equal(level.getMusicPhase(), 'arena');
    level.houseEmergenceCuePlayed = true;
    assert.equal(level.getMusicPhase(), 'house-emergence');
    level.bossFight = { phase: 'approach' };
    assert.equal(level.getMusicPhase(), 'dean');
    level.bossFight.phase = 'combat';
    assert.equal(level.getMusicPhase(), 'dean');
    level.bossFight.phase = 'defeated'; level.deanDefeated = true;
    assert.equal(level.getMusicPhase(), 'dean', 'Tar continues through the transformation');
    for (const phase of ['combat', 'dying', 'defeated']) {
      level.monsterFight = { phase };
      assert.equal(level.getMusicPhase(), 'monster', 'Red Moon stays through the degree pickup');
    }
    level.degreeVictory = { done: true };
    assert.equal(level.getMusicPhase(), 'complete', 'portal reveal and choice are silent');
    level.destinyReady = true; level.destinyChoice = 'blue';
    assert.equal(level.getMusicPhase(), 'complete', 'the score never restarts after entering a portal');
  } finally { level.monsterFight = null; level.bossFight = null; level.degreeVictory = null; level.dispose(); }
});

async function levelFixture() {
  const f = await monsterFixture(), level = new Level3(new THREE.Scene());
  level.root.add(f.monster.group);
  level.transformationMonster = f.monster; level.degreeScroll = f.scroll; level.deanDefeated = true;
  level.dean = { group: new THREE.Group(), alive: false };
  level.bossMarker = level.dean.group; level.bossFight = { phase: 'defeated' };
  level.root.add(level.dean.group);
  const meshes = []; f.monster.group.traverse(node => { if (node.isMesh) meshes.push(node); });
  level.transformation = { done: true, swapped: true, degreeCatch: f.degreeCatch,
    monsterMeshes: meshes, monsterObstacle: { x: 0, z: 0, radius: 1.2 }, updates: 0,
    update() { this.updates++; } };
  f.player.bodyMesh = new THREE.Group(); f.player.scriptedMovement = true;
  f.player.velocity = new THREE.Vector3(); f.player.score = 0; f.player.addScore = amount => { f.player.score += amount; };
  f.player._updateCamera = () => { f.player.camera.position.set(0, 2, 18); f.player.camera.lookAt(0, 2, 0); };
  level.allowsShooting = false;
  level.transformationCutscene = { player: f.player, scriptedMovement: false, bodyVisible: true };
  level.victoryPortals = new VictoryPortals(level.root);
  return { ...f, level, clean() { level.destinyPassage?.restore(); level.degreeVictory?.dispose();
    level.victoryPortals?.dispose(); level.monsterFight?.dispose(); f.degreeCatch.dispose(); level.root.removeFromParent(); } };
}

test('Monster combat waits for camera/control restoration and then owns the rig updates', async () => {
  const f = await levelFixture();
  try {
    f.level.update(0.3, f.player); assert.equal(f.level.monsterFight, undefined);
    f.level.update(0.4, f.player);
    assert.equal(f.level.monsterFight.phase, 'combat'); assert.equal(f.player.scriptedMovement, false);
    assert.equal(f.level.allowsShooting, true); assert.equal(f.level.hasUnlimitedAmmo('smg'), true);
    assert.equal(f.level.hasUnlimitedAmmo('pistol'), false);
    const before = f.level.transformation.updates; f.level.update(0.1, f.player);
    assert.equal(f.level.transformation.updates, before, 'cinematic no longer overwrites combat bones or the flying degree');
    assert.deepEqual(f.level.getRestartState(), { transformationPreview: true });
    assert.equal(f.level.getTargetStatus().maxHealth, 600);
    assert.equal(f.level.getChallengeStatus().detail.includes('throw'), false, 'no attack-specific warnings');
    assert.ok(f.level.getObstacles().includes(f.level.monsterFight.obstacle));
  } finally { f.clean(); }
});

test('Level 3 waits for degree collection, celebration, portal reveal and a destiny choice', async () => {
  const f = await levelFixture();
  try {
    f.level.update(0.7, f.player);
    const hit = { object: f.level.transformation.monsterMeshes[0] };
    assert.equal(f.level.handleBulletHit(hit, 100, f.player), true);
    assert.equal(f.level.monsterFight.health, 500);
    assert.equal(f.level.handleMeleeHit(f.level.monsterFight, 50, f.player), true);
    assert.equal(f.level.monsterFight.health, 450);
    f.level.handleBulletHit(hit, 500, f.player);
    assert.equal(f.level.levelComplete, false); assert.equal(f.player.score, 1500);
    for (let i = 0; i < 150; i++) f.level.update(1 / 60, f.player);
    assert.equal(f.level.levelComplete, false); assert.equal(f.level.monsterFight.phase, 'defeated');
    assert.ok(f.level.degreeVictory); assert.equal(f.level.victoryPortals.started, false, 'portals wait for the degree');
    for (let i = 0; i < 1500 && !f.level.destinyReady; i++) f.level.update(1 / 60, f.player);
    assert.equal(f.level.degreeVictory.taken, true); assert.equal(f.level.degreeVictory.done, true);
    assert.equal(f.scroll.parent, f.level.degreeVictory.grip, 'the actual degree is held by Shaun');
    assert.ok(f.scroll.position.length() < 1e-6, 'paper seats at the palm grip');
    assert.ok(f.scroll.quaternion.angleTo(new THREE.Quaternion()) < 1e-6, 'paper aligns across the palm');
    const victory = f.level.degreeVictory;
    assert.ok(Math.abs(f.scroll.scale.length() / victory.transfer.scale.length() - victory.paperFit) < 1e-6, 'paper is resized to fit Shaun');
    assert.ok(victory.stepEnd.distanceTo(victory.stepStart) > 0.9, 'celebration includes a small step away from the corpse');
    const clearance = victory.corpseBounds.clone().expandByScalar(0.55);
    assert.ok(victory.stepEnd.x <= clearance.min.x || victory.stepEnd.x >= clearance.max.x
      || victory.stepEnd.z <= clearance.min.z || victory.stepEnd.z >= clearance.max.z,
    'celebration takes place clear of the whole fallen body');
    assert.equal(f.level.victoryPortals.done, true); assert.equal(f.level.destinyReady, true);
    assert.equal(f.level.levelComplete, false, 'player must choose instead of an automatic ending');
    assert.equal(f.player.scriptedMovement, false);
    assert.equal(f.level.getChallengeStatus().title, 'CHOOSE YOUR DESTINY');
    const blue = f.level.victoryPortals.portals[1]; assert.equal(blue.blue, true);
    f.player.group.position.copy(blue.center).setY(0); f.player.grounded = true;
    f.level.update(1 / 60, f.player); assert.equal(f.level.destinyChoice, 'blue');
    for (let i = 0; i < 120; i++) f.level.update(1 / 60, f.player);
    assert.equal(f.level.levelComplete, true); assert.match(f.level.getCompletionText(), /blue portal/);
    f.level.handleBulletHit(hit, 500, f.player); assert.equal(f.player.score, 1500);
  } finally { f.clean(); }
});

test('melee target selection includes the active Monster', async () => {
  const f = await levelFixture(), combat = new WeaponCombat(new THREE.Scene());
  try {
    f.level.update(0.7, f.player);
    f.player.group.position.set(0, 0, 2.1); f.player.getForwardDirection = () => new THREE.Vector3(0, 0, -1);
    f.level.root.updateMatrixWorld(true);
    const result = combat.hitWithGun(f.player, f.level, f.level.getBulletObstacles(), { damage: 25, reach: 2.25, arc: 0.4 });
    assert.ok(result === f.level.monsterFight, 'a close gun bash reaches the Monster body'); assert.equal(f.level.monsterFight.health, 575);
  } finally { combat.dispose(); f.clean(); }
});
