import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { AudioManager } from '../src/core/AudioManager.js';
import { loadDeanLaugh } from '../src/enemies/DeanLaughAudio.js';

class FakeParam {
  constructor(value = 1) { this.value = value; this.events = []; }
  setTargetAtTime(value) { this.value = value; }
  setValueAtTime(value, time) { this.value = value; this.events.push({ type: 'set', value, time }); }
  linearRampToValueAtTime(value, time) { this.value = value; this.events.push({ type: 'ramp', value, time }); }
  cancelScheduledValues() {}
}

class FakeNode {
  constructor() {
    this.gain = new FakeParam();
    this.threshold = new FakeParam();
    this.knee = new FakeParam();
    this.ratio = new FakeParam();
    this.attack = new FakeParam();
    this.release = new FakeParam();
    this.playbackRate = new FakeParam(1);
    this.connections = [];
  }
  connect(node) { this.connections.push(node); }
  disconnect() {}
  start(...args) { this.startArgs = args; }
  stop() { this.onended?.(); }
}

class FakeAudioContext {
  constructor() {
    this.state = 'running';
    this.currentTime = 0;
    this.sampleRate = 48000;
    this.destination = new FakeNode();
    this.sources = [];
  }
  createGain() { return new FakeNode(); }
  createBiquadFilter() { const node = new FakeNode(); node.frequency = new FakeParam(350); return node; }
  createDynamicsCompressor() { return new FakeNode(); }
  createBuffer(channels, length) {
    const data = Array.from({ length: channels }, () => new Float32Array(length));
    return { getChannelData: channel => data[channel] };
  }
  createBufferSource() {
    const source = new FakeNode();
    this.sources.push(source);
    return source;
  }
  createOscillator() {
    const source = new FakeNode();
    source.frequency = new FakeParam(220);
    this.sources.push(source);
    return source;
  }
  async decodeAudioData() {
    return {
      numberOfChannels: 1,
      length: 4,
      duration: 180,
      getChannelData: () => new Float32Array([0.01, 0.02, -0.01, -0.02]),
    };
  }
  async resume() { this.state = 'running'; }
  async suspend() { this.state = 'suspended'; }
  async close() { this.state = 'closed'; }
}

function withAudioGlobals(callback) {
  const oldAudioContext = globalThis.AudioContext;
  const oldFetch = globalThis.fetch;
  const urls = [];
  globalThis.AudioContext = FakeAudioContext;
  globalThis.fetch = async url => {
    urls.push(url);
    return {
      ok: !String(url).includes('missing'),
      status: 404,
      arrayBuffer: async () => new ArrayBuffer(4),
    };
  };
  return Promise.resolve(callback(urls)).finally(() => {
    globalThis.AudioContext = oldAudioContext;
    globalThis.fetch = oldFetch;
  });
}

test('source loudness compensation is bounded by gain and peak ceilings', () => {
  const manager = new AudioManager();
  const quietBuffer = {
    numberOfChannels: 1,
    length: 4,
    getChannelData: () => new Float32Array([0.01, 0.02, -0.01, -0.02]),
  };
  assert.equal(manager._normalizedGain(quietBuffer, 'music'), 4);

  const loudBuffer = {
    numberOfChannels: 1,
    length: 4,
    getChannelData: () => new Float32Array([0.5, 0.5, -0.5, -0.5]),
  };
  assert.ok(manager._normalizedGain(loudBuffer, 'sfx') < 1);
});

test('failed audio loads resolve safely and release their reserved voice', async () => {
  await withAudioGlobals(async () => {
    const manager = new AudioManager();
    const originalWarn = console.warn;
    console.warn = () => {};
    try {
      assert.equal(await manager.playSfx('./assets/audio/missing.ogg', { group: 'zombie' }), null);
      assert.equal(manager.groupVoiceCounts.has('zombie'), false);
    } finally {
      console.warn = originalWarn;
    }
  });
});

