import test from 'node:test';
import assert from 'node:assert/strict';
import { QUALITY_LEVELS, qualityConfig, loadQuality, saveQuality } from '../src/core/Quality.js';

function stubStorage() {
  const data = new Map();
  globalThis.localStorage = {
    getItem: key => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => { data.set(key, String(value)); },
    removeItem: key => { data.delete(key); },
  };
  return data;
}

test('every tier caps pixel ratio, shadow size and blur progressively lower', () => {
  const high = qualityConfig('high');
  const medium = qualityConfig('medium');
  const low = qualityConfig('low');
  assert.ok(high.pixelRatioCap > medium.pixelRatioCap && medium.pixelRatioCap > low.pixelRatioCap);
  assert.ok(high.shadowMapCap > medium.shadowMapCap && medium.shadowMapCap > low.shadowMapCap);
  assert.equal(low.blur, false);
  assert.equal(medium.blur, false);
  assert.equal(high.blur, true);
  for (const config of [high, medium, low]) {
    assert.ok(config.shadowType !== undefined);
    assert.ok(config.pixelRatioCap > 0);
  }
});

test('unknown tiers fall back to the high config', () => {
  assert.deepEqual(qualityConfig('ultra'), qualityConfig('high'));
});

test('quality persists across save and load, ignoring invalid values', () => {
  const data = stubStorage();
  assert.equal(loadQuality(), 'high'); // nothing stored yet
  for (const level of QUALITY_LEVELS) {
    saveQuality(level);
    assert.equal(loadQuality(), level);
  }
  data.set('thesis-of-the-dead:quality', 'ultra');
  assert.equal(loadQuality(), 'high');
  saveQuality('ultra');
  assert.equal(loadQuality(), 'high');
});

test('broken storage returns the default without throwing', () => {
  globalThis.localStorage = {
    getItem() { throw new Error('denied'); },
    setItem() { throw new Error('denied'); },
  };
  assert.equal(loadQuality(), 'high');
  saveQuality('low'); // must not throw
  delete globalThis.localStorage;
});
