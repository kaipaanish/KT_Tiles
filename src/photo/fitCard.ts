import type { SurfaceType } from '../engine';
import { h } from '../ui/dom';

export interface FitCardModel {
  /** "Wall", "Wall 2", "Floor". */
  name: string;
  kind: SurfaceType;
  marks: 'surface' | 'rectangle';
  /** The rectangle follows the lines of a wall that runs past the photo's edges. */
  lined: boolean;
  /** The size in the fields: the surface's, or the marked rectangle's. */
  size: { w: number; h: number };
  /** False while the corners cross over. */
  valid: boolean;
}

export interface FitCardActions {
  setMarks(marks: 'surface' | 'rectangle'): void;
  setSize(patch: { w?: number; h?: number }): void;
  done(): void;
  remove(): void;
}

/**
 * The card under the photo while a surface's corners are placed: what the corners mark, its real
 * size (pre-filled from the designer), and Done.
 */
export class FitCard {
  readonly el: HTMLElement;
  private key = '';
  private width: HTMLInputElement | null = null;
  private height: HTMLInputElement | null = null;
  private doneButton: HTMLButtonElement | null = null;
  private problem: HTMLElement | null = null;

  constructor(private readonly actions: FitCardActions) {
    this.el = h('div', { class: 'fit-card', hidden: true, role: 'group' });
  }

  update(model: FitCardModel | null): void {
    this.el.hidden = !model;
    if (!model) {
      this.key = '';
      return;
    }
    const key = `${model.name}|${model.kind}|${model.marks}|${model.lined}`;
    if (key !== this.key) {
      this.key = key;
      this.build(model);
    }
    // The fields follow the design, except one being typed in.
    if (this.width && document.activeElement !== this.width) this.width.value = String(Math.round(model.size.w));
    if (this.height && document.activeElement !== this.height) this.height.value = String(Math.round(model.size.h));
    if (this.doneButton) this.doneButton.disabled = !model.valid;
    if (this.problem) this.problem.hidden = model.valid;
  }

  private build(model: FitCardModel): void {
    const surfaceWord = model.kind === 'wall' ? 'wall' : 'floor';
    this.el.setAttribute('aria-label', `Fit the ${model.name.toLowerCase()}: its corners and real size`);
    const marks = (value: 'surface' | 'rectangle', label: string) =>
      h(
        'button',
        { type: 'button', class: `segment${model.marks === value ? ' is-on' : ''}`, 'aria-pressed': String(model.marks === value), onclick: () => this.actions.setMarks(value) },
        label,
      );
    const field = (label: string, key: 'w' | 'h') => {
      const input = h('input', { type: 'number', inputMode: 'numeric', min: 100, max: 20000, step: 10, 'aria-label': label });
      input.addEventListener('change', () => {
        const mm = Number(input.value);
        if (input.value !== '' && Number.isFinite(mm) && mm > 0) this.actions.setSize({ [key]: mm });
      });
      return { input, el: h('label', { class: 'fit-field' }, h('span', { class: 'fit-label' }, label), h('span', { class: 'field-input' }, input, h('span', { class: 'unit' }, 'mm'))) };
    };
    const rectangle = model.marks === 'rectangle';
    const w = field(rectangle ? 'Rectangle width' : 'Real width', 'w');
    const hgt = field(rectangle ? 'Rectangle height' : model.kind === 'wall' ? 'Real height' : 'Real length', 'h');
    this.width = w.input;
    this.height = hgt.input;
    this.doneButton = h('button', { type: 'button', class: 'pill-button primary', onclick: () => this.actions.done() }, 'Done');
    this.problem = h('p', { class: 'fit-problem', hidden: true }, 'The corners cross over. Drag them back into place.');
    const parts: (Node | null)[] = [
      h('div', { class: 'segmented fit-marks', role: 'group', 'aria-label': 'What the corners mark' }, marks('surface', `The ${surfaceWord}'s edges`), marks('rectangle', 'A known rectangle')),
      rectangle
        ? h(
            'p',
            { class: 'fit-note' },
            model.lined
              ? `This ${surfaceWord} runs past the photo, so its size can't be read from it. The corners follow its lines: put them on something you know the size of, such as a tile or a door, and enter its size.`
              : `Put the corners on something of known size on this ${surfaceWord}, such as a door or a tile, and enter its size.`,
          )
        : null,
      h('div', { class: 'fit-size' }, w.el, hgt.el),
      this.problem,
      h(
        'div',
        { class: 'fit-actions' },
        h('button', { type: 'button', class: 'pill-button', onclick: () => this.actions.remove() }, 'Remove'),
        this.doneButton,
      ),
    ];
    this.el.replaceChildren(...parts.filter((part): part is Node => part !== null));
  }
}
