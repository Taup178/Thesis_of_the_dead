import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { MonsterBoss } from '../src/enemies/MonsterBoss.js';
import { monsterFixture } from './helpers/monster-fixture.mjs';

test('the approaching monster accelerates into a distance-matched gait with grounded feet at 30–120 FPS', async () => {
  const finishes = [];
  for (const fps of [30, 60, 120]) {
    const f = await monsterFixture(), boss = new MonsterBoss(f.root, f.monster, f.degreeCatch);
    try {
      boss.start(); boss.cooldown = 100; f.player.group.position.z = 30;
      const start = boss.group.position.clone();
      let previous = start.clone(), previousSpeed = 0, footTravel = 0;
      const foot = boss.motion.legs[0].foot, initialFoot = boss.group.worldToLocal(foot.getWorldPosition(new THREE.Vector3()));
      for (let frame = 0; frame < fps * 2; frame++) {
        boss.update(1 / fps, f.player);
        const speed = boss.group.position.distanceTo(previous) * fps;
        assert.ok(speed <= 5.61, 'ground pursuit stays at its authored speed');
        assert.ok(Math.abs(speed - previousSpeed) < 56 / fps, 'acceleration has no position snap');
        previous.copy(boss.group.position); previousSpeed = speed;
        footTravel = Math.max(footTravel, boss.group.worldToLocal(foot.getWorldPosition(new THREE.Vector3())).distanceTo(initialFoot));
        if (frame % Math.floor(fps / 10) === 0 && frame > fps / 2) {
          const floor = new THREE.Box3().setFromObject(boss.group, true).min.y;
          assert.ok(floor > -0.04 && floor < 0.08, `feet meet the actual terrain: ${floor}`);
        }
      }
      assert.ok(boss.group.position.distanceTo(start) > 9, 'he approaches briskly');
      assert.ok(footTravel > 0.6, 'feet actually stride rather than sliding a fixed pose');
      assert.ok(Math.abs(boss.motion.walkDistance - boss.group.position.distanceTo(start)) < 0.01);
      finishes.push(boss.group.position.clone());
    } finally { boss.dispose(); f.degreeCatch.dispose(); }
  }
  assert.ok(finishes.every(position => position.distanceTo(finishes[0]) < 0.04));
});

test('the native idle keeps breathing continuously through its loop without resetting the visible bones', async () => {
  const f = await monsterFixture(), boss = new MonsterBoss(f.root, f.monster, f.degreeCatch);
  try {
    boss.start(); boss.cooldown = 100;
    f.player.group.position.copy(boss.group.position).z += 6;
    const arm = boss.motion.arms[0].upper;
    for (let i = 0; i < 60; i++) boss.update(1 / 60, f.player);
    const rest = arm.quaternion.clone(), restPosition = boss.motion.arms[0].hand.getWorldPosition(new THREE.Vector3());
    let previous = rest.clone(), travel = 0;
    for (let i = 0; i < 300; i++) {
      boss.update(1 / 60, f.player);
      assert.ok(arm.quaternion.angleTo(previous) < 0.04, 'the loop seam never snaps');
      travel = Math.max(travel, restPosition.distanceTo(boss.motion.arms[0].hand.getWorldPosition(new THREE.Vector3())));
      previous.copy(arm.quaternion);
    }
    assert.ok(travel > 0.05, `the idle has visible breathing motion: ${travel}`);
  } finally { boss.dispose(); f.degreeCatch.dispose(); }
});

