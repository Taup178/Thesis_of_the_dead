import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Player } from '../src/player/Player.js';
import { WeaponCombat } from '../src/player/WeaponCombat.js';
import { SWORD_ATTACKS, getSwordViewPose } from '../src/player/SwordSwings.js';
import { SurvivorWeapon } from '../src/player/SurvivorWeapon.js';
import { Level3 } from '../src/levels/Level3.js';

function setup() {
  const scene = new THREE.Scene(), presses = new Set();
  const input = { pointerLocked: true, mouseDeltaX: 0, mouseDeltaY: 0, shooting: false, secondary: false,
    isDown: () => false, flushMouseDelta() {}, consumeKeyPress: key => presses.delete(key),
    isMouseButtonDown(button = 0) { return button === 2 ? this.secondary : this.shooting; } };
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 200), player = new Player(scene, input, camera);
  player.toggleCamera(); player.getMuzzleWorldPosition = () => new THREE.Vector3(0, 1.1, -0.5);
  const combat = new WeaponCombat(scene), level = { zombies: [], allowsShooting: true }, cover = [];
  const zombie = (x, z) => {
    const group = new THREE.Group(), mesh = new THREE.Mesh(new THREE.BoxGeometry(0.8, 2, 0.8), new THREE.MeshBasicMaterial());
    mesh.position.y = 1; group.add(mesh); group.position.set(x, 0, z); scene.add(group);
    const enemy = { group, health: 30, alive: true, takeDamage(damage) {
      if (!this.alive) return false; this.health = Math.max(0, this.health - damage); this.alive = this.health > 0; return !this.alive;
    } };
    level.zombies.push(enemy); return enemy;
  };
  const targets = () => { scene.updateMatrixWorld(true); return [...level.zombies.filter(z => z.alive).map(z => z.group.children[0]), ...cover]; };
  const step = (dt = 1 / 60) => { player.update(dt); combat.update(dt, player, level, input, targets); };
  const cleanup = () => { player.dispose(); combat.dispose(); for (const object of [...level.zombies.map(z => z.group.children[0]), ...cover]) { object.geometry.dispose(); object.material.dispose(); } };
  return { scene, player, combat, level, input, presses, cover, zombie, targets, step, cleanup };
}

test('shots spend ammo and travel visibly before a single impact, including large frame steps', () => {
  const f = setup();
  try {
    const enemy = f.zombie(0, -10); f.player.ammo = 1; f.input.shooting = true; f.step(0);
    assert.equal(f.player.ammo, 0); assert.equal(f.combat.projectiles.length, 1); assert.equal(enemy.health, 30);
    f.input.shooting = false; f.step(0.04);
    assert.ok(f.combat.projectiles[0].mesh.position.z < -2); assert.equal(enemy.health, 30);
    f.step(0.2); assert.equal(enemy.health, 15); assert.equal(f.combat.projectiles.length, 0);
    f.step(0.2); assert.equal(enemy.health, 15);
  } finally { f.cleanup(); }
});

test('bullets and gun strikes cannot hit through cover, including a muzzle beyond the wall', () => {
  const f = setup();
  try {
    const enemy = f.zombie(0, -1.8), wall = new THREE.Mesh(new THREE.BoxGeometry(2, 3, 0.1), new THREE.MeshBasicMaterial());
    wall.position.set(0, 1, -0.7); f.scene.add(wall); f.cover.push(wall);
    f.player.getMuzzleWorldPosition = () => new THREE.Vector3(0, 1.1, -1);
    f.input.shooting = true; f.step(0.05); f.input.shooting = false;
    assert.equal(enemy.health, 30); assert.equal(f.combat.projectiles.length, 0);
    f.presses.add('KeyF'); f.step(); f.step(0.3); assert.equal(enemy.health, 30);
  } finally { f.cleanup(); }
});

test('F bashes at the animation contact time without spending ammo or hitting distant/backward enemies', () => {
  const f = setup();
  try {
    const close = f.zombie(0, -1.6), behind = f.zombie(0, 1), far = f.zombie(0, -5);
    f.presses.add('KeyF'); f.step(); assert.equal(f.player.bashTime, 0.6); assert.equal(close.health, 30);
    f.step(0.1); assert.equal(close.health, 30);
    f.step(0.13); assert.equal(close.alive, false); assert.equal(behind.health, 30); assert.equal(far.health, 30);
    assert.equal(f.player.ammo, 30); assert.equal(f.player.score, 200);
    f.step(0.1); assert.equal(f.player.score, 200);
  } finally { f.cleanup(); }
});

