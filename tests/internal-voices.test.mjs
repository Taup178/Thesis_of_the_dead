import test from 'node:test';
import assert from 'node:assert/strict';
import { AudioManager } from '../src/core/AudioManager.js';
import { voiceSettings, loadVoiceSettings } from '../src/audio/InternalVoices.js';
import { Level1Voices, loadLevel1VoiceAssets } from '../src/audio/Level1Voices.js';
import { LEVEL1_VOICE_CUES } from '../src/audio/level1VoiceCatalog.js';

class Param {
  constructor(value = 1) { this.value = value; this.targets = []; }
  setTargetAtTime(value, time, duration) { this.value = value; this.targets.push({ value, time, duration }); }
  setValueAtTime(value) { this.value = value; }
  linearRampToValueAtTime(value) { this.value = value; }
  cancelScheduledValues() {}
}
class Node {
  constructor() {
    for (const key of ['gain', 'threshold', 'knee', 'ratio', 'attack', 'release', 'positionX', 'positionY', 'positionZ', 'pan']) this[key] = new Param();
    this.connections = [];
  }
  connect(node) { this.connections.push(node); }
  disconnect() { this.disconnected = true; }
  start(time) { this.startedAt = time; }
  stop() { this.onended?.(); }
}
class Context {
  constructor() { this.state = 'running'; this.currentTime = 0; this.destination = new Node(); this.sources = []; }
  createGain() { return new Node(); }
  createDynamicsCompressor() { return new Node(); }
  createBiquadFilter() { const node = new Node(); node.frequency = new Param(); return node; }
  createPanner() { return this.panner = new Node(); }
  createStereoPanner() { return this.stereo = new Node(); }
  createBufferSource() { const node = new Node(); this.sources.push(node); return node; }
  async decodeAudioData() { return { duration: 2 }; }
  async suspend() { this.state = 'suspended'; }
  async resume() { this.state = 'running'; }
  async close() { this.state = 'closed'; }
}
async function withAudio(run) {
  const saved = { AudioContext: globalThis.AudioContext, fetch: globalThis.fetch, localStorage: globalThis.localStorage };
  globalThis.AudioContext = Context;
  globalThis.fetch = async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(4) });
  globalThis.localStorage = undefined;
  try { await run(new AudioManager()); }
  finally { Object.assign(globalThis, saved); }
}

test('actual internal speech ducks all three backgrounds and overlapping voices restore only after the last end', () => withAudio(async audio => {
  const first = await audio.internalVoices.play('first.wav');
  assert.ok(first);
  assert.equal(audio.dialogueDuckGains.music.gain.value, 0.35);
  assert.equal(audio.dialogueDuckGains.ambience.gain.value, 0.4);
  assert.equal(audio.dialogueDuckGains.sfx.gain.value, 0.65);
  assert.equal(audio.musicGain.gain.value, 0.88);
  assert.equal(audio.voiceGain.gain.value, 0.82, 'Shaun bodily vocals are not background dialogue');
  assert.ok(audio.musicGain.connections.includes(audio.dialogueDuckGains.music));
  const second = await audio.internalVoices.play('second.wav');
  assert.equal(await audio.internalVoices.play('third.wav'), null, 'two simultaneous voices maximum');
  first.source.onended();
  assert.equal(audio.dialogueDuckGains.music.gain.value, 0.35);
  audio.setVolume(0.2);
  second.source.onended();
  second.source.onended();
  for (const gain of Object.values(audio.dialogueDuckGains)) {
    assert.equal(gain.gain.value, 1);
    assert.equal(gain.gain.targets.at(-1).duration, 0.45, 'gentle restoration on audio clock');
    assert.equal(gain.gain.targets.length, 2, 'no overlap pumping or duplicate release');
  }
  assert.equal(audio.master.gain.value, 0.2, 'user master changes survive duck/recovery');
}));

test('loading, cancelled decoding, missing clips and start failures never leave a duck or consume playback slots', () => withAudio(async audio => {
  let resolveFetch;
  globalThis.fetch = () => new Promise(resolve => { resolveFetch = resolve; });
  const pending = audio.internalVoices.play('late.wav');
  assert.equal(audio.dialogueDuckGains.music.gain.value, 1);
  audio.internalVoices.stop();
  assert.equal(audio.internalVoices.pending.size, 0);
  resolveFetch({ ok: true, arrayBuffer: async () => new ArrayBuffer(4) });
  assert.equal(await pending, null);
  assert.equal(audio.context.sources.length, 0);
  globalThis.fetch = async () => ({ ok: false });
  assert.equal(await audio.internalVoices.play('missing.wav'), null);
  assert.equal(audio.dialogueDuckOwners.size, 0);
  globalThis.fetch = async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(4) });
  const createSource = audio.context.createBufferSource.bind(audio.context);
  audio.context.createBufferSource = () => { const node = createSource(); node.start = () => { throw new Error('start failure'); }; return node; };
  assert.equal(await audio.internalVoices.play('cannot-start.wav'), null);
  assert.equal(audio.internalVoices.active.size, 0);
  assert.equal(audio.dialogueDuckOwners.size, 0);
  assert.equal(audio.dialogueDuckGains.music.gain.value, 1);
}));

