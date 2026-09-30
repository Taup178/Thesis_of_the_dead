/**
 * InputManager - Centralised keyboard & mouse state.
 * Poll keys via .isDown('KeyW'), mouse via .mouseX/Y, .mouseButtons.
 */
export class InputManager {
  constructor() {
    this.keys = {};
    this.pressedKeys = new Set();
    this.mouseX = 0;
    this.mouseY = 0;
    this.mouseDeltaX = 0;
    this.mouseDeltaY = 0;
    this.mouseButtons = {};
    this._pointerLocked = false;
    this._pointerLockTarget = null;
    this._pointerLockRequest = null;
    this._pointerLockPending = false;
    this.sensitivity = 0.002;

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
      this.mouseButtons[e.button] = true;
    });
    window.addEventListener('mouseup', (e) => {
      this.mouseButtons[e.button] = false;
    });

    // Pointer lock change
    document.addEventListener('pointerlockchange', () => {
      this._pointerLocked = this._pointerLockTarget !== null
        && document.pointerLockElement === this._pointerLockTarget;
      this.flushMouseDelta();
      this.mouseButtons = {};
      this.pressedKeys.clear();
      if (!this._pointerLocked) this.keys = {};
    });

    window.addEventListener('blur', () => {
      this.keys = {};
      this.pressedKeys.clear();
      this.mouseButtons = {};
      this.flushMouseDelta();
      if (this._pointerLocked) document.exitPointerLock();
    });
  }

  isDown(code) {
    return !!this.keys[code];
  }

  /** Preserve quick taps between frames and consume each press once. */
  consumeKeyPress(code) {
    return this.pressedKeys.delete(code);
  }

  isMouseButtonDown(button = 0) {
    return !!this.mouseButtons[button];
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
