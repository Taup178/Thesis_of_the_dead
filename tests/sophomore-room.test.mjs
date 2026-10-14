import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Level2 } from '../src/levels/Level2.js';
import { createSophomorePatterns } from '../src/levels/sophomorePatterns.js';
import { SOPHOMORE_LAYOUT as layout, SPIKE_CORRIDOR_PUZZLE } from '../src/levels/SophomoreLayout.js';
import { getRetractingSpikeState, SPIKE_CYCLE } from '../src/environment/RetractingSpikes.js';
import { LevelManager } from '../src/levels/LevelManager.js';
import { Player } from '../src/player/Player.js';
import { WeaponCombat } from '../src/player/WeaponCombat.js';
import { Game } from '../src/core/Game.js';
import { SophomoreAmbush } from '../src/levels/SophomoreAmbush.js';
import { Zombie } from '../src/enemies/Zombie.js';

function createGame(stageIndex = 0, seed = 1234, firstPerson = false, puzzleIndex = 2, freshStart = false) {
  const scene = new THREE.Scene();
  const level = new Level2(scene, freshStart ? null : { stageIndex, seed, puzzleIndex });
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
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.6, 1.8, 0.4), new THREE.MeshStandardMaterial());
  body.position.y = 0.9;
  player.bodyMesh.add(body);
  if (firstPerson) player.toggleCamera();
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

async function attachAmbush(game) {
  const createZombie = position => {
    // Exercise the real combat/AI methods without loading models in a physics check.
    const zombie = Object.create(Zombie.prototype);
    const group = new THREE.Group(); group.position.copy(position);
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.6, 1.8, 0.4), new THREE.MeshStandardMaterial());
    body.position.y = 0.9; group.add(body);
    Object.assign(zombie, { group, scene: game.scene, alive: true, isBoss: false, health: 30, speed: 3.2,
      damage: 10, damageCooldown: 0, damageRate: 1, attackTimer: 0, actions: {}, mixer: null,
      _loaded: true, _disposed: false, _ownsGeometry: true, deathPlayed: false, ready: Promise.resolve() });
    return zombie;
  };
  game.level.ambush = new SophomoreAmbush(game.level, { createZombie });
  await game.level.ambush.load();
  return game.level.ambush;
}

test('spike ambush has four staggered waves of four that leap from both pit edges and never refill', async () => {
  const game = createGame(0, 1234, false, SPIKE_CORRIDOR_PUZZLE);
  try {
    const ambush = await attachAmbush(game);
    game.level.update(0, game.player);
    assert.equal(ambush.started, false, 'The safe bridge exit does not start the ambush');
    game.player.group.position.set(0, 0, layout.spikeCorridorMaxZ - 1);
    game.player.platformSupport = game.level.retractingSpikes.surface;
    game.player.takeDamage = () => {}; // Keep the observer alive while all four waves play out.
    game.level.update(0, game.player);
    assert.equal(ambush.remaining, 16);
    assert.equal(ambush.records.filter(record => record.phase === 'jumping').length, 1);
    assert.equal(ambush.records[0].from.y, game.level.spikeTipY);
    for (let waveIndex = 0; waveIndex < 4; waveIndex++) {
      const wave = ambush.records.filter(record => record.wave === waveIndex);
      assert.deepEqual(wave.map(record => record.side), [-1, 1, -1, 1]);
      let frames = 0;
      while (wave.some(record => record.phase !== 'active') && frames++ < 600) {
        const before = ambush.records.filter(record => record.phase !== 'waiting').length;
        game.level.update(1 / 60, game.player);
        const after = ambush.records.filter(record => record.phase !== 'waiting').length;
        assert.ok(after - before <= 1, 'Zombies arrive individually, never as an immediate group');
        assert.equal(ambush.records.filter(record => record.zombie.alive && record.phase !== 'waiting').length <= 4, true);
      }
      assert.ok(wave.every(record => record.phase === 'active'), 'Each wave finishes its real jumps');
      assert.ok(wave.every(record => record.zombie.group.position.y === 0 && record.zombie.group.visible));
      for (const record of wave) record.zombie.takeDamage(30);
      game.level.update(0, game.player);
      if (waveIndex < 3) {
        const next = ambush.records.filter(record => record.wave === waveIndex + 1);
        game.level.update(1, game.player);
        assert.ok(next.every(record => record.phase === 'waiting'), 'The next wave has a pause after the previous one dies');
      }
    }
    assert.equal(ambush.cleared, true);
    assert.equal(ambush.start(), false, 'Crossing the trigger again cannot create another wave');
    game.level.update(10, game.player);
    assert.equal(game.level.zombies.length, 16);
    assert.equal(ambush.remaining, 0);
  } finally { game.cleanup(); }
});

test('ambush zombies walk through raised spikes and remain outside the memory tiles', async () => {
  const game = createGame(0, 1234, false, SPIKE_CORRIDOR_PUZZLE);
  try {
    const ambush = await attachAmbush(game);
    ambush.start();
    const record = ambush.records[0]; record.phase = 'active';
    const row = game.level.retractingSpikes.rows[0];
    record.zombie.group.visible = true;
    record.zombie.group.position.set(0.5, 0, row.z);
    game.player.group.position.set(0.5, 0, row.z - 4);
    game.level.retractingSpikes.time = 0.8;
    game.level.update(0.1, game.player);
    assert.equal(record.zombie.health, 30);
    assert.equal(record.zombie.alive, true);
    assert.ok(record.zombie.group.position.z < row.z, 'The zombie keeps pursuing through the raised row');
    assert.equal(record.zombie.group.position.y, 0);
    game.player.group.position.set(0, 0, -10);
    ambush.update(20, game.player);
    assert.ok(record.zombie.group.position.z > layout.memoryTriggerZ, 'Combat zombies cannot enter the memory area');
  } finally { game.cleanup(); }
});

