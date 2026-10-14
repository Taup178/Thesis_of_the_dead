import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { Level3 } from '../src/levels/Level3.js';
import { DeanBoss } from '../src/enemies/DeanBoss.js';
import { DeanTransformation } from '../src/enemies/DeanTransformation.js';
import { createTransformationMonster } from '../src/enemies/TransformationMonster.js';
import { Player } from '../src/player/Player.js';

globalThis.ProgressEvent ??= class { constructor(type, properties) { Object.assign(this, properties); } };
async function rig(file) {
  const path = new URL(file, import.meta.url), asset = JSON.parse(readFileSync(path));
  for (const buffer of asset.buffers) if (!buffer.uri.startsWith('data:')) {
    buffer.uri = `data:application/octet-stream;base64,${readFileSync(new URL(buffer.uri, path)).toString('base64')}`;
  }
  // Use actual meshes, bones and clips. Omit browser-only texture decoding in this timing check.
  asset.materials = asset.materials.map(() => ({ pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1] } }));
  return new GLTFLoader().parseAsync(JSON.stringify(asset), '');
}

async function fixture() {
  const scene = new THREE.Scene(), level = new Level3(scene);
  const [deanRig, monsterRig] = await Promise.all([
    rig('../public/assets/models/zombies/Zombie_Arm.gltf'), rig('../public/assets/models/monster/scene.gltf'),
  ]);
  const group = new THREE.Group(); group.add(deanRig.scene); group.scale.setScalar(1.6); group.position.set(0, 0, -4); level.root.add(group);
  const mixer = new THREE.AnimationMixer(deanRig.scene);
  const dean = { group, mixer, alive: true, actions: Object.fromEntries(deanRig.animations.map(clip => [clip.name, mixer.clipAction(clip)])),
    _playAction(name, fade = 0.12, restart = false) {
      const action = this.actions[name]; if (!action || action === this.currentAction && !restart) return;
      action.reset().play();
      if (this.currentAction && action !== this.currentAction) this.currentAction.crossFadeTo(action, fade, false);
      this.currentAction = action;
    },
    takeDamage(amount) {
      this.health = Math.max(0, this.health - amount);
      if (this.health) return false;
      this.alive = false; this._playAction('Death', 0.2);
      this.actions.Death.setLoop(THREE.LoopOnce, 1); this.actions.Death.clampWhenFinished = true;
      return true;
    }, dispose() { mixer.stopAllAction(); } };
  dean._playAction('Idle'); mixer.update(0);
  level.dean = dean; level.bossMarker = group; level.bossFight = new DeanBoss(level.root, dean); level.bossFight.phase = 'combat';
  level.transformationMonster = createTransformationMonster(level.root, monsterRig);
  level.preparedTransformation = new DeanTransformation(level.root, dean, level.transformationMonster);
  const player = new Player(scene, { flushMouseDelta() {}, isDown: () => false }, new THREE.PerspectiveCamera(60, 1.6, 0.1, 300));
  player.group.position.set(0, 0, 8); player._updateCamera();
  level.arenaCleared = true;
  const advance = time => {
    while (level.transformation.time < time - 0.0001) {
      const event = level.update(Math.min(1 / 60, time - level.transformation.time), player);
      assert.equal(event.levelComplete, false, 'No victory overlay or next encounter interrupts the reveal');
    }
    scene.updateMatrixWorld(true);
  };
  return { scene, level, dean, player, advance, cleanup() {
    level.dispose(); player.dispose();
    for (const asset of [deanRig, monsterRig]) asset.scene.traverse(node => {
      if (node.isMesh) { node.geometry.dispose(); node.material.dispose(); }
    });
  } };
}

