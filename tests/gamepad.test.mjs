import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyRadialDeadzone, findConnectedPad, KEY_TO_PAD, KEY_TO_PADS, MOVE_SNAP_ANGLE,
  PAD, PAD_TO_KEY, readGamepadState, snapToCardinal, stepFocusIndex,
} from '../src/core/Gamepad.js';
import { InputManager } from '../src/core/InputManager.js';

function fakePad({ axes = [0, 0, 0, 0], pressed = [] } = {}) {
  return {
    id: 'FakePad', connected: true, axes,
    buttons: Array.from({ length: 17 }, (_, index) => ({ pressed: pressed.includes(index) })),
  };
}

const approx = (actual, expected, epsilon = 1e-9) => Math.abs(actual - expected) < epsilon;

test('radial deadzone zeroes small vectors and rescales magnitude uniformly', () => {
  assert.deepEqual(applyRadialDeadzone(0.1, 0), [0, 0]);
  assert.deepEqual(applyRadialDeadzone(0.12, -0.12), [0, 0]); // magnitude 0.17 < deadzone
  assert.deepEqual(applyRadialDeadzone(1, 0), [1, 0]);
  assert.deepEqual(applyRadialDeadzone(-1, 0), [-1, 0]);
  const [x, y] = applyRadialDeadzone(0.3, 0.4); // magnitude 0.5 -> scaled (0.5 - 0.18) / 0.82
  assert.ok(approx(x, 0.23414634146341464) && approx(y, 0.3121951219512195));
  // Direction must be preserved exactly — the whole point over per-axis deadzones.
  assert.ok(approx(Math.atan2(y, x), Math.atan2(0.4, 0.3)));
  // A unit vector stays at full magnitude.
  const [ux, uy] = applyRadialDeadzone(0.6, 0.8);
  assert.ok(approx(ux, 0.6) && approx(uy, 0.8));
  // Oversized raw magnitudes clamp to 1.
  const [cx, cy] = applyRadialDeadzone(0.5, -1); // magnitude ~1.118
  assert.ok(approx(Math.hypot(cx, cy), 1));
});

test('snapToCardinal locks near-axis pushes and leaves diagonals analog', () => {
  assert.deepEqual(snapToCardinal(0, 0), [0, 0]);
  // ~5 degrees off straight up snaps to exactly up, keeping the radial-rescaled magnitude.
  const [rx, ry] = applyRadialDeadzone(0.078126, -0.878916);
  const [sx, sy] = snapToCardinal(rx, ry);
  assert.ok(approx(sx, 0, 1e-9) && approx(sy, -Math.hypot(rx, ry), 1e-9) && sy < 0);
  // 26.6 degrees off an axis stays untouched.
  assert.deepEqual(snapToCardinal(0.5, -1), [0.5, -1]);
  // Diagonals (45 degrees) stay analog.
  assert.deepEqual(snapToCardinal(0.7, -0.7), [0.7, -0.7]);
  // Snap respects the configurable angle (26.6° off axis snaps when allowed 0.5 rad).
  const [ax, ay] = snapToCardinal(0.5, -1, 0.5);
  assert.ok(approx(ax, 0, 1e-9) && approx(ay, -Math.hypot(0.5, 1), 1e-9));
});

test('left stick maps to move axes and right stick to look axes with signs', () => {
  const pad = fakePad({ axes: [0.5, -1, -0.4, 0.8] });
  const state = readGamepadState(pad, []);
  const [moveX, moveY] = snapToCardinal(...applyRadialDeadzone(0.5, -1)); // 26.6° off axis: no snap
  assert.ok(approx(state.moveX, moveX) && approx(state.moveY, moveY));
  assert.ok(state.moveY < 0); // stick up = -1 = forward
  const [lookX, lookY] = applyRadialDeadzone(-0.4, 0.8);
  assert.ok(approx(state.lookX, lookX) && approx(state.lookY, lookY));
  assert.equal(state.active, true);
});

test('a near-straight push with drift walks exactly straight', () => {
  const state = readGamepadState(fakePad({ axes: [0.08, -0.9] }), []);
  assert.ok(approx(state.moveX, 0, 1e-12));
  assert.ok(state.moveY < 0 && approx(Math.hypot(state.moveX, state.moveY), (Math.hypot(0.08, 0.9) - 0.18) / 0.82, 1e-6));
});

test('snap angle is about 20 degrees', () => {
  assert.ok(MOVE_SNAP_ANGLE > 0.3 && MOVE_SNAP_ANGLE < 0.45);
});

