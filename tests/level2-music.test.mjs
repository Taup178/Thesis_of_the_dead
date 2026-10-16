import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Level2 } from '../src/levels/Level2.js';
import { Level2Music, createMusicLoopBuffer } from '../src/levels/Level2Music.js';

function buffer(channels, length, sampleRate) {
  const data = Array.from({ length: channels }, () => new Float32Array(length));
  return { numberOfChannels: channels, length, sampleRate, duration: length / sampleRate,
    getChannelData: channel => data[channel] };
}

test('music retains its first intro and joins each loop to the overlapped opening', () => {
  const input = buffer(2, 48000, 48000);
  for (let channel = 0; channel < 2; channel++) {
    const data = input.getChannelData(channel);
    for (let i = 0; i < data.length; i++) data[i] = Math.sin(i * 0.017 + channel) * 0.2;
  }
  const loop = createMusicLoopBuffer({ createBuffer: buffer }, input);
  const overlap = Math.round(loop.loopStart * input.sampleRate);
  for (let channel = 0; channel < 2; channel++) {
    const output = loop.buffer.getChannelData(channel), original = input.getChannelData(channel);
    assert.deepEqual(output.subarray(0, input.length - overlap), original.subarray(0, input.length - overlap));
    assert.ok(Math.abs(output.at(-1) - output[overlap]) < 0.004, 'loop boundary must remain continuous');
    assert.ok(output.every(Number.isFinite));
  }
});

test('Dean cue starts the score; effects duck it, master mute works, pause preserves the loop position', async () => {
  const previousDocument = globalThis.document, previousFetch = globalThis.fetch;
  globalThis.document = { hidden: false, addEventListener() {}, removeEventListener() {} };
  globalThis.fetch = async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(0) });
  const param = () => ({ value: 0, setValueAtTime(value) { this.value = value; },
    setTargetAtTime(value) { this.value = value; }, linearRampToValueAtTime(value) { this.value = value; },
    cancelAndHoldAtTime() {} });
  const node = () => ({ gain: param(), frequency: param(), Q: param(), connect() {}, disconnect() {} });
  const decoded = buffer(2, 200, 100);
  decoded.getChannelData(0).fill(0.1); decoded.getChannelData(1).fill(0.1);
  const context = { currentTime: 0, state: 'running', destination: {}, createGain: node,
    createBiquadFilter: node, createBuffer: buffer, decodeAudioData: async () => decoded,
    createBufferSource: () => ({ connect() {}, disconnect() {}, stop() {},
      start(time, offset) { this.startOffset = offset; } }) };
  let music;
  try {
    const level = new Level2(new THREE.Scene());
    music = new Level2Music(context); level.music = music; await music.ready;
    assert.ok(music.buffer);
    level.sawSound = { targetVolume: 0 };
    level.tileBreakSound = { voices: new Set() }; level.getEffectsVolume = () => 0.7;
    const player = { alive: true, health: 100, maxHealth: 100, shotTime: 0, bashTime: 0, damageFlashTime: 0 };
    level._updateMusic(player); assert.equal(music.source, undefined, 'score must wait for the Dean');
    level.deanBladeIntro = true; level._finishDeanBladeIntro(); level._updateMusic(player);
    assert.ok(music.source?.loop); assert.equal(music.source.startOffset, 0);
    const baseline = music.targetVolume;
    level.tileBreakSound.voices.add({}); level._updateMusic(player);
    assert.ok(music.targetVolume < baseline, 'tile breaks must stay audible');
    level.tileBreakSound.voices.clear(); level.sawSound.targetVolume = 0.56; level._updateMusic(player);
    assert.ok(music.targetVolume < baseline, 'saws must stay audible');
    level.sawSound.targetVolume = 0; player.shotTime = 0.14; level._updateMusic(player);
    assert.ok(music.targetVolume < baseline, 'combat must stay audible');
    player.shotTime = 0; level._updateMusic(player); assert.equal(music.targetVolume, baseline);
    level.getEffectsVolume = () => 0; level._updateMusic(player); assert.equal(music.targetVolume, 0);
    context.currentTime = 6.5; music.pause(); const offset = music.offset;
    assert.equal(music.source, null); assert.ok(offset >= music.loopStart && offset < music.buffer.duration);
    level.getEffectsVolume = () => 0.7; level._updateMusic(player);
    assert.equal(music.source.startOffset, offset, 'resume must continue instead of restarting');
    assert.equal(new Level2(new THREE.Scene(), { puzzleIndex: 1 }).musicCueReached, true);
    assert.equal(new Level2(new THREE.Scene(), { puzzleIndex: 2 }).musicCueReached, true);
  } finally {
    music?.dispose();
    if (music) for (const voice of [...music.voices]) voice.source.onended();
    globalThis.document = previousDocument; globalThis.fetch = previousFetch;
  }
});