test('a lethal boss hit reveals the Monster through slow clearing dust and restores gameplay with an idle boss', async () => {
  const f = await fixture();
  try {
    const mesh = f.dean.group.getObjectByProperty('isMesh', true);
    mesh.material.emissive.setHex(0xffffff); mesh.material.emissiveIntensity = 0.6;
    assert.equal(f.level.handleBulletHit({ object: mesh }, 300, f.player), true);
    const cut = f.level.transformation, timing = cut.timing;
    assert.equal(f.player.score, 1000); assert.equal(f.player.scriptedMovement, true);
    assert.equal(mesh.material.emissive.getHex(), 0, 'The killing-hit flash is cleared before the revival');
    assert.equal(mesh.material.emissiveIntensity, 0);
    assert.equal(f.level.transformationCinematicActive, true); assert.equal(f.level.allowsShooting, false);
    f.level.handleBulletHit({ object: mesh }, 300, f.player);
    assert.equal(f.player.score, 1000, 'The boss kill awards points once');
    f.advance(timing.fallEnd);
    const head = f.dean.group.getObjectByName('Head'), low = head.getWorldPosition(new THREE.Vector3()).y;
    f.advance(timing.wakeEnd + 0.1);
    assert.ok(head.getWorldPosition(new THREE.Vector3()).y > low + 0.6, 'The native fall reverses from the ground into a standing pose');
    f.advance(timing.burst - 0.02);
    assert.ok(f.dean.group.scale.x > 2.05, 'His body visibly expands before the dust blast');
    assert.equal(f.level.transformationMonster.group.visible, false);
    f.advance(timing.swap - 0.01);
    assert.ok(cut.dust.coverage > 0.99); assert.equal(cut.swapped, false, 'Dense dust precedes the hidden swap');
    f.advance(timing.swap + 0.01);
    assert.equal(f.dean.group.visible, false); assert.equal(f.level.transformationMonster.group.visible, true);
    assert.ok(cut.materials.filter(saved => saved.actor === 'monster').every(saved => saved.material.opacity === 1),
      'The new boss is solid behind the covering dust, rather than fading in as a ghost');
    assert.ok(cut.dust.coverage > 0.99, 'The model swap happens at the peak of the dust blast');
    assert.equal(cut.dust.clouds.count, 17, 'Dust remains a small fixed instanced batch');
    assert.ok(timing.clearEnd - timing.clearStart >= 6.5, 'Dust clears slowly over at least six and a half seconds');
    f.advance((timing.clearStart + timing.clearEnd) / 2);
    assert.equal(cut.dust.root.visible, true, 'Dust remains present halfway through the reveal');
    assert.ok(cut.dust.opacity[0] > 0 && cut.dust.opacity[0] < 1);
    f.advance(timing.end);
    assert.equal(cut.done, true); assert.equal(cut.dust.root.visible, false);
    assert.equal(f.level.levelComplete, false);
    for (let frame = 0; frame < 45; frame++) f.level.update(1 / 60, f.player);
    assert.equal(f.player.scriptedMovement, false); assert.equal(f.level.allowsShooting, true);
    assert.equal(f.level.transformationCinematicActive, false);
    assert.equal(f.level.getTargetStatus(), null); assert.equal(f.level.getChallengeStatus(), null);
    const normalCamera = f.player.camera.position.clone(); f.player._updateCamera();
    assert.ok(f.player.camera.position.distanceTo(normalCamera) < 0.001, 'The selected gameplay camera is restored');
    assert.ok(f.level.getBulletObstacles().includes(cut.monsterMeshes[0]));
    assert.ok(f.level.getObstacles().includes(cut.monsterObstacle), 'The idle creature has a physical presence');
    const bossPosition = cut.monster.group.position.clone(), playerHealth = f.player.health;
    f.level.update(5, f.player);
    assert.deepEqual(cut.monster.group.position, bossPosition); assert.equal(f.player.health, playerHealth);
    assert.equal(f.level.bossFight.phase, 'defeated'); assert.equal(f.level.transformationMonster.group.visible, true);
  } finally { f.cleanup(); }
});

test('a melee kill starts the same cutscene and restart disposal restores control and releases effects', async () => {
  const f = await fixture();
  try {
    assert.equal(f.level.handleMeleeHit(f.dean, 300, f.player), true);
    const cut = f.level.transformation;
    assert.ok(cut.started); assert.equal(f.player.scriptedMovement, true);
    assert.deepEqual(f.level.getRestartState(), { arenaCleared: true, timeRemaining: 60 });
    f.level.dispose();
    assert.equal(cut.disposed, true); assert.equal(cut.dust.root.parent, null);
    assert.equal(f.player.scriptedMovement, false); assert.equal(f.level.transformationCinematicActive, false);
  } finally { f.cleanup(); }
});