test('button edges fire once per press and held state persists', () => {
  const previous = [];
  let state = readGamepadState(fakePad({ pressed: [PAD.FIRE] }), previous);
  assert.equal(state.held[PAD.FIRE], true);
  assert.equal(state.pressed.has(PAD.FIRE), true);
  state = readGamepadState(fakePad({ pressed: [PAD.FIRE] }), previous); // still held
  assert.equal(state.held[PAD.FIRE], true);
  assert.equal(state.pressed.has(PAD.FIRE), false);
  state = readGamepadState(fakePad({}), previous); // released
  assert.equal(state.held[PAD.FIRE], false);
  assert.equal(state.pressed.has(PAD.FIRE), false);
  assert.equal(state.active, false);
});

test('idle pad reports no activity', () => {
  const state = readGamepadState(fakePad(), []);
  assert.equal(state.active, false);
  for (const index of Object.values(PAD)) assert.equal(state.held[index], false);
});

test('findConnectedPad skips empty and disconnected entries', () => {
  const pad = fakePad();
  assert.equal(findConnectedPad([null, undefined]), null);
  assert.equal(findConnectedPad([{ connected: false }]), null);
  assert.equal(findConnectedPad([null, pad]), pad);
});

test('button-to-key map is consistent and covers the core actions', () => {
  for (const [button, code] of Object.entries(PAD_TO_KEY)) {
    assert.ok(KEY_TO_PADS[code].includes(Number(button)), `${code} includes pad ${button}`);
  }
  for (const code of ['Space', 'KeyQ', 'KeyC', 'Digit1', 'KeyF', 'ShiftLeft']) {
    assert.ok(KEY_TO_PAD[code] !== undefined, `${code} mapped`);
  }
});

test('LB attacks, RB sprints and L3 gun-bashes', () => {
  assert.equal(PAD.ATTACK, 4);
  assert.equal(PAD.SPRINT, 5);
  assert.equal(PAD.BASH, 10);
  assert.equal(PAD_TO_KEY[PAD.SPRINT], 'ShiftLeft');
  assert.deepEqual(KEY_TO_PADS['ShiftLeft'], [5]);
  assert.equal(PAD_TO_KEY[PAD.BASH], 'KeyF');
  assert.deepEqual(KEY_TO_PADS['KeyF'], [10]);
  // LB rides the mouse-button path instead of a virtual key, so it fires guns and swings melee.
  assert.equal(PAD_TO_KEY[PAD.ATTACK], undefined);
  // X opens the weapon wheel.
  assert.equal(PAD.WHEEL, 2);
  assert.equal(PAD_TO_KEY[PAD.WHEEL], 'Digit1');
});

test('LB reads as a mouse click so it shoots or attacks with the equipped weapon', () => {
  const input = Object.create(InputManager.prototype);
  input.mouseButtons = {};
  input.mousePresses = {};
  input._padHeld = { [PAD.ATTACK]: true };
  input._padPresses = new Set([PAD.ATTACK]);
  assert.equal(input.isMouseButtonDown(0), true);
  assert.equal(input.consumeMousePresses(0), 1);
  assert.equal(input.consumeMousePresses(0), 0); // one press, consumed once
  input._padHeld = { [PAD.SPRINT]: true };
  assert.equal(input.isMouseButtonDown(0), false); // sprint must not fire
  input._padHeld = { [PAD.ALT_FIRE]: true };
  assert.equal(input.isMouseButtonDown(2), true);
  assert.equal(input.isMouseButtonDown(0), false);
  input._padHeld = { [PAD.FIRE]: true };
  assert.equal(input.isMouseButtonDown(0), true); // RT stays a fire button
});

test('d-pad up/down use the standard-mapping button indices', () => {
  assert.equal(PAD.UP, 12);
  assert.equal(PAD.DOWN, 13);
  assert.equal(PAD_TO_KEY[PAD.UP], undefined);
  assert.equal(PAD_TO_KEY[PAD.DOWN], undefined);
});

test('stepFocusIndex moves and wraps in both directions', () => {
  assert.equal(stepFocusIndex(0, 1, 4), 1);
  assert.equal(stepFocusIndex(3, 1, 4), 0); // wrap past the end
  assert.equal(stepFocusIndex(0, -1, 4), 3); // wrap past the start
  assert.equal(stepFocusIndex(2, -1, 4), 1);
  assert.equal(stepFocusIndex(1, 0, 4), 1); // no movement
  assert.equal(stepFocusIndex(0, 1, 0), -1); // empty list
  assert.equal(stepFocusIndex(0, 1, -2), -1); // invalid count
});