test('empty clicks bash with a cooldown and never produce a bullet or negative ammo', () => {
  const f = setup();
  try {
    f.player.ammo = 0; f.input.shooting = true; f.zombie(0, -1.7);
    for (let i = 0; i < 25; i++) f.step();
    assert.equal(f.combat.kills, 1); assert.equal(f.player.ammo, 0); assert.equal(f.combat.projectiles.length, 0);
    assert.ok(f.combat.bashCooldown > 0);
  } finally { f.cleanup(); }
});

test('SMG boss ammo is unlimited at zero reserve, while other guns and normal encounters spend bullets', () => {
  const f = setup();
  try {
    f.level.hasUnlimitedAmmo = Level3.prototype.hasUnlimitedAmmo;
    f.level.bossFight = { phase: 'combat' };
    f.player.ammo = 0; f.input.shooting = true; f.step(0);
    assert.equal(f.combat.projectiles.length, 1, 'An empty SMG shoots during the boss fight');
    assert.equal(f.player.bashTime, 0, 'Left click does not turn into an empty-ammo bash');
    assert.equal(f.player.ammo, 0, 'Unlimited fire preserves the shared reserve');
    f.step(0);
    assert.equal(f.combat.projectiles.length, 1, 'The normal fire-rate cooldown still applies');
    f.player.equipWeapon('pistol'); f.player.ammo = 3; f.combat.shootCooldown = 0; f.step(0);
    assert.equal(f.player.ammo, 2, 'The pistol still spends ammo during the boss fight');
    f.player.equipWeapon('smg'); f.combat.shootCooldown = 0; f.step(0);
    assert.equal(f.player.ammo, 2, 'SMG fire does not use ammunition reserved for other guns');
    for (const phase of ['defeated', 'waiting']) {
      f.level.bossFight.phase = phase; f.combat.shootCooldown = 0;
      assert.equal(f.combat.fire(f.player, []), true);
    }
    assert.equal(f.player.ammo, 0, 'Unlimited ammo ends outside active boss combat');
    f.combat.shootCooldown = 0;
    assert.equal(f.combat.fire(f.player, []), false);
    f.level.bossFight.phase = 'combat'; f.combat.reset();
    f.combat.level = { allowsShooting: true };
    assert.equal(f.combat.fire(f.player, []), false, 'The benefit cannot carry into another level');
  } finally { f.cleanup(); }
});

test('only some zombies drop ammo, collection is bounded, and retries clear remaining pickups', () => {
  const f = setup();
  try {
    const a = f.zombie(3, -4), b = f.zombie(3, -4);
    f.combat.damageZombie(a, 30, f.player); assert.equal(f.combat.pickups.length, 0);
    f.combat.damageZombie(b, 30, f.player); assert.equal(f.combat.pickups.length, 1);
    f.combat.damageZombie(b, 30, f.player); assert.equal(f.player.score, 400);
    f.combat.updatePickups(0.1, f.player); assert.equal(f.player.ammo, 30);
    f.player.group.position.copy(b.group.position); f.player.ammo = 118;
    f.combat.updatePickups(0.1, f.player); assert.equal(f.player.ammo, 120); assert.equal(f.combat.pickups[0].amount, 10);
    f.player.ammo = 100; f.combat.updatePickups(0.1, f.player);
    assert.equal(f.player.ammo, 110); assert.equal(f.combat.pickups.length, 0);
    f.combat.dropAmmo(new THREE.Vector3()); f.combat.reset(); f.player.reset(new THREE.Vector3());
    assert.equal(f.combat.pickups.length, 0); assert.equal(f.player.ammo, 30);
  } finally { f.cleanup(); }
});

test('the memory room and portal travel prevent shooting and melee', () => {
  const f = setup();
  try {
    f.input.shooting = true; f.presses.add('KeyF'); f.level.allowsShooting = false; f.step();
    assert.equal(f.player.ammo, 30); assert.equal(f.player.bashTime, 0);
    f.level.allowsShooting = true; f.player.scriptedMovement = true; f.step();
    assert.equal(f.combat.projectiles.length, 0); assert.equal(f.player.bashTime, 0);
  } finally { f.cleanup(); }
});

