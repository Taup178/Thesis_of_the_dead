import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Level2 } from '../src/levels/Level2.js';
import { createSophomorePatterns } from '../src/levels/sophomorePatterns.js';
import { LevelManager } from '../src/levels/LevelManager.js';
import { Player } from '../src/player/Player.js';

function createGame(stageIndex = 0, seed = 1234) {
  const scene = new THREE.Scene();
  const level = new Level2(scene, { stageIndex, seed });
  level._createRoom();
  level._createTiles();
  level.bossMarker = new THREE.Group();
  level.root.add(level.bossMarker);
  // Model loading is covered in the browser; these tests exercise the real level and physics.
  level.dean = { actions: {}, _playAction() {}, dispose() {} };
  const input = { keys: {}, presses: new Set(), pointerLocked: true, mouseDeltaX: 0, mouseDeltaY: 0,
    isDown(key) { return !!this.keys[key]; }, consumeKeyPress(key) { return this.presses.delete(key); },
    flushMouseDelta() { this.mouseDeltaX = this.mouseDeltaY = 0; } };
  const player = new Player(scene, input, new THREE.PerspectiveCamera(60, 1.5, 0.1, 500));
  level.preparePlayer(player);
  const step = (dt = 1 / 60) => {
    player.update(dt, [], null, level.getPlatforming());
    return level.update(dt, player);
  };
  const until = (condition, dt = 1 / 60, limit = 1200) => {
    let frames = 0;
    while (!condition() && frames++ < limit) step(dt);
    assert.ok(condition(), `Timed out: phase=${level.phase}, position=${player.group.position.toArray()}`);
  };
  const jump = (key, dt = 1 / 60) => {
    input.keys[key] = true;
    // Walk towards the edge, then cross the gap with the existing jump distance.
    const goal = level.tilePosition(...level.pattern[level.expectedIndex]);
    const axis = key === 'KeyW' ? 'z' : 'x';
    const sign = key === 'KeyW' || key === 'KeyA' ? -1 : 1;
    const start = player.group.position.clone();
    let walkFrames = 0;
    while ((goal[axis] - player.group.position[axis]) * sign > 3.15 && walkFrames++ < 60) {
      step(dt);
      assert.equal(player.grounded, true, 'The walk-up remains inside the larger tile');
      assert.equal(level.phase, 'follow');
    }
    assert.ok(player.group.position.distanceTo(start) > 1, 'There is room for several steps before jumping');
    input.presses.add('Space');
    step(dt);
    assert.equal(player.grounded, false, 'Space launches a jump');
    until(() => player.grounded || !player.alive, dt, 100);
    input.keys[key] = false;
    assert.equal(player.alive, true);
    assert.notEqual(level.phase, 'failed', level.failureReason);
  };
  const land = (i, j) => {
    player.group.position.copy(level.tilePosition(i, j)).add(new THREE.Vector3(0, 0.3, 0));
    player.verticalVelocity = -3;
    player.grounded = false;
    until(() => player.grounded || level.phase === 'failed');
  };
  const cleanup = () => { player.dispose(); level.dispose(); };
  return { level, scene, input, player, step, until, jump, land, cleanup };
}

test('seeded routes vary, stay adjacent, and never require a collapsed tile across 128 courses', () => {
  const courses = new Set(), startColumns = new Set();
  const variants = Array.from({ length: 4 }, () => new Set());
  for (let seed = 0; seed < 128; seed++) {
    const patterns = createSophomorePatterns(seed);
    assert.deepEqual(patterns, createSophomorePatterns(seed), 'A seed recreates the exact course on retry');
    courses.add(JSON.stringify(patterns));
    startColumns.add(patterns[0][0][0]);
    const visited = new Set();
    for (let stage = 0; stage < patterns.length; stage++) {
      const pattern = patterns[stage];
      assert.equal(pattern.length - 1, [4, 6, 8, 10][stage]);
      const [startI, startJ] = pattern[0];
      variants[stage].add(JSON.stringify(pattern.map(([i, j]) => [i ^ startI, j - startJ])));
      for (let index = 0; index < pattern.length; index++) {
        const [i, j] = pattern[index];
        assert.ok(i === 0 || i === 1);
        assert.ok(j >= 0 && j <= patterns.at(-1).at(-1)[1]);
        if (index === 0 && stage > 0) {
          assert.deepEqual(pattern[index], patterns[stage - 1].at(-1));
          continue;
        }
        assert.ok(!visited.has(`${i},${j}`));
        visited.add(`${i},${j}`);
        if (index > 0) {
          const [previousI, previousJ] = pattern[index - 1];
          assert.equal(Math.abs(i - previousI) + Math.abs(j - previousJ), 1);
          assert.ok(j >= previousJ);
        }
      }
    }
  }
  assert.ok(courses.size >= 100);
  assert.equal(startColumns.size, 2);
  for (const choices of variants) assert.ok(choices.size >= 3, 'Each stage has different movement orders');
});

