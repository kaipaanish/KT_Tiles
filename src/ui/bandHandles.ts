import type { BandExtent, Catalog, LayoutResult } from '../engine';
import { screenRect, type View } from '../render/renderer';
import { activeWall, type DesignDoc } from '../state/document';
import { h, icon, ICONS } from './dom';
import { bandRangeLabel, rowsLabel } from './labels';

export interface BandHandleActions {
  /** The band's label was tapped: select it and offer its designs. */
  pick(index: number, anchor: Element): void;
  step(index: number, direction: 1 | -1): void;
  fill(index: number, fill: boolean): void;
  move(from: number, to: number): void;
  /** A band is being dragged (index), or the drag ended (null). */
  dragging(index: number | null): void;
}

interface Item {
  root: HTMLDivElement;
  extent: BandExtent;
}

interface BandDrag {
  index: number;
  pointerId: number;
  startY: number;
  offsetY: number;
  to: number;
}

/**
 * Row mode: a handle on the left of each band, with its height range from the floor,
 * a grip to drag it up or down, and +/− for its rows.
 */
export class BandHandles {
  readonly el: HTMLDivElement;
  private readonly dropLine: HTMLDivElement;
  private items: Item[] = [];
  private signature = '';
  private view: View | null = null;
  private result: LayoutResult | null = null;
  private drag: BandDrag | null = null;

  constructor(
    private readonly catalog: Catalog,
    private readonly actions: BandHandleActions,
  ) {
    this.el = h('div', { class: 'band-handles' });
    this.dropLine = h('div', { class: 'band-drop', hidden: true });
  }

  update(result: LayoutResult, doc: DesignDoc, view: View | null, visible: boolean, selected: number | null): void {
    this.el.hidden = !visible || result.surfaceType !== 'wall';
    if (this.el.hidden) return;
    this.result = result;
    this.view = view;
    const signature = JSON.stringify([activeWall(doc)?.layout.bands, result.bands, selected]);
    if (signature !== this.signature && !this.drag) {
      this.signature = signature;
      this.build(result, doc, selected);
    }
    this.place();
  }

  private build(result: LayoutResult, doc: DesignDoc, selected: number | null): void {
    const bands = activeWall(doc)?.layout.bands ?? [];
    this.items = [];
    this.el.replaceChildren(this.dropLine);
    for (const extent of result.bands) {
      const band = bands[extent.index];
      if (!band || extent.hidden) continue;
      const design = this.catalog.design(band.designId);
      const isTop = extent.index === bands.length - 1;
      const grip = h('button', { class: 'band-grip', type: 'button', 'aria-label': `Drag to move the ${design.name} band` }, icon(ICONS.grip));
      grip.addEventListener('pointerdown', (e) => this.startDrag(e, extent.index));
      // Name over height range keeps the handle narrow enough for a phone.
      const fullLabel = bandRangeLabel(extent, this.catalog);
      const label = h(
        'button',
        { class: 'band-label', type: 'button', title: `${fullLabel}. Tap to change the design`, 'aria-label': fullLabel },
        h('span', { class: 'band-name' }, design.name),
        h('span', { class: 'band-range' }, fullLabel.slice(design.name.length + 2)),
      );
      label.addEventListener('click', () => this.actions.pick(extent.index, label));

      let controls: HTMLElement;
      if (band.rows === 'fill') {
        controls = h(
          'button',
          { class: 'chip is-on', type: 'button', title: 'This band fills the rest of the wall. Tap to fix its rows instead.', onclick: () => this.actions.fill(extent.index, false) },
          'Fills rest',
        );
      } else {
        const rows = band.rows;
        controls = h(
          'div',
          { class: 'stepper' },
          h('button', { type: 'button', 'aria-label': `Fewer rows of ${design.name}`, disabled: rows <= design.rows, onclick: () => this.actions.step(extent.index, -1) }, icon(ICONS.minus)),
          h('span', { class: 'stepper-value' }, rowsLabel(rows)),
          h('button', { type: 'button', 'aria-label': `More rows of ${design.name}`, onclick: () => this.actions.step(extent.index, 1) }, icon(ICONS.plus)),
          isTop ? h('button', { class: 'chip', type: 'button', title: 'Fill the rest of the wall', onclick: () => this.actions.fill(extent.index, true) }, 'Fill') : null,
        );
      }
      const root = h('div', { class: `band-handle${selected === extent.index ? ' is-selected' : ''}` }, grip, label, controls);
      this.el.append(root);
      this.items.push({ root, extent });
    }
  }

