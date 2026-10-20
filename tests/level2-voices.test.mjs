import test from 'node:test';
import assert from 'node:assert/strict';
import { Level2Voices, memoryLieDirection } from '../src/audio/Level2Voices.js';
import { LEVEL2_VOICE_CUES } from '../src/audio/level2VoiceCatalog.js';
import { SOPHOMORE_LAYOUT as layout, SPIKE_CORRIDOR_PUZZLE } from '../src/levels/SophomoreLayout.js';

function fixture() {
  const playback = {
    settings: { enabled: true, volume: 0.7, subtitles: true }, active: new Set(), played: [],
    load() {}, stop() { for (const handle of [...this.active]) handle.stop(); }, unload() { this.stop(); },
    async play(url, options) {
      if (!options.isCurrent()) return null;
      const handle = { duration: 2, stop: () => { this.active.delete(handle); options.onEnd(handle); } };
      this.active.add(handle); this.played.push(url); options.onStart(handle); return handle;
    },
  };
  const assets = Object.fromEntries(LEVEL2_VOICE_CUES.flatMap(c => c.lines).map(l => [l.id, l.id]));
  const captions = [];
  const director = new Level2Voices(playback, { assets, onCaptions: c => captions.push(c) });
  const level = { title: 'Chapter 2: The Sophomore Room', puzzleIndex: 0, phase: 'dean_challenge',
    deanBladeIntro: false, ambush: null, stageIndex: 0 };
  const player = { alive: true, health: 100, maxHealth: 100, ammo: 30, grounded: true,
    platformSupport: {}, group: { position: { x: 0, z: layout.spawnZ } } };
  const tick = async (seconds = 0.1, options) => {
    for (let t = 0; t < seconds; t += 0.1) { director.update(0.1, level, player, options); await Promise.resolve(); }
  };
  return { director, playback, level, player, tick, captions };
}

test('blade demonstration stays quiet; a safe-deck recording finishes during a crossing', async () => {
  const f = fixture(); f.level.deanBladeIntro = true;
  await f.tick(5); assert.equal(f.playback.played.length, 0);
  f.level.deanBladeIntro = false; await f.tick(4);
  assert.deepEqual(f.playback.played, ['l2_protector_01']);
  f.player.group.position.z = layout.firstBladeZ;
  await f.tick(); assert.equal(f.playback.active.size, 1);
});

test('entering memory demonstration or traversal lets an audible sentence finish', async () => {
  for (const condition of ['watch', 'follow']) {
    const f = fixture(); await f.tick(4); assert.equal(f.playback.active.size, 1);
    if (condition === 'jump') f.player.grounded = false;
    else if (condition === 'bridge') f.player.platformSupport.bridge = 0;
    else { f.level.puzzleIndex = 2; f.level.phase = condition; }
    await f.tick();
    assert.equal(f.playback.active.size, 1, condition);
    assert.equal(f.playback.played.at(-1), 'l2_protector_01');
    await f.tick(20); assert.equal(f.playback.played.length, 1, 'no repeated chatter each frame');
    f.level.phase = 'entering'; f.player.scriptedMovement = true; await f.tick();
    assert.equal(f.playback.active.size, 0);
  }
});

test('ordinary jumps and moving platforms do not cut off an already audible sentence', async () => {
  for (const condition of ['jump', 'bridge']) {
    const f = fixture(); await f.tick(0.2);
    assert.equal(f.playback.active.size, 1, 'entry voice starts promptly');
    if (condition === 'jump') f.player.grounded = false;
    else f.player.platformSupport.bridge = 0;
    await f.tick();
    assert.equal(f.playback.active.size, 1, condition);
    assert.equal(f.playback.played.length, 1, 'no additional voice starts during traversal');
  }
});