test('the spinning punch sprints in, brakes, commits its target and pivots on a planted foot', async () => {
  for (const fps of [30, 60, 120]) {
    const f = await monsterFixture(), boss = new MonsterBoss(f.root, f.monster, f.degreeCatch);
    try {
      boss.start(); f.player.group.position.set(0, 0, 14);
      boss._beginSpinApproach(f.player);
      let previous = boss.group.position.clone(), peakSpeed = 0, committed = null, spun = false, pivot = null;
      for (let frame = 0; frame < fps * 5; frame++) {
        const before = boss.state;
        boss.update(1 / fps, f.player);
        if (boss.state === 'spinApproach') {
          peakSpeed = Math.max(peakSpeed, boss.group.position.distanceTo(previous) * fps);
          assert.equal(f.player.hits.length, 0, 'running itself does not deal a phantom punch');
          if (boss.rushCommitted) {
            committed ??= boss.rushTarget.clone();
            assert.ok(committed.distanceTo(boss.rushTarget) < 1e-8);
          }
        }
        if (boss.state === 'spin') {
          spun = true;
          assert.ok(boss.motion.moveSpeed < 0.01, 'he plants before swinging');
          if (boss.time > 0.18) {
            const foot = boss.motion.legs[boss.motion.spinSupport].foot.getWorldPosition(new THREE.Vector3());
            pivot ??= foot.clone();
            assert.ok(foot.distanceTo(pivot) < 0.045,
              `supporting foot does not skate around the turn: ${foot.distanceTo(pivot)} at ${boss.time}, ${fps} FPS`);
          }
        }
        previous.copy(boss.group.position);
        if (before === 'spin' && boss.state === 'idle') break;
      }
      assert.ok(peakSpeed > 8 && peakSpeed <= 10.01, 'a fast sprint leads into the strike');
      assert.ok(spun && pivot && committed, 'complete sprint-to-pivot-to-punch sequence');
      assert.deepEqual(f.player.hits, [24], 'the visible fist makes exactly one contact');
      assert.equal(f.scroll.parent, f.degreeCatch.grip);
    } finally { boss.dispose(); f.degreeCatch.dispose(); }
  }
});

test('a sidestep after the sprint commits stays dodgeable instead of homing through the swing', async () => {
  const f = await monsterFixture(), boss = new MonsterBoss(f.root, f.monster, f.degreeCatch);
  try {
    boss.start(); boss._beginSpinApproach(f.player);
    for (let i = 0; i < 180 && !boss.rushCommitted; i++) boss.update(1 / 60, f.player);
    assert.ok(boss.rushCommitted);
    const target = boss.rushTarget.clone(); f.player.group.position.x += 10;
    for (let i = 0; i < 180 && boss.state !== 'idle'; i++) boss.update(1 / 60, f.player);
    assert.ok(boss.rushTarget.distanceTo(target) < 1e-8);
    assert.deepEqual(f.player.hits, []);
    assert.equal(boss.state, 'idle');
  } finally { boss.dispose(); f.degreeCatch.dispose(); }
});

test('the spin holds both arms wide with nearly straight elbows through its active sweep', async () => {
  const f = await monsterFixture(), boss = new MonsterBoss(f.root, f.monster, f.degreeCatch);
  try {
    boss.start(); boss.state = 'spin'; boss._beginSpin();
    for (let frame = 0; frame < 45; frame++) {
      boss.update(1 / 60, f.player);
      if (boss.time < 0.23) continue;
      const hands = boss.motion.arms.map(arm => boss.group.worldToLocal(arm.hand.getWorldPosition(new THREE.Vector3())));
      assert.ok(hands[0].x - hands[1].x > 4.3, `the hand span is clearly wider than his body: ${hands[0].x - hands[1].x}`);
      for (const arm of boss.motion.arms) {
        const shoulder = arm.upper.getWorldPosition(new THREE.Vector3()), elbow = arm.lower.getWorldPosition(new THREE.Vector3());
        const hand = arm.hand.getWorldPosition(new THREE.Vector3());
        assert.ok(elbow.clone().sub(shoulder).normalize().dot(hand.sub(elbow).normalize()) > 0.85, 'elbows stay extended through the spin');
      }
    }
  } finally { boss.dispose(); f.degreeCatch.dispose(); }
});