test('rolling blocks new shots and cancels a pending gun bash', () => {
  const f = setup();
  try {
    f.input.shooting = true;
    f.player.isDodging = true;
    f.combat.pendingBash = 0.1;
    f.combat.update(0.2, f.player, f.level, f.input, f.targets);
    assert.equal(f.combat.pendingBash, null);
    assert.equal(f.player.ammo, 30);
    assert.equal(f.combat.projectiles.length, 0);
    assert.equal(f.combat.fire(f.player, f.targets()), false);
  } finally { f.cleanup(); }
});

test('single and dual pistols spend one and two rounds and launch separate projectiles', () => {
  const f = setup();
  try {
    f.player.equipWeapon('pistol');
    f.input.shooting = true; f.step(0);
    assert.equal(f.player.ammo, 29);
    assert.equal(f.combat.projectiles.length, 1);
    assert.equal(f.combat.projectiles[0].damage, 22);
    f.player.equipWeapon('dual');
    f.combat.shootCooldown = 0;
    f.step(0);
    assert.equal(f.player.ammo, 27);
    assert.equal(f.combat.projectiles.length, 3);
    assert.equal(f.combat.projectiles[1].damage, 14);
    assert.equal(f.combat.projectiles[2].damage, 14);
    f.input.shooting = false; f.input.secondary = true;
    f.combat.shootCooldown = 0;
    f.step(0);
    assert.equal(f.player.ammo, 26, 'Right click fires only one of the dual pistols');
    assert.equal(f.combat.projectiles.length, 4);
  } finally { f.cleanup(); }
});

test('sword reaches farther than dagger and both strike without ammunition', () => {
  const f = setup();
  try {
    const enemy = f.zombie(0, -2.4); enemy.health = 100;
    f.player.equipWeapon('dagger');
    f.input.shooting = true; f.step(0.01); f.step(0.17);
    assert.equal(enemy.health, 100, 'The dagger cannot reach the distant target');
    f.input.shooting = false; f.step(0.5);
    f.player.equipWeapon('sword');
    f.input.shooting = true; f.step(0.01); f.step(0.29);
    assert.equal(enemy.health, 55, 'The sword lands its longer slash');
    assert.equal(f.player.ammo, 30);
    assert.equal(f.combat.projectiles.length, 0);
  } finally { f.cleanup(); }
});

test('sword combo plays slash, forward stab and turning slash with one attack per click and no held repeats', () => {
  for (let clicks = 1; clicks <= 3; clicks++) {
    const f = setup();
    try {
      const enemy = f.zombie(0, -2.4); enemy.health = 1000;
      f.player.equipWeapon('sword');
      let presses = clicks;
      f.input.consumeMousePresses = () => { const count = presses; presses = 0; return count; };
      const attacks = [], start = f.player.startMeleeAttack.bind(f.player);
      f.player.startMeleeAttack = (attack, options) => {
        const accepted = start(attack, options);
        if (accepted) attacks.push(attack.clip);
        return accepted;
      };
      f.input.shooting = true;
      f.step(0);
      assert.equal(attacks.length, 1, 'Buffered clicks play sequentially, not all at once');
      f.step(0.1);
      assert.equal(enemy.health, 1000, 'Wind-up does not deal damage');
      for (let frame = 0; frame < 300; frame++) f.step();
      assert.deepEqual(attacks, SWORD_ATTACKS.slice(0, clicks).map(attack => attack.clip));
      assert.equal(enemy.health, 1000 - SWORD_ATTACKS.slice(0, clicks).reduce((sum, attack) => sum + attack.damage, 0));
      assert.equal(f.combat.swordQueue.length, 0);
      assert.equal(f.player.bashTime, 0);
      assert.equal(f.player.ammo, 30);
      assert.equal(f.combat.projectiles.length, 0);
      const impactPoses = SWORD_ATTACKS.map(attack => getSwordViewPose(attack, attack.contact / attack.duration));
      assert.equal(new Set(impactPoses.map(pose => JSON.stringify(pose))).size, 3, 'Every attack has a distinct visible motion');
      for (const attack of SWORD_ATTACKS) {
        assert.deepEqual(getSwordViewPose(attack, 0), [0, 0, 0, 0, 0, 0]);
        assert.deepEqual(getSwordViewPose(attack, 1), [0, 0, 0, 0, 0, 0], 'Each swing recovers to the resting pose');
      }
    } finally { f.cleanup(); }
  }
});

