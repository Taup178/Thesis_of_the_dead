import test from 'node:test';
import assert from 'node:assert/strict';
import { EndingVoice } from '../src/audio/EndingVoice.js';

test('final voice waits for decoding, starts once and captions only after source starts', async () => {
  let resolve, options, calls = 0, loaded = 0; const captions = [];
  const playback = { settings: { enabled: true, volume: .7, subtitles: true }, load() { loaded++; },
    play(asset, opts) { calls++; options = opts; return new Promise(r => { resolve = r; }); } };
  const voice = new EndingVoice(playback, {url:'final.ogg',effectsBaked:true}, c => captions.push(c));
  voice.start(); voice.start(); assert.equal(loaded, 1); assert.equal(calls, 1); assert.equal(voice.state, 'loading'); assert.deepEqual(captions, []);
  const handle = {stop() { options.onEnd(); }};
  assert.equal(options.isCurrent(), true); options.onStart(handle); resolve(handle); await Promise.resolve();
  assert.equal(voice.state, 'playing'); assert.equal(captions.at(-1)[0].text, "It's done.");
  options.onEnd(); assert.equal(voice.state, 'finished'); assert.deepEqual(captions.at(-1), []);
});

test('muted or unavailable final voice never produces a phantom caption', () => {
  for (const [asset, enabled, volume] of [[null,true,1],['a',false,1],['a',true,0]]) {
    const playback = { settings: {enabled, volume}, load(){}, play(){ throw Error('unexpected'); } };
    const voice = new EndingVoice(playback, asset, () => assert.fail('phantom caption'));
    voice.start(); assert.equal(voice.state, 'finished');
  }
});

test('disposing during decode invalidates the pending request', async () => {
  let options, resolve; const playback = { settings: {enabled:true,volume:1}, load(){}, play(a,o){options=o; return new Promise(r=>resolve=r);} };
  const voice = new EndingVoice(playback,'a'); voice.start(); voice.dispose(); assert.equal(options.isCurrent(), false); resolve(null); await Promise.resolve(); assert.equal(voice.state,'disposed');
});