test('pause, disable, zero voice volume, stop and disposal release speech independently of a future ended event', () => withAudio(async audio => {
  const play = async () => {
    audio.context?.resume();
    audio.internalVoices.configure({ enabled: true, volume: 0.7 });
    const handle = await audio.internalVoices.play('voice.wav');
    assert.ok(handle);
    // Real browsers deliver ended later, and a suspended clock may defer it indefinitely.
    handle.source.stop = () => {};
    return handle;
  };
  for (const cancel of [() => audio.pause(), () => audio.internalVoices.configure({ enabled: false }),
    () => audio.internalVoices.configure({ volume: 0 }), () => audio.stopAll()]) {
    const handle = await play(); cancel();
    assert.equal(audio.dialogueDuckOwners.size, 0);
    assert.equal(audio.dialogueDuckGains.sfx.gain.value, 1);
    handle.source.onended();
    assert.equal(audio.internalVoices.active.size, 0);
  }
  await play(); audio.dispose();
  assert.equal(audio.dialogueDuckOwners.size, 0);
  assert.equal(audio.internalVoices.buffers.size, 0);
}));

test('headphone, stereo and centered playback choose one output route without moving the world listener', () => withAudio(async audio => {
  const first = await audio.internalVoices.play('voice.wav', { pan: -0.5 });
  assert.equal(audio.context.panner.panningModel, 'HRTF');
  assert.equal(audio.context.panner.positionX.value, -0.5);
  first.stop();
  audio.internalVoices.configure({ mode: 'stereo' });
  const second = await audio.internalVoices.play('voice.wav', { pan: 0.55 });
  assert.equal(audio.context.stereo.pan.value, 0.55);
  second.stop();
  audio.internalVoices.configure({ mode: 'centered' });
  audio.context.createPanner = () => { throw new Error('centered must not create a panner'); };
  audio.context.createStereoPanner = audio.context.createPanner;
  assert.ok(await audio.internalVoices.play('voice.wav'));
}));

test('fading repetitions retain ducking through the last echo and cancel with speech', () => withAudio(async audio => {
  const handle = await audio.internalVoices.play('voice.wav', { identity: 'manipulator', pan: 0.25 });
  const [dry, first, second] = audio.context.sources;
  assert.equal(first.buffer, dry.buffer);
  assert.equal(first.startedAt, 0.34);
  assert.equal(second.startedAt, 0.68);
  assert.ok(first.connections[0].gain.value > second.connections[0].gain.value);
  dry.onended(); first.onended();
  assert.equal(audio.dialogueDuckOwners.size, 1);
  second.onended();
  assert.equal(audio.dialogueDuckOwners.size, 0);
  assert.equal(handle.tailDuration, 0.68);
  await audio.internalVoices.play('voice.wav', { identity: 'tormentor' });
  audio.internalVoices.stop();
  assert.equal(audio.internalVoices.active.size, 0);
  assert.equal(audio.dialogueDuckOwners.size, 0);
  assert.ok(audio.context.sources.slice(3).every(node => node.disconnected));
}));

test('voice preferences tolerate unavailable or corrupt storage and sanitize values', () => {
  assert.deepEqual(voiceSettings({ volume: 10, mode: 'bad', enabled: false }), { volume: 1, mode: 'headphones', enabled: false, subtitles: true });
  const saved = globalThis.localStorage;
  globalThis.localStorage = { getItem() { throw new Error('blocked'); } };
  try { assert.equal(loadVoiceSettings().enabled, true); }
  finally { globalThis.localStorage = saved; }
});

