import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createTransformationMonster } from '../src/enemies/TransformationMonster.js';
import { DeanTransformation } from '../src/enemies/DeanTransformation.js';
import { createDegreeScroll } from '../src/props/DegreeScroll.js';
import { createDeanRevivalClip } from '../src/enemies/DeanRevivalMotion.js';

test('the shipped Dean rises with planted feet and settles into his idle pose', async () => {
  const data = JSON.parse(await readFile(new URL('../public/assets/models/zombies/Zombie_Arm.gltf', import.meta.url), 'utf8'));
  data.materials = data.materials.map(() => ({})); delete data.images; delete data.textures;
  globalThis.ProgressEvent ??= class {};
  const gltf = await new GLTFLoader().parseAsync(JSON.stringify(data), '');
  const group = new THREE.Group(); group.add(gltf.scene);
  const mixer = new THREE.AnimationMixer(gltf.scene), actions = {};
  for (const clip of gltf.animations) actions[clip.name] = mixer.clipAction(clip);
  const clip = createDeanRevivalClip({ group, mixer, actions }, 3.2);
  assert.ok(clip);
  const rise = mixer.clipAction(clip).setLoop(THREE.LoopOnce, 1); rise.clampWhenFinished = true; rise.play();
  const find = name => group.getObjectByName(THREE.PropertyBinding.sanitizeNodeName(name));
  const supportHand = [];
  group.traverse(mesh => {
    if (!mesh.isSkinnedMesh) return;
    const handBones = new Set(mesh.skeleton.bones.map((bone, index) =>
      /^(DeanSupportWrist|(Index|Middle|Pinky|Thumb)[123]R)$/.test(bone.name) ? index : -1));
    handBones.delete(-1);
    const vertices = [], indices = mesh.geometry.attributes.skinIndex, weights = mesh.geometry.attributes.skinWeight;
    for (let vertex = 0; vertex < indices.count; vertex++) {
      let influence = 0;
      for (let slot = 0; slot < 4; slot++) if (handBones.has(indices.getComponent(vertex, slot))) influence += weights.getComponent(vertex, slot);
      if (influence > 0.4) vertices.push(vertex);
    }
    supportHand.push({ mesh, vertices });
  });
  let previous = null, maxHeadStep = 0;
  for (let frame = 0; frame <= 192; frame++) {
    const time = frame / 60; mixer.setTime(time); group.updateMatrixWorld(true);
    const head = find('Head').getWorldPosition(new THREE.Vector3());
    if (previous) maxHeadStep = Math.max(maxHeadStep, head.distanceTo(previous));
    previous = head;
    const wrist = find('DeanSupportWrist');
    assert.ok(wrist.quaternion.angleTo(new THREE.Quaternion()) <= 1.14, 'wrist extension must remain anatomically bounded');
    if (time >= 0.8 && time <= 1.35 && frame % 6 === 0) {
      let lowest = Infinity;
      const point = new THREE.Vector3();
      for (const { mesh, vertices } of supportHand) for (const vertex of vertices) {
        mesh.getVertexPosition(vertex, point); mesh.localToWorld(point); lowest = Math.min(lowest, point.y);
      }
      assert.ok(lowest >= -0.008 && lowest <= 0.035,
        `the actual supporting hand must meet the floor without penetrating it (${lowest} at ${time}s)`);
    }
    if (time > 1.6) for (const side of ['L', 'R']) {
      const foot = find(`Foot.${side}`).getWorldPosition(new THREE.Vector3());
      assert.ok(foot.y > -0.025 && foot.y < 0.085, 'feet must support the rise on the ground');
    }
  }
  assert.ok(maxHeadStep < 0.065, 'the head must rise without a sudden frame jump');
  const held = find('Torso').quaternion.clone(); mixer.stopAllAction(); actions.Idle.reset().play(); mixer.update(0);
  assert.ok(held.angleTo(find('Torso').quaternion) < 0.03, 'the rise must blend into the authored idle');
});