test('memory waits for all sixteen ambush zombies and a new approach after the last kill', async () => {
  const game = createGame(0, 1234, false, SPIKE_CORRIDOR_PUZZLE);
  const combat = new WeaponCombat(game.scene);
  try {
    const ambush = await attachAmbush(game);
    game.player.group.position.set(0, 0, layout.memoryTriggerZ - 0.5);
    game.player.platformSupport = game.level.startSurface;
    game.level.update(0, game.player);
    assert.equal(game.level.phase, 'chase');
    assert.equal(game.level.puzzleIndex, SPIKE_CORRIDOR_PUZZLE);
    for (const record of ambush.records.slice(0, 4)) combat.damageZombie(record.zombie, 30, game.player);
    game.level.update(0, game.player);
    assert.equal(game.level.phase, 'chase', 'Future waves count toward the memory lock');
    assert.equal(ambush.remaining, 12);
    for (const record of ambush.records.slice(4)) combat.damageZombie(record.zombie, 30, game.player);
    game.level.update(0, game.player);
    assert.equal(game.level.phase, 'chase', 'The last kill does not start memory while the player is already in its trigger');
    assert.equal(combat.kills, 16);
    assert.equal(combat.pickups.length, 8, 'The normal combat ammo rewards support the finite wave');
    assert.equal(game.level.getRestartState().ambushCleared, true, 'A cleared ambush stays cleared if this checkpoint is retried');
    game.player.group.position.z = layout.memoryTriggerZ + 0.5;
    game.level.update(0, game.player);
    game.player.group.position.z = layout.memoryTriggerZ - 0.5;
    game.level.update(0, game.player);
    assert.equal(game.level.puzzleIndex, 2);
    assert.equal(game.level.phase, 'watch');
    assert.ok(game.level.zombies.every(zombie => !zombie.alive));
  } finally { combat.dispose(); game.cleanup(); }
});

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

test('checkpoint retries keep the room walls and red portal fixed while preserving the saved spawn', () => {
  let wallsAtStart;
  for (const [puzzleIndex, stageIndex] of [[0, 0], [1, 0], [SPIKE_CORRIDOR_PUZZLE, 0], [2, 0], [2, 2]]) {
    const game = createGame(stageIndex, 1234, false, puzzleIndex);
    const { level, player, input } = game;
    try {
      level.root.updateMatrixWorld(true);
      const walls = level.root.children.filter(node => node.name === 'SkullWall');
      const snapshot = () => walls.map(wall => ({ matrix: wall.matrixWorld.toArray(), size: wall.geometry.parameters }));
      if (!wallsAtStart) wallsAtStart = snapshot();
      assert.deepEqual(snapshot(), wallsAtStart, 'The entrance wall never advances to the checkpoint');
      assert.deepEqual(level.entrancePortal.root.position.toArray(), [0, 0, layout.entrancePortalZ]);
      assert.equal(level.entrancePortal.root.visible, true);
      assert.equal(level.entrancePortal.root.parent, level.root);
      assert.ok(level.entrancePortal.light.color.r > level.entrancePortal.light.color.g);
      assert.ok(player.group.position.distanceTo(level.spawnPoint) < 1e-8);
      assert.equal(level.arrivalPlayer, undefined, 'Retry does not replay the portal emergence');
      assert.equal(level.portalCinematicActive, false);
      assert.equal(player.scriptedMovement, false);
      const surfaces = level.getPlatforming().surfaces;
      assert.ok(surfaces.includes(level.bladeSurface) && surfaces.includes(level.retractingSpikes.surface));
      assert.ok(level.bridgePlatforms.every(bridge => surfaces.includes(bridge.surface)), 'The preceding corridor stays in place');
      level.phase = 'chase';
      input.keys.KeyS = true;
      for (let frame = 0; frame < 12; frame++) game.step();
      level.root.updateMatrixWorld(true);
      assert.deepEqual(snapshot(), wallsAtStart, 'Moving the player and updating torch lights cannot move the walls');
      assert.equal(level.entrancePortal.root.position.z, layout.entrancePortalZ);
    } finally { game.cleanup(); }
  }
});

