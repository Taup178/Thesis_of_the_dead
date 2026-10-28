import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { MonsterBoss, MONSTER_SLAM_RADIUS } from '../src/enemies/MonsterBoss.js';
import { monsterFixture } from './helpers/monster-fixture.mjs';

test('the real Monster catches the degree then jumps between three separate smash positions', async () => {
  const f = await monsterFixture(), boss = new MonsterBoss(f.root, f.monster, f.degreeCatch);
  boss.start();
  const feet = ['L_ankle_04', 'R_ankle_09'].map(name => f.monster.group.getObjectByName(name));
  const feetLocal = feet.map(foot => f.monster.group.worldToLocal(foot.getWorldPosition(new THREE.Vector3())));
  const impacts = [], launches = [], airborne = [];
  const launch = boss.rocks.launch.bind(boss.rocks);
  boss.rocks.launch = (origin, direction) => {
    let fistBottom = Infinity;
    for (const { mesh, vertices } of boss.motion.handVertices) {
      mesh.skeleton.update();
      for (const vertex of vertices) fistBottom = Math.min(fistBottom,
        mesh.getVertexPosition(vertex, new THREE.Vector3()).applyMatrix4(mesh.matrixWorld).y);
    }
    assert.ok(fistBottom >= -0.015 && fistBottom < 0.15, 'the actual fist mesh meets the floor without sinking');
    assert.ok(new THREE.Box3().setFromObject(f.scroll, true).min.y >= -0.015, 'held degree stays above the floor');
    impacts.push({ origin: origin.clone(), boss: boss.group.position.clone(), direction: direction.clone(),
      wrists: boss.motion.arms.map(arm => arm.hand.getWorldPosition(new THREE.Vector3())) });
    return launch(origin, direction);
  };
  let previousDegree = f.scroll.getWorldPosition(new THREE.Vector3()), previousActive = false, caught = false;
  const armBones = boss.motion.arms.flatMap(arm => [arm.upper, arm.lower, arm.hand]);
  let previousArms = armBones.map(bone => bone.getWorldQuaternion(new THREE.Quaternion()));
  for (let frame = 0; frame < 22 * 60 && impacts.length < 3; frame++) {
    boss.update(1 / 60, f.player);
    previousArms = armBones.map((bone, index) => {
      const rotation = bone.getWorldQuaternion(new THREE.Quaternion());
      assert.ok(rotation.angleTo(previousArms[index]) < 0.7,
        `${bone.name} must not flip between frames: frame=${frame}, state=${boss.state}, age=${boss.motion.previousAge}, angle=${rotation.angleTo(previousArms[index])}`);
      return rotation;
    });
    if (boss.state === 'smash' && boss.group.position.y > 0.15) airborne[boss.impacts] = true;
    if (!boss.degree.active) assert.equal(f.scroll.parent, f.degreeCatch.grip, 'the degree stays in hand outside its throw');
    const position = f.scroll.getWorldPosition(new THREE.Vector3());
    if (!previousActive && boss.degree.active) launches.push(position.distanceTo(previousDegree));
    if (previousActive && !boss.degree.active) { caught = true; assert.ok(position.distanceTo(previousDegree) < 0.45, 'no catch teleport'); }
    previousDegree = position; previousActive = boss.degree.active;
    feet.forEach((foot, i) => {
      const local = f.monster.group.worldToLocal(foot.getWorldPosition(new THREE.Vector3()));
      if (boss.motion.previousKind !== 'idle' && boss.motion.transitionTime >= 0.14)
        assert.ok(local.distanceTo(feetLocal[i]) < 0.035, 'feet stay planted under the attack pose');
    });
  }
  assert.ok(launches.length > 0 && launches[0] < 0.45, 'release starts at the moving hand');
  assert.ok(caught); assert.equal(impacts.length, 3);
  for (const impact of impacts) {
    assert.ok(impact.wrists.every(wrist => wrist.y > 0.45 && wrist.y < 0.85), 'fist targets leave room for the actual hand mesh');
    assert.ok(impact.wrists.every(wrist => Math.hypot(wrist.x - impact.origin.x, wrist.z - impact.origin.z) < 0.8), 'rocks start where fists land');
  }
  assert.ok(airborne[0] && airborne[1] && airborne[2], 'a visible jump precedes every smash');
  for (let i = 1; i < impacts.length; i++) {
    assert.ok(impacts[i].boss.distanceTo(impacts[i - 1].boss) > 2.5, 'each smash lands in a new position');
    assert.ok(impacts[i].origin.distanceTo(impacts[i - 1].origin) > 1.5, 'rock waves also start at distinct contacts');
    assert.ok(impacts[i].direction.angleTo(impacts[i - 1].direction) > 0.3, 'each landing sends rocks from a different angle');
  }
  assert.ok(f.scroll.getWorldScale(new THREE.Vector3()).distanceTo(new THREE.Vector3(0.82, 0.78, 0.78)) < 1e-5);
  boss.dispose(); f.degreeCatch.dispose();
});

