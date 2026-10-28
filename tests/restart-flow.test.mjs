import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../src/core/Game.js';
import { LevelManager } from '../src/levels/LevelManager.js';

test('LevelManager distinguishes a full restart from a checkpoint retry', async () => {
  const manager = new LevelManager({});
  const snapshot = { puzzleIndex: 2 };
  manager.currentLevelIndex = 1;
  manager.currentLevel = { getRestartState: () => snapshot };
  const loads = [];
  manager.loadLevel = async (...args) => {
    loads.push(args);
    return {};
  };

  await manager.restartLevel();
  await manager.restartLevel(undefined, { preserveCheckpoint: false });

  assert.equal(loads[0][0], 1);
  assert.equal(loads[0][2], snapshot);
  assert.equal(loads[1][0], 1);
  assert.equal(loads[1][2], null);
});

test('pause menu buttons invoke their actions without bubbling to the resume overlay', () => {
  const elements = new Map();
  const getElement = id => {
    if (!elements.has(id)) elements.set(id, {
      listeners: {},
      addEventListener(type, handler) { this.listeners[type] = handler; },
    });
    return elements.get(id);
  };
  const originalDocument = globalThis.document;
  globalThis.document = {
    addEventListener() {},
    getElementById: getElement,
  };
  const actions = [];
  const game = {
    renderer: { domElement: { addEventListener() {} } },
    input: {},
    state: 'paused',
    STATE: { PAUSED: 'paused' },
    resume: () => actions.push('resume'),
    restartLevel: options => actions.push(['restart', options]),
    returnToMenu: () => actions.push('menu'),
    _showOverlay: overlay => actions.push(['overlay', overlay]),
  };

  try {
    Game.prototype._bindUI.call(game);
    const overlayClick = getElement('pause-overlay').listeners.click;
    for (const [id, expected] of [
      ['btn-pause-resume', 'resume'],
      ['btn-pause-restart', ['restart', { preserveCheckpoint: false }]],
      ['btn-pause-options', ['overlay', 'options-overlay']],
      ['btn-pause-menu', 'menu'],
    ]) {
      let stopped = false;
      getElement(id).listeners.click({ stopPropagation() { stopped = true; } });
      if (!stopped) overlayClick();
      assert.deepEqual(actions.at(-1), expected);
    }
    assert.deepEqual(actions, [
      'resume',
      ['restart', { preserveCheckpoint: false }],
      ['overlay', 'options-overlay'],
      'menu',
    ]);
  } finally {
    globalThis.document = originalDocument;
  }
});

test('Game restart forwards full-restart intent and restores player and controls', async () => {
  const originalDocument = globalThis.document;
  const originalSetTimeout = globalThis.setTimeout;
  const originalWindow = globalThis.window;
  globalThis.setTimeout = () => 0;
  globalThis.window = { innerWidth: 1920, innerHeight: 1080, devicePixelRatio: 1 };
  globalThis.document = {
    getElementById(id) {
      if (id === 'progress-bar') return { style: {} };
      if (id === 'volume-slider') return { value: '50' };
      throw new Error(`Unexpected element ${id}`);
    },
  };

  const spawnPoint = { x: 1, y: 2, z: 3 };
  const prepared = [];
  const level = {
    spawnPoint,
    title: 'Freshman Woods',
    preparePlayer: player => prepared.push(player),
  };
  const calls = [];
  const player = { reset: point => calls.push(['reset', point]) };
  const game = {
    combat: { reset() {} },
    state: 'paused',
    quality: 'high',
    scene: { traverse() {} },
    STATE: { LOADING: 'loading', PLAYING: 'playing' },
    _showOverlay() {},
    hudEl: { classList: { add() {}, remove() {} } },
    _captureMouse: () => calls.push('capture'),
    _releaseMouse: () => calls.push('release'),
    levelManager: {
      restartLevel: async (...args) => {
        calls.push(['restart', args[1]]);
        return level;
      },
    },
    player,
    heartbeat: { context: {} },
    renderer: { setPixelRatio() {}, setSize() {}, shadowMap: {} },
    camera: {},
    levelTitleDisplay: { textContent: '', classList: { add() {}, remove() {} } },
  };

  try {
    await Game.prototype.restartLevel.call(game, { preserveCheckpoint: false });
    assert.deepEqual(calls.find(call => Array.isArray(call) && call[0] === 'restart')[1], {
      preserveCheckpoint: false,
    });
    assert.deepEqual(calls.find(call => Array.isArray(call) && call[0] === 'reset'), ['reset', spawnPoint]);
    assert.deepEqual(prepared, [player]);
    assert.equal(game.state, 'playing');
    assert.equal(calls.filter(call => call === 'capture').length, 1);
    assert.equal(calls.filter(call => call === 'release').length, 1);
  } finally {
    globalThis.document = originalDocument;
    globalThis.setTimeout = originalSetTimeout;
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
  }
});

test('Game Over labels retry only when an earned checkpoint snapshot exists', () => {
  const retryButton = { textContent: '' };
  const elements = {
    'gameover-text': { textContent: '' },
    'btn-retry': retryButton,
  };
  const originalDocument = globalThis.document;
  globalThis.document = {
    getElementById: id => elements[id],
    exitPointerLock() {},
  };
  const game = {
    STATE: { GAMEOVER: 'gameover' },
    hudEl: { classList: { add() {} } },
    _showOverlay() {},
  };

  try {
    game.currentLevel = { getRestartState: () => null };
    Game.prototype.gameOver.call(game);
    assert.equal(retryButton.textContent, 'Try Again');

    game.currentLevel = { getRestartState: () => ({ puzzleIndex: 0, stageIndex: 0, seed: 42 }) };
    Game.prototype.gameOver.call(game);
    assert.equal(retryButton.textContent, 'Try Again');

    game.currentLevel = { getRestartState: () => ({ puzzleIndex: 2, stageIndex: 1, seed: 42 }) };
    Game.prototype.gameOver.call(game);
    assert.equal(retryButton.textContent, 'Retry Checkpoint');

    game.currentLevel = { getRestartState: () => ({ bossPreview: true }) };
    Game.prototype.gameOver.call(game);
    assert.equal(retryButton.textContent, 'Try Again');

    game.currentLevel = { getRestartState: () => ({ arenaCleared: true }) };
    Game.prototype.gameOver.call(game);
    assert.equal(retryButton.textContent, 'Retry Checkpoint');
  } finally {
    globalThis.document = originalDocument;
  }
});

test('returning to the main menu disposes gameplay and releases pointer lock', () => {
  const calls = [];
  const originalDocument = globalThis.document;
  globalThis.document = { exitPointerLock: () => calls.push('unlock') };
  const player = { dispose: () => calls.push('player disposed') };
  const level = { dispose: () => calls.push('level disposed') };
  const game = {
    combat: { reset: () => calls.push('combat reset') },
    STATE: { MENU: 'menu' },
    player,
    currentLevel: level,
    levelManager: { currentLevel: level },
    hudEl: { classList: { add: () => calls.push('hud hidden') } },
    _showOverlay: overlay => calls.push(overlay),
  };

  try {
    Game.prototype.returnToMenu.call(game);
    assert.deepEqual(calls, ['combat reset', 'unlock', 'level disposed', 'player disposed', 'hud hidden', 'menu-overlay']);
    assert.equal(game.state, 'menu');
    assert.equal(game.player, null);
    assert.equal(game.currentLevel, null);
    assert.equal(game.levelManager.currentLevel, null);
  } finally {
    globalThis.document = originalDocument;
  }
});