test('queued sword attacks link during follow-through without idle gaps or duplicate impacts', () => {
  const f = setup();
  try {
    const enemy = f.zombie(0, -2.4); enemy.health = 1000;
    f.player.equipWeapon('sword');
    let presses = 3;
    f.input.consumeMousePresses = () => { const count = presses; presses = 0; return count; };
    f.step(0); f.step(0.42);
    assert.equal(f.player.swordAttack, SWORD_ATTACKS[0]);
    assert.equal(enemy.health, 955);
    f.step(0.02);
    assert.equal(f.player.swordAttack, SWORD_ATTACKS[1], 'The stab starts before the slash returns to idle');
    assert.equal(f.player.bashTime, SWORD_ATTACKS[1].duration);
    f.step(0.35);
    assert.equal(enemy.health, 910);
    f.step(0.02);
    assert.equal(f.player.swordAttack, SWORD_ATTACKS[2], 'The spin starts from the stab follow-through');
    f.step(0.69);
    assert.equal(enemy.health, 910, 'The spinning strike keeps its contact timing');
    f.step(0.02);
    assert.equal(enemy.health, 850);
    f.step(0.3);
    assert.equal(enemy.health, 850, 'Blending does not add extra hits');
    assert.equal(f.player.bashTime, 0);
    assert.equal(f.combat.swordQueue.length, 0);
  } finally { f.cleanup(); }
});

test('sword combo requires the next click within 0.75 seconds even while an attack is still recovering', () => {
  const f = setup();
  try {
    f.player.equipWeapon('sword');
    let presses = 1;
    f.input.consumeMousePresses = () => { const count = presses; presses = 0; return count; };
    f.step(0); f.step(0.3);
    presses = 1; f.step(0);
    assert.equal(f.combat.swordQueue[0], SWORD_ATTACKS[1], 'A timely second click queues the forward stab');
    f.step(0.4);
    assert.equal(f.player.swordAttack, SWORD_ATTACKS[1]);
    f.step(0.36);
    assert.ok(f.player.bashTime > 0, 'The stab is still recovering when the click window expires');
    presses = 1; f.step(0);
    assert.equal(f.combat.swordQueue[0], SWORD_ATTACKS[0], 'A late click starts a fresh slash instead of triggering attack three');
    f.step(0.3);
    assert.equal(f.player.swordAttack, SWORD_ATTACKS[0]);
    assert.ok(f.combat.swordQueue.every(attack => attack !== SWORD_ATTACKS[2]));
  } finally { f.cleanup(); }
});

test('sword combo expires after a pause and cancels buffered attacks on rolls or weapon changes', () => {
  const f = setup();
  try {
    f.player.equipWeapon('sword');
    let presses = 1;
    f.input.consumeMousePresses = () => { const count = presses; presses = 0; return count; };
    f.step(0);
    for (let frame = 0; frame < 120; frame++) f.step();
    presses = 1; f.step();
    assert.equal(f.player.swordAttack, SWORD_ATTACKS[0], 'A fresh click after a pause starts the first swing');
    presses = 2; f.step();
    assert.equal(f.combat.swordQueue.length, 2);
    f.player.isDodging = true;
    f.combat.update(0, f.player, f.level, f.input, f.targets);
    assert.equal(f.combat.swordQueue.length, 0);
    assert.equal(f.combat.pendingBash, null);
    f.player.isDodging = false;
    for (let frame = 0; frame < 60; frame++) f.step();
    presses = 3; f.step();
    assert.equal(f.combat.swordQueue.length, 2);
    f.player.equipWeapon('dagger'); f.step();
    assert.equal(f.combat.swordQueue.length, 0);
    assert.equal(f.combat.pendingBash, null);
  } finally { f.cleanup(); }
});