test('Monster damage, death and player death stop every hazard without extra attack indicators', async () => {
  const f = await monsterFixture(), boss = new MonsterBoss(f.root, f.monster, f.degreeCatch);
  assert.equal(boss.takeDamage(100), false); assert.equal(boss.health, 600);
  boss.start();
  for (let i = 0; i < 130; i++) boss.update(1 / 60, f.player);
  assert.ok(boss.degree.active);
  assert.equal(boss.takeDamage(600), true); assert.equal(boss.health, 0);
  assert.equal(boss.degree.active, false); assert.ok(boss.rocks.pool.every(wave => !wave.active));
  for (let i = 0; i < 180; i++) boss.update(1 / 60, f.player);
  assert.equal(boss.phase, 'defeated');
  assert.ok(Math.abs(new THREE.Vector3(0, 1, 0).applyQuaternion(boss.group.quaternion).y) < 0.01, 'body lies horizontally');
  for (const leg of boss.motion.legs) {
    const rest = boss.motion.neutral[boss.motion.bones.findIndex(saved => saved.node === leg.lower)];
    assert.ok(leg.lower.quaternion.clone().normalize().angleTo(rest.rotation.clone().normalize()) < 1e-5, 'legs relax out of the jumping pose');
  }
  assert.equal(boss.takeDamage(10), false);
  assert.equal(f.root.getObjectByName('MonsterAttackWarnings'), undefined);
  boss.dispose(); f.degreeCatch.dispose();
  const other = await monsterFixture(), next = new MonsterBoss(other.root, other.monster, other.degreeCatch); next.start();
  for (let i = 0; i < 130; i++) next.update(1 / 60, other.player);
  other.player.alive = false; next.update(0.1, other.player);
  assert.equal(next.degree.active, false); assert.ok(next.rocks.pool.every(wave => !wave.active));
  next.dispose(); other.degreeCatch.dispose();
});

test('jump tracks a sidestep while keeping its airborne trajectory and fast combo cadence', async () => {
  const f = await monsterFixture(), boss = new MonsterBoss(f.root, f.monster, f.degreeCatch);
  try {
    boss.start(); boss.state = 'smash'; boss.direction = new THREE.Vector3(0, 0, 1);
    boss._beginJump(f.player);
    for (let i = 0; i < 15; i++) boss.update(1 / 60, f.player);
    const landing = boss.jump.to.clone(), initialDirection = boss.jump.direction.clone();
    f.player.group.position.x += 5;
    for (let i = 0; i < 12; i++) boss.update(1 / 60, f.player);
    assert.ok(boss.jump.to.distanceTo(landing) < 1e-6, 'landing momentum stays committed in the air');
    assert.ok(boss.jump.direction.angleTo(initialDirection) > 0.25, 'smash follows a changed player direction');
    let elapsed = 27 / 60;
    while (boss.impacts < 3 && elapsed < 3.2) { boss.update(1 / 60, f.player); elapsed += 1 / 60; }
    assert.equal(boss.impacts, 3); assert.ok(elapsed < 3, 'three fast jumps maintain pressure');
  } finally { boss.dispose(); f.degreeCatch.dispose(); }
});

test('spinning punch sweeps the visible fist once, keeps the degree, and respects dodges', async () => {
  const f = await monsterFixture(), boss = new MonsterBoss(f.root, f.monster, f.degreeCatch);
  try {
    boss.start(); boss.state = 'spin'; boss.time = 0; boss._beginSpin();
    // Follow the fist through its active sweep to exercise collision rather than a timed radial hit.
    for (let i = 0; i < 58; i++) {
      f.player.group.position.copy(boss.motion.arms[1].hand.getWorldPosition(new THREE.Vector3())).setY(0);
      boss.update(1 / 60, f.player);
      assert.equal(f.scroll.parent, f.degreeCatch.grip);
    }
    assert.deepEqual(f.player.hits, [24]); assert.equal(boss.state, 'idle');
    f.player.hits.length = 0; f.player.isDodging = true;
    boss.state = 'spin'; boss.time = 0; boss._beginSpin();
    for (let i = 0; i < 58; i++) {
      f.player.group.position.copy(boss.motion.arms[1].hand.getWorldPosition(new THREE.Vector3())).setY(0);
      boss.update(1 / 60, f.player);
    }
    assert.equal(f.player.hits.length, 0);
  } finally { boss.dispose(); f.degreeCatch.dispose(); }
});