test('ambush warning waits for a real visible arrival and expires rather than guessing danger', async () => {
  const f = fixture(); f.level.puzzleIndex = SPIKE_CORRIDOR_PUZZLE; f.level.phase = 'chase';
  f.player.group.position.z = layout.spikeCorridorMaxZ - 3;
  const record = { phase: 'waiting', zombie: { alive: true, group: { visible: false } } };
  f.level.ambush = { started: true, cleared: false, currentWave: 0, records: [record] };
  await f.tick(4); assert.equal(f.playback.played.length, 0);
  record.phase = 'jumping'; record.zombie.group.visible = true;
  await f.tick(); assert.deepEqual(f.playback.played, ['l2_anxious_03']);
});

test('memory entry help requires a cleared ambush and a safe untimed landing', async () => {
  const f = fixture(); f.level.puzzleIndex = SPIKE_CORRIDOR_PUZZLE; f.level.phase = 'chase';
  f.player.group.position.z = layout.memoryTriggerZ + 1;
  f.level.memoryApproachArmed = false;
  f.level.ambush = { started: true, cleared: true, currentWave: 3, records: [] };
  f.director.heard.add('l2_protector_03');
  await f.tick(9);
  assert.deepEqual(f.playback.played, ['l2_protector_08']);
  f.level.puzzleIndex = 2; f.level.phase = 'watch'; await f.tick();
  assert.equal(f.playback.played.at(-1), 'l2_protector_08', 'memory transition does not cut the current sentence');
});

test('deceptive calls oppose the real next tile relative to Shaun and skip straight or rearward jumps', () => {
  const player = { yaw: 0, group: { position: { x: 0, z: 0 } } };
  const level = { expectedIndex: 1, pattern: [[0, 0], [1, 0]], tilePosition: () => ({ x: 3, z: -3 }) };
  assert.equal(memoryLieDirection(level, player), 'left');
  level.tilePosition = () => ({ x: -3, z: -3 });
  assert.equal(memoryLieDirection(level, player), 'right');
  level.tilePosition = () => ({ x: 0, z: -3 });
  assert.equal(memoryLieDirection(level, player), null);
  level.tilePosition = () => ({ x: 3, z: 3 });
  assert.equal(memoryLieDirection(level, player), null);
  player.yaw = Math.PI / 2;
  level.tilePosition = () => ({ x: -3, z: -3 });
  assert.equal(memoryLieDirection(level, player), 'left');
});

test('approved directional assets play the opposite call once per memory stage and finish across landings', async () => {
  for (const [x, direction] of [[3, 'left'], [-3, 'right']]) {
    const f = fixture();
    f.level.puzzleIndex = 2; f.level.phase = 'watch';
    f.level.pattern = [[0, 0], [1, 0], [2, 0]]; f.level.expectedIndex = 0;
    f.player.group.position = { x: 0, z: 0 }; f.player.yaw = 0;
    f.level.tilePosition = () => ({ x, z: -3 });
    await f.tick(5);
    for (const handle of [...f.playback.active]) handle.stop();
    await f.tick(0.2);
    f.level.phase = 'follow'; f.level.expectedIndex = 1;
    await f.tick();
    assert.equal(f.playback.played.at(-1), `l2_manipulator_${direction}`);
    f.level.expectedIndex = 2; await f.tick();
    assert.equal(f.playback.active.size, 1, 'the sentence finishes even when the player lands');
    await f.tick(10);
    assert.equal(f.playback.played.filter(id => id === `l2_manipulator_${direction}`).length, 1);
  }
});

test('final success waits for portal passage to end and cancels immediately when Shaun enters', async () => {
  const f = fixture(); f.level.puzzleIndex = 2; f.level.phase = 'dean_exit';
  f.player.group.position.z = -40; f.player.platformSupport = { tile: { checkpoint: true } };
  await f.tick(5); assert.equal(f.playback.played.length, 0);
  f.level.phase = 'exit'; await f.tick(2);
  assert.deepEqual(f.playback.played, ['l2_tormentor_03']);
  f.level.phase = 'entering'; f.player.scriptedMovement = true;
  await f.tick(); assert.equal(f.playback.active.size, 0);
});
