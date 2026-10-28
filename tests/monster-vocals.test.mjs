import test from 'node:test';
import assert from 'node:assert/strict';
import { MonsterVocals, MONSTER_VOCAL_ASSETS } from '../src/audio/MonsterVocals.js';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const flush = async () => { await Promise.resolve(); await Promise.resolve(); };
function fixture() {
  const played = [], sources = [], owners = new Set();
  const audio = {
    internalVoices: { active: new Set(), pending: new Set() }, dialogueDuckOwners: owners,
    acquireDialogueDucking() { const owner = {}; owners.add(owner); return () => owners.delete(owner); },
    playSfx(file, options) {
      const listeners = [];
      const source = { stopped: false, addEventListener: (_name, callback) => listeners.push(callback),
        finish() { listeners.forEach(callback => callback()); }, stop() { this.stopped = true; this.finish(); } };
      played.push({ id: file.split('/').at(-1).replace('.ogg', ''), file, options }); sources.push(source);
      return Promise.resolve(source);
    },
  };
  const position = { x: 3, y: 0, z: 10 }, vocals = new MonsterVocals(audio, position);
  vocals.start(); return { vocals, audio, played, sources, owners, position };
}

test('combat cycles growls and distinct taunts with one voice at a time and music ducking', async () => {
  const f = fixture();
  f.vocals.update(1); assert.equal(f.played.length, 0);
  f.vocals.update(1); await flush();
  assert.equal(f.played[0].id, 'intro'); assert.equal(f.owners.size, 1);
  f.vocals.update(15); assert.equal(f.played.length, 1, 'a long playing clip is never stacked');
  f.sources.at(-1).finish(); assert.equal(f.owners.size, 0);
  for (let i = 0; i < 5; i++) {
    f.vocals.update(11); await flush(); f.sources.at(-1).finish();
  }
  assert.deepEqual(f.played.map(clip => clip.id), ['intro', 'growl-01', 'taunt-01', 'growl-02', 'taunt-02', 'taunt-03']);
  assert.equal(f.played[0].options.position, f.position);
  assert.equal(f.played[0].options.category, 'voice');
  assert.equal(f.played[0].options.referenceDistance, 18, 'a distant boss remains audible');
  f.vocals.stop();
});

test('internal dialogue postpones the creature and interrupts incidental taunts', async () => {
  const f = fixture(); f.audio.internalVoices.active.add('protector');
  f.vocals.update(3); await flush(); assert.equal(f.played.length, 0);
  f.audio.internalVoices.active.clear(); f.vocals.update(1.1); await flush();
  assert.equal(f.played.length, 1);
  f.audio.internalVoices.active.add('anxious'); f.vocals.update(0.1);
  assert.equal(f.sources[0].stopped, true); assert.equal(f.owners.size, 0);
  f.vocals.stop();
});

test('attack vocals have a shared cooldown and the enrage line takes priority', async () => {
  const f = fixture(); f.vocals.update(2); await flush(); f.sources[0].finish();
  f.vocals.attack('rush'); await flush();
  assert.equal(f.played.at(-1).id, 'rush');
  f.vocals.enrage(); f.vocals.update(0.1); await flush();
  assert.equal(f.sources[1].stopped, true); assert.equal(f.played.at(-1).id, 'enrage');
  f.sources.at(-1).finish();
  f.vocals.attack('roar'); await flush();
  assert.equal(f.played.at(-1).id, 'enrage', 'rapid attacks do not spam roars');
  f.vocals.update(11); await flush(); f.sources.at(-1).finish();
  f.vocals.attack('roar'); await flush(); assert.equal(f.played.at(-1).id, 'attack-roar');
  f.vocals.stop();
});

test('death interrupts a taunt once, uses its own voice slot, and prevents all later speech', async () => {
  const f = fixture(); f.vocals.update(2); await flush();
  f.vocals.die(); await flush(); f.vocals.die();
  assert.equal(f.sources[0].stopped, true);
  assert.deepEqual(f.played.map(clip => clip.id), ['intro', 'death']);
  assert.equal(f.played.at(-1).options.group, 'monster-death', 'old audio cleanup cannot suppress the death roar');
  f.vocals.update(30); f.vocals.enrage(); f.vocals.attack('rush'); await flush();
  assert.equal(f.played.length, 2);
  f.vocals.stop(); assert.equal(f.sources.at(-1).stopped, true); assert.equal(f.owners.size, 0);
});

test('stopping cancels pending playback so no late voice leaks into a restart', async () => {
  const f = fixture(); let resolve;
  f.audio.playSfx = () => new Promise(done => { resolve = done; });
  f.vocals.update(2); f.vocals.stop();
  const source = { stopped: false, stop() { this.stopped = true; } };
  resolve(source); await flush(); assert.equal(source.stopped, true);
  assert.equal(f.owners.size, 0);
  assert.equal(MONSTER_VOCAL_ASSETS.length, 10);
});

test('all ten served monster clips match their generated, mastered asset records', () => {
  const records = JSON.parse(readFileSync(new URL('../audio-staging/monster/clips.json', import.meta.url)));
  const manifest = JSON.parse(readFileSync(new URL('../public/assets/audio/voices/monster/manifest.json', import.meta.url)));
  assert.equal(records.clips.length, 10);
  for (const asset of MONSTER_VOCAL_ASSETS) {
    const id = asset.split('/').at(-1).replace('.ogg', '');
    const record = records.clips.find(record => record.id === id);
    const bytes = readFileSync(new URL(`../public/${asset.slice(2)}`, import.meta.url));
    assert.equal(bytes.subarray(0, 4).toString(), 'OggS');
    assert.equal(createHash('sha256').update(bytes).digest('hex'), record.sha256);
    assert.ok(manifest.clips[id].duration > 0.3 && manifest.clips[id].duration < 10);
  }
});