test('two columns, valid adjacent jumps, continuous checkpoints and increasing difficulty', () => {
  const game = createGame();
  try {
    assert.deepEqual(game.level.tiles.map(column => column.length), [game.level.rows, game.level.rows]);
    const visited = new Set();
    let previousTileTime = Infinity, previousDeanTime = Infinity, previousLength = 0;
    for (let stage = 0; stage < game.level.patterns.length; stage++) {
      const pattern = game.level.patterns[stage];
      assert.ok(pattern.length > previousLength);
      for (let index = 0; index < pattern.length; index++) {
        const [i, j] = pattern[index];
        assert.ok(game.level.tiles[i][j]);
        if (index === 0 && stage > 0) {
          assert.deepEqual(pattern[index], game.level.patterns[stage - 1].at(-1));
          continue;
        }
        assert.ok(!visited.has(`${i},${j}`), 'No later stage requires a collapsed tile');
        visited.add(`${i},${j}`);
        if (index > 0) assert.equal(Math.abs(i - pattern[index - 1][0]) + Math.abs(j - pattern[index - 1][1]), 1);
      }
      game.level.stageIndex = stage;
      assert.ok(game.level.difficulty.tileTime < previousTileTime);
      assert.ok(game.level.difficulty.jumpDuration < previousDeanTime);
      previousTileTime = game.level.difficulty.tileTime;
      previousDeanTime = game.level.difficulty.jumpDuration;
      previousLength = pattern.length;
    }
  } finally { game.cleanup(); }
});

test('arrival falls onto the starting deck, freezes movement during watching and erases route hints', () => {
  const game = createGame();
  try {
    const originalX = game.player.group.position.x;
    game.input.keys.KeyW = game.input.keys.KeyD = true;
    game.input.presses.add('Space');
    game.until(() => game.level.phase === 'follow');
    assert.equal(game.player.group.position.x, originalX);
    assert.equal(game.player.group.position.z, 0);
    assert.equal(game.player.group.position.y, 0);
    assert.equal(game.player.platformSupport, game.level.startSurface);
    for (const tile of game.level.tiles.flat()) {
      assert.equal(tile.preview, false);
      assert.equal(tile.timer, null);
      assert.equal(tile.mesh.material.color.getHex(), tile === game.level.targetTile ? 0x46dd9b : 0x626b79);
    }
    const center = game.level.tilePosition(...game.level.pattern.at(-1));
    assert.ok(game.level.bossMarker.position.distanceTo(game.level.deanCheckpointPosition(...game.level.pattern.at(-1))) < 1e-8);
    assert.ok(game.level.bossMarker.position.distanceTo(center) > 2, 'The Dean leaves the center clear for the player');
  } finally { game.cleanup(); }
});

