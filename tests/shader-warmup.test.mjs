import test from 'node:test';
import assert from 'node:assert/strict';
import { compileHiddenObjects } from '../src/core/ShaderWarmup.js';

test('hidden objects are revealed for the compile pass and restored afterwards', async () => {
  let duringCompile = null;
  const renderer = { compileAsync: async () => { duringCompile = [a.visible, b.visible, c.visible]; } };
  const a = { visible: false }, b = { visible: true }, c = { visible: false };
  await compileHiddenObjects(renderer, {}, {}, [a, b, c]);
  assert.deepEqual(duringCompile, [true, true, true]); // everything visible for the compile pass
  assert.deepEqual([a.visible, b.visible, c.visible], [false, true, false]);
});

test('already-visible objects are untouched and skipped', async () => {
  let compiles = 0;
  const renderer = { compileAsync: async () => { compiles++; } };
  const visible = { visible: true };
  await compileHiddenObjects(renderer, {}, {}, [visible]);
  assert.equal(compiles, 0);
  assert.equal(visible.visible, true);
});

test('empty and null lists are safe', async () => {
  const renderer = { compileAsync: async () => { throw new Error('must not compile'); } };
  await compileHiddenObjects(renderer, {}, {}, []);
  await compileHiddenObjects(renderer, {}, {}, [null, undefined]);
});

test('visibility is restored even if compilation fails', async () => {
  const hidden = { visible: false };
  const renderer = { compileAsync: async () => { throw new Error('compile error'); } };
  await assert.rejects(compileHiddenObjects(renderer, {}, {}, [hidden]));
  assert.equal(hidden.visible, false);
});

test('a renderer without compileAsync is tolerated', async () => {
  const hidden = { visible: false };
  await compileHiddenObjects({}, {}, {}, [hidden]);
  assert.equal(hidden.visible, false);
});
