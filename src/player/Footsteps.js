const base = './assets/audio/sfx/player/';
export const FOOTSTEP_SOUNDS = Object.freeze({
  grass: ['grass-footfall-left.ogg', 'grass-footfall-right.ogg'].map(file => base + file),
  stone: ['tile-step-01.ogg', 'tile-step-02.ogg'].map(file => base + file),
  sand: ['sand-step-01.ogg', 'sand-step-02.ogg', 'sand-step-03.ogg', 'sand-step-04.ogg'].map(file => base + file),
});
const contacts = new WeakMap();

/** Read one landing per foot from the actual clip, including generated strafe clips. */
export function footContacts(clip) {
  if (contacts.has(clip)) return contacts.get(clip);
  const times = [];
  for (const name of ['FootL.position', 'FootR.position']) {
    const track = clip.tracks.find(track => track.name === name);
    if (!track) continue;
    const heights = Array.from(track.times, (_, i) => track.values[i * 3 + 1]);
    const low = Math.min(...heights), high = Math.max(...heights);
    if (high - low < 0.001) continue;
    const threshold = low + (high - low) * 0.03;
    const peak = heights.indexOf(high), count = heights.length - 1;
    // Follow the swing down to the planted pose, ignoring tiny motion during stance.
    for (let offset = 1; offset <= count; offset++) {
      const index = (peak + offset) % count;
      if (heights[index] > threshold) continue;
      const previous = (index + count - 1) % count;
      const start = track.times[previous];
      const end = index === 0 ? clip.duration : track.times[index];
      const fraction = (heights[previous] - threshold) / (heights[previous] - heights[index]);
      times.push((start + (end - start) * fraction) % clip.duration);
      break;
    }
  }
  times.sort((a, b) => a - b);
  contacts.set(clip, times);
  return times;
}

export function crossedFootContacts(clip, start, advance) {
  let count = 0;
  for (const time of footContacts(clip)) {
    count += Math.floor((start + advance - time + 1e-8) / clip.duration)
      - Math.floor((start - time + 1e-8) / clip.duration);
  }
  return count;
}