for (const dt of [1 / 60, 1 / 20]) {
  test(`all four routes can be completed with real forward/sideways jumps at ${Math.round(1 / dt)} FPS`, () => {
    const game = createGame();
    try {
      game.until(() => game.level.phase === 'follow', dt);
      game.jump('KeyW', dt); // Arrival deck -> the randomized first column.
      for (let stage = 0; stage < game.level.patterns.length; stage++) {
        const pattern = game.level.patterns[stage];
        for (let index = 1; index < pattern.length; index++) {
          const [previousI, previousJ] = pattern[index - 1], [i, j] = pattern[index];
          game.jump(j > previousJ ? 'KeyW' : i > previousI ? 'KeyD' : 'KeyA', dt);
          assert.equal(game.level.currentTile, game.level.tiles[i][j]);
        }
        assert.ok(game.player.group.position.distanceTo(game.level.bossMarker.position) > 1.8, 'Checkpoint landings do not touch the Dean');
        if (stage < game.level.patterns.length - 1) {
          assert.equal(game.level.phase, 'watch');
          assert.equal(game.level.currentTile.timer, null, 'Checkpoint stays safe throughout the demonstration');
          game.until(() => game.level.phase === 'follow', dt);
        }
      }
      assert.equal(game.level.levelComplete, false, 'Reaching the last checkpoint does not skip the portal');
      assert.equal(game.level.phase, 'dean_exit');
      assert.equal(game.level.creditsCollected, 4);
      assert.equal(game.player.score, 1200);
      const safePosition = game.player.group.position.clone();
      game.until(() => game.level.phase === 'exit', dt);
      assert.equal(game.level.bossMarker.visible, false, 'The Dean disappears first');
      assert.ok(game.player.group.position.distanceTo(safePosition) < 0.001);
      assert.equal(game.level.levelComplete, false);
      game.input.keys.KeyW = true;
      game.until(() => game.level.phase === 'entering', dt);
      game.input.keys.KeyW = false;
      assert.equal(game.player.scriptedMovement, true);
      game.until(() => game.level.levelComplete, dt);
      assert.equal(game.player.group.visible, false);
      assert.equal(game.step(dt).autoAdvance, true, 'Walking through enters the Final Encounter automatically');
    } finally { game.cleanup(); }
  });
}

test('a later tile in the correct route still fails when reached out of sequence', () => {
  const game = createGame();
  try {
    game.until(() => game.level.phase === 'follow');
    game.land(...game.level.pattern[0]);
    const skipped = game.level.pattern[2];
    game.land(...skipped); // A valid route tile, but the next landing was skipped.
    assert.equal(game.level.phase, 'failed');
    assert.equal(game.level.tiles[skipped[0]][skipped[1]].falling, true);
    assert.ok(!game.level.getPlatforming().surfaces.includes(game.level.tiles[skipped[0]][skipped[1]].surface));
    game.until(() => !game.player.alive);
    assert.equal(game.player.health, 0);
    assert.ok(game.player.camera.position.y < 0, 'Camera follows the player into the pit');
  } finally { game.cleanup(); }
});

test('an unused tile collapses and fails the player', () => {
  const game = createGame();
  try {
    game.until(() => game.level.phase === 'follow');
    game.land(1 - game.level.pattern[0][0], 0);
    assert.equal(game.level.phase, 'failed');
    assert.match(game.level.failureReason, /not the next tile/);
  } finally { game.cleanup(); }
});

test('staying too long collapses the tile, and a jump in place does not reset its timer', () => {
  const game = createGame();
  try {
    game.until(() => game.level.phase === 'follow');
    game.land(...game.level.pattern[0]);
    const tile = game.level.currentTile;
    const before = tile.timer;
    game.input.presses.add('Space');
    game.step();
    game.until(() => game.player.grounded);
    assert.ok(tile.timer < before - 0.5);
    game.until(() => game.level.phase === 'failed');
    assert.equal(tile.falling, true);
    assert.equal(tile.mesh.visible, false, 'The intact slab is replaced by broken pieces');
    assert.equal(tile.fragments.length, 9);
    const fragmentStart = tile.fragments[0].mesh.position.clone();
    assert.ok(game.level.spikes.isInstancedMesh);
    assert.ok(game.level.spikes.count > 1000);
    assert.match(game.level.failureReason, /collapsed/);
    for (let frame = 0; frame < 12; frame++) game.step();
    assert.ok(tile.fragments[0].mesh.position.y < fragmentStart.y);
    assert.ok(Math.abs(tile.fragments[0].mesh.position.x - fragmentStart.x) > 0.01, 'Chunks separate as they fall');
    assert.equal(game.player.alive, true, 'Breaking the slab starts a fall, not instant death');
    game.until(() => !game.player.alive);
    assert.equal(game.player.group.position.y, game.level.spikeTipY, 'Death occurs at the visible spike tips');
  } finally { game.cleanup(); }
});

