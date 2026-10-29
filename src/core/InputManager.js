/**
 * InputManager - Centralised keyboard & mouse state.
 * Poll keys via .isDown('KeyW'), mouse via .mouseX/Y, .mouseButtons.
 * Gamepads are polled each frame via updateGamepad() and folded into the
 * same key/mouse vocabulary (see Gamepad.js for the button mapping).
 */
import { findConnectedPad, GAMEPAD_LOOK_SPEED, KEY_TO_PAD, KEY_TO_PADS, PAD, readGamepadState } from './Gamepad.js';

const GAMEPAD_STORAGE_KEY = 'thesis-of-the-dead:gamepad';

/**
 * Pad buttons that stand in for mouse buttons, so weapon code keeps working
 * unchanged: LB is the primary attack (fire a gun / swing melee), RT is a
 * second fire button, LT is the dual-pistol single shot.
 */
const PAD_TO_MOUSE = {
  0: [PAD.ATTACK, PAD.FIRE],
  2: [PAD.ALT_FIRE],
};

function loadGamepadEnabled() {
  try { return globalThis.localStorage?.getItem(GAMEPAD_STORAGE_KEY) !== 'off'; } catch { return true; }
}

export class InputManager {
  constructor() {
    this.keys = {};
    this.pressedKeys = new Set();
    this.mouseX = 0;
    this.mouseY = 0;
    this.mouseDeltaX = 0;
    this.mouseDeltaY = 0;
    this.mouseButtons = {};
    this.mousePresses = {};
    this._pointerLocked = false;
    this._pointerLockTarget = null;
    this._pointerLockRequest = null;
    this._pointerLockPending = false;
    this.sensitivity = 0.002;

    // ---- Gamepad state ----
    this.gamepadEnabled = loadGamepadEnabled();
    this.gamepadInUse = false;   // enabled + a pad is connected
    this.moveAxisX = 0;          // left stick, deadzoned
    this.moveAxisY = 0;
    this._padId = null;
    this._padButtons = [];       // previous frame button states (mutated by readGamepadState)
    this._padHeld = {};
    this._padPresses = new Set();
    this.onGamepadConnected = null;

    // Key listeners
    window.addEventListener('keydown', (e) => {
      if (!e.repeat && !this.keys[e.code]) this.pressedKeys.add(e.code);
      this.keys[e.code] = true;
    });
    window.addEventListener('keyup', (e) => {
      this.keys[e.code] = false;
    });

    // Mouse move (uses movementX/Y when pointer-locked)
    window.addEventListener('mousemove', (e) => {
      if (this._pointerLocked) {
        this.mouseDeltaX += e.movementX || 0;
        this.mouseDeltaY += e.movementY || 0;
      }
      this.mouseX = e.clientX;
      this.mouseY = e.clientY;
    });

    // Mouse buttons
    window.addEventListener('mousedown', (e) => {
      if (this._pointerLocked && !this.mouseButtons[e.button]) {
        this.mousePresses[e.button] = (this.mousePresses[e.button] || 0) + 1;
      }
      this.mouseButtons[e.button] = true;
    });
    window.addEventListener('mouseup', (e) => {
      this.mouseButtons[e.button] = false;
    });
    window.addEventListener('contextmenu', e => {
      if (this._pointerLocked) e.preventDefault();
    });

    // Pointer lock change
    document.addEventListener('pointerlockchange', () => {
      this._pointerLocked = this._pointerLockTarget !== null
        && document.pointerLockElement === this._pointerLockTarget;
      this.flushMouseDelta();
      this.mouseButtons = {};
      this.mousePresses = {};
      this.pressedKeys.clear();
      if (!this._pointerLocked) this.keys = {};
    });

    window.addEventListener('blur', () => {
      this.keys = {};
      this.pressedKeys.clear();
      this.mouseButtons = {};
      this.mousePresses = {};
      this.flushMouseDelta();
      if (this._pointerLocked) document.exitPointerLock();
    });
  }

  isDown(code) {
    if (this.keys[code]) return true;
    const buttons = KEY_TO_PADS[code];
    return buttons !== undefined && buttons.some(button => !!this._padHeld[button]);
  }

