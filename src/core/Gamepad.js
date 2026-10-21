/**
 * Gamepad helpers — pure functions over the browser Gamepad API shape,
 * kept DOM-free so they can be unit-tested with fake pad objects.
 *
 * Standard-mapping button indices: 0 A/Cross, 1 B/Circle, 3 Y/Triangle,
 * 4 LB, 5 RB, 6 LT, 7 RT, 8 Back, 9 Start, 10 L3, 12/13 d-pad up/down,
 * 14/15 d-pad left/right.
 */

export const PAD = {
  JUMP: 0, ROLL: 1, WHEEL: 2, CAMERA: 3, SPRINT_ALT: 4, BASH: 5,
  ALT_FIRE: 6, FIRE: 7, START: 9, SPRINT: 10, LOCK_ON: 11,
  UP: 12, DOWN: 13, PREV_WEAPON: 14, NEXT_WEAPON: 15,
};

export const DEFAULT_DEADZONE = 0.18;

/** Pad buttons translated onto keyboard codes; InputManager ORs these with real keys. */
export const PAD_TO_KEY = {
  [PAD.JUMP]: 'Space',
  [PAD.ROLL]: 'KeyQ',
  [PAD.SPRINT_ALT]: 'ShiftLeft', // LB doubles L3 so pads without a stick click can still sprint
  [PAD.CAMERA]: 'KeyC',
  [PAD.WHEEL]: 'Digit1',
  [PAD.BASH]: 'KeyF',
  [PAD.SPRINT]: 'ShiftLeft',
  [PAD.LOCK_ON]: 'KeyL',
};

export const KEY_TO_PAD = Object.fromEntries(Object.entries(PAD_TO_KEY).map(([button, code]) => [code, Number(button)]));

/** Every pad button held for a key, per key — a held action (sprint) may accept several buttons. */
export const KEY_TO_PADS = {};
for (const [button, code] of Object.entries(PAD_TO_KEY)) {
  (KEY_TO_PADS[code] ??= []).push(Number(button));
}

/** Walk-straight assist: pushes within this many radians of a cardinal axis lock onto it. */
export const MOVE_SNAP_ANGLE = 0.35; // ~20 degrees

/**
 * Radial deadzone: zero the whole stick vector below the threshold, then rescale its
 * magnitude uniformly. Direction is preserved exactly — a per-axis deadzone skews it
 * (an axis barely past the deadzone collapses toward 0, swinging the walk angle).
 */
export function applyRadialDeadzone(x, y, deadzone = DEFAULT_DEADZONE) {
  const magnitude = Math.hypot(x, y);
  if (magnitude <= deadzone) return [0, 0];
  const scaled = Math.min(1, (magnitude - deadzone) / (1 - deadzone));
  const factor = scaled / magnitude;
  return [x * factor, y * factor];
}

/** Snap a stick direction to the nearest cardinal axis when it is within `snap` radians. */
export function snapToCardinal(x, y, snap = MOVE_SNAP_ANGLE) {
  const magnitude = Math.hypot(x, y);
  if (magnitude === 0) return [x, y];
  const angle = Math.atan2(y, x);
  const nearest = Math.round(angle / (Math.PI / 2)) * (Math.PI / 2);
  if (Math.abs(angle - nearest) > snap) return [x, y];
  return [Math.cos(nearest) * magnitude, Math.sin(nearest) * magnitude];
}

/** Look speed in "mouse-pixel equivalents" per second at full stick tilt. */
export const GAMEPAD_LOOK_SPEED = 900;

/**
 * Reads one frame of gamepad state.
 * `previousButtons` is an array of booleans from the last call; it is updated in place.
 */
export function readGamepadState(pad, previousButtons, deadzone = DEFAULT_DEADZONE) {
  const axes = pad.axes || [];
  // The movement stick gets a radial deadzone plus a walk-straight snap so pushes
  // near a cardinal direction walk exactly straight; the look stick stays analog.
  let moveX, moveY;
  [moveX, moveY] = applyRadialDeadzone(axes[0] ?? 0, axes[1] ?? 0, deadzone);
  [moveX, moveY] = snapToCardinal(moveX, moveY);
  const [lookX, lookY] = applyRadialDeadzone(axes[2] ?? 0, axes[3] ?? 0, deadzone);
  const held = {};
  const pressed = new Set();
  pad.buttons?.forEach((button, index) => {
    const down = !!button.pressed;
    held[index] = down;
    if (down && !previousButtons[index]) pressed.add(index);
    previousButtons[index] = down;
  });
  const active = pressed.size > 0 || Object.values(held).some(Boolean)
    || moveX !== 0 || moveY !== 0 || lookX !== 0 || lookY !== 0;
  return { moveX, moveY, lookX, lookY, held, pressed, active };
}

/** First connected pad from a navigator.getGamepads() array-like, or null. */
export function findConnectedPad(pads) {
  for (const pad of pads || []) {
    if (pad && pad.connected) return pad;
  }
  return null;
}

/** Next focus position when moving `dir` (+1 down / -1 up) through `count` items, wrapping. */
export function stepFocusIndex(current, dir, count) {
  if (count <= 0) return -1;
  return (((current + dir) % count) + count) % count;
}
