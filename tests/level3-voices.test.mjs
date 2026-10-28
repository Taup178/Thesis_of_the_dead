import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Level3Voices } from '../src/audio/Level3Voices.js';
import { ChapterVoices } from '../src/audio/ChapterVoices.js';
import { LEVEL3_VOICE_CUES } from '../src/audio/level3VoiceCatalog.js';

function fixture() {
  let time = 0;
  const handles = new Set(), captions = [];
  const playback = { settings: { enabled: true, volume: 0.7, subtitles: true }, played: [],
    audio: { context: { get currentTime() { return time; } } }, load() {},
    stop() { for (const h of [...handles]) h.stop(); }, unload() { this.stop(); },
    async play(url, options) {
      if (!options.isCurrent()) return null;
      const h = { duration: 1, end: time + 1.2, stop() { handles.delete(h); options.onEnd(h); } };
      handles.add(h); this.played.push(url); options.onStart(h); return h;
    } };
  const assets = Object.fromEntries(LEVEL3_VOICE_CUES.flatMap(c => c.lines).map(l => [l.id, l.id]));
  const director = new Level3Voices(playback, { assets, onCaptions: value => captions.push(value) });
  const level = { title: 'Chapter 3: The Final Encounter', timeRemaining: 60, houses: Array.from({ length: 4 }, () => ({ alive: true })),
    houseEmergenceCuePlayed: false, spawnRecords: [], bossFight: { phase: 'waiting' } };
  const player = { alive: true, health: 100, maxHealth: 100, ammo: 30, group: { position: { x: 0, z: 31 } } };
  const tick = async (seconds = 0.1, options = {}) => {
    for (let t = 0; t < seconds - 1e-6; t += 0.1) {
      time += 0.1;
      for (const h of [...handles]) if (h.end <= time) h.stop();
      director.update(0.1, level, player, options); await Promise.resolve();
    }
  };
  const skip = id => LEVEL3_VOICE_CUES.find(c => c.id === id).lines.forEach(l => director.heard.add(l.id));
  return { playback, director, level, player, tick, skip, handles, captions };
}

test('final chapter shares the established cast/history and stays quiet until the arrival finishes', async () => {
  const f = fixture(), chapters = new ChapterVoices(f.playback);
  assert.equal(chapters._chapter(f.level), chapters.third);
  assert.equal(chapters.third.heard, chapters.first.heard);
  f.level.arrivalPlayer = f.player;
  await f.tick(5); assert.equal(f.playback.played.length, 0);
  f.level.arrivalPlayer = null;
  await f.tick(4);
  assert.deepEqual(f.playback.played, ['l3_tormentor_arrival', 'l3_protector_arrival']);
  await f.tick(30); assert.equal(f.playback.played.length, 2, 'arrival never loops');
});

test('house reactions require real destruction/emergence and deadline dialogue expires on arena clearance', async () => {
  const f = fixture(); f.skip('arrival');
  await f.tick(); f.level.houseEmergenceCuePlayed = true;
  const record = { phase: 'waiting', zombie: { alive: true, group: { visible: false } } };
  f.level.spawnRecords.push(record); await f.tick(); assert.equal(f.playback.played.length, 0);
  record.phase = 'active'; record.zombie.group.visible = true;
  await f.tick(); assert.deepEqual(f.playback.played, ['l3_anxious_emergence']);
  f.level.timeRemaining = 14; await f.tick();
  f.level.arenaCleared = true; await f.tick(3);
  assert.ok(!f.playback.played.includes('l3_anxious_time_low'), 'queued clock warning is obsolete once cleared');
  assert.ok(f.playback.played.includes('l3_protector_arena_clear'));
});

test('transformation lines follow the actual fall, revival and visible monster reveal', async () => {
  const f = fixture();
  f.level.transformation = { time: 0.3, timing: { fallEnd: 2, scrollCatch: 13 } };
  await f.tick(2); assert.deepEqual(f.playback.played, ['l3_anxious_dean_fallen']);
  f.level.transformation.time = 3; await f.tick(2);
  assert.equal(f.playback.played.at(-1), 'l3_tormentor_transformation');
  f.level.transformation.time = 12; await f.tick(2);
  assert.ok(!f.playback.played.includes('l3_anxious_monster_reveal'));
  f.level.transformation.time = 13.3; await f.tick(2);
  assert.equal(f.playback.played.at(-1), 'l3_anxious_monster_reveal');
});

