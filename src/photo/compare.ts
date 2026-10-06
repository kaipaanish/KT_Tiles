import { h, icon } from '../ui/dom';

const GRIP = '<path d="M9 7l-4 5 4 5M15 7l4 5-4 5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>';

/**
 * The before/after line over the photo: the room as it is on the left, with the new tiles on the
 * right. Drag the line or its handle, or use the arrow keys on the handle.
 */
export class CompareSlider {
  readonly el: HTMLElement;
  private readonly line: HTMLElement;
  private readonly handle: HTMLButtonElement;
  /** Where the line is, as a share of the stage's width. */
  split = 0.5;

  constructor(private readonly onMove: (split: number) => void) {
    this.handle = h('button', { type: 'button', class: 'compare-handle', role: 'slider', 'aria-label': 'Before and after', 'aria-valuemin': '0', 'aria-valuemax': '100' }, icon(GRIP));
    this.line = h('div', { class: 'compare-line' }, this.handle);
    this.el = h(
      'div',
      { class: 'compare', hidden: true },
      h('span', { class: 'compare-label is-before' }, 'Before'),
      h('span', { class: 'compare-label is-after' }, 'After'),
      this.line,
    );
    const drag = (event: PointerEvent) => {
      const rect = this.el.getBoundingClientRect();
      this.set((event.clientX - rect.left) / rect.width);
    };
    // As on the canvas: without this, Chrome takes a touch drag on the line for its own gesture
    // and swallows the click of the next tap (the Before / after button didn't turn off).
    this.line.addEventListener('touchstart', (event) => event.preventDefault(), { passive: false });
    this.line.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      this.line.setPointerCapture(event.pointerId);
      drag(event);
    });
    this.line.addEventListener('pointermove', (event) => {
      if (this.line.hasPointerCapture(event.pointerId)) drag(event);
    });
    this.handle.addEventListener('keydown', (event) => {
      const step = event.key === 'ArrowLeft' ? -0.02 : event.key === 'ArrowRight' ? 0.02 : 0;
      if (event.key === 'Home') this.set(0);
      else if (event.key === 'End') this.set(1);
      else if (step) this.set(this.split + step);
      else return;
      event.preventDefault();
    });
    this.place();
  }

  show(visible: boolean): void {
    this.el.hidden = !visible;
  }

  set(split: number): void {
    this.split = Math.min(1, Math.max(0, split));
    this.place();
    this.onMove(this.split);
  }

  private place(): void {
    const percent = `${(this.split * 100).toFixed(2)}%`;
    this.line.style.left = percent;
    this.el.style.setProperty('--split', percent);
    this.handle.setAttribute('aria-valuenow', String(Math.round(this.split * 100)));
    this.handle.setAttribute('aria-valuetext', `${Math.round(this.split * 100)}% before, the rest after`);
  }
}