test('sword swings pivot at the hand and keep the blade in front of the first-person camera', () => {
  const viewRoot = new THREE.Group(), model = new THREE.Group(), sword = new THREE.Group();
  model.rotation.y = Math.PI; model.scale.set(-0.72, 0.72, 0.72);
  sword.position.set(0.4, 1.3, 0.2); sword.rotation.set(0.18, Math.PI + 0.28, 0);
  const tip = new THREE.Object3D(); tip.name = 'BladeTip'; tip.position.z = -1.05; sword.add(tip);
  model.add(sword); viewRoot.add(model);
  const player = { camera: new THREE.PerspectiveCamera(), characterModel: new THREE.Group(),
    group: new THREE.Group(), bodyMesh: new THREE.Group(), weapon: 'sword', isFirstPerson: true, isAiming: false,
    isDodging: false, scriptedMovement: false, shotTime: 0 };
  const presentation = Object.create(SurvivorWeapon.prototype);
  Object.assign(presentation, { player, viewRoot, viewModel: model, viewBaseRotation: model.rotation.clone(),
    viewWeapons: { sword }, viewMixer: { update() {} }, viewAiming: false, aimBlend: 0, flashes: [] });
  for (const attack of SWORD_ATTACKS) {
    player.swordAttack = attack;
    let previousTurn = 0;
    const cameraRotation = player.camera.quaternion.clone();
    for (let frame = 0; frame <= 40; frame++) {
      const progress = frame / 40;
      player.bashTime = attack.duration * (1 - progress); presentation.bashing = true;
      presentation.update(1 / 60);
      const [x, y, z] = getSwordViewPose(attack, progress);
      const expectedGrip = new THREE.Vector3(0.33 + x, -0.26 + y, -0.65 + z);
      assert.ok(sword.getWorldPosition(new THREE.Vector3()).distanceTo(expectedGrip) < 1e-6,
        'Rotating the swing must not orbit the hand around the character origin');
      assert.ok(tip.getWorldPosition(new THREE.Vector3()).z < 0, 'The blade never flips behind the camera');
      if (attack.source === 'Stab') {
        const contact = attack.contact / attack.duration;
        const follow = contact + (1 - contact) * 0.28;
        if (progress >= contact * 0.62 && progress <= follow) {
          const bladeDirection = tip.getWorldPosition(new THREE.Vector3())
            .sub(sword.getWorldPosition(new THREE.Vector3())).normalize();
          assert.ok(bladeDirection.dot(new THREE.Vector3(0, 0, -1)) > 0.9999, 'The thrust points straight ahead even with a diagonal authored grip');
        }
      }
      if (attack.spin && progress < 1) {
        assert.ok(player.bodyMesh.rotation.y >= previousTurn, 'The spin keeps turning forward instead of reversing during recovery');
        previousTurn = player.bodyMesh.rotation.y;
        if (progress >= 0.18 && progress <= 0.84) {
          const bladeDirection = tip.getWorldPosition(new THREE.Vector3())
            .sub(sword.getWorldPosition(new THREE.Vector3())).normalize();
          assert.ok(bladeDirection.y <= 0 && bladeDirection.y > -0.1, 'The spinning slash stays nearly horizontal, slightly below level');
        }
      }
      assert.ok(player.camera.quaternion.equals(cameraRotation), 'The body spin does not rotate the camera');
    }
    if (attack.spin) {
      assert.ok(Math.abs(previousTurn - 2 * Math.PI) < 1e-6, 'The third attack completes exactly 360 degrees');
      assert.equal(player.bodyMesh.rotation.y, 0, 'The resting facing is restored after the completed turn');
    }
  }
  for (let index = 0; index < 2; index++) {
    const previous = SWORD_ATTACKS[index], next = SWORD_ATTACKS[index + 1];
    player.swordAttack = previous; player.bashTime = previous.duration - previous.chainAt;
    presentation.bash(); presentation.update(0);
    const oldGrip = sword.getWorldPosition(new THREE.Vector3());
    const oldRotation = model.quaternion.clone();
    player.swordAttack = next; player.bashTime = next.duration;
    presentation.bash({ chain: true }); presentation.update(0);
    assert.ok(sword.getWorldPosition(new THREE.Vector3()).distanceTo(oldGrip) < 1e-6,
      'A linked attack starts from the previous hand position');
    assert.ok(model.quaternion.angleTo(oldRotation) < 1e-6, 'The blade does not snap between attacks');
    player.bashTime -= 0.07; presentation.update(0.07);
    assert.ok(presentation.swordTransition, 'The hand and blade blend gradually through the transition');
    player.bashTime -= 0.07; presentation.update(0.07);
    assert.equal(presentation.swordTransition, null);
  }
});