test('victory preview skips earlier story and waits for physical pickup and visible portals', async () => {
  const f = fixture(); f.level.monsterFight = { phase: 'defeated' };
  f.level.degreeVictory = { taken: false }; f.level.victoryPortals = { time: 0 };
  await f.tick(2); assert.deepEqual(f.playback.played, ['l3_protector_monster_fallen']);
  f.level.degreeVictory.taken = true; await f.tick(4);
  assert.ok(f.playback.played.includes('l3_anxious_degree_taken'));
  assert.ok(f.playback.played.includes('l3_protector_degree_held'));
  assert.ok(!f.playback.played.includes('l3_manipulator_portals'));
  f.level.victoryPortals.time = 2; await f.tick(4);
  assert.deepEqual(f.playback.played.slice(-2), ['l3_manipulator_portals', 'l3_protector_portals']);
  f.level.destinyChoice = 'blue'; await f.tick(2);
  assert.equal(f.playback.played.at(-1), 'l3_protector_blue_choice');
  assert.ok(!f.playback.played.includes('l3_protector_red_choice'));
});

test('failure mentions flames only after ignition and never says Shaun claimed his degree', async () => {
  const f = fixture(); f.level.degreeBurn = { time: 0, timing: { ignite: 8 } };
  await f.tick(3); assert.deepEqual(f.playback.played, ['l3_tormentor_burn_raise']);
  f.level.degreeBurn.time = 8; await f.tick(2);
  assert.equal(f.playback.played.at(-1), 'l3_anxious_burn_flames');
  f.player.alive = false; await f.tick(); assert.equal(f.handles.size, 0);
  assert.ok(!f.playback.played.some(id => /degree_(taken|held)/.test(id)));
});

test('pause, mute, death and inventory cancel speech, tails, pending replies and captions', async () => {
  for (const mode of ['pause', 'mute', 'death', 'inventory']) {
    const f = fixture(); await f.tick(); assert.equal(f.handles.size, 1);
    if (mode === 'mute') f.playback.settings.enabled = false;
    if (mode === 'death') f.player.alive = false;
    await f.tick(0.1, { active: mode !== 'pause', blocked: mode === 'inventory' });
    assert.equal(f.handles.size, 0, mode); assert.equal(f.director.pending, null);
    assert.deepEqual(f.captions.at(-1), []);
  }
});

test('all authored lines have generated local recordings with the existing four identities', () => {
  const root = new URL('../public/assets/audio/voices/level3/', import.meta.url);
  const manifest = JSON.parse(readFileSync(new URL('manifest.json', root), 'utf8'));
  const lines = LEVEL3_VOICE_CUES.flatMap(c => c.lines);
  assert.equal(lines.length, 25); assert.equal(Object.keys(manifest.clips).length, lines.length);
  for (const line of lines) {
    assert.ok(['tormentor', 'anxious', 'manipulator', 'protector'].includes(line.identity));
    const clip = manifest.clips[line.id]; assert.ok(clip.effectsBaked && clip.speechDuration > 0);
    const bytes = readFileSync(new URL(clip.file, root));
    assert.equal(bytes.subarray(0, 4).toString(), 'OggS'); assert.ok(bytes.length > 2000);
  }
});

test('ending room replays the real choice recording once and stops when blocked', async () => {
  const f = fixture(); f.level.destinyChoice = 'blue';
  await f.tick(2);
  const before = f.playback.played.filter(id => id === 'l3_protector_blue_choice').length;
  f.level.endingCutscene = { time: 0 }; await f.tick(3);
  assert.equal(f.playback.played.filter(id => id === 'l3_protector_blue_choice').length, before + 1);
  await f.tick(3, { blocked: true });
  assert.equal(f.handles.size, 0);
  await f.tick(2, { blocked: true });
  assert.equal(f.playback.played.filter(id => id === 'l3_protector_blue_choice').length, before + 1);
});
