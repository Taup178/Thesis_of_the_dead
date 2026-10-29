import test from 'node:test';
import assert from 'node:assert/strict';
import { Game, MENU_BACK_BUTTONS } from '../src/core/Game.js';
import { PAD } from '../src/core/Gamepad.js';

function fakeButton(id, { onClick } = {}) {
  return {
    id, offsetParent: {}, disabled: false,
    classList: { add() {}, remove() {} },
    focus() {},
    scrollIntoView(options) { this.scrolled = options; },
    click() { onClick?.(); },
  };
}

function fakeOverlay({ buttons = [], panel = null } = {}) {
  return {
    querySelectorAll: () => buttons,
    querySelector: selector => (selector === '.menu-container' ? panel : null),
  };
}

function fakePanel({ scrollHeight = 900, clientHeight = 400 } = {}) {
  return {
    scrollHeight, clientHeight, scrolls: [],
    scrollBy(options) { this.scrolls.push(options); },
  };
}

/** Game double with only the menu-nav state, plus a document holding one overlay. */
function menuGame(overlayId, overlay, { pressed = [], gamepadInUse = true } = {}) {
  const padPresses = new Set(pressed);
  const input = {
    gamepadInUse, moveAxisY: 0,
    consumeGamepadPress: button => padPresses.delete(button),
    releasePadButton: button => padPresses.delete(button),
  };
  const elements = { [overlayId]: overlay };
  for (const [id, element] of Object.entries(overlay.elements || {})) elements[id] = element;
  const game = {
    input,
    _menuNav: { overlayId: null, index: 0, stickDir: 0, repeat: 0, highlighted: null },
    pauseGamepadHint: { hidden: true },
    menuKeyHint: { hidden: false },
    menuGamepadHint: { hidden: true },
    _activeOverlayId: () => overlayId,
    _updateMenuFocus: Game.prototype._updateMenuFocus,
    _highlightMenuButton: Game.prototype._highlightMenuButton,
    _clearMenuFocus: Game.prototype._clearMenuFocus,
  };
  return { game, padPresses, elements, input };
}

/** Run `_updateMenuFocus` with a stubbed document. */
function withDocument(elements, run) {
  const original = globalThis.document;
  globalThis.document = { getElementById: id => elements[id] ?? null };
  try { run(); } finally { globalThis.document = original; }
}

test('B leaves a submenu through the same Back button the mouse uses', () => {
  const clicks = [];
  const back = fakeButton('btn-options-back', { onClick: () => clicks.push('back') });
  const overlay = fakeOverlay({ buttons: [back], panel: fakePanel() });
  overlay.elements = { 'btn-options-back': back };
  const { game, padPresses, elements } = menuGame('options-overlay', overlay, { pressed: [PAD.ROLL] });
  withDocument(elements, () => game._updateMenuFocus(0.016));
  assert.deepEqual(clicks, ['back']);
  assert.equal(padPresses.has(PAD.ROLL), false, 'the press is released so it cannot leak into gameplay');
});

test('B is inert on screens that have no parent, but the press is still swallowed', () => {
  const retry = fakeButton('btn-retry');
  const overlay = fakeOverlay({ buttons: [retry], panel: null });
  const { game, padPresses, elements } = menuGame('gameover-overlay', overlay, { pressed: [PAD.ROLL] });
  withDocument(elements, () => game._updateMenuFocus(0.016));
  assert.equal(retry.scrolled, undefined);
  assert.equal(padPresses.has(PAD.ROLL), false);
});

test('every submenu B target exists in the shipped markup', async () => {
  const { readFile } = await import('node:fs/promises');
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  for (const id of Object.values(MENU_BACK_BUTTONS)) {
    assert.ok(html.includes(`id="${id}"`), `${id} is present in index.html`);
  }
});

test('the stick scrolls a long single-button panel such as Options', () => {
  const back = fakeButton('btn-options-back');
  const panel = fakePanel({ scrollHeight: 900, clientHeight: 400 });
  const overlay = fakeOverlay({ buttons: [back], panel });
  overlay.elements = { 'btn-options-back': back };
  const { game, elements } = menuGame('options-overlay', overlay);
  withDocument(elements, () => {
    game.input._padPresses = new Set([PAD.DOWN]);
    game.input.consumeGamepadPress = button => game.input._padPresses.delete(button);
    game._updateMenuFocus(0.016);
    assert.deepEqual(panel.scrolls.at(-1), { top: 64, behavior: 'smooth' });
    game.input._padPresses = new Set([PAD.UP]);
    game._updateMenuFocus(0.016);
    assert.deepEqual(panel.scrolls.at(-1), { top: -64, behavior: 'smooth' });
  });
});

test('a panel that fits does not scroll', () => {
  const back = fakeButton('btn-credits-back');
  const panel = fakePanel({ scrollHeight: 400, clientHeight: 400 });
  const overlay = fakeOverlay({ buttons: [back], panel });
  const { game, elements } = menuGame('credits-overlay', overlay, { pressed: [PAD.DOWN] });
  withDocument(elements, () => game._updateMenuFocus(0.016));
  assert.equal(panel.scrolls.length, 0);
});

test('a multi-button menu moves the highlight and keeps it in view', () => {
  const level1 = fakeButton('level-1');
  const level2 = fakeButton('level-2');
  level2.offsetParent = null; // locked levels are hidden from the pad
  const back = fakeButton('btn-levels-back');
  const panel = fakePanel({ scrollHeight: 900, clientHeight: 400 });
  const overlay = fakeOverlay({ buttons: [level1, level2, back], panel });
  const { game, elements } = menuGame('levels-overlay', overlay, { pressed: [PAD.DOWN] });
  withDocument(elements, () => game._updateMenuFocus(0.016));
  assert.equal(game._menuNav.index, 1);
  assert.equal(game._menuNav.highlighted, back, 'the second selectable button is Back');
  assert.deepEqual(back.scrolled, { block: 'nearest', behavior: 'smooth' });
  assert.equal(panel.scrolls.length, 0, 'button menus scroll through focus, not the panel');
});

test('the pad controls replace the keyboard hint on the main menu', () => {
  const start = fakeButton('btn-start');
  const overlay = fakeOverlay({ buttons: [start], panel: null });
  const { game, elements } = menuGame('menu-overlay', overlay);
  withDocument(elements, () => game._updateMenuFocus(0.016));
  assert.equal(game.menuKeyHint.hidden, true);
  assert.equal(game.menuGamepadHint.hidden, false);
});
