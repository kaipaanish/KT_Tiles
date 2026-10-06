import { h, icon, ICONS } from '../ui/dom';

/** What a one-finger drag on a tiled surface does: move the pattern, or brush the tiles' area. */
export type PhotoTool = 'pattern' | 'add' | 'remove';

export const BRUSH_MIN_PX = 6;
export const BRUSH_MAX_PX = 60;

const ADD = '<path d="M12 4v16M4 12h16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="1.5" stroke-dasharray="3 3"/>';
const REMOVE = '<path d="M4 12h16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="1.5" stroke-dasharray="3 3"/>';
const COMPARE = '<path d="M12 3v18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M8 8l-4 4 4 4M16 8l4 4-4 4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>';

const HINTS: Record<PhotoTool, string> = {
  pattern: 'Drag on the tiles to move the pattern',
  add: 'Paint where tiles are missing',
  remove: 'Paint over things the tiles should stay behind',
};

export interface PhotoToolsModel {
  tool: PhotoTool;
  brushPx: number;
  /** A tiled surface is being edited, so the pattern and brush tools apply. */
  editable: boolean;
  comparing: boolean;
}

/**
 * The bar floating under the photo once something is tiled: Pattern (drag the layout, as in the
 * designer), a brush to add to or take from where the tiles go, and Before / after.
 */
export class PhotoTools {
  readonly el: HTMLElement;
  private readonly buttons: Record<PhotoTool, HTMLButtonElement>;
  private readonly switcher: HTMLElement;
  private readonly size: HTMLElement;
  private readonly slider: HTMLInputElement;
  private readonly compare: HTMLButtonElement;
  private readonly hint: HTMLElement;

  constructor(actions: { setTool(tool: PhotoTool): void; setBrush(px: number): void; setComparing(on: boolean): void }) {
    const make = (tool: PhotoTool, label: string, paths: string) =>
      h('button', { type: 'button', class: 'segment', title: HINTS[tool], onclick: () => actions.setTool(tool) }, icon(paths), h('span', {}, label));
    this.buttons = { pattern: make('pattern', 'Pattern', ICONS.pattern), add: make('add', 'Add', ADD), remove: make('remove', 'Remove', REMOVE) };
    this.switcher = h('div', { class: 'segmented tool-switch', role: 'group', 'aria-label': 'Photo tool' }, this.buttons.pattern, this.buttons.add, this.buttons.remove);
    this.slider = h('input', { type: 'range', min: BRUSH_MIN_PX, max: BRUSH_MAX_PX, step: 2, 'aria-label': 'Brush size' });
    this.slider.addEventListener('input', () => actions.setBrush(Number(this.slider.value)));
    this.size = h('label', { class: 'brush-size' }, h('span', {}, 'Size'), this.slider);
    this.compare = h(
      'button',
      { type: 'button', class: 'pill-button compare-button', title: 'Compare the photo before and after', onclick: () => actions.setComparing(this.compare.getAttribute('aria-pressed') !== 'true') },
      icon(COMPARE),
      h('span', {}, 'Before / after'),
    );
    this.hint = h('p', { class: 'tools-hint' });
    this.el = h('div', { class: 'photo-tools', hidden: true }, this.switcher, this.size, this.compare, this.hint);
  }

  update(model: PhotoToolsModel | null): void {
    this.el.hidden = !model;
    if (!model) return;
    const tools = model.editable && !model.comparing;
    this.switcher.hidden = !tools;
    for (const [tool, button] of Object.entries(this.buttons) as [PhotoTool, HTMLButtonElement][]) {
      button.classList.toggle('is-on', tool === model.tool);
      button.setAttribute('aria-pressed', String(tool === model.tool));
    }
    this.size.hidden = !tools || model.tool === 'pattern';
    if (document.activeElement !== this.slider) this.slider.value = String(model.brushPx);
    this.compare.classList.toggle('is-on', model.comparing);
    this.compare.setAttribute('aria-pressed', String(model.comparing));
    this.hint.textContent = model.comparing ? 'Drag the line to compare' : tools ? HINTS[model.tool] : 'Tap a tiled surface to edit it';
  }
}