test('SFX voice caps and cooldown keys bound repeated playback', async () => {
  await withAudioGlobals(async () => {
    const manager = new AudioManager();
    const first = manager.playSfx('./assets/audio/voice.ogg', {
      group: 'zombie',
      maxVoices: 1,
      cooldownKey: 'zombie-idle-1',
      cooldown: 5,
    });
    assert.equal(await manager.playSfx('./assets/audio/voice.ogg', {
      group: 'zombie',
      maxVoices: 1,
    }), null);
    assert.ok(await first);
    assert.equal(manager.groupVoiceCounts.get('zombie'), 1);
    assert.equal(await manager.playSfx('./assets/audio/voice.ogg', {
      group: 'zombie',
      maxVoices: 1,
      cooldownKey: 'zombie-idle-1',
      cooldown: 5,
    }), null);
    manager.activeVoices.values().next().value.source.onended();
    assert.equal(manager.groupVoiceCounts.has('zombie'), false);
  });
});

test('pausing and stopping cancel pending one-shots without leaving voice reservations', async () => {
  const oldAudioContext = globalThis.AudioContext;
  const oldFetch = globalThis.fetch;
  let resolveFetch;
  globalThis.AudioContext = FakeAudioContext;
  globalThis.fetch = () => new Promise(resolve => { resolveFetch = resolve; });
  try {
    const manager = new AudioManager();
    const pending = manager.playSfx('./assets/audio/late.ogg', { group: 'player' });
    await Promise.resolve();
    manager.stopAll();
    resolveFetch({
      ok: true,
      arrayBuffer: async () => new ArrayBuffer(4),
    });
    assert.equal(await pending, null);
    assert.equal(manager.groupVoiceCounts.has('player'), false);

    manager.pause();
    await Promise.resolve();
    assert.equal(manager.context.state, 'suspended');
    manager.resume();
    await Promise.resolve();
    assert.equal(manager.context.state, 'running');
  } finally {
    globalThis.AudioContext = oldAudioContext;
    globalThis.fetch = oldFetch;
  }
});

test('final fights crossfade to Tar at 1:00 and Red Moon at 0:25 without the old boss score', async () => {
  await withAudioGlobals(async urls => {
    const manager = new AudioManager();
    await manager.setLevelTheme('Chapter 3: The Final Encounter');
    assert.equal(manager.themeSources.size, 0);
    await manager.setFinalEncounterPhase('house-emergence');
    assert.equal(manager.themeKey, 'final-house-emergence');
    assert.ok(urls.some(url => url.endsWith('/music/tar.mp3')));
    manager.context.currentTime = 10;
    const house = [...manager.themeSources][0];
    await manager.setFinalEncounterPhase('dean');
    assert.equal(manager.themeKey, 'final-dean');
    const dean = [...manager.themeSources][0];
    assert.deepEqual(dean.source.startArgs, [10, 60]);
    assert.equal(dean.source.buffer, manager.cache.get('./assets/audio/music/tar.mp3'));
    assert.deepEqual(dean.gain.gain.events[0], { type: 'set', value: 0, time: 10 });
    assert.equal(dean.gain.gain.events.at(-1).time, 13, 'Tar fades up over three seconds');
    assert.equal(house.gain.gain.events.at(-1).value, 0, 'the preceding music fades away');
    const count = manager.context.sources.length;
    await manager.setFinalEncounterPhase('dean');
    assert.equal(manager.context.sources.length, count, 'per-frame phase sync never restarts the song');
    manager.context.currentTime = 35;
    await manager.setFinalEncounterPhase('monster');
    const monster = [...manager.themeSources][0];
    assert.equal(manager.themeKey, 'final-monster');
    assert.deepEqual(monster.source.startArgs, [35, 25]);
    assert.equal(monster.source.buffer, manager.cache.get('./assets/audio/red-moon.mp3'));
    assert.deepEqual(monster.gain.gain.events[0], { type: 'set', value: 0, time: 35 });
    assert.equal(monster.gain.gain.events.at(-1).time, 38, 'Red Moon fades up over three seconds');
    assert.equal(dean.gain.gain.events.at(-1).value, 0, 'Tar fades out beneath Red Moon');
    manager.pause(); await Promise.resolve(); manager.resume(); await Promise.resolve();
    await manager.setFinalEncounterPhase('monster');
    assert.equal(manager.context.sources.length, count + 1, 'pause resumes the existing song');
    manager.context.currentTime = 50;
    await manager.setFinalEncounterPhase('complete');
    assert.equal(manager.themeKey, 'final-complete');
    assert.equal(manager.themeSources.size, 0);
    assert.deepEqual(monster.gain.gain.events.at(-1), { type: 'ramp', value: 0, time: 52 },
      'all music fades out over two seconds after the degree cutscene');
    await manager.setFinalEncounterPhase('complete');
    assert.equal(manager.context.sources.length, count + 1, 'silence does not restart a source');
    assert.ok(!urls.some(url => url.endsWith('/music/arena-wind.ogg')));
    assert.ok(!urls.some(url => url.endsWith('/music/lost-horror.ogg')));
    assert.ok(!urls.some(url => url.endsWith('/music/final-boss.mp3')));
    manager.stopAll();
  });
});