test('walking into a gap falls instead of landing on an invisible ground plane', () => {
  const game = createGame();
  try {
    game.until(() => game.level.phase === 'follow');
    game.input.keys.KeyW = true;
    game.until(() => !game.player.alive);
    assert.equal(game.level.phase, 'failed');
    assert.match(game.level.failureReason, /between the tiles/);
  } finally { game.cleanup(); }
});

test('retry restores the completed checkpoint and re-demonstrates the unfinished route', async () => {
  const game = createGame(2);
  try {
    const manager = new LevelManager(game.scene);
    manager.currentLevel = game.level;
    manager.currentLevelIndex = 1;
    manager.loadLevel = async (index, progress, restart) => ({ index, restart });
    const saved = game.level.getRestartState();
    assert.deepEqual(await manager.restartLevel(), { index: 1, restart: saved });
    const restored = new Level2(game.scene, saved);
    assert.deepEqual(restored.patterns, game.level.patterns);
    restored.dispose();
    assert.equal(manager._getLevelClass(1), Level2);
    assert.deepEqual(await manager.nextLevel(), { index: 2, restart: undefined }, 'Continue enters the Final Encounter');
    game.until(() => game.level.phase === 'follow');
    const [startI, startJ] = game.level.pattern[0];
    assert.equal(game.level.currentTile, game.level.tiles[startI][startJ]);
    assert.equal(game.level.expectedIndex, 1);
    assert.equal(game.level.creditsCollected, 2);
    game.jump('KeyW');
    const [nextI, nextJ] = game.level.pattern[1];
    assert.equal(game.level.currentTile, game.level.tiles[nextI][nextJ]);
  } finally { game.cleanup(); }
});

test('disposing the room releases shared resources once and restores its scene', () => {
  const game = createGame();
  const resources = new Set();
  game.level.root.traverse(node => {
    if (!node.isMesh) return;
    resources.add(node.geometry); resources.add(node.material);
  });
  const counts = new Map();
  for (const resource of resources) resource.addEventListener('dispose', () => counts.set(resource, (counts.get(resource) || 0) + 1));
  game.level.dispose(); game.level.dispose();
  for (const resource of resources) assert.equal(counts.get(resource), 1);
  assert.ok(!game.scene.children.includes(game.level.root));
  assert.equal(game.scene.fog, null);
  game.player.dispose();
});

test('retry during exit restores player scale, materials, visibility and camera mode', () => {
  const game = createGame(3);
  try {
    const {level, player} = game;
    player.toggleCamera();
    const material = player.bodyMesh.material;
    const opacity = material?.opacity;
    level.phase = 'exit';
    player.group.position.copy(level.portalApproachPoint); player.grounded = true;
    level.update(0.01, player);
    assert.equal(level.phase, 'entering');
    assert.equal(player.bodyMesh.visible, true);
    level.update(1.3, player);
    assert.ok(player.group.scale.x < 0.5);
    level.dispose();
    assert.equal(player.group.scale.x, 1);
    assert.equal(player.group.visible, true);
    assert.equal(player.bodyMesh.visible, false);
    assert.equal(player.isFirstPerson, true);
    assert.equal(player.scriptedMovement, false);
    if (material) assert.equal(material.opacity, opacity);
  } finally { game.cleanup(); }
});

test('woods keep their ground clamp, dodge, bounds recovery and camera switching', () => {
  const game = createGame();
  try {
    game.player.reset(new THREE.Vector3());
    game.input.keys.KeyW = game.input.keys.Space = true;
    game.player.update(0.05, [], { minX: -60, maxX: 60, minZ: -60, maxZ: 60 });
    assert.equal(game.player.isDodging, true);
    assert.equal(game.player.group.position.y, 0);
    game.player.group.position.x = 65;
    game.player.update(0);
    game.player.update(0, [], { minX: -60, maxX: 60, minZ: -60, maxZ: 60 });
    assert.ok(game.player.group.position.x < 60);
    const direction = game.player.getForwardDirection();
    game.player.toggleCamera();
    assert.equal(game.player.isFirstPerson, true);
    assert.ok(game.player.getForwardDirection().distanceTo(direction) < 1e-8);
    game.player.toggleCamera();
    assert.equal(game.player.bodyMesh.visible, true);
  } finally { game.cleanup(); }
});