function fixture() {
  const playback = {
    settings: { enabled: true, volume: 0.7, subtitles: true }, played: [], loads: [], active: new Set(),
    load(url) { this.loads.push(url); },
    stop() { for (const handle of [...this.active]) handle.stop(); }, unload() { this.stop(); },
    async play(url, options) {
      if (!options.isCurrent()) return null;
      const handle = { duration: 2, stop: () => { this.active.delete(handle); options.onEnd(handle); } };
      this.played.push(url); this.active.add(handle); options.onStart(handle); return handle;
    },
  };
  const assets = Object.fromEntries(LEVEL1_VOICE_CUES.flatMap(cue => cue.lines).map(line => [line.id, `${line.id}.wav`]));
  const captions = [];
  const director = new Level1Voices(playback, { assets, onCaptions: lines => captions.push(lines) });
  const level = { title: 'Chapter 1: The Freshman Woods', creditsCollected: 0, zombies: [], remainingZombies: 16,
    wakeUpIntro: { done: true }, bluePortalUnlocked: false };
  const player = { alive: true, health: 100, maxHealth: 100, grounded: true, ammo: 30, weapon: 'smg', group: { position: { x: 0, z: 0 } } };
  const tick = async (seconds = 0.1, options) => {
    for (let t = 0; t < seconds; t += 0.1) {
      director.update(0.1, level, player, options);
      await Promise.resolve();
    }
  };
  return { director, playback, level, player, captions, tick };
}

test('Level 1 wake starts only with assets and controls; tutorial cancellation removes subtitles and pending replies', async () => {
  const f = fixture();
  await f.tick(2, { blocked: true });
  assert.equal(f.playback.played.length, 0);
  await f.tick(4);
  assert.deepEqual(f.playback.played, ['l1_protector_01.wav']);
  assert.equal(f.captions.at(-1).length, 1);
  await f.tick(0.1, { blocked: true });
  assert.equal(f.playback.active.size, 0);
  assert.deepEqual(f.captions.at(-1), []);
  await f.tick(4);
  assert.equal(f.playback.played.length, 1, 'cancelled speech is not replayed');
  const empty = fixture(); empty.director.assets = {};
  await empty.tick(30);
  assert.equal(empty.playback.played.length, 0);
  assert.equal(empty.playback.loads.length, 0, 'empty manifest makes no guessed requests');
});

test('Dean reveal supersedes pickup commentary; pair warning is discarded if either revealed zombie died', async () => {
  const f = fixture();
  f.director.heard.add('l1_protector_01');
  await f.tick(4);
  f.level.creditsCollected = 8; f.level.bossCutscene = {}; f.level.bossState = 'emerging';
  await f.tick(0.1, { events: { finalCreditCollected: true, deanReveal: true } });
  await f.tick(1);
  assert.deepEqual(f.playback.played, ['l1_tormentor_05.wav']);
  const pair = fixture(); pair.director.heard.add('l1_protector_01');
  await pair.tick(4);
  pair.level.creditsCollected = 1; pair.level.orbPortalCutscene = {};
  pair.level.zombies = [true, false].map(alive => ({ alive, group: { visible: true, position: { x: 20, z: 0 } } }));
  await pair.tick(0.1, { events: { firstCreditCollected: true } });
  pair.level.orbPortalCutscene = null;
  await pair.tick(3);
  assert.equal(pair.playback.played.length, 0);
});

test('death history survives retry, manual restarts do not count, and other chapters never load voices', async () => {
  const f = fixture();
  await f.tick(0.1); f.player.alive = false;
  await f.tick(0.1, { active: false });
  f.director.leave(); f.player.alive = true;
  await f.tick(4);
  assert.deepEqual(f.playback.played, ['l1_protector_08.wav']);
  f.director.leave(); await f.tick(0.1);
  assert.equal(f.director.deaths, 1);
  const loads = f.playback.loads.length;
  f.level.title = 'Chapter 2: The Sophomore Room';
  await f.tick(20);
  assert.equal(f.playback.loads.length, loads);
  assert.equal(f.playback.active.size, 0);
});

test('chapter manifest permits only known line IDs and files inside its own local asset directory', async () => {
  const savedFetch = globalThis.fetch, savedLocation = globalThis.location;
  globalThis.location = { href: 'http://localhost:5173/' };
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ version: 1, clips: {
    l1_protector_01: 'protector/wake.ogg', l1_tormentor_01: '../../music/score.mp3',
    l1_manipulator_01: 'https://elsewhere.example/voice.ogg', arbitrary: 'bad.ogg',
  } }) });
  try { assert.deepEqual(await loadLevel1VoiceAssets(), { l1_protector_01: 'http://localhost:5173/assets/audio/voices/level1/protector/wake.ogg' }); }
  finally { globalThis.fetch = savedFetch; globalThis.location = savedLocation; }
});
