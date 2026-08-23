/**
 * Thesis of the Dead - Entry Point
 *
 * A graduate student fights through the zombie-infested forest of their own mind,
 * chasing the personification of their Degree through three distinct mental states.
 *
 * Controls:
 *   WASD   - Move
 *   Mouse  - Look / Aim
 *   Click  - Shoot
 *   Shift  - Sprint
 *   Space  - Dodge Roll
 *   C      - Toggle Camera (1st / 3rd person)
 *   R      - Restart Level
 *   Esc    - Pause
 */

import { Game } from './core/Game.js';

// Wait for DOM, then boot
window.addEventListener('DOMContentLoaded', () => {
  const container = document.getElementById('game-container');
  const game = new Game(container);

  // Expose for debugging in dev console
  window.__game = game;
});