test('returning to the quiet final arena cancels the preceding chapter music', async () => {
  await withAudioGlobals(async () => {
    const manager = new AudioManager();
    await manager.playTheme('earlier-level', './assets/audio/music/rannsaka.mp3');
    assert.equal(manager.themeSources.size, 1);
    await manager.setLevelTheme('Chapter 3: The Final Encounter');
    assert.equal(manager.themeSources.size, 0);
    manager.stopAll();
  });
});

test('both final boss tracks match the supplied Zombie Kit originals', () => {
  for (const [served, original] of [
    ['music/tar.mp3', 'Tar [agmPnGNZ574].mp3'],
    ['red-moon.mp3', 'Red Moon [uvgIA_KBNf8].mp3'],
  ]) {
    assert.ok(readFileSync(new URL(`../public/assets/audio/${served}`, import.meta.url))
      .equals(readFileSync(new URL(`../Zombie_Kit/${original}`, import.meta.url))));
  }
});

test('Level 1 stays quiet until the first-orb song starts and a restart clears it', async () => {
  await withAudioGlobals(async () => {
    const manager = new AudioManager();
    await manager.setLevelTheme('Chapter 1: Freshman Woods');
    assert.equal(manager.themeSources.size, 0);
    assert.ok(manager.cache.has('./assets/audio/music/rannsaka.mp3'));

    manager.pause();
    assert.equal(manager.context.state, 'suspended');
    assert.equal(manager.themeSources.size, 0);
    manager.resume();
    assert.equal(manager.context.state, 'running');

    await manager.playTheme('freshman-rannsaka', './assets/audio/music/rannsaka.mp3', { volume: 0.62 });
    const firstOrbSources = [...manager.themeSources];
    assert.equal(firstOrbSources.length, 1);
    assert.equal(manager.themeKey, 'freshman-rannsaka');

    await manager.restartLevelTheme('Chapter 1: Freshman Woods');
    assert.equal(manager.themeKey, null);
    assert.equal(manager.themeSources.size, 0);
    for (const track of firstOrbSources) assert.equal(manager.themeSources.has(track), false);
    manager.stopAll();
  });
});