test('body slam hits a huge area only on landing and can be rolled or jumped', async () => {
  assert.ok(MONSTER_SLAM_RADIUS > 3 * 3, 'over three times the Dean leap radius');
  for (const mode of ['hit', 'outside', 'dodge', 'jump']) {
    const f = await monsterFixture(), boss = new MonsterBoss(f.root, f.monster, f.degreeCatch);
    try {
      boss.start(); boss.state = 'slam'; boss.time = 0; boss._beginSlam(f.player);
      for (let i = 0; i < 20; i++) boss.update(1 / 60, f.player);
      assert.ok(boss.group.position.y > 0); assert.equal(f.player.hits.length, 0);
      const landing = boss.slam.to.clone();
      f.player.group.position.copy(landing).add(new THREE.Vector3(mode === 'outside' ? 10 : 8, mode === 'jump' ? 2 : 0, 0));
      f.player.isDodging = mode === 'dodge';
      let peak = 0, tuckTravel = 0;
      for (let i = 0; i < 133; i++) {
        boss.update(1 / 60, f.player);
        peak = Math.max(peak, boss.group.position.y);
        if (boss.time > 0.5 && boss.time < 1.1) {
          const leg = boss.motion.legs[0];
          const foot = boss.group.worldToLocal(leg.foot.getWorldPosition(new THREE.Vector3()));
          tuckTravel = Math.max(tuckTravel, foot.distanceTo(leg.anchor));
        }
        assert.equal(f.scroll.parent, f.degreeCatch.grip);
        if (boss.state === 'idle') break;
      }
      assert.ok(peak > 7, 'the single body-slam leap rises over seven metres');
      assert.ok(tuckTravel > 0.1, 'feet tuck naturally instead of being pinned in their standing pose in flight');
      assert.deepEqual(f.player.hits, mode === 'hit' ? [32] : []);
      assert.ok(boss.group.position.distanceTo(landing) < 1e-6);
      assert.equal(boss.state, 'idle');
    } finally { boss.dispose(); f.degreeCatch.dispose(); }
  }
});

test('40 percent health queues one grounded chest-beat transition then rapid attack chains', async () => {
  const f = await monsterFixture(), boss = new MonsterBoss(f.root, f.monster, f.degreeCatch);
  try {
    boss.start(); boss.takeDamage(359); assert.equal(boss.enraged, false);
    boss.state = 'slam'; boss.time = 0.6; boss._beginSlam(f.player); boss.update(1 / 60, f.player);
    const height = boss.group.position.y;
    boss.takeDamage(1); assert.equal(boss.enraged, true); assert.equal(boss.health, 240);
    boss.update(1 / 60, f.player);
    assert.equal(boss.state, 'slam'); assert.ok(boss.group.position.y >= height, 'threshold never interrupts an airborne leap');
    const sounds = []; boss._sound = kind => sounds.push(kind);
    for (let i = 0; i < 180 && boss.state !== 'enrage'; i++) boss.update(1 / 60, f.player);
    assert.equal(boss.state, 'enrage'); assert.equal(boss.group.position.y, 0);
    const arm = boss.motion.arms[1]; let previous = arm.lower.quaternion.clone();
    for (let i = 0; i < 100 && !boss.enrageComplete; i++) {
      boss.update(1 / 60, f.player);
      assert.ok(arm.lower.quaternion.angleTo(previous) < 0.7, 'chest strikes blend without elbow flips');
      previous.copy(arm.lower.quaternion);
      assert.equal(f.scroll.parent, f.degreeCatch.grip);
    }
    assert.equal(boss.enrageComplete, true); assert.equal(sounds.filter(sound => sound === 'chest').length, 3);
    assert.ok(boss.cooldown <= 0.04);
    boss.takeDamage(1); assert.equal(boss.enragePending, false, 'transition happens only once');
    for (let i = 0; i < 40; i++) boss.update(1 / 60, f.player);
    assert.ok(boss.tempo > 1.3); assert.notEqual(boss.state, 'idle', 'attacks resume immediately');
    boss.degree.clear(); boss.state = 'spin'; boss.time = 0; boss._beginSpin();
    let elapsed = 0;
    while (boss.state === 'spin' && elapsed < 1) { boss.update(1 / 60, f.player); elapsed += 1 / 60; }
    assert.ok(elapsed < 0.76, 'enraged spinning punch is faster'); assert.ok(boss.cooldown <= 0.04);
  } finally { boss.dispose(); f.degreeCatch.dispose(); }
});
