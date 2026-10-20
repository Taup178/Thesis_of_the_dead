import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createPortalObstacles } from '../src/props/PortalObstacles.js';
import { RoomExitPortal } from '../src/props/RoomExitPortal.js';
import { Player } from '../src/player/Player.js';
import { Level2 } from '../src/levels/Level2.js';

// Use the shipped geometry and its existing portal normalization, without textures or fetches.
const url = new URL('../public/assets/models/portal/portal.gltf', import.meta.url);
const asset = JSON.parse(readFileSync(url, 'utf8'));
asset.materials = asset.materials.map(() => ({}));
delete asset.images; delete asset.textures;
for (const buffer of asset.buffers) if (!buffer.uri.startsWith('data:')) {
  buffer.uri = `data:application/octet-stream;base64,${readFileSync(new URL(buffer.uri, url)).toString('base64')}`;
}
globalThis.ProgressEvent ??= class {};
const { scene: template } = await new GLTFLoader().parseAsync(JSON.stringify(asset), '');
for (const [name, diameter] of [['Object_35', 10.3135], ['Object_17', 7.4], ['Object_19', 8.2]]) {
  const geometry = template.getObjectByName(name).geometry;
  geometry.computeBoundingBox();
  const center = geometry.boundingBox.getCenter(new THREE.Vector3()), size = geometry.boundingBox.getSize(new THREE.Vector3());
  geometry.translate(-center.x, -center.y, -center.z);
  geometry.scale(diameter / size.x, diameter / size.x, diameter / size.x);
  geometry.translate(0, 4, 0);
}

function portal(scale = 1, rotation = 0) {
  const root = new THREE.Group(), model = template.clone(true);
  model.position.y = 1.68 * scale; model.scale.setScalar(scale);
  root.rotation.y = rotation; root.add(model);
  return root;
}

function player() {
  return new Player(new THREE.Scene(), { flushMouseDelta() {} }, new THREE.PerspectiveCamera(60, 1.6, 0.1, 500));
}

test('both forest portals and smaller room portals block fast movement from every side', () => {
  for (const scale of [1, 0.65]) for (const rotation of [0, Math.PI]) {
    const root = portal(scale, rotation), obstacles = createPortalObstacles(root);
    const bounds = new THREE.Box3().setFromObject(root, true), center = bounds.getCenter(new THREE.Vector3());
    for (const axis of ['x', 'z']) for (const side of [-1, 1]) {
      const p = player();
      try {
        p.group.position.set(center.x, 0, center.z);
        p.group.position[axis] = (side > 0 ? bounds.max[axis] : bounds.min[axis]) + side * 4;
        const distance = bounds.max[axis] - bounds.min[axis] + 8;
        p._moveHorizontally(axis === 'x' ? -side * distance : 0, axis === 'z' ? -side * distance : 0, obstacles);
        assert.ok(side * (p.group.position[axis] - center[axis]) > 0, 'cannot sprint or roll through the portal');
        for (const obstacle of obstacles) assert.ok(Math.hypot(p.group.position.x - obstacle.x,
          p.group.position.z - obstacle.z) >= obstacle.radius + p.radius - 1e-6);
      } finally { p.dispose(); }
    }
  }
});

test('fallback portals also block their hollow opening', () => {
  const room = new RoomExitPortal(new THREE.Group(), new THREE.Vector3()), p = player();
  try {
    p.group.position.set(0, 0, 5);
    p._moveHorizontally(0, -10, room.obstacles);
    assert.ok(p.group.position.z > 0.5);
  } finally { p.dispose(); }
});

test('room exit collision still lets the approach trigger start and finish scripted portal travel', () => {
  const level = new Level2(new THREE.Scene()), p = player(), root = portal(0.65);
  level.obstacles = createPortalObstacles(root);
  level.exitPortal = { center: new THREE.Vector3(0, 2.2, 0) };
  level.portalApproachPoint = new THREE.Vector3(0, 0, 2.5);
  level.phase = 'exit';
  try {
    p.group.position.set(0, 0, 8);
    p._moveHorizontally(0, -5.5, level.getObstacles());
    level._updateExit(0, p);
    assert.equal(level.phase, 'entering');
    assert.equal(p.scriptedMovement, true);
    for (let i = 0; i < 20 && !level.levelComplete; i++) level._updateExit(0.1, p);
    assert.equal(level.levelComplete, true);
  } finally { p.dispose(); }
});
