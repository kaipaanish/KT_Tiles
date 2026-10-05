import type { LayoutWarning, SurfaceType } from '../engine';
import type { Mode, Toggles } from '../state/store';
import { h, icon, ICONS } from './dom';
import { Popover } from './popover';

const MODE_HINTS: Record<Mode, string> = {
  pattern: 'Drag to shift the whole pattern. It snaps every half tile, to the centreline and to the motif.',
  row: 'Drag ⠿ to move a band up or down, use − / + for rows, tap a band to change its design.',
  tile: 'Tap a tile to select it, tap again to rotate. Hold and drag onto another tile to swap.',
};

/** The floating Pattern | Row | Tile switch: what a one-finger drag grabs. */
export class ModeSwitch {
  readonly el: HTMLElement;
  private readonly buttons: Record<Mode, HTMLButtonElement>;

  constructor(onChange: (mode: Mode) => void) {
    const make = (mode: Mode, label: string, paths: string) =>
      h('button', { type: 'button', class: 'segment', onclick: () => onChange(mode), title: MODE_HINTS[mode] }, icon(paths), h('span', {}, label));
    this.buttons = { pattern: make('pattern', 'Pattern', ICONS.pattern), row: make('row', 'Row', ICONS.rows), tile: make('tile', 'Tile', ICONS.tile) };
    this.el = h('div', { class: 'segmented mode-switch', role: 'group', 'aria-label': 'Drag mode' }, this.buttons.pattern, this.buttons.row, this.buttons.tile);
  }

  update(mode: Mode, surface: SurfaceType): void {
    for (const [key, button] of Object.entries(this.buttons) as [Mode, HTMLButtonElement][]) {
      button.classList.toggle('is-on', key === mode);
      button.setAttribute('aria-pressed', String(key === mode));
    }
    // Floors have no bands.
    this.buttons.row.disabled = surface === 'floor';
  }
}

export function modeHint(mode: Mode): string {
  return MODE_HINTS[mode];
}

export interface ViewControlActions {
  fit(): void;
  toggle(key: keyof Toggles): void;
  resetTiles(): void;
}

const TOGGLE_LABELS: Record<keyof Toggles, string> = {
  showCuts: 'Show cuts',
  showRepeat: 'Show repeat',
  showMotifs: 'Show motif centres',
  showDims: 'Dimensions',
};

/** Fit, the view toggles and Reset tiles, floating over the canvas. */
export class ViewControls {
  readonly el: HTMLElement;
  private readonly reset: HTMLButtonElement;
  private readonly togglesButton: HTMLButtonElement;
  private readonly popover: Popover;
  private toggles: Toggles | null = null;

  constructor(
    host: HTMLElement,
    private readonly actions: ViewControlActions,
  ) {
    this.popover = new Popover(host, 'View', 'toggles-popover');
    this.reset = h('button', { type: 'button', class: 'pill-button', onclick: () => actions.resetTiles() }, icon(ICONS.reset), h('span', {}, 'Reset tiles'));
    this.togglesButton = h('button', { type: 'button', class: 'round-button', 'aria-label': 'View options', 'aria-haspopup': 'dialog', onclick: () => this.openToggles() }, icon(ICONS.eye));
    const fit = h('button', { type: 'button', class: 'round-button', 'aria-label': 'Fit to screen', title: 'Fit (double-tap)', onclick: () => actions.fit() }, icon(ICONS.fit));
    this.el = h('div', { class: 'view-controls' }, this.reset, this.togglesButton, fit);
  }

  update(toggles: Toggles, showReset: boolean): void {
    this.toggles = toggles;
    this.reset.hidden = !showReset;
    if (this.popover.isOpen) this.popover.open(this.toggleList(), this.togglesButton);
  }

  private openToggles(): void {
    if (this.popover.isOpen) this.popover.close();
    else this.popover.open(this.toggleList(), this.togglesButton);
  }

  private toggleList(): HTMLElement {
    const toggles = this.toggles;
    const list = h('div', { class: 'toggle-list' }, h('p', { class: 'popover-title' }, 'View'));
    if (!toggles) return list;
    for (const key of Object.keys(TOGGLE_LABELS) as (keyof Toggles)[]) {
      const input = h('input', { type: 'checkbox', checked: toggles[key], onchange: () => this.actions.toggle(key) });
      list.append(h('label', { class: 'toggle' }, input, h('span', {}, TOGGLE_LABELS[key])));
    }
    return list;
  }
}

/** Warnings as small chips at the bottom of the canvas; slivers in red. */
export class WarningStrip {
  readonly el: HTMLElement;
  private signature = '';

  constructor() {
    this.el = h('div', { class: 'warning-strip', role: 'status', 'aria-live': 'polite' });
  }

  update(warnings: readonly LayoutWarning[], hidden: boolean): void {
    this.el.hidden = hidden || warnings.length === 0;
    const signature = warnings.map((w) => w.message).join('|');
    if (signature === this.signature) return;
    this.signature = signature;
    this.el.replaceChildren(...warnings.map((w) => h('span', { class: `warning-chip${w.code === 'sliver' ? ' is-sliver' : ''}` }, w.message)));
  }
}

/** A short message that fades away. */
export function toast(host: HTMLElement, message: string): void {
  host.querySelector('.toast')?.remove();
  const el = h('div', { class: 'toast', role: 'status' }, message);
  host.append(el);
  window.setTimeout(() => el.classList.add('is-leaving'), 2600);
  window.setTimeout(() => el.remove(), 3000);
}