test('the real monster catches the ballistic degree through fading dust and keeps it in its hand', async () => {
  const source = new URL('../public/assets/models/monster/scene.gltf', import.meta.url);
  const data = JSON.parse(await readFile(source, 'utf8'));
  const binary = await readFile(new URL('scene.bin', source));
  data.buffers[0].uri = `data:application/octet-stream;base64,${binary.toString('base64')}`;
  data.materials = data.materials.map(() => ({})); delete data.images; delete data.textures;
  globalThis.ProgressEvent ??= class {};
  const gltf = await new GLTFLoader().parseAsync(JSON.stringify(data), '');
  const root = new THREE.Group(), monster = createTransformationMonster(root, gltf);
  const dean = { group: new THREE.Group(), actions: {}, mixer: { update() {} } }; root.add(dean.group);
  dean.group.scale.setScalar(1.6);
  const oldHand = new THREE.Group(); dean.group.add(oldHand);
  const scroll = createDegreeScroll(); scroll.scale.set(0.82, 0.78, 0.78); oldHand.add(scroll);
  const cinematic = new DeanTransformation(root, dean, monster, scroll);
  cinematic.start(null);
  const catchMotion = cinematic.degreeCatch, timing = cinematic.timing;
  const middle = (timing.scrollLaunch + timing.scrollCatch) / 2;
  const apex = catchMotion.getFlightPosition(middle, new THREE.Vector3());
  assert.ok(apex.y > monster.height + 1.5, 'the degree must rise visibly above the cloud');
  const before = catchMotion.getFlightPosition(middle - 0.1, new THREE.Vector3());
  const after = catchMotion.getFlightPosition(middle + 0.1, new THREE.Vector3());
  assert.ok(Math.abs((after.y - 2 * apex.y + before.y) / 0.01 + 9.81) < 1e-8, 'flight must follow gravity');
  let beforeCatch, afterCatch, caughtInDust = false;
  const originalScale = scroll.getWorldScale(new THREE.Vector3());
  for (let frame = 0; frame < Math.ceil(timing.end * 60) + 30; frame++) {
    const wasCaught = catchMotion.caught;
    const previous = scroll.getWorldPosition(new THREE.Vector3());
    cinematic.update(1 / 60, null);
    if (cinematic.time < timing.scrollLaunch) assert.equal(catchMotion.launched, false);
    if (!wasCaught && catchMotion.caught) {
      beforeCatch = previous; afterCatch = scroll.getWorldPosition(new THREE.Vector3());
      caughtInDust = cinematic.dust.root.visible && cinematic.dust.coverage > 0;
      assert.ok(catchMotion.grip.getWorldPosition(new THREE.Vector3()).distanceTo(catchMotion.target) < 0.002,
        'the arm must reach the landing position');
    }
    if (catchMotion.caught) {
      assert.equal(scroll.parent, catchMotion.grip);
      assert.ok(scroll.position.length() < 1e-8, 'the degree must stay attached during breathing');
      assert.ok(scroll.getWorldScale(new THREE.Vector3()).distanceTo(originalScale) < 1e-6);
    }
  }
  assert.ok(caughtInDust, 'catch must happen before the dust finishes fading');
  assert.ok(beforeCatch.distanceTo(afterCatch) < 0.2, 'catch must not teleport the degree');
  assert.equal(catchMotion.grip.parent.name, 'L_wrist_017');
  assert.ok(catchMotion.hand.quaternion.angleTo(catchMotion.wristRest) < 0.08,
    'the settled wrist must follow the forearm without a forced bend');
  const elbow = catchMotion.elbow.getWorldPosition(new THREE.Vector3());
  const shoulder = catchMotion.upper.getWorldPosition(new THREE.Vector3());
  assert.ok(elbow.y < shoulder.y - 0.35, 'the resting elbow must stay below the shoulder');
  const freeHand = monster.group.getObjectByName('R_wrist_040').getWorldPosition(new THREE.Vector3());
  const holdingHand = catchMotion.hand.getWorldPosition(new THREE.Vector3());
  assert.ok(Math.abs(holdingHand.y - freeHand.y) < 0.3,
    'the holding arm must hang at the same relaxed height as the free arm');
  assert.ok(cinematic.done && catchMotion.caught && scroll.visible);
  const paperRadius = 0.105 * Math.max(originalScale.y, originalScale.z);
  for (const finger of catchMotion.fingers.filter(finger => finger.joint > 1)) {
    const point = catchMotion.grip.worldToLocal(finger.node.getWorldPosition(new THREE.Vector3()));
    const radius = Math.hypot(point.y, point.z);
    assert.ok(radius >= paperRadius + 0.015 && radius <= paperRadius + 0.07,
      `${finger.node.name} must wrap the paper surface rather than pass through it`);
  }
  cinematic.dispose(); assert.equal(scroll.parent, oldHand);
});
