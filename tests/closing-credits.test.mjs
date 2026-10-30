import test from 'node:test';
import assert from 'node:assert/strict';
import { ClosingCredits } from '../src/core/ClosingCredits.js';

function fixture() {
  const elements = new Map();
  const root = { dataset: {}, querySelector(selector) {
    if (!elements.has(selector)) elements.set(selector, {
      style: {}, clientHeight: 600, scrollHeight: 2000, listeners: {},
      setAttribute() {},
      addEventListener(type, listener) { this.listeners[type] = listener; },
      removeEventListener(type) { delete this.listeners[type]; },
    });
    return elements.get(selector);
  } };
  let finished = 0;
  const credits = new ClosingCredits(root, () => finished++);
  return { root, credits, finished: () => finished };
}

test('both ending credits progress to the existing continuation exactly once', () => {
  for (const choice of ['blue', 'red']) {
    const { root, credits, finished } = fixture();
    credits.start(choice);
    assert.equal(root.dataset.phase, 'epilogue');
    assert.equal(root.querySelector('[data-credits-ending-title]').textContent,
      choice === 'blue' ? 'A Quiet Beginning' : 'The Wrong Way Out');
    for (let i = 0; i < 20; i++) credits.update(.25);
    assert.equal(root.dataset.phase, 'studio');
    for (let i = 0; i < 24; i++) credits.update(.25);
    assert.equal(root.dataset.phase, 'roll');
    for (let i = 0; i < 144; i++) credits.update(.25);
    assert.equal(root.dataset.phase, 'thanks');
    for (let i = 0; i < 28; i++) credits.update(.25);
    credits.finish();
    assert.equal(finished(), 1);
    assert.equal(credits.active, false);
  }
});

test('credits pause, resume, skip and release their controls', () => {
  const { root, credits, finished } = fixture();
  credits.start('blue');
  const pause = root.querySelector('[data-credits-pause]');
  pause.listeners.click();
  credits.update(.25);
  assert.equal(credits.time, 0);
  pause.listeners.click();
  credits.update(.25);
  assert.equal(credits.time, .25);
  root.querySelector('[data-credits-skip]').listeners.click();
  assert.equal(finished(), 1);
  credits.dispose();
  assert.equal(pause.listeners.click, undefined);
});
