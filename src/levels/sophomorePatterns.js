const STAGES = [
  { jumps: 4, minForward: 3, maxForward: 3 },
  { jumps: 6, minForward: 4, maxForward: 5 },
  { jumps: 8, minForward: 5, maxForward: 6 },
  { jumps: 10, minForward: 6, maxForward: 7 },
];

/** A seeded course lets checkpoint retries keep the same demonstrated routes. */
export function createSophomorePatterns(seed) {
  let state = seed >>> 0;
  const random = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
  let column = random() < 0.5 ? 0 : 1;
  let row = 0;
  return STAGES.map(stage => {
    const forward = stage.minForward + Math.floor(random() * (stage.maxForward - stage.minForward + 1));
    const slots = Array.from({ length: forward }, (_, index) => index + 1);
    for (let index = slots.length - 1; index > 0; index--) {
      const other = Math.floor(random() * (index + 1));
      [slots[index], slots[other]] = [slots[other], slots[index]];
    }
    const switches = new Set(slots.slice(0, stage.jumps - forward));
    const pattern = [[column, row]];
    for (let step = 1; step <= forward; step++) {
      // Move to a fresh row before switching; never require an already collapsed tile.
      row++;
      pattern.push([column, row]);
      if (switches.has(step)) {
        column = 1 - column;
        pattern.push([column, row]);
      }
    }
    return pattern;
  });
}
