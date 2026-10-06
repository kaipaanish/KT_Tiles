import { h, icon, ICONS } from '../ui/dom';

/** What a one-finger drag on a tiled surface does: move the pattern, or brush the tiles' area. */
export type PhotoTool = 'pattern' | 'add' | 'remove';

export const BRUSH_MIN_PX = 6;
export const BRUSH_MAX_PX = 60;

const ADD = '<path d="M12 4v16M4 12h16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="1.5" stroke-dasharray="3 3"/>';
const REMOVE = '<path d="M4 12h16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="1.5" stroke-dasharray="3 3"/>';

const HINTS: Record<PhotoTool, string> = {
  pattern: 'Drag on the tiles to move the pattern',
  add: 'Paint where tiles are missing',
  remove: 'Paint over things the tiles should stay behind',
};

/**
 * The tools floating under the photo while a tiled surface is being edited: Pattern (drag the
 * layout, as in the designer), and a brush to add to or take from where the tiles go.
 */
export class PhotoTools {
  readonly el: HTMLElement;
  private readonly buttons: Record<PhotoTool, HTMLButtonElement>;
  private readonly size: HTMLElement;
  private readonly slider: HTMLInputElement;
  private readonly hint: HTMLElement;

  constructor(actions: { setTool(tool: PhotoTool): void; setBrush(px: number): void }) {
    const make = (tool: PhotoTool, label: string, paths: string) =>
      h('button', { type: 'button', class: 'segment', title: HINTS[tool], onclick: () => actions.setTool(tool) }, icon(paths), h('span', {}, label));
    this.buttons = { pattern: make('pattern', 'Pattern', ICONS.pattern), add: make('add', 'Add', ADD), remove: make('remove', 'Remove', REMOVE) };
    this.slider = h('input', { type: 'range', min: BRUSH_MIN_PX, max: BRUSH_MAX_PX, step: 2, 'aria-label': 'Brush size' });
    this.slider.addEventListener('input', () => actions.setBrush(Number(this.slider.value)));
    this.size = h('label', { class: 'brush-size' }, h('span', {}, 'Size'), this.slider);
    this.hint = h('p', { class: 'tools-hint' });
    this.el = h(
      'div',
      { class: 'photo-tools', hidden: true },
      h('div', { class: 'segmented tool-switch', role: 'group', 'aria-label': 'Photo tool' }, this.buttons.pattern, this.buttons.add, this.buttons.remove),
      this.size,
      this.hint,
    );
  }

  update(model: { tool: PhotoTool; brushPx: number } | null): void {
    this.el.hidden = !model;
    if (!model) return;
    for (const [tool, button] of Object.entries(this.buttons) as [PhotoTool, HTMLButtonElement][]) {
      button.classList.toggle('is-on', tool === model.tool);
      button.setAttribute('aria-pressed', String(tool === model.tool));
    }
    this.size.hidden = model.tool === 'pattern';
    if (document.activeElement !== this.slider) this.slider.value = String(model.brushPx);
    this.hint.textContent = HINTS[model.tool];
  }
}
