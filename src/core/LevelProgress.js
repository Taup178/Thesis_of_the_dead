const STORAGE_KEY = 'thesis-level-progress-v1';
const LAST_LEVEL = 2;

/** Local unlocks only; selecting a chapter starts it from the beginning. */
export class LevelProgress {
  constructor(storage) {
    this.highestReached = 0;
    try {
      this.storage = storage ?? globalThis.localStorage;
      const saved = JSON.parse(this.storage?.getItem(STORAGE_KEY) ?? 'null');
      if (saved?.version === 1 && Number.isInteger(saved.highestReached)
        && saved.highestReached >= 0 && saved.highestReached <= LAST_LEVEL) {
        this.highestReached = saved.highestReached;
      }
    } catch { /* Storage may be unavailable; keep unlocks for this session. */ }
  }

  canPlay(index) {
    return Number.isInteger(index) && index >= 0 && index <= this.highestReached;
  }

  reach(index) {
    if (!Number.isInteger(index) || index < 0 || index > LAST_LEVEL || index <= this.highestReached) return;
    this.highestReached = index;
    try {
      this.storage?.setItem(STORAGE_KEY, JSON.stringify({ version: 1, highestReached: index }));
    } catch { /* A blocked save must not interrupt gameplay. */ }
  }
}