test('the first memory checkpoint starts on the safe deck and demonstrates without a portal entrance', () => {
  const game = createGame();
  try {
    const originalX = game.player.group.position.x;
    assert.equal(game.player.group.position.y, 0, 'The player starts on the deck instead of in the sky');
    assert.equal(game.player.grounded, true);
    assert.equal(game.player.group.visible, true);
    assert.equal(game.player.scriptedMovement, false);
    assert.equal(game.level.phase, 'arrival');
    assert.equal(game.level.entrancePortal.root.position.z, layout.entrancePortalZ, 'The original red portal remains at the entrance on retry');
    assert.ok(game.level.exitPortal.light.color.g > game.level.exitPortal.light.color.r);
    game.input.keys.KeyW = game.input.keys.KeyD = true;
    game.input.presses.add('Space');
    game.until(() => game.level.phase === 'watch');
    assert.equal(game.player.group.visible, true);
    assert.equal(game.level.bossMarker.visible, true);
    assert.ok(game.level.bossMarker.position.distanceTo(game.level._deanStepPosition(0)) < 1e-8);
    assert.equal(game.level.demonstrationIndex, 0);
    assert.equal(game.level.tiles.flat().some(tile => tile.timer !== null), false);
    assert.equal(game.player.scriptedMovement, false);
    assert.equal(game.player.group.visible, true);
    assert.equal(game.player.group.scale.x, 1);
    assert.equal(game.player.verticalVelocity, 0);
    assert.ok(game.player.lastSafePosition.distanceTo(game.level.spawnPoint) < 1e-8);
    game.until(() => game.level.phase === 'follow');
    assert.equal(game.player.group.position.x, originalX);
    assert.equal(game.player.group.position.z, 0);
    assert.equal(game.player.group.position.y, 0);
    assert.equal(game.player.platformSupport, game.level.startSurface);
    for (const tile of game.level.tiles.flat()) {
      assert.equal(tile.preview, false);
      assert.equal(tile.timer, null);
      assert.equal(tile.mesh.material.color.getHex(), tile === game.level.targetTile ? 0x46dd9b : 0xffffff);
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
    assert.equal(game.level.spikePit.root.name, 'SpikePit');
    assert.ok(game.level.spikePit.count > 200, 'Trap panels cover the entire pit');
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
    assert.equal(game.player.group.position.y, 0);
    assert.equal(game.player.grounded, true);
    assert.equal(game.player.platformSupport.tile, game.level.tiles[game.level.pattern[0][0]][game.level.pattern[0][1]]);
    assert.equal(game.level.phase, 'arrival', 'Later checkpoints skip the entrance cinematic');
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

for (const firstPerson of [false, true]) {
  for (const stageIndex of [0, 1, 2, 3]) {
    test(`a memory death retries checkpoint ${stageIndex + 1} without emergence (first person: ${firstPerson})`, async t => {
      const game = createGame(stageIndex, 1234, firstPerson);
      const { level, scene, player } = game;
      const manager = new LevelManager(scene);
      manager.currentLevel = level;
      manager.currentLevelIndex = 1;
      // Keep the real level reconstruction and reused player, with only asset loading stubbed.
      t.mock.method(Level2.prototype, 'load', async function () {
        this._createRoom();
        this._createTiles();
        this.bossMarker = new THREE.Group();
        this.root.add(this.bossMarker);
        this.dean = { actions: {}, _playAction() {}, dispose() {} };
      });
      try {
        game.until(() => level.phase === 'follow');
        if (stageIndex === 0) game.land(...level.pattern[0]);
        game.land(...level.pattern[2]);
        game.until(() => !player.alive);
        const saved = level.getRestartState();
        const retry = await manager.restartLevel();
        player.reset(retry.spawnPoint);
        retry.preparePlayer(player);
        assert.deepEqual(retry.getRestartState(), saved);
        assert.deepEqual(retry.patterns, level.patterns);
        assert.ok(player.group.position.distanceTo(retry.spawnPoint) < 1e-8);
        assert.ok(player.lastSafePosition.distanceTo(retry.spawnPoint) < 1e-8);
        assert.equal(player.platformSupport, stageIndex === 0 ? retry.startSurface :
          retry.tiles[retry.pattern[0][0]][retry.pattern[0][1]].surface);
        assert.equal(player.health, player.maxHealth);
        assert.equal(player.isFirstPerson, firstPerson);
        assert.equal(player.bodyMesh.visible, !firstPerson);
        assert.equal(player.group.visible, true);
        assert.equal(player.group.scale.x, 1);
        assert.equal(player.scriptedMovement, false);
        assert.equal(retry.phase, 'arrival');
        assert.equal(retry.entrancePortal.root.position.z, layout.entrancePortalZ);
        const start = player.group.position.clone();
        const cameraPosition = player.camera.position.clone();
        const cameraRotation = player.camera.quaternion.clone();
        player._updateCamera();
        assert.ok(cameraPosition.distanceTo(player.camera.position) < 1e-8);
        assert.ok(cameraRotation.angleTo(player.camera.quaternion) < 1e-7);
        let frames = 0;
        while (retry.phase !== 'follow' && frames++ < 1200) {
          player.update(1 / 60, [], null, retry.getPlatforming());
          retry.update(1 / 60, player);
          assert.equal(retry.arrivalPlayer, undefined, 'The portal cinematic never starts on retry');
          assert.ok(player.group.position.distanceTo(start) < 1e-8);
        }
        assert.equal(retry.phase, 'follow', 'The same unfinished route is demonstrated again');
        assert.equal(retry.expectedIndex, stageIndex === 0 ? 0 : 1);
        assert.equal(player.grounded, true);
        assert.equal(retry.currentTile?.falling ?? false, false);
      } finally {
        manager.currentLevel?.dispose();
        game.cleanup();
      }
    });
  }
}

for (const firstPerson of [false, true]) {
  test(`arrival restores the normal camera during the Dean demonstration (first person: ${firstPerson})`, () => {
    const game = createGame(0, 0, firstPerson, 0, true);
    try {
      game.until(() => game.level.phase === 'dean_challenge');
      assert.equal(game.player.isFirstPerson, firstPerson);
      assert.equal(game.player.bodyMesh.visible, !firstPerson);
      assert.equal(game.player.group.visible, true);
      assert.equal(game.player.group.scale.x, 1);
      assert.equal(game.player.scriptedMovement, true, 'The blade intro still holds player control');
      const cameraPosition = game.player.camera.position.clone();
      const cameraRotation = game.player.camera.quaternion.clone();
      game.player._updateCamera();
      assert.ok(cameraPosition.distanceTo(game.player.camera.position) < 1e-8);
      assert.ok(cameraRotation.angleTo(game.player.camera.quaternion) < 1e-7);
      game.step();
      assert.ok(cameraPosition.distanceTo(game.player.camera.position) < 1e-8, 'The camera stays on the player while the Dean moves');
      assert.ok(cameraRotation.angleTo(game.player.camera.quaternion) < 1e-7);
    } finally { game.cleanup(); }
  });
}

test('portal cinematic bars hold control until the Dean clears the blades, then release the chase', () => {
  const game = createGame(0, 1234, false, 0, true);
  const bands = new Set(), hud = new Set();
  const classList = classes => ({ toggle(name, active) { if (active) classes.add(name); else classes.delete(name); } });
  const controller = Object.create(Game.prototype);
  Object.assign(controller, { STATE: { PLAYING: 'playing' }, state: 'playing', input: game.input, currentLevel: game.level,
    bossCinematic: { classList: classList(bands) }, hudEl: { classList: classList(hud) } });
  try {
    controller._updateCinematicPresentation();
    assert.equal(bands.has('active'), true, 'Portal emergence shows the top and bottom bars');
    assert.equal(bands.has('boss-intro'), false, 'Portal bars do not display the combat boss title');
    assert.equal(game.level.spawnPoint.z, layout.spawnZ);
    assert.equal(game.level.blades.length, 4);
    assert.equal(game.level.bridgePlatforms.length, 6);
    assert.equal(game.level.runePads, undefined);
    assert.equal(game.level.root.getObjectByName('RuneDeck'), undefined);
    assert.equal(game.level.entrancePortal.root.rotation.y, Math.PI);
    assert.ok(game.level.entrancePortal.light.color.r > game.level.entrancePortal.light.color.g);
    assert.equal(game.player.group.visible, false, 'The player waits while the Dean emerges first');
    game.until(() => game.level.phase === 'player_arrival');
    assert.deepEqual(game.level.bossMarker.position.toArray(), [0, 0, layout.deanStartZ]);
    game.step(game.level.playerArrival.duration / 3);
    assert.equal(game.player.group.visible, true);
    assert.ok(game.player.group.scale.x > 0 && game.player.group.scale.x < 1);
    assert.deepEqual(game.level.bossMarker.position.toArray(), [0, 0, layout.deanStartZ], 'The Dean waits in the center while Shaun emerges');
    game.until(() => game.level.phase === 'dean_challenge');
    assert.deepEqual(game.level.bossMarker.position.toArray(), [0, 0, layout.deanStartZ], 'The Dean waits for the camera to return before dodging');
    assert.equal(game.level.getPlatforming().canMove, false);
    assert.equal(game.player.scriptedMovement, true);
    const waitPosition = game.player.group.position.clone();
    game.input.keys.KeyW = true;
    for (let frame = 0; frame < 40; frame++) game.step();
    game.input.keys.KeyW = false;
    assert.ok(game.player.group.position.distanceTo(waitPosition) < 1e-8, 'Shaun waits while the Dean clears the blades');
    game.until(() => !game.level.deanBladeIntro);
    assert.ok(game.level.bossMarker.position.z <= layout.bladeCompleteZ);
    assert.equal(game.level.phase, 'dean_challenge', 'The Dean continues toward the bridge after control returns');
    assert.equal(game.player.scriptedMovement, false);
    assert.equal(game.level.getPlatforming().canMove, true);
    controller._updateCinematicPresentation();
    assert.equal(bands.has('active'), false, 'Bars disappear at the end of the blades');
    assert.equal(hud.has('cinematic'), false, 'Gameplay HUD returns with control');
    game.input.keys.KeyW = true;
    game.step();
    game.input.keys.KeyW = false;
    assert.ok(game.player.group.position.z < waitPosition.z, 'Movement resumes immediately');
    let guideFrames = 0;
    while (game.level.phase === 'dean_challenge' && guideFrames++ < 3000) {
      game.step();
    }
    assert.equal(game.level.phase, 'chase');
    assert.equal(game.level.getPlatforming().allowDodge, true);
    assert.ok(game.level.bossMarker.position.distanceTo(game.level._deanStepPosition(0)) < 1e-8);
    game.player.group.position.set(0, 0, layout.bladeCompleteZ - 0.5);
    game.level.update(0, game.player);
    assert.equal(game.level.puzzleIndex, 1);
    assert.equal(game.level.phase, 'chase', 'The Dean already crossed the bridge and does not stop to demonstrate it again');
    assert.equal(game.level.getPlatforming().allowDodge, true, 'Q still rolls after the saws');
    assert.equal(game.level.getRestartState().puzzleIndex, 1);
    assert.equal(game.level.getPlatforming().canMove, true);
    assert.ok(game.level.bossMarker.position.distanceTo(game.level._deanStepPosition(0)) < 1e-8);
    game.player.group.position.set(0, 0, layout.spikeCheckpointTriggerZ - 0.1);
    game.player.platformSupport = game.level.bridgeExitSurface;
    game.level.update(0, game.player);
    assert.equal(game.level.puzzleIndex, SPIKE_CORRIDOR_PUZZLE);
    assert.equal(game.level.getRestartState().puzzleIndex, SPIKE_CORRIDOR_PUZZLE);
    game.player.group.position.set(0, 0, layout.memoryTriggerZ - 0.5);
    game.player.platformSupport = game.level.startSurface;
    game.player.grounded = true;
    game.level.update(0, game.player);
    assert.equal(game.level.puzzleIndex, 2);
    assert.equal(game.level.phase, 'watch', 'The spike corridor leads into the memory demonstration');
    assert.match(game.level.getChallengeStatus().title, /4 \/ 4/);
    controller._updateCinematicPresentation();
    assert.equal(bands.has('active'), false, 'Memory demonstrations keep their normal presentation');
    for (const phase of ['dean_exit', 'entering']) {
      game.level.phase = phase;
      controller._updateCinematicPresentation();
      assert.equal(bands.has('active'), true, 'Exiting through the portal shows cinematic bars');
    }
    controller.state = 'paused';
    controller._updateCinematicPresentation();
    assert.equal(bands.has('active'), false, 'Bars clear while paused');
  } finally { game.cleanup(); }
});

for (const dt of [1 / 60, 1 / 20]) {
  test(`the Dean dodges every moving blade and continues across the bridge without pauses at ${Math.round(1 / dt)} FPS`, () => {
    const game = createGame(0, 1234, false, 0);
    const { level, player } = game;
    try {
      const chosenSides = new Set();
      for (const time of [0, 0.7, 1.8, 3.4, 6.1]) {
        level.gauntletTime = time;
        level.bossMarker.position.set(0, 0, layout.deanStartZ);
        level.dean.actions.Run = {};
        const actions = [];
        level.dean._playAction = name => actions.push(name);
        level._beginDeanChallenge();
        const crossedBlades = new Set(), jumps = new Set();
        const waitPosition = player.group.position.clone();
        let frames = 0, leaned = false;
        let lastZ = level.bossMarker.position.z;
        let previousFacing = level.bossMarker.quaternion.clone();
        while (level.phase === 'dean_challenge' && frames++ < 3000) {
          assert.equal(level.getPlatforming().canMove, !level.deanBladeIntro);
          const target = level.deanPath[level.deanSegment + 1];
          game.step(dt);
          const position = level.bossMarker.position;
          assert.ok(level.bossMarker.quaternion.angleTo(previousFacing) <= 10 * dt, 'The Dean turns into waypoints instead of snapping his facing');
          previousFacing.copy(level.bossMarker.quaternion);
          assert.ok(position.z <= lastZ + 1e-8, 'The Dean keeps advancing instead of stopping or backtracking');
          lastZ = position.z;
          const deckHalfWidth = position.z >= level.bladeSurface.minZ ? level.bladeSurface.maxX : level.startSurface.maxX;
          assert.ok(Math.abs(position.x) <= deckHalfWidth - 0.6, 'The Dean stays on the playable decks with clearance from their edges');
          assert.ok(player.group.position.distanceTo(waitPosition) < 1e-8);
          for (const blade of level.blades) {
            if (Math.abs(position.z - blade.z) > 1.1) continue;
            assert.ok(Math.abs(position.x - blade.wheel.position.x) >= 2.2,
              `The Dean must clear the actual blade sweep (time=${time}, z=${blade.z})`);
            crossedBlades.add(blade);
            chosenSides.add(Math.sign(position.x));
          }
          if (target.jump && position.y > 0.6) jumps.add(target.position);
          const up = new THREE.Vector3(0, 1, 0).applyQuaternion(level.bossMarker.quaternion);
          leaned ||= up.y < 0.999;
        }
        assert.equal(level.phase, 'chase');
        assert.equal(crossedBlades.size, 4, 'Every blade is dodged');
        for (const bridge of level.bridgePlatforms) assert.ok([...jumps].some(point => point.z >= bridge.surface.minZ && point.z <= bridge.surface.maxZ), 'All six moving platforms are demonstrated');
        const firstTile = level.tiles[level.pattern[0][0]][level.pattern[0][1]].surface;
        assert.ok([...jumps].some(point => point.z >= firstTile.minZ && point.z <= firstTile.maxZ), 'The final jump lands on the first memory tile');
        assert.ok(level.bossMarker.position.distanceTo(level._deanStepPosition(0)) < 1e-8);
        assert.equal(actions.filter(name => name === 'Idle').length, 1,
          'The Dean runs through the spikes and waits only at the memory tile');
        assert.ok(actions.includes('Run') && actions.includes('Jump'));
        assert.equal(leaned, true, 'Each quick sidestep visibly leans the Dean into the dodge');
        assert.ok(new THREE.Vector3(0, 1, 0).applyQuaternion(level.bossMarker.quaternion).y > 0.999999, 'Waiting restores an upright pose');
        assert.equal(player.health, player.maxHealth);
      }
      assert.equal(chosenSides.size, 2, 'The Dean chooses either side according to the blade timing');
    } finally { game.cleanup(); }
  });
}

test('the Dean uses the restored chase pace and keeps his bridge landings and jump height', () => {
  const game = createGame(0, 1234, false, 0);
  const { level, player, input } = game;
  try {
    input.keys.KeyW = true;
    game.step();
    const speed = Math.hypot(player.velocity.x, player.velocity.z);
    assert.ok(speed > 0);
    level.bossMarker.position.set(0, 0, layout.deanStartZ);
    let runScale = null;
    level.dean.actions.Run = { setEffectiveTimeScale(value) { runScale = value; } };
    level._beginDeanChallenge();
    assert.ok(Math.abs(runScale - 12 / speed) < 1e-8, 'The run animation matches the restored chase pace');
    for (let index = 1; index < level.deanPath.length; index++) {
      const from = level.deanPath[index - 1].position, next = level.deanPath[index];
      if (next.wait) { assert.equal(from.distanceTo(next.position), 0); continue; }
      const deanSpeed = from.distanceTo(next.position) / next.duration;
      assert.ok(Math.abs(deanSpeed - 12) < 1e-8, 'The guide keeps his previous movement speed');
      if (next.jump) {
        const playerFlight = -2 * level.getPlatforming().jumpVelocity / player.gravity;
        assert.ok(Math.abs(next.duration - speed * playerFlight / 12) < 1e-8, 'Bridge jumps use the restored chase timing');
        assert.ok(Math.abs(from.distanceTo(next.position) - speed * playerFlight) < 1e-8,
          'Normal jumps preserve the original landing positions');
        level.deanSegment = index - 1;
        level.deanSegmentTime = next.duration / 2;
        level._updateDeanChallenge(0);
        assert.ok(Math.abs(level.bossMarker.position.y - (-(level.getPlatforming().jumpVelocity ** 2) / (2 * player.gravity))) < 1e-8,
          'Normal jumps preserve the original arc height');
      }
    }
  } finally { game.cleanup(); }
});

test('playing alongside the Dean advances checkpoints and keeps blade hits active', () => {
  const game = createGame(0, 1234, false, 0);
  const { level, player, input } = game;
  try {
    level.bossMarker.position.set(0, 0, layout.deanStartZ);
    level._beginDeanChallenge(player);
    game.until(() => !level.deanBladeIntro);
    player.group.position.x = 6.2;
    input.keys.KeyW = true;
    let frames = 0;
    while (level.puzzleIndex === 0 && frames++ < 400) {
      assert.equal(level.getPlatforming().canMove, true);
      game.step();
      assert.ok(level.bossMarker.position.z < layout.deanStartZ, 'The Dean keeps advancing while Shaun plays');
    }
    input.keys.KeyW = false;
    assert.equal(level.puzzleIndex, 1);
    assert.equal(level.phase, 'dean_challenge', 'The checkpoint advances while the guide is still clearing the room');
    assert.equal(level.getPlatforming().allowDodge, true, 'Q can roll on the bridge while Space jumps');
    assert.equal(player.health, 100);
    assert.equal(level.getRestartState().puzzleIndex, 1);
    // A player who reaches memory early cannot interrupt the Dean's current route.
    player.group.position.set(0, 0, layout.spikeCheckpointTriggerZ - 0.1);
    player.platformSupport = level.bridgeExitSurface;
    level.update(0, player);
    assert.equal(level.puzzleIndex, SPIKE_CORRIDOR_PUZZLE);
    player.group.position.set(0, 0, layout.memoryTriggerZ - 0.5);
    player.platformSupport = level.startSurface;
    level.update(0, player);
    assert.equal(level.phase, 'dean_challenge');
    game.until(() => level.phase === 'watch');
    assert.equal(level.getPlatforming().canMove, false, 'Memory still has a watch turn');
    assert.equal(level.puzzleIndex, 2);
  } finally { game.cleanup(); }

  const contact = createGame(0, 1234, false, 0);
  try {
    contact.level.bossMarker.position.set(0, 0, layout.deanStartZ);
    contact.level._beginDeanChallenge(contact.player);
    contact.until(() => !contact.level.deanBladeIntro);
    const blade = contact.level.blades[0];
    contact.level.gauntletTime = -blade.phase / 1.75;
    contact.player.group.position.set(0, 0, blade.z);
    contact.level.update(0, contact.player);
    assert.equal(contact.player.health, 72, 'Blade injuries remain active while the Dean is running');
    blade.hitCooldown = 0;
    contact.player.group.position.set(0, 0, blade.z);
    contact.input.keys.KeyQ = contact.input.keys.KeyW = true;
    contact.player.update(1 / 60, [], null, contact.level.getPlatforming());
    assert.equal(contact.player.isDodging, true, 'Rolling is available once the blade intro ends');
    contact.level.update(0, contact.player);
    assert.equal(contact.player.health, 72, 'A timed roll still prevents blade damage');
  } finally { contact.cleanup(); }
});

test('slicing disks hit on contact, while a timed roll passes through safely', () => {
  const game = createGame(0, 1234, false, 0);
  try {
    game.until(() => game.level.phase === 'chase');
    const blade = game.level.blades[0];
    game.level.gauntletTime = -blade.phase / 1.75;
    game.player.group.position.set(0, 0, blade.z);
    const before = game.player.health;
    game.level.update(0, game.player);
    assert.equal(game.player.health, before - 28);
    blade.hitCooldown = 0;
    game.player.group.position.set(0, 0, blade.z);
    game.input.keys.KeyQ = game.input.keys.KeyW = true;
    game.player.update(1 / 60, [], null, game.level.getPlatforming());
    assert.equal(game.player.isDodging, true);
    const after = game.player.health;
    game.level.update(0, game.player);
    assert.equal(game.player.health, after);
  } finally { game.cleanup(); }
});

test('Space jumps, Q rolls and either Shift sprints in every playable puzzle', () => {
  for (const puzzleIndex of [0, 1, SPIKE_CORRIDOR_PUZZLE, 2]) {
    const game = createGame(0, 1234, false, puzzleIndex);
    const { level, player, input } = game;
    try {
      level.phase = puzzleIndex === 2 ? 'follow' : 'dean_challenge';
      for (const shift of ['ShiftLeft', 'ShiftRight']) {
        input.keys[shift] = input.keys.KeyW = true;
        player.update(1 / 60, [], null, level.getPlatforming());
        assert.ok(Math.abs(player.velocity.z + level.getPlatforming().moveSpeed * player.sprintMultiplier) < 1e-8);
        input.keys[shift] = false;
      }
      input.keys.KeyW = false;
      input.keys.Space = true;
      input.presses.add('Space');
      player.update(1 / 60, [], null, level.getPlatforming());
      assert.equal(player.grounded, false);
      assert.equal(player.isDodging, false, 'Space is always a jump, including at the blades');
      assert.ok(player.group.position.y > 0);
      for (let frame = 0; frame < 60; frame++) player.update(1 / 60, [], null, level.getPlatforming());
      assert.equal(player.grounded, true, 'Holding Space does not repeatedly jump');
      input.keys.Space = false;
      input.presses.add('KeyQ'); // A tap released between frames must still trigger the roll.
      player.update(1 / 60, [], null, level.getPlatforming());
      assert.equal(player.isDodging, true, 'Q remains available throughout the room');
    } finally { game.cleanup(); }
  }
});

test('level two allows shooting and opening and selecting from the weapon inventory', () => {
  const game = createGame(0, 1234, false, 0);
  const { level, player, input } = game;
  const combat = new WeaponCombat(game.scene);
  try {
    assert.equal(level.allowsShooting, true);
    input.isMouseButtonDown = button => button === 0;
    combat.update(0, player, level, input, () => []);
    assert.equal(player.ammo, 29);
    assert.equal(combat.projectiles.length, 1, 'Click fires a visible bullet during Level 2');
    let hidden = true;
    const controller = Object.create(Game.prototype);
    Object.assign(controller, { player, currentLevel: level, input, combat,
      weaponWheelEl: { classList: { remove() { hidden = false; }, add() { hidden = true; } }, setAttribute() {} },
      _showWheelSelection() {} });
    controller._openWeaponWheel();
    assert.equal(controller.weaponWheelOpen, true);
    assert.equal(hidden, false);
    controller._equipWeapon('pistol');
    assert.equal(player.weapon, 'pistol');
    assert.equal(controller.weaponWheelOpen, false);
    assert.equal(hidden, true);
  } finally { combat.dispose(); game.cleanup(); }
});

test('torch lighting stays at the flames and remains consistent during demonstrations', () => {
  const game = createGame(0, 1234, false, 1);
  const { level, player } = game;
  try {
    assert.ok(level.torches.anchors.length > 20, 'Torches cover the full room, including the saws and bridge');
    assert.ok(level.torches.anchors.every(anchor => level.blades.every(blade =>
      Math.abs(anchor.position.z - (blade.z - 0.38)) >= 1.25)), 'Torches leave the blade support anchors clear');
    const blockedRows = level.torches.lightUniforms.dungeonTorchBlockedRows.value.toArray().filter(row => row >= 0);
    assert.ok(blockedRows.length > 0, 'Overlapping torch pairs were removed');
    assert.ok(level.torches.anchors.every(anchor => !blockedRows.includes(anchor.row)), 'Removed rows have no torches or fire sources');
    const initial = level.localLights.filter(light => light.visible);
    assert.equal(initial.length, 8);
    const positions = initial.map(light => light.position.clone());
    assert.equal(initial.filter(light => light.castShadow).length, 2);
    assert.ok(initial.every(light => light.decay === 2), 'Torchlight has inverse-square falloff');
    player.group.position.set(0, 0, level.bridgePlatforms[1].platform.position.z);
    player.platformSupport = level.bridgePlatforms[1].surface;
    game.step();
    const current = level.localLights.filter(light => light.visible);
    assert.equal(current.length, 8);
    assert.ok(current.some((light, index) => !light.position.equals(positions[index])), 'Light slots follow nearby torch sources');
    assert.ok(current.every(light => level.torches.anchors.some(anchor =>
      Math.abs(light.position.y - anchor.flame.y - 0.22) < 1e-6 &&
      light.position.x === anchor.flame.x && light.position.z === anchor.flame.z)), 'Every light originates inside a visible flame');
    const activeIds = [...level.torches.lightUniforms.dungeonTorchSlotsA.value.toArray(),
      ...level.torches.lightUniforms.dungeonTorchSlotsB.value.toArray()];
    assert.ok(activeIds.every(id => level.torches.anchors.some(anchor => anchor.id === id)), 'Removed torches never leave invisible lights behind');
    const snapshot = () => current.map(light => [...light.position.toArray(), light.intensity]);
    const before = snapshot();
    level.phase = 'watch'; level.bossMarker.position.set(0, 0, -90);
    level._updateLocalLighting(player);
    assert.deepEqual(snapshot(), before, 'The Dean moving away never changes the room lighting');
    let overheads = 0;
    level.root.traverse(node => { if (node.isDirectionalLight || node.isHemisphereLight) overheads++; });
    assert.equal(overheads, 0, 'The room has no unmotivated overhead lighting');
  } finally { game.cleanup(); }
});

test('moving bridge platforms carry a standing player over a real floor gap', () => {
  const game = createGame(0, 1234, false, 1);
  try {
    const bridge = game.level.bridgePlatforms[0];
    assert.ok(!game.level.getPlatforming().surfaces.some(surface => surface.y === 0 &&
      surface.minZ <= layout.bridgeFirstZ - layout.bridgeSpacing && surface.maxZ >= layout.bridgeMaxZ - 1),
      'No invisible floor spans the bridge at running height');
    assert.equal(game.level.bridgeCatchSurface, undefined, 'There is no safety floor beneath the bridge');
    assert.equal(game.level.root.getObjectByName('BridgeMaintenanceGrate'), undefined);
    game.player.group.position.set(bridge.platform.position.x, 0, bridge.platform.position.z);
    game.player.platformSupport = bridge.surface;
    game.player.grounded = true;
    const previousX = game.player.group.position.x;
    game.level.update(0.2, game.player);
    assert.ok(game.player.group.position.x !== previousX);
    assert.equal(game.player.group.position.x, bridge.platform.position.x);
  } finally { game.cleanup(); }
});

test('safe landings provide breathing room after both hazards and share the stone floor finish', () => {
  const game = createGame(0, 1234, false, 0);
  const { level, player, input } = game;
  try {
    assert.ok(level.blades.at(-1).z - level.bladeSurface.minZ >= 10, 'The last blade has a long safe exit deck');
    assert.ok(level.startSurface.maxZ - layout.memoryTriggerZ >= 10, 'The bridge has a long landing before the memory puzzle');
    assert.equal(level.startSurface.maxX - level.startSurface.minX, level.bladeSurface.maxX - level.bladeSurface.minX);
    const floors = [level.root.getObjectByName('SlicingDiskCorridor'), level.startPlatform, level.exitDeck, level.bridgeExitDeck, level.retractingSpikes.floor,
      ...level.bridgePlatforms.map(bridge => bridge.platform), ...level.tiles.flat().map(tile => tile.mesh)];
    assert.ok(floors.every(mesh => level.floors.materials.has(mesh.material)), 'Every walkable floor receives the same stone maps');
    const uvScale = mesh => {
      const p = mesh.geometry.getAttribute('position'), n = mesh.geometry.getAttribute('normal'), uv = mesh.geometry.getAttribute('uv');
      const vertices = Array.from({ length: p.count }, (_, index) => index).filter(index => n.getY(index) > 0.999);
      const xs = vertices.map(index => p.getX(index)), us = vertices.map(index => uv.getX(index));
      return (Math.max(...us) - Math.min(...us)) / (Math.max(...xs) - Math.min(...xs));
    };
    const scale = uvScale(level.startPlatform);
    assert.ok(floors.every(mesh => Math.abs(uvScale(mesh) - scale) < 1e-6), 'Stone blocks have consistent size on decks, bridge platforms and memory tiles');
    input.keys.KeyW = true;
    player.group.position.set(0, 0, layout.bladeCompleteZ + 0.2); player.platformSupport = level.bladeSurface;
    const sawExit = player.group.position.z;
    while (player.group.position.z > level.bladeSurface.minZ + 0.5) {
      game.step(); assert.equal(player.grounded, true); assert.equal(player.alive, true);
    }
    assert.ok(sawExit - player.group.position.z > 8, 'The player can walk freely after clearing the final blade');
    assert.equal(level.puzzleIndex, 1);
    player.group.position.set(0, 0, level.startSurface.maxZ - 1); player.platformSupport = level.startSurface;
    const bridgeExit = player.group.position.z;
    while (player.group.position.z > layout.memoryTriggerZ + 0.5) {
      game.step(); assert.equal(player.grounded, true); assert.equal(level.phase, 'chase');
    }
    assert.ok(bridgeExit - player.group.position.z > 8, 'The bridge landing leaves room to walk before watching the memory route');
  } finally { game.cleanup(); }
});

test('a missed bridge jump dies on first spike impact and retries after the saws', () => {
  const game = createGame(0, 1234, false, 1);
  let retry;
  try {
    assert.equal(game.player.group.position.z, layout.bridgeCheckpointZ);
    assert.equal(game.player.platformSupport, game.level.bladeSurface);
    game.step();
    assert.equal(game.player.grounded, true, 'The bridge checkpoint is on the entry deck');
    game.input.keys.KeyW = true;
    game.until(() => game.player.group.position.z < game.level.bladeSurface.minZ + 0.5);
    game.input.presses.add('Space');
    game.step();
    assert.equal(game.player.grounded, false, 'The first jump launches from solid ground');
    game.until(() => game.player.grounded, 1 / 60, 100);
    assert.equal(game.player.platformSupport, game.level.bridgePlatforms[0].surface);
    game.player.group.position.set(0, -0.2, (game.level.bridgePlatforms[0].surface.minZ + game.level.bridgePlatforms[1].surface.maxZ) / 2);
    game.player.verticalVelocity = -2;
    game.player.grounded = false;
    game.input.keys.KeyW = false;
    game.until(() => game.player.health < game.player.maxHealth, 1 / 60, 120);
    assert.equal(game.player.alive, false, 'The first pit spike impact kills immediately');
    assert.equal(game.player.health, 0);
    assert.equal(game.player.group.position.y, game.level.spikeTipY, 'Death occurs at the visible spike tips');
    assert.equal(game.level.phase, 'failed');
    assert.notEqual(game.player.group.position.z, layout.bridgeCheckpointZ, 'A fall never teleports the player out of the spikes');
    assert.equal(game.level.puzzleIndex, 1);
    const state = game.level.getRestartState();
    retry = createGame(state.stageIndex, state.seed, false, state.puzzleIndex);
    assert.equal(retry.player.group.position.z, layout.bridgeCheckpointZ);
    assert.equal(retry.player.platformSupport, retry.level.bladeSurface);
    assert.equal(retry.level.phase, 'chase', 'Retry starts safely after the blades');
    assert.equal(retry.player.alive, true);
  } finally { game.cleanup(); retry?.cleanup(); }
});

test('pit spike contact kills instantly without combat flinches even while rolling or on cooldown', () => {
  const game = createGame(0, 1234, false, 0);
  try {
    game.player.group.position.set(0, game.level.spikeTipY - 0.01, layout.bridgeFirstZ);
    game.player.health = 37;
    game.player.isDodging = true; game.player.dodgeTimer = 0.5;
    game.level.spikeHitCooldown = 0.7;
    game.player.takeDamage = () => assert.fail('Pit death must not play the combat hit reaction');
    game.level.update(0, game.player);
    assert.equal(game.player.alive, false);
    assert.equal(game.player.health, 0);
    assert.equal(game.player.group.position.y, game.level.spikeTipY);
    assert.equal(game.player.isDodging, false);
    assert.equal(game.player.damageFlashTime, 0);
    assert.equal(game.player.hitReactionTime, 0);
    assert.equal(game.level.phase, 'failed');
  } finally { game.cleanup(); }
});

test('retracting spikes rise from real lined holes in a deterministic repeating pattern', () => {
  const game = createGame(0, 1234, false, SPIKE_CORRIDOR_PUZZLE);
  const trap = game.level.retractingSpikes;
  try {
    assert.equal(trap.surface.maxZ - trap.surface.minZ, 40);
    assert.deepEqual(trap.rows.map(row => row.bank), [0, 1, 2, 0, 1, 2, 0, 1, 2]);
    for (let bank = 0; bank < 3; bank++) {
      const time = bank * 2.4 + 0.8;
      for (let other = 0; other < 3; other++) {
        assert.equal(getRetractingSpikeState(time, other).extension, bank === other ? 1 : 0);
        assert.deepEqual(getRetractingSpikeState(time + SPIKE_CYCLE, other), getRetractingSpikeState(time, other));
      }
    }
    assert.equal(getRetractingSpikeState(0.15, 0).warning, true);
    const matrix = new THREE.Matrix4();
    trap.banks[0].spike.getMatrixAt(0, matrix);
    assert.ok(matrix.elements[13] < 0, 'Retracted spike tips are below the floor');
    trap.time = 0.8; trap.update(0);
    trap.banks[0].spike.getMatrixAt(0, matrix);
    assert.ok(matrix.elements[13] > 1, 'Spikes rise through their sockets');
    game.level.root.updateMatrixWorld(true);
    const socket = trap.rows[0].slots[0];
    const ray = new THREE.Raycaster(new THREE.Vector3(socket.x, 2, socket.z), new THREE.Vector3(0, -1, 0));
    assert.equal(ray.intersectObject(trap.floor).length, 0, 'Sockets are actual holes through the stone slab');
    ray.ray.origin.x += 0.5;
    assert.ok(ray.intersectObject(trap.floor).length > 0, 'Stone between sockets remains solid');
  } finally { game.cleanup(); }
});

test('retracting spike hits reduce health without stopping play and allow escape', () => {
  const game = createGame(0, 1234, false, SPIKE_CORRIDOR_PUZZLE);
  const { level, player } = game;
  try {
    const slot = level.retractingSpikes.rows[0].slots[6];
    player.group.position.set(slot.x, 0, slot.z);
    player.platformSupport = level.retractingSpikes.surface;
    level.retractingSpikes.time = 0.8;
    level.update(0, player);
    assert.equal(player.health, 80);
    assert.equal(player.alive, true);
    assert.equal(level.phase, 'chase');
    assert.equal(level.getPlatforming().canMove, true);
    level.update(0.4, player);
    assert.equal(player.health, 80);
    level.update(0.4, player);
    assert.equal(player.health, 60);
    player.group.position.z += 1;
    level.update(0.8, player);
    assert.equal(player.health, 60, 'Leaving the row stops damage');
    player.group.position.z = slot.z;
    level.update(0, player);
    assert.equal(player.health, 60, 'Fully retracted spikes are harmless');
  } finally { game.cleanup(); }
});

test('the spike checkpoint skips the portal and its timed corridor is walkable into memory', () => {
  const game = createGame(0, 1234, false, SPIKE_CORRIDOR_PUZZLE);
  const { level, player, input } = game;
  try {
    assert.equal(level.entrancePortal.root.position.z, layout.entrancePortalZ);
    assert.equal(level.phase, 'chase');
    assert.equal(player.group.position.z, layout.spikeCheckpointZ);
    assert.equal(player.platformSupport, level.bridgeExitSurface);
    for (const row of level.retractingSpikes.rows) {
      input.keys.KeyW = true;
      game.until(() => player.group.position.z <= row.z + 0.85);
      input.keys.KeyW = false;
      // Include the small frame overshoot when reserving a clear crossing window.
      const duration = (player.group.position.z - (row.z - 0.85)) / level.getPlatforming().moveSpeed + 1 / 30;
      game.until(() => level.retractingSpikes.clearCrossingDelay(row, level.retractingSpikes.time, duration) === 0);
      input.keys.KeyW = true;
      game.until(() => player.group.position.z <= row.z - 0.85);
      assert.equal(player.health, 100, 'Following the fixed sequence avoids every spike hit');
      assert.equal(player.grounded, true);
    }
    game.until(() => level.phase === 'watch');
    input.keys.KeyW = false;
    assert.equal(level.puzzleIndex, 2, 'Existing memory checkpoint indices are preserved');
    assert.equal(player.platformSupport, level.startSurface);
    assert.deepEqual(level.getRestartState(), { puzzleIndex: 2, stageIndex: 0, seed: 1234 });
    assert.equal(player.health, 100);
  } finally { game.cleanup(); }
});

for (const dt of [1 / 60, 1 / 20]) {
  test(`real bridge jumps reach the spike corridor checkpoint at ${Math.round(1 / dt)} FPS`, () => {
    const game = createGame(0, 1234, false, 1);
    const { level, player, input } = game;
    try {
      const destinations = level.bridgePlatforms.map(bridge => ({ z: bridge.platform.position.z, surface: bridge.surface }));
      destinations.push({ z: level.bridgeExitSurface.maxZ - 1.5, surface: level.bridgeExitSurface });
      input.keys.KeyW = true;
      for (const destination of destinations) {
        game.until(() => player.group.position.z <= destination.z + 4.9, dt, 120);
        assert.equal(player.grounded, true, 'Every jump launches from solid ground');
        input.presses.add('Space');
        game.step(dt);
        assert.equal(player.grounded, false);
        game.until(() => player.grounded, dt, 120);
        assert.equal(player.platformSupport, destination.surface, 'The player reaches the next bridge platform or memory deck');
      }
      game.until(() => level.puzzleIndex === SPIKE_CORRIDOR_PUZZLE, dt, 120);
      input.keys.KeyW = false;
      assert.equal(level.phase, 'chase');
      assert.equal(player.platformSupport, level.bridgeExitSurface);
      assert.equal(player.health, player.maxHealth);
      assert.deepEqual(level.getRestartState(), { puzzleIndex: SPIKE_CORRIDOR_PUZZLE, stageIndex: 0, seed: 1234 });
      assert.match(level.getChallengeStatus().title, /3 \/ 4/);
    } finally { game.cleanup(); }
  });
}

for (const phase of ['dean_arrival', 'dean_to_start', 'player_arrival', 'arrival_camera', 'dean_challenge']) {
  test(`retry during ${phase} restores player visibility, materials and movement`, () => {
    const game = createGame(0, 1234, true, 0, true);
    try {
      const material = game.player.bodyMesh.getObjectByProperty('isMesh', true).material;
      const opacity = material.opacity, transparent = material.transparent, depthWrite = material.depthWrite;
      game.until(() => game.level.phase === phase);
      game.step(0.3);
      game.level.dispose();
      assert.equal(game.player.group.visible, true);
      assert.equal(game.player.bodyMesh.visible, false);
      assert.equal(game.player.group.scale.x, 1);
      assert.equal(game.player.isFirstPerson, true);
      assert.equal(game.player.scriptedMovement, false);
      assert.equal(material.opacity, opacity);
      assert.equal(material.transparent, transparent);
      assert.equal(material.depthWrite, depthWrite);
    } finally { game.cleanup(); }
  });
}

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
    const material = player.bodyMesh.getObjectByProperty('isMesh', true).material;
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
    game.input.keys.KeyW = game.input.keys.KeyQ = true;
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
