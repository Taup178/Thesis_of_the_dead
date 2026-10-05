import test from 'node:test';
import assert from 'node:assert/strict';
import { getDistressEffects, Heartbeat } from '../src/core/Heartbeat.js';

const player = { alive: true, health: 100, maxHealth: 100 };

test('wake-up blur fades away and healthy gameplay stays clear', () => {
  const intro = { time: 0, duration: 3.5, done: false };
  assert.equal(getDistressEffects(player, intro, true).blur, 1);
  intro.time = 1.75;
  assert.equal(getDistressEffects(player, intro, true).blur, 0.5);
  intro.done = true;
  assert.deepEqual(getDistressEffects(player, intro, true), { blur: 0, distress: 0 });
  assert.equal(getDistressEffects(player, null, true).blur, 0);
});

test('low health intensifies effects; healing, death and pause clear them', () => {
  const hurt = { ...player, health: 39 };
  const low = getDistressEffects(hurt, null, true);
  const critical = getDistressEffects({ ...hurt, health: 5 }, null, true);
  assert.ok(low.blur > 0 && low.distress > 0);
  assert.ok(critical.blur > low.blur && critical.distress > low.distress);
  for (const [subject, active] of [[player, true], [{ ...hurt, health: 40 }, true], [hurt, false], [{ ...hurt, alive: false }, true]]) {
    assert.deepEqual(getDistressEffects(subject, null, active), { blur: 0, distress: 0 });
  }
});

test('heartbeat plays paired thumps, respects cadence and stops on recovery or mute', () => {
  const heartbeat = new Heartbeat();
  const beats = [];
  let stopped = 0;
  heartbeat.context = { currentTime: 1, state: 'running' };
  heartbeat.master = { gain: { setTargetAtTime() {}, cancelScheduledValues() {}, setValueAtTime() {} } };
  heartbeat._thump = (...args) => beats.push(args);
  heartbeat.update(0.5, 0.7);
  assert.equal(beats.length, 2);
  assert.equal(beats[1][0] - beats[0][0] > 0.15, true);
  heartbeat.update(0.5, 0.7);
  assert.equal(beats.length, 2);
  heartbeat.voices.add({ stop() { stopped++; } });
  heartbeat.update(0, 0.7);
  assert.equal(stopped, 1);
  assert.equal(heartbeat.nextBeat, 0);
  heartbeat.update(1, 0);
  assert.equal(beats.length, 2);
  heartbeat.update(1, 0.7);
  assert.equal(beats.length, 4);
});