  /** Puts each handle beside its band: outside the wall when there's room, otherwise over its left edge. */
  private place(): void {
    const { view, result } = this;
    if (!view || !result) return;
    for (const { root, extent } of this.items) {
      const r = screenRect(view, { x: 0, y: extent.fromMm, w: result.widthMm, h: extent.toMm - extent.fromMm });
      const outside = r.x - root.offsetWidth - 10;
      // Never past the right edge of the screen.
      const x = Math.min(outside >= 6 ? outside : Math.max(6, r.x + 6), Math.max(6, this.el.clientWidth - root.offsetWidth - 6));
      let y = r.y + r.h / 2 - root.offsetHeight / 2;
      if (this.drag?.index === extent.index) y += this.drag.offsetY;
      root.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
      root.classList.toggle('is-dragging', this.drag?.index === extent.index);
    }
  }

  private bandCentreY(extent: BandExtent): number {
    if (!this.view) return 0;
    return this.view.originY - ((extent.fromMm + extent.toMm) / 2) * this.view.scale;
  }

  /** Bands are listed from the floor up, so the new index is the number of other bands below the pointer. */
  private targetIndex(clientY: number, index: number): number {
    const y = clientY - this.el.getBoundingClientRect().top;
    return (this.result?.bands ?? []).filter((b) => b.index !== index && this.bandCentreY(b) > y).length;
  }

  private showDropLine(index: number, to: number): void {
    const { view, result } = this;
    if (!view || !result) return;
    const others = result.bands.filter((b) => b.index !== index);
    const below = others[to - 1];
    const above = others[to];
    const mm = below ? below.toMm : (above?.fromMm ?? 0);
    const left = view.originX;
    this.dropLine.hidden = false;
    this.dropLine.style.transform = `translate(${Math.round(left)}px, ${Math.round(view.originY - mm * view.scale - 2)}px)`;
    this.dropLine.style.width = `${Math.round(result.widthMm * view.scale)}px`;
  }

  private startDrag(e: PointerEvent, index: number): void {
    e.preventDefault();
    e.stopPropagation();
    const grip = e.currentTarget as HTMLElement;
    grip.setPointerCapture(e.pointerId);
    this.drag = { index, pointerId: e.pointerId, startY: e.clientY, offsetY: 0, to: index };
    this.actions.dragging(index);
    const move = (ev: PointerEvent) => {
      if (!this.drag || ev.pointerId !== this.drag.pointerId) return;
      this.drag.offsetY = ev.clientY - this.drag.startY;
      this.drag.to = this.targetIndex(ev.clientY, this.drag.index);
      this.showDropLine(this.drag.index, this.drag.to);
      this.place();
    };
    const finish = (ev: PointerEvent, commit: boolean) => {
      if (!this.drag || ev.pointerId !== this.drag.pointerId) return;
      const { index: from, to } = this.drag;
      this.drag = null;
      this.dropLine.hidden = true;
      grip.removeEventListener('pointermove', move);
      grip.removeEventListener('pointerup', up);
      grip.removeEventListener('pointercancel', cancel);
      this.actions.dragging(null);
      this.signature = '';
      if (commit && to !== from) this.actions.move(from, to);
      else this.place();
    };
    const up = (ev: PointerEvent) => finish(ev, true);
    const cancel = (ev: PointerEvent) => finish(ev, false);
    grip.addEventListener('pointermove', move);
    grip.addEventListener('pointerup', up);
    grip.addEventListener('pointercancel', cancel);
  }
}
