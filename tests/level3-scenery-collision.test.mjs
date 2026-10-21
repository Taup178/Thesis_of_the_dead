import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { Level3 } from '../src/levels/Level3.js';
import { Player } from '../src/player/Player.js';
import { ArenaNavigation } from '../src/environment/ArenaNavigation.js';

globalThis.ProgressEvent ??= class {};
async function loadScenery(name) {
  const url = new URL(`../public/assets/models/desert/${name}/scene.gltf`, import.meta.url);
  const data = JSON.parse(await readFile(url, 'utf8'));
  data.materials = data.materials.map(() => ({}));
  delete data.images; delete data.textures;
  for (const buffer of data.buffers) if (!buffer.uri.startsWith('data:')) {
    buffer.uri = `data:application/octet-stream;base64,${(await readFile(new URL(buffer.uri, url))).toString('base64')}`;
  }
  return (await new GLTFLoader().parseAsync(JSON.stringify(data), '')).scene;
}
const [rocks, shrubs, scenery] = await Promise.all([
  loadScenery('desert__rocks__stones__pack'), loadScenery('desert_shrubs'), loadScenery('desert'),
]);

test('Level 3 ground clutter is walkable while large scenery stays solid from every side', () => {
  const scene = new THREE.Scene(), level = new Level3(scene);
  level.environment = new THREE.Group(); level.root.add(level.environment);
  level._createScenery({ rocks, shrubs, scenery });
  level._createDeanStage(); level._createEntrancePortal();
  const player = new Player(scene, { flushMouseDelta() {} }, new THREE.PerspectiveCamera());
  try {
    assert.ok(level.props.length > 80, 'exercise the complete supplied desert layout');
    const obstacles = level.getObstacles();
    const navigation = new ArenaNavigation(obstacles);
    let walkable = 0, crossings = 0, solid = 0;
    for (const prop of level.props) {
      const obstacle = obstacles.find(o => o.scenery === prop);
      assert.ok(level.getBulletObstacles().includes(prop), `${prop.name} also stops bullets`);
      const bounds = new THREE.Box3().setFromObject(prop);
      if (bounds.getSize(new THREE.Vector3()).y < 1) {
        walkable++;
        assert.equal(obstacle, undefined, `${prop.name}: plants and small rocks must be passable`);
        const center = bounds.getCenter(new THREE.Vector3());
        const start = center.clone().setY(0), end = start.clone();
        start.x = bounds.min.x - 0.6; end.x = bounds.max.x + 0.6;
        // Test against the entire arena when a nearby large prop does not occupy this path.
        if (navigation.clear(start, end)) {
          player.group.position.copy(start); player.velocity.set(0, 0, 0);
          player._moveHorizontally(end.x - start.x, 0, obstacles);
          assert.ok(player.group.position.distanceTo(end) < 1e-6, 'Shaun walks across the ground clutter');
          crossings++;
        }
        continue;
      }
      solid++;
      assert.ok(obstacle, `${prop.name}: large rocks, skulls and tall scenery stay solid`);
      const vertices = prop.geometry.getAttribute('position'), point = new THREE.Vector3();
      for (let i = 0; i < vertices.count; i++) {
        point.fromBufferAttribute(vertices, i).applyMatrix4(prop.matrixWorld);
        assert.ok(Math.hypot(point.x - obstacle.x, point.z - obstacle.z) <= obstacle.radius + 1e-6,
          `${prop.name}: collider includes horns and protruding edges`);
      }
      for (const axis of ['x', 'z']) for (const side of [-1, 1]) {
        player.group.position.set(obstacle.x, 0, obstacle.z);
        player.group.position[axis] += side * (obstacle.radius + 2);
        player.velocity.set(0, 0, 0);
        const distance = -side * (obstacle.radius + 2) * 2;
        player._moveHorizontally(axis === 'x' ? distance : 0, axis === 'z' ? distance : 0, [obstacle]);
        assert.ok(side * (player.group.position[axis] - obstacle[axis]) >= obstacle.radius + player.radius - 1e-6,
          `${prop.name}: cannot sprint or roll through it along ${axis}`);
      }
      const nav = new ArenaNavigation([obstacle]);
      assert.equal(nav.clear({ x: obstacle.x - obstacle.radius - 2, z: obstacle.z },
        { x: obstacle.x + obstacle.radius + 2, z: obstacle.z }), false, 'navigation respects the same prop');
    }
    assert.ok(walkable > 30 && crossings > 10, 'exercise actual walks over scattered plants and small rocks');
    assert.ok(solid >= 50, 'retain the large scenery collisions');
    const poles = level.staticObstacles.filter(o => o.scenery && !level.props.includes(o.scenery));
    assert.equal(poles.length, 2, 'both banner poles are solid');
    assert.ok(level.entrancePortal.obstacles.every(o => obstacles.includes(o)), 'entrance portal is solid');
    assert.ok(navigation.clear(level.spawnPoint, level.spawnPoint), 'the arrival stays clear of scenery');
    for (const goal of [new THREE.Vector3(0, 0, 0), new THREE.Vector3(-8, 0, -34), new THREE.Vector3(8, 0, -34)]) {
      const route = navigation.route(level.spawnPoint, goal);
      assert.ok(route.length && Math.hypot(route.at(-1).x - goal.x, route.at(-1).z - goal.z) < 0.01,
        'the arena centre and both final portals remain reachable');
    }
  } finally { player.dispose(); level.dispose(); }
});
