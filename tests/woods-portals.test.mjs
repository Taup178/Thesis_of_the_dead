import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Level1 } from '../src/levels/Level1.js';
import { Player } from '../src/player/Player.js';

function setup() {
  const scene = new THREE.Scene(), level = new Level1(scene);
  level._createFallbackPortal(); level._createRedPortal();
  const input = { pointerLocked: true, mouseDeltaX: 0, mouseDeltaY: 0, isDown: () => false, flushMouseDelta() {} };
  const player = new Player(scene, input, new THREE.PerspectiveCamera(60, 1.5, 0.1, 500));
  player.actions = {};
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.7, 1.7, 0.4), new THREE.MeshStandardMaterial());
  mesh.position.y = 0.85; player.bodyMesh.add(mesh);
  level._spawnBoss = () => { level.bossState = 'done'; };
  return { scene, level, player, mesh, cleanup: () => { level.dispose(); player.dispose(); } };
}

test('the red portal faces the green entrance from the opposite side of the woods', () => {
  const f = setup();
  try {
    assert.equal(f.level.redPortalRoot.position.z, 45);
    assert.equal(f.level.portalRoot.position.z, -45);
    assert.ok(Math.abs(f.level.redPortalRoot.rotation.y - Math.PI) < 1e-8);
    const red = f.level.redPortalRoot.children[0].material;
    assert.ok(red.emissive.r > red.emissive.g);
    assert.ok(f.level.portalModel.material.emissive.g > f.level.portalModel.material.emissive.r);
    assert.notEqual(red, f.level.portalModel.material);
  } finally { f.cleanup(); }
});

test('each orb activates exactly two zombies, staggered from the red portal, with no repeat pickup', () => {
  const f = setup();
  try {
    f.level._createCredits(2);
    f.level.credits[0].mesh.position.set(0, 1.5, 0); f.level.credits[1].mesh.position.set(10, 1.5, 0);
    f.level.zombieReserve = Array.from({ length: 4 }, () => {
      const group = new THREE.Group(); group.visible = false; f.scene.add(group);
      return { alive: true, group, update: () => ({ hit: false }), dispose: () => group.removeFromParent() };
    });
    f.level.update(0.01, f.player, 0);
    assert.equal(f.level.zombies.length, 2); assert.equal(f.level.zombieReserve.length, 2);
    assert.equal(f.level.zombies[0].group.visible, true); assert.equal(f.level.zombies[1].group.visible, false);
    assert.ok(f.level.zombies[0].group.position.z > 44);
    for (let i = 0; i < 150; i++) f.level.update(1 / 60, f.player, i / 60);
    assert.equal(f.level.zombies.length, 2);
    assert.ok(f.level.zombies.every(z => !z.portalExit && z.group.visible && Math.abs(z.group.position.z - 39) < 1e-7));
    f.player.group.position.x = 10; f.level.update(0.01, f.player, 0);
    assert.equal(f.level.zombies.length, 4); assert.equal(f.level.zombieReserve.length, 0);
    assert.equal(f.player.score, 200);
  } finally { f.cleanup(); }
});

test('crossing any world edge recovers at that edge, faces opposite the crossing, and displays a timed notice', () => {
  const f = setup();
  try {
    for (const limit of [60, 46]) for (const [x, z] of [[65, 0], [-65, 0], [0, 65], [0, -65], [65, 65]]) {
      f.player.reset(new THREE.Vector3(Math.sign(x) * (limit - 2), 0, Math.sign(z) * (limit - 2)));
      const before = f.player.group.position.clone();
      f.player.group.position.set(Math.sign(x) * (limit + 2), 0, Math.sign(z) * (limit + 2));
      const outward = f.player.group.position.clone().sub(before).normalize();
      f.player.update(0, [], { minX: -limit, maxX: limit, minZ: -limit, maxZ: limit });
      assert.ok(f.player.getForwardDirection().dot(outward) < -0.999);
      assert.ok(Math.abs(f.player.group.position.x) < limit && Math.abs(f.player.group.position.z) < limit);
      assert.ok(f.player.group.position.length() > limit - 3, 'Returns near the crossed edge');
      assert.ok(f.player.boundaryNoticeTime > 0);
      f.player.update(4); assert.equal(f.player.boundaryNoticeTime, 0);
    }
  } finally { f.cleanup(); }
});

test('the Dean leaving does not finish the level; entering triggers shrink, disappearance and automatic advance', () => {
  const f = setup();
  try {
    f.level.bossState = 'done';
    let event = f.level.update(0.05, f.player, 0);
    assert.equal(event.levelComplete, false); assert.equal(f.level.playerAbsorption, null);
    f.player.toggleCamera();
    f.player.group.position.copy(f.level.portalApproachPoint);
    f.level.update(0.05, f.player, 0);
    assert.equal(f.player.scriptedMovement, true); assert.equal(f.player.bodyMesh.visible, true);
    assert.equal(f.level.allowsShooting, false);
    f.level.update(1.1, f.player, 1.1);
    assert.ok(f.player.group.scale.x < 0.5 && f.player.group.scale.x > 0.1);
    assert.ok(f.player.group.position.y > 0);
    event = f.level.update(1.1, f.player, 2.2);
    assert.equal(f.player.group.visible, false); assert.equal(event.levelComplete, false);
    event = f.level.update(0.3, f.player, 2.5);
    assert.equal(event.levelComplete, true); assert.equal(event.autoAdvance, true);
    f.level._restorePlayerAppearance();
    assert.equal(f.player.group.visible, true); assert.equal(f.player.group.scale.x, 1);
    assert.equal(f.player.bodyMesh.visible, false); assert.equal(f.player.isFirstPerson, true);
    assert.equal(f.mesh.material.opacity, 1); assert.equal(f.mesh.material.transparent, false);
  } finally { f.cleanup(); }
});

test('restarting during portal travel restores player appearance and movement', () => {
  const f = setup();
  try {
    f.level._beginPlayerAbsorption(f.player); f.level._updatePlayerAbsorption(1.8);
    f.level._restorePlayerAppearance(); f.player.reset(new THREE.Vector3());
    assert.equal(f.player.scriptedMovement, false); assert.equal(f.player.group.scale.x, 1);
    assert.equal(f.player.bodyMesh.visible, true); assert.equal(f.mesh.material.opacity, 1);
    assert.equal(f.mesh.material.depthWrite, true);
  } finally { f.cleanup(); }
});
