import test from 'node:test';
import assert from 'node:assert/strict';
import { LevelProgress } from '../src/core/LevelProgress.js';
import { LevelManager } from '../src/levels/LevelManager.js';
import { Game } from '../src/core/Game.js';

function memoryStorage() {
  let value = null;
  return { getItem: () => value, setItem: (_key, next) => { value = next; } };
}

test('Start Game honors the final-boss URL instead of forcing Chapter 1', async () => {
  const previousDocument = globalThis.document, previousWindow = globalThis.window;
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, { style: {}, classList: { add() {} },
      listeners: {}, addEventListener(type, callback) { this.listeners[type] = callback; } });
    return elements.get(id);
  };
  globalThis.document = { getElementById: element, addEventListener() {}, querySelectorAll: () => [] };
  globalThis.window = { location: { search: '?level=3&transform=1' } };
  const stop = new Error('stop after selecting the level');
  let selected, launch;
  const game = { input: {}, renderer: { domElement: element('canvas') },
    combat: { reset() {} }, firstLevelTutorialSeen: new Set(), firstLevelHintQueue: [],
    STATE: { LOADING: 'loading' }, hudEl: element('hud'), _showOverlay() {}, _releaseMouse() {},
    levelManager: { progress: new LevelProgress(memoryStorage()),
      async loadLevel(index, progress, options) { selected = { index, options }; throw stop; } },
    startGame(...args) { launch = Game.prototype.startGame.apply(this, args); } };
  try {
    Game.prototype._bindUI.call(game);
    element('btn-start').listeners.click();
    await assert.rejects(launch, error => error === stop);
    assert.deepEqual(selected, { index: 2, options: { transformationPreview: true } });
  } finally { globalThis.document = previousDocument; globalThis.window = previousWindow; }
});

test('only Level 1 starts unlocked; reaching later levels persists without replay relocking them', () => {
  const storage = memoryStorage(), progress = new LevelProgress(storage);
  assert.deepEqual([0, 1, 2].map(i => progress.canPlay(i)), [true, false, false]);
  progress.reach(1);
  assert.deepEqual([0, 1, 2].map(i => new LevelProgress(storage).canPlay(i)), [true, true, false]);
  progress.reach(2); progress.reach(0);
  assert.deepEqual([0, 1, 2].map(i => new LevelProgress(storage).canPlay(i)), [true, true, true]);
  for (const invalid of [-1, 3, 0.5, NaN, '1']) assert.equal(progress.canPlay(invalid), false);
});

test('invalid or blocked storage keeps a fresh game playable and preserves session unlocks', () => {
  for (const value of ['broken', '{"version":1,"highestReached":99}', '{"version":1,"highestReached":"2"}']) {
    const progress = new LevelProgress({ getItem: () => value });
    assert.equal(progress.highestReached, 0);
  }
  const progress = new LevelProgress({ getItem() { throw Error('blocked'); }, setItem() { throw Error('blocked'); } });
  progress.reach(1);
  assert.equal(progress.canPlay(1), true);
  progress.reach(99);
  assert.equal(progress.canPlay(2), false);
});

test('level loading and transitions unlock reached chapters, while a failed load does not', async () => {
  const manager = new LevelManager({}), storage = memoryStorage();
  manager.progress = new LevelProgress(storage);
  manager._getLevelClass = () => class { async load() {} dispose() {} };
  await manager.loadLevel(0);
  await manager.nextLevel();
  assert.equal(new LevelProgress(storage).canPlay(1), true);
  assert.equal(new LevelProgress(storage).canPlay(2), false);
  manager._getLevelClass = () => class { async load() { throw Error('load failed'); } };
  await assert.rejects(manager.nextLevel(), /load failed/);
  assert.equal(new LevelProgress(storage).canPlay(2), false);
});

test('level selection disables locked chapters and rejects a direct locked selection before loading', async () => {
  const previous = globalThis.document;
  const buttons = [0, 1, 2].map(index => ({ dataset: { levelIndex: String(index) },
    status: {}, querySelector() { return this.status; } }));
  const game = { levelManager: { progress: new LevelProgress(memoryStorage()) } };
  globalThis.document = { querySelectorAll: () => buttons };
  try {
    Game.prototype._refreshLevelMenu.call(game);
    assert.deepEqual(buttons.map(button => button.disabled), [false, true, true]);
    assert.match(buttons[1].status.textContent, /Locked/);
    await Game.prototype.startGame.call(game, 1);
    assert.equal(game.state, undefined, 'locked selection never enters loading');
    game.levelManager.progress.reach(1);
    Game.prototype._refreshLevelMenu.call(game);
    assert.deepEqual(buttons.map(button => button.disabled), [false, false, true]);
    assert.equal(buttons[1].status.textContent, 'Available');
  } finally { globalThis.document = previous; }
});