test('generated story cues route to the audible buses and clean up safely', async () => {
  await withAudioGlobals(async () => {
    const manager = new AudioManager();
    manager.setListenerPosition({ x: 0, y: 0, z: 0 });
    manager.startPortalHum({ x: 0, y: 0, z: 6 });
    const hum = manager.portalHum;
    manager.startPortalHum({ x: 0, y: 0, z: 4 });
    assert.equal(manager.portalHum, hum);
    assert.equal(hum.gain.connections[0], manager.ambienceGain);

    for (const cue of [
      manager.playUiHover(),
      manager.playUiConfirm(),
      manager.playCreditPickup(),
      manager.playDeanReveal(),
      manager.playPortalActivation(),
      manager.playPortalEntry(),
      manager.playFinalCreditMilestone(),
    ]) {
      assert.ok(cue);
      assert.equal(cue.nodes.at(-1).connections[0], manager.sfxGain);
    }
    manager.pause();
    assert.equal(manager.generatedEffects.size, 0);
    manager.resume();
    assert.equal(manager.portalHum, hum);
    manager.stopAll();
    assert.equal(manager.portalHum, null);
  });
});

test('Batch 1 cleared assets are present and use one-shot cooldown cleanup', async () => {
  const assets = [
    'public/assets/audio/sfx/collect/ammo-pickup-event-a.wav',
    'public/assets/audio/sfx/collect/ammo-pickup-event-b.wav',
    ...[1, 2, 3, 4, 5].map(index => `public/assets/audio/sfx/player/shaun-exertion-0${index}.ogg`),
    ...[1, 2].map(index => `public/assets/audio/sfx/player/garybran-forest-step-0${index}.ogg`),
    ...[1, 2].map(index => `public/assets/audio/sfx/weapon/artninja-sword-swing-0${index}.ogg`),
  ];
  for (const asset of assets) {
    assert.equal(existsSync(asset), true, `${asset} is missing`);
    assert.ok(statSync(asset).size > 0, `${asset} is empty`);
  }

  await withAudioGlobals(async () => {
    const manager = new AudioManager();
    const first = manager.playSfx('./assets/audio/sfx/collect/ammo-pickup-event-a.wav', {
      group: 'pickup', maxVoices: 1, cooldownKey: 'ammo-pickup', cooldown: 0.15,
    });
    assert.equal(await manager.playSfx('./assets/audio/sfx/collect/ammo-pickup-event-b.wav', {
      group: 'pickup', maxVoices: 1, cooldownKey: 'ammo-pickup', cooldown: 0.15,
    }), null);
    assert.ok(await first);
    manager.stopEffects();
    assert.equal(manager.groupVoiceCounts.has('pickup'), false);
  });
});

test('cleared footstep and melee variants are preloaded for event-driven playback', () => {
  const gameSource = readFileSync('src/core/Game.js', 'utf8');
  for (const index of [1, 2]) {
    assert.match(gameSource, new RegExp(`garybran-forest-step-0${index}\\.ogg`));
    assert.match(gameSource, new RegExp(`artninja-sword-swing-0${index}`));
  }
  assert.doesNotMatch(gameSource, /player\/footstep-0[01]\.ogg|weapon\/swish-[12]\.wav/);
});

test('the optional private Dean laugh falls back safely when absent from a public checkout', async () => {
  const oldFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: false, status: 404 });
  try {
    assert.equal(await loadDeanLaugh({ decodeAudioData() {} }), null);
  } finally { globalThis.fetch = oldFetch; }
  assert.match(readFileSync('.gitignore', 'utf8'), /public\/assets\/audio\/dean-laugh\.mp3/);
});

test('the optional local Dean laugh decodes once and retains its cinematic duration', async () => {
  const module = await import(`../src/enemies/DeanLaughAudio.js?local-test=${Date.now()}`);
  const oldFetch = globalThis.fetch;
  globalThis.fetch = async url => ({ ok: String(url).endsWith('dean-laugh.mp3'), arrayBuffer: async () => new ArrayBuffer(8) });
  const context = { decodeAudioData: async () => ({ sampleRate: 48000, length: 4800, duration: 0.1, numberOfChannels: 1, getChannelData: () => new Float32Array(4800) }) };
  try {
    const clip = await module.loadDeanLaugh(context);
    assert.equal(clip.buffer.duration, 0.1);
    assert.equal(clip.envelopeStep, 0.025);
  } finally { globalThis.fetch = oldFetch; }
});
