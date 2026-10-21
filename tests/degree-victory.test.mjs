import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { Player } from '../src/player/Player.js';
import { DegreeVictory } from '../src/player/DegreeVictory.js';
import { monsterFixture } from './helpers/monster-fixture.mjs';

globalThis.ProgressEvent ??= class {};
const data = JSON.parse(readFileSync(new URL('../public/assets/models/character/shaun.gltf', import.meta.url), 'utf8'));
data.materials = data.materials.map(() => ({}));

test('Shaun wraps every digit around the parchment and carries it with a relaxed arm', async () => {
  const f = await monsterFixture(), scene = new THREE.Scene();
  const player = new Player(scene, { flushMouseDelta() {} }, new THREE.PerspectiveCamera());
  const loaded = await new GLTFLoader().parseAsync(JSON.stringify(data), '');
  const model = loaded.scene;
  model.rotation.y = Math.PI; player.bodyMesh.add(model);
  const unit = 1.75 / new THREE.Box3().setFromObject(model, true).getSize(new THREE.Vector3()).y;
  model.scale.set(-unit, unit, unit);
  model.position.y = -new THREE.Box3().setFromObject(model, true).min.y;
  player.characterModel = model; player.animations = loaded.animations;
  player.mixer = new THREE.AnimationMixer(model);
  player.actions = Object.fromEntries(loaded.animations.map(clip => [clip.name, player.mixer.clipAction(clip)]));
  player._playAnimation('Idle'); player.mixer.update(0.3);
  const victory = new DegreeVictory(player, { group: f.monster.group }, f.degreeCatch);
  try {
    victory.grip.attach(f.scroll);
    victory.transfer = { position: f.scroll.position.clone(), rotation: f.scroll.quaternion.clone(), scale: f.scroll.scale.clone() };
    victory.taken = true; victory.done = true;
    assert.equal(victory.fingerContacts.length, 4, 'the supplied hand has three fingers and a thumb');
    for (const name of ['Idle', 'Walk', 'Run', 'Jump_Idle']) {
      player._playAnimation(name, 'Idle');
      for (let frame = 0; frame < 20; frame++) {
        player.mixer.update(1 / 60); victory.keepHolding();
        const scale = f.scroll.getWorldScale(new THREE.Vector3());
        assert.ok(Math.abs(scale.x) * 0.85 >= 0.62, 'the degree remains full sized');
        assert.ok(Math.abs(scale.y) * 0.21 >= 0.09, 'the parchment has a substantial diameter');
        for (const { joints, tip } of victory.fingerContacts) {
          for (const point of [...joints.slice(1).map(joint => joint.getWorldPosition(new THREE.Vector3())),
            joints.at(-1).localToWorld(tip.clone())]) {
            const local = f.scroll.worldToLocal(point);
            const radius = Math.hypot(local.y, local.z);
            assert.ok(radius > 0.105 && radius < 0.21, `${name}: ${joints[0].name} wraps the paper surface (${radius})`);
            assert.ok(Math.abs(local.x) < 0.425, 'every digit stays on the roll');
          }
        }
        const upper = victory.upper.quaternion.clone(), lower = victory.lower.quaternion.clone();
        victory.keepHolding();
        assert.ok(victory.upper.quaternion.equals(upper), 'carrying preserves the natural upper arm pose');
        assert.ok(victory.lower.quaternion.equals(lower), 'carrying preserves the natural elbow pose');
      }
    }
  } finally { victory.dispose(); f.degreeCatch.dispose(); player.dispose(); }
});
