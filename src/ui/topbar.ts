import { formatMm, type SurfaceType } from '../engine';
import { MAX_SIZE_MM, MIN_SIZE_MM } from '../state/actions';
import { activeKind, activePlan, isPhotoRef, photoSurfaceName } from '../state/document';
import type { AppState, View } from '../state/store';
import { h, icon, ICONS } from './dom';
import { Popover } from './popover';

export interface TopBarActions {
  setView(view: View): void;
  setSurface(surface: SurfaceType): void;
  setSize(patch: { widthMm?: number; heightMm?: number; tiledHeightMm?: number }): void;
  undo(): void;
  redo(): void;
  /** Hidden until provided. */
  share?: () => void;
}

const DESIGNER_ICON = '<g fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="4" width="7" height="7" rx="1"/><rect x="13" y="4" width="7" height="7" rx="1"/><rect x="4" y="13" width="7" height="7" rx="1"/><rect x="13" y="13" width="7" height="7" rx="1"/></g>';
const PHOTO_ICON = '<path d="M4 8h3l2-3h6l2 3h3v11H4z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><circle cx="12" cy="13" r="3.5" fill="none" stroke="currentColor" stroke-width="2"/>';

/** Designer | Photo, Wall | Floor, the surface size, Undo, Redo and Share. */
export class TopBar {
  readonly el: HTMLElement;
  private readonly designer: HTMLButtonElement;
  private readonly photo: HTMLButtonElement;
  private readonly surfaceToggle: HTMLElement;
  private readonly wall: HTMLButtonElement;
  private readonly floor: HTMLButtonElement;
  private readonly size: HTMLButtonElement;
  private readonly undo: HTMLButtonElement;
  private readonly redo: HTMLButtonElement;
  private readonly sizePopover: Popover;
  private state: AppState | null = null;

  constructor(
    host: HTMLElement,
    private readonly actions: TopBarActions,
  ) {
    this.designer = h('button', { type: 'button', class: 'segment', 'aria-label': 'Designer', title: 'Designer: flat wall or floor', onclick: () => actions.setView('designer') }, icon(DESIGNER_ICON), h('span', { class: 'view-label' }, 'Designer'));
    this.photo = h('button', { type: 'button', class: 'segment', 'aria-label': 'Photo', title: 'Photo: tile a real room', onclick: () => actions.setView('photo') }, icon(PHOTO_ICON), h('span', { class: 'view-label' }, 'Photo'));
    this.wall = h('button', { type: 'button', class: 'segment', onclick: () => actions.setSurface('wall') }, 'Wall');
    this.floor = h('button', { type: 'button', class: 'segment', onclick: () => actions.setSurface('floor') }, 'Floor');
    this.size = h('button', { type: 'button', class: 'size-chip', 'aria-haspopup': 'dialog', onclick: () => this.openSize() });
    this.undo = h('button', { type: 'button', class: 'icon-button', 'aria-label': 'Undo', title: 'Undo (Ctrl+Z)', onclick: () => actions.undo() }, icon(ICONS.undo));
    this.redo = h('button', { type: 'button', class: 'icon-button', 'aria-label': 'Redo', title: 'Redo (Ctrl+Shift+Z)', onclick: () => actions.redo() }, icon(ICONS.redo));
    const share = h('button', { type: 'button', class: 'icon-button share-button', 'aria-label': 'Share', title: 'Share a picture', hidden: !actions.share, onclick: () => actions.share?.() }, icon(ICONS.share));
    this.sizePopover = new Popover(host, 'Surface size', 'size-popover');
    this.el = h(
      'header',
      { class: 'topbar' },
      h('div', { class: 'segmented view-toggle', role: 'group', 'aria-label': 'Mode' }, this.designer, this.photo),
      (this.surfaceToggle = h('div', { class: 'segmented surface-toggle', role: 'group', 'aria-label': 'Surface' }, this.wall, this.floor)),
      this.size,
      // On phones the bar wraps here: the surface and its size get a row of their own.
      h('span', { class: 'topbar-break', 'aria-hidden': 'true' }),
      h('div', { class: 'topbar-actions' }, this.undo, this.redo, share),
    );
  }

  update(state: AppState): void {
    this.state = state;
    const { doc } = state;
    const plan = activePlan(doc);
    const photoView = state.ui.view === 'photo';
    this.designer.classList.toggle('is-on', !photoView);
    this.photo.classList.toggle('is-on', photoView);
    this.designer.setAttribute('aria-pressed', String(!photoView));
    this.photo.setAttribute('aria-pressed', String(photoView));
    // Photo surfaces bring their own kind and size (they arrive in a later step).
    this.surfaceToggle.hidden = photoView;
    this.el.classList.toggle('is-photo', photoView);
    this.size.hidden = photoView;
    const kind = activeKind(doc);
    this.wall.classList.toggle('is-on', kind === 'wall');
    this.floor.classList.toggle('is-on', kind === 'floor');
    this.wall.setAttribute('aria-pressed', String(kind === 'wall'));
    this.floor.setAttribute('aria-pressed', String(kind === 'floor'));
    const { widthMm, heightMm, tiledHeightMm } = plan.surface;
    const tiled = kind === 'wall' && tiledHeightMm !== undefined && tiledHeightMm < heightMm ? ` · tiled ${formatMm(tiledHeightMm)}` : '';
    // A surface from the photo, shown flat in the designer, says which one it is.
    const from = isPhotoRef(doc.active) ? `Photo ${photoSurfaceName(doc, doc.active).toLowerCase()}: ` : '';
    this.size.textContent = `${from}${formatMm(widthMm)} × ${formatMm(heightMm)} mm${tiled}`;
    this.size.setAttribute('aria-label', `Size: ${this.size.textContent}. Edit`);
    this.undo.disabled = !state.canUndo;
    this.redo.disabled = !state.canRedo;
  }

  private openSize(): void {
    if (this.sizePopover.isOpen) {
      this.sizePopover.close();
      return;
    }
    const state = this.state;
    if (!state) return;
    const plan = activePlan(state.doc);
    const wall = activeKind(state.doc) === 'wall';
    const field = (label: string, value: number, apply: (mm: number) => void) => {
      const input = h('input', { type: 'number', inputMode: 'numeric', min: MIN_SIZE_MM, max: MAX_SIZE_MM, step: 10, value: String(value) });
      input.addEventListener('change', () => {
        const mm = Number(input.value);
        if (Number.isFinite(mm) && mm > 0) apply(mm);
      });
      return h('label', { class: 'field' }, h('span', {}, label), h('span', { class: 'field-input' }, input, h('span', { class: 'unit' }, 'mm')));
    };
    const { widthMm, heightMm, tiledHeightMm } = plan.surface;
    const form = h(
      'form',
      { class: 'size-form', onsubmit: (e: Event) => e.preventDefault() },
      h('p', { class: 'popover-title' }, wall ? 'Wall size' : 'Floor size'),
      field('Width', widthMm, (mm) => this.actions.setSize({ widthMm: mm })),
      field(wall ? 'Height' : 'Length', heightMm, (mm) => this.actions.setSize({ heightMm: mm })),
      wall ? field('Tiled height', tiledHeightMm ?? heightMm, (mm) => this.actions.setSize({ tiledHeightMm: mm })) : null,
      h('p', { class: 'hint' }, wall ? 'Tiles stop at the tiled height; the wall above is painted.' : 'Seen from above, from the doorway.'),
    );
    this.sizePopover.open(form, this.size);
    form.querySelector('input')?.focus();
  }
}