test('sprinting plants the feet backward relative to forward travel instead of moonwalking', async () => {
  const f = await monsterFixture(), boss = new MonsterBoss(f.root, f.monster, f.degreeCatch);
  try {
    boss.start(); f.player.group.position.z = 24; boss._beginSpinApproach(f.player);
    let previous = null, stanceMotion = 0, contacts = 0;
    for (let frame = 0; frame < 90 && boss.state === 'spinApproach'; frame++) {
      boss.update(1 / 60, f.player);
      const feet = boss.motion.legs.map(leg => boss.group.worldToLocal(leg.foot.getWorldPosition(new THREE.Vector3())));
      if (previous && frame > 30 && boss.motion.moveSpeed > 7) feet.forEach((foot, index) => {
        if (foot.y < 0.41 && previous[index].y < 0.41) {
          stanceMotion += foot.z - previous[index].z; contacts++;
        }
      });
      previous = feet;
    }
    assert.ok(contacts >= 8, 'several grounded footfalls were sampled');
    assert.ok(stanceMotion / contacts < -0.07, `stance feet oppose forward travel: ${stanceMotion / contacts}`);
  } finally { boss.dispose(); f.degreeCatch.dispose(); }
});

test('the sprint has bent arm drive, knee lift and a flight phase rather than accelerated walking', async () => {
  const f = await monsterFixture(), boss = new MonsterBoss(f.root, f.monster, f.degreeCatch);
  try {
    boss.start(); f.player.group.position.z = 24; boss._beginSpinApproach(f.player);
    let lift = 0, flightFrames = 0;
    for (let frame = 0; frame < 90 && boss.state === 'spinApproach'; frame++) {
      boss.update(1 / 60, f.player);
      if (frame < 30 || boss.motion.moveSpeed < 7) continue;
      const feet = boss.motion.legs.map(leg => boss.group.worldToLocal(leg.foot.getWorldPosition(new THREE.Vector3())));
      lift = Math.max(lift, ...feet.map((foot, i) => foot.y - boss.motion.legs[i].anchor.y));
      if (feet.every((foot, i) => foot.y - boss.motion.legs[i].anchor.y > 0.08)) flightFrames++;
      for (const arm of boss.motion.arms) {
        const upper = arm.lower.getWorldPosition(new THREE.Vector3()).sub(arm.upper.getWorldPosition(new THREE.Vector3())).normalize();
        const lower = arm.hand.getWorldPosition(new THREE.Vector3()).sub(arm.lower.getWorldPosition(new THREE.Vector3())).normalize();
        assert.ok(upper.dot(lower) < 0.65, 'arms stay bent in a running drive');
      }
    }
    assert.ok(lift > 0.55, 'the recovery leg clears the floor with a visible knee lift');
    assert.ok(flightFrames > 0, 'both feet leave the ground between sprint strides');
  } finally { boss.dispose(); f.degreeCatch.dispose(); }
});

test('normal and enraged attacks blend from locomotion without arm-pose snaps', async () => {
  for (const enraged of [false, true]) for (const attack of ['throw', 'smash', 'slam', 'spinApproach']) {
    const f = await monsterFixture(), boss = new MonsterBoss(f.root, f.monster, f.degreeCatch);
    try {
      boss.start(); boss.cooldown = 100;
      for (let frame = 0; frame < 30; frame++) boss.update(1 / 60, f.player);
      const bones = boss.motion.arms.flatMap(arm => [arm.upper, arm.lower, arm.hand]);
      const previous = bones.map(bone => bone.quaternion.clone());
      boss.enraged = boss.enrageComplete = enraged; boss.tempo = enraged ? 1.35 : 1;
      boss.state = attack; boss.time = 0; boss.impacts = 0; boss.released = false;
      boss.aim = f.player.group.position.clone();
      boss.direction = boss.aim.clone().sub(boss.group.position).setY(0).normalize();
      if (attack === 'smash') boss._beginJump(f.player);
      if (attack === 'slam') boss._beginSlam(f.player);
      if (attack === 'spinApproach') boss._beginSpinApproach(f.player);
      for (let frame = 0; frame < 360; frame++) {
        boss.update(1 / 60, f.player);
        bones.forEach((bone, i) => {
          const angle = bone.quaternion.angleTo(previous[i]);
          assert.ok(angle < 0.45, `${attack}, enraged=${enraged}, ${bone.name}, age=${boss.motion.previousAge}, angular jump=${angle}`);
          previous[i].copy(bone.quaternion);
        });
        if (boss.state === 'idle') break;
      }
      assert.equal(boss.state, 'idle', `${attack} completes its recovery`);
    } finally { boss.dispose(); f.degreeCatch.dispose(); }
  }
});
