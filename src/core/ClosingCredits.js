export const CLOSING_CREDITS_TIMING = { studio: 4, roll: 10, thanks: 46, end: 52 };

/** A lightweight closing film: end card, studio ident, credit roll, final thanks. */
export class ClosingCredits {
  constructor(root, onFinish) {
    this.root = root; this.onFinish = onFinish;
    this.time = 0; this.active = false; this.paused = false;
    this.roll = root.querySelector('[data-credit-roll]');
    this.viewport = root.querySelector('.closing-roll-viewport');
    this.pauseButton = root.querySelector('[data-credits-pause]');
    this.skipButton = root.querySelector('[data-credits-skip]');
    this.onPause = () => {
      if (!this.active) return;
      this.paused = !this.paused;
      this.pauseButton.textContent = this.paused ? 'Resume credits' : 'Pause credits';
      this.pauseButton.setAttribute('aria-pressed', String(this.paused));
    };
    this.onSkip = () => this.finish();
    this.pauseButton.addEventListener('click', this.onPause);
    this.skipButton.addEventListener('click', this.onSkip);
  }

  start(choice) {
    this.time = 0; this.active = true; this.paused = false;
    this.root.querySelector('[data-credits-ending-title]').textContent = choice === 'red' ? 'The Wrong Way Out' : 'A Quiet Beginning';
    this.root.querySelector('[data-credits-ending-line]').textContent = choice === 'red'
      ? 'Some lessons follow us beyond the final door.' : 'The voices fall quiet. The day belongs to you.';
    this.pauseButton.textContent = 'Pause credits'; this.pauseButton.setAttribute('aria-pressed', 'false');
    this.render();
  }

  update(dt) {
    if (!this.active || this.paused) return;
    this.time += Math.max(0, Math.min(dt, .25));
    if (this.time >= CLOSING_CREDITS_TIMING.end) { this.finish(); return; }
    this.render();
  }

  render() {
    const timing = CLOSING_CREDITS_TIMING;
    this.phase = this.time < timing.studio ? 'epilogue' : this.time < timing.roll ? 'studio'
      : this.time < timing.thanks ? 'roll' : 'thanks';
    this.root.dataset.phase = this.phase;
    const progress = Math.max(0, Math.min(1, (this.time - timing.roll) / (timing.thanks - timing.roll)));
    const height = this.viewport.clientHeight;
    this.roll.style.transform = `translate3d(0, ${height - progress * (height + this.roll.scrollHeight)}px, 0)`;
  }

  finish() {
    if (!this.active) return;
    this.active = false;
    this.onFinish?.();
  }

  dispose() {
    this.active = false;
    this.pauseButton.removeEventListener('click', this.onPause);
    this.skipButton.removeEventListener('click', this.onSkip);
  }
}