  /** Preserve quick taps between frames and consume each press once. */
  consumeKeyPress(code) {
    if (this.pressedKeys.delete(code)) return true;
    const button = KEY_TO_PAD[code];
    return button !== undefined && this._padPresses.delete(button);
  }

  isMouseButtonDown(button = 0) {
    if (this.mouseButtons[button]) return true;
    return (PAD_TO_MOUSE[button] || []).some(padButton => !!this._padHeld[padButton]);
  }

  /** Count individual clicks, including clicks pressed and released between frames. */
  consumeMousePresses(button = 0) {
    let count = this.mousePresses[button] || 0;
    delete this.mousePresses[button];
    for (const padButton of PAD_TO_MOUSE[button] || []) {
      if (this._padPresses.delete(padButton)) count++;
    }
    return count;
  }

  /** Edge-triggered gamepad button read (Start pause, d-pad weapon cycling). */
  consumeGamepadPress(button) {
    return this._padPresses.delete(button);
  }

  /** Drop a pad button's held/pressed state (e.g. after it activated a menu item). */
  releasePadButton(button) {
    delete this._padHeld[button];
    this._padPresses.delete(button);
  }

  setGamepadEnabled(enabled) {
    this.gamepadEnabled = enabled;
    try { globalThis.localStorage?.setItem(GAMEPAD_STORAGE_KEY, enabled ? 'on' : 'off'); } catch { /* storage unavailable */ }
    if (!enabled) this._clearGamepad();
  }

  /** Poll once per frame, before player/weapon input is read. */
  updateGamepad(dt) {
    if (!this.gamepadEnabled || typeof navigator === 'undefined' || typeof navigator.getGamepads !== 'function') {
      if (this.gamepadInUse) this._clearGamepad();
      return;
    }
    const pad = findConnectedPad(navigator.getGamepads());
    if (!pad) {
      if (this.gamepadInUse) this._clearGamepad();
      return;
    }
    if (pad.id !== this._padId) {
      this._padId = pad.id;
      this.onGamepadConnected?.(pad);
    }
    const state = readGamepadState(pad, this._padButtons);
    this.gamepadInUse = true;
    this.moveAxisX = state.moveX;
    this.moveAxisY = state.moveY;
    // Right stick look is folded into the mouse delta so existing look code works unchanged.
    this.mouseDeltaX += state.lookX * GAMEPAD_LOOK_SPEED * dt;
    this.mouseDeltaY += state.lookY * GAMEPAD_LOOK_SPEED * dt;
    this._padHeld = state.held;
    for (const index of state.pressed) this._padPresses.add(index);
  }

  _clearGamepad() {
    this.gamepadInUse = false;
    this.moveAxisX = 0;
    this.moveAxisY = 0;
    this._padId = null;
    this._padButtons = [];
    this._padHeld = {};
    this._padPresses.clear();
  }

  /** Call once per frame AFTER reading mouseDelta to reset it. */
  flushMouseDelta() {
    this.mouseDeltaX = 0;
    this.mouseDeltaY = 0;
  }

  get pointerLocked() {
    return this._pointerLocked;
  }

  get pointerLockPending() {
    return this._pointerLockPending;
  }

  requestPointerLock(element) {
    if (this._pointerLockRequest) return this._pointerLockRequest;
    this._pointerLockTarget = element;
    this._pointerLockPending = true;
    const request = (async () => {
      try {
        try {
          // Use raw relative movement where supported, avoiding OS mouse acceleration.
          await element.requestPointerLock({ unadjustedMovement: true });
        } catch (error) {
          if (error.name !== 'NotSupportedError') throw error;
          await element.requestPointerLock();
        }
        return true;
      } catch (error) {
        console.warn('[Input] Mouse capture needs another click:', error);
        return false;
      }
    })();
    this._pointerLockRequest = request;
    request.finally(() => {
      if (this._pointerLockRequest === request) {
        this._pointerLockRequest = null;
        this._pointerLockPending = false;
      }
    });
    return request;
  }
}
