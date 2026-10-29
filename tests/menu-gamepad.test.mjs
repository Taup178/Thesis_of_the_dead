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
function menuGame(overlayId, overlay, { pressed = [], gamepadInUse = true, lastInputDevice = 'pad' } = {}) {
  const padPresses = new Set(pressed);
  const input = {
    gamepadInUse, lastInputDevice, moveAxisX: 0, moveAxisY: 0,
    consumeGamepadPress: button => padPresses.delete(button),
    releasePadButton: button => padPresses.delete(button),
  };
  const elements = { [overlayId]: overlay };
  for (const [id, element] of Object.entries(overlay.elements || {})) elements[id] = element;
  const game = {
    input,
    _menuNav: { overlayId: null, index: 0, stickDir: 0, stickDirX: 0, repeat: 0, repeatX: 0, highlighted: null },
    pauseGamepadHint: { hidden: true },
    optionsGamepadHint: { hidden: true },
    menuKeyHint: { hidden: false },
    menuGamepadHint: { hidden: true },
    _activeOverlayId: () => overlayId,
    _updateMenuFocus: Game.prototype._updateMenuFocus,
    _highlightMenuButton: Game.prototype._highlightMenuButton,
    _clearMenuFocus: Game.prototype._clearMenuFocus,
    _menuItemControl: Game.prototype._menuItemControl,
    _pressMenuOption: Game.prototype._pressMenuOption,
    _adjustMenuOption: Game.prototype._adjustMenuOption,
  };
  return { game, padPresses, elements, input };
}

/** An Options row holding one native control. */
function fakeRow(control) {
  return {
    offsetParent: {}, disabled: false,
    classList: { add() {}, remove() {} },
    querySelector: selector => (selector === 'input, select' ? control : null),
    focus() {},
    scrollIntoView(options) { this.scrolled = options; },
  };
}

function fakeRange(value = 70) {
  return {
    type: 'range', min: '0', max: '100', value: String(value), events: [],
    dispatchEvent(event) { this.events.push(event.type); },
    focus() {},
  };
}

function fakeCheckbox(checked = false) {
  return {
    type: 'checkbox', checked, clicks: 0,
    click() { this.clicks++; this.checked = !this.checked; },
    focus() {},
  };
}

function fakeSelect(length = 3) {
  return {
    tagName: 'SELECT', type: 'select-one', options: Array.from({ length }, () => ({})),
    selectedIndex: 0, changes: 0,
    dispatchEvent(event) { if (event.type === 'change') this.changes++; },
    focus() {},
  };
}

/** Run `_updateMenuFocus` with a stubbed document. */
function withDocument(elements, run) {
  const original = globalThis.document;
  const body = { classes: {} };
  body.classList = { toggle(name, on) { body.classes[name] = on; } };
  globalThis.document = { getElementById: id => elements[id] ?? null, body };
  try { return run(body); } finally { globalThis.document = original; }
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

/** Press one pad button for one menu frame. */
function pressOnce(game, button) {
  const presses = new Set([button]);
  game.input.consumeGamepadPress = name => presses.delete(name);
  game._updateMenuFocus(0.016);
}

test('the Options screen focuses every row, not just Back', () => {
  const volume = fakeRow(fakeRange());
  const toggle = fakeRow(fakeCheckbox());
  const mode = fakeRow(fakeSelect());
  const back = fakeButton('btn-options-back');
  const overlay = fakeOverlay({ buttons: [volume, toggle, mode, back], panel: null });
  const { game, elements } = menuGame('options-overlay', overlay);
  withDocument(elements, () => {
    game._updateMenuFocus(0.016);
    assert.equal(game._menuNav.highlighted, volume, 'the first row takes the focus');
    pressOnce(game, PAD.DOWN);
    assert.equal(game._menuNav.highlighted, toggle);
    assert.deepEqual(toggle.scrolled, { block: 'nearest', behavior: 'smooth' });
    pressOnce(game, PAD.DOWN);
    pressOnce(game, PAD.DOWN);
    assert.equal(game._menuNav.highlighted, back);
  });
});

test('left and right adjust the focused option in place', () => {
  const range = fakeRange(70);
  const volume = fakeRow(range);
  const back = fakeButton('btn-options-back');
  const overlay = fakeOverlay({ buttons: [volume, back], panel: null });
  const { game, elements } = menuGame('options-overlay', overlay);
  withDocument(elements, () => {
    game._updateMenuFocus(0.016);
    pressOnce(game, PAD.NEXT_WEAPON);
    assert.equal(range.value, '75', 'right raises the volume');
    assert.deepEqual(range.events, ['input'], 'the slider reports its new value');
    pressOnce(game, PAD.PREV_WEAPON);
    assert.equal(range.value, '70', 'left lowers it again');
  });
});

test('A toggles a checkbox and steps a dropdown', () => {
  const checkbox = fakeCheckbox(false);
  const toggle = fakeRow(checkbox);
  const select = fakeSelect(3);
  const mode = fakeRow(select);
  const overlay = fakeOverlay({ buttons: [toggle, mode], panel: null });
  const { game, elements } = menuGame('options-overlay', overlay);
  withDocument(elements, () => {
    game._updateMenuFocus(0.016);
    pressOnce(game, PAD.JUMP);
    assert.equal(checkbox.checked, true, 'A checks the toggle');
    assert.equal(checkbox.clicks, 1);
    pressOnce(game, PAD.DOWN);
    pressOnce(game, PAD.JUMP);
    assert.equal(select.selectedIndex, 1, 'A advances the dropdown');
    assert.equal(select.changes, 1, 'the change is reported');
  });
});

test('right checks a toggle and left clears it', () => {
  const checkbox = fakeCheckbox(true);
  const row = fakeRow(checkbox);
  const overlay = fakeOverlay({ buttons: [row], panel: null });
  const { game, elements } = menuGame('options-overlay', overlay);
  withDocument(elements, () => {
    game._updateMenuFocus(0.016);
    pressOnce(game, PAD.PREV_WEAPON);
    assert.equal(checkbox.checked, false, 'left clears it');
    pressOnce(game, PAD.NEXT_WEAPON);
    assert.equal(checkbox.checked, true, 'right checks it');
  });
});

test('only the device used last keeps a highlight', () => {
  const volume = fakeRow(fakeRange());
  const back = fakeButton('btn-options-back');
  const overlay = fakeOverlay({ buttons: [volume, back], panel: null });
  const { game, elements } = menuGame('options-overlay', overlay);
  const result = withDocument(elements, body => {
    game._updateMenuFocus(0.016);
    const pad = { ...body.classes, highlighted: game._menuNav.highlighted };
    game.input.lastInputDevice = 'mouse'; // the player reaches for the mouse
    game._updateMenuFocus(0.016);
    return { pad, mouse: { ...body.classes }, highlighted: game._menuNav.highlighted };
  });
  assert.equal(result.pad['using-pad'], true, 'the pad owns the highlight while it is in use');
  assert.equal(result.pad.highlighted, volume);
  assert.equal(result.mouse['using-pad'], false, 'the mouse hands the highlight back to hover');
  assert.equal(result.highlighted, null, 'the pad highlight is dropped');
  assert.equal(game.menuGamepadHint.hidden, true, 'the pad hints give way to the keyboard ones');
});
