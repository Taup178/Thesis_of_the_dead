import { Level1 } from './Level1.js';

/**
 * LevelManager - Orchestrates level transitions with proper asset disposal.
 * Prevents the dreaded "tab crash in Level 3" from memory leaks.
 */
export class LevelManager {
  constructor(scene) {
    this.scene = scene;
    this.currentLevel = null;
    this.currentLevelIndex = 0;
    this.totalLevels = 3; // Freshman Woods, Sophomore Swamp, Final Summit
  }

  /** Returns the level class for a given index. */
  _getLevelClass(index) {
    switch (index) {
      case 0: return Level1;
      // case 1: return Level2;  // TODO: Sophomore Swamp
      // case 2: return Level3;  // TODO: Final Summit
      default: return null;
    }
  }

  /**
   * Load a level by index. Disposes the current level first.
   * @param {number} index
   * @param {function} onProgress - Callback with 0..1 progress
   * @returns {object} The loaded level instance
   */
  async loadLevel(index, onProgress) {
    // Dispose current level if any
    if (this.currentLevel) {
      this.currentLevel.dispose();
      this.currentLevel = null;
    }

    const LevelClass = this._getLevelClass(index);
    if (!LevelClass) {
      throw new Error(`No level class for index ${index}`);
    }

    const level = new LevelClass(this.scene);
    await level.load(onProgress);

    this.currentLevel = level;
    this.currentLevelIndex = index;
    return level;
  }

  /** Restart the current level. */
  async restartLevel(onProgress) {
    return this.loadLevel(this.currentLevelIndex, onProgress);
  }

  /** Load the next level. Returns false if there is no next level. */
  async nextLevel(onProgress) {
    const next = this.currentLevelIndex + 1;
    if (next >= this.totalLevels) return null;
    return this.loadLevel(next, onProgress);
  }

  /** Check if all levels are complete. */
  isGameComplete() {
    return this.currentLevelIndex >= this.totalLevels - 1 &&
           this.currentLevel && this.currentLevel.levelComplete;
  }
}
