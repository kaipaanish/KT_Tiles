import samples from 'virtual:samples';
import { h, icon, ICONS } from '../ui/dom';
import { attachGestures, type Drag, type GestureTarget, type PointerPoint } from '../ui/gestures';
import type { Photo } from './capture';
import type { Pt } from './homography';

export type Sample = (typeof samples)[number];

/** Photo pixels to CSS pixels: scale, and where the photo's top-left corner sits. */
export interface PhotoTransform {
  scale: number;
  x: number;
  y: number;
}

export interface PhotoSources {
  take(): void;
  choose(): void;
  useSample(sample: Sample): void;
}

/** What the photo stage asks of whoever drives it (taps, drags, overlay drawing). */
export interface PhotoInteraction {
  tap(photo: Pt, screen: PointerPoint): void;
  /** A one-finger drag began: return a Drag to handle it, or null to pan. */
  dragStart(photo: Pt, screen: PointerPoint): Drag | null;
  longPress(photo: Pt, screen: PointerPoint): Drag | null;
  /** Draws on the overlay canvas after the photo, in CSS pixels. */
  drawOverlay(ctx: CanvasRenderingContext2D, transform: PhotoTransform, frame: { width: number; height: number }): void;
}

/** Room around the photo: the floating tools at the top, a little everywhere else. */
const MARGIN = { top: 64, right: 16, bottom: 16, left: 16 };

/**
 * The photo stage: the photo drawn with zoom and pan, an overlay canvas on top for handles and
 * labels, and (later) a WebGL canvas for the tiles in between.
 */
export class PhotoView {
  readonly el: HTMLDivElement;
  readonly photoCanvas: HTMLCanvasElement;
  readonly overlayCanvas: HTMLCanvasElement;
  /** Slot for the tile canvas, between the photo and the overlay. */
  readonly layers: HTMLDivElement;
  private readonly empty: HTMLElement;
  private readonly busy: HTMLElement;
  private readonly photoCtx: CanvasRenderingContext2D;
  private readonly overlayCtx: CanvasRenderingContext2D;
  private photo: Photo | null = null;
  private transform: PhotoTransform | null = null;
  private autoFit = true;
  private frame = { width: 1, height: 1, dpr: 1 };
  private queued = false;
  interaction: PhotoInteraction | null = null;
  /** Called after every frame, e.g. to move DOM overlays. */
  onFrame: (() => void) | null = null;

  constructor(host: HTMLElement, sources: PhotoSources) {
    this.photoCanvas = h('canvas', { class: 'photo-canvas' });
    this.overlayCanvas = h('canvas', { class: 'photo-overlay' });
    this.layers = h('div', { class: 'photo-layers' }, this.photoCanvas);
    const photoCtx = this.photoCanvas.getContext('2d', { alpha: false });
    const overlayCtx = this.overlayCanvas.getContext('2d');
    if (!photoCtx || !overlayCtx) throw new Error('Canvas 2D is not available');
    this.photoCtx = photoCtx;
    this.overlayCtx = overlayCtx;
    this.empty = this.emptyState(sources);
    this.busy = h('div', { class: 'photo-busy', role: 'status', hidden: true });
    this.el = h('div', { class: 'photo-stage', hidden: true }, this.layers, this.overlayCanvas, this.empty, this.busy);
    host.append(this.el);
    new ResizeObserver(() => this.resize()).observe(this.el);
    attachGestures(this.overlayCanvas, this.gestures());
  }

  get current(): Photo | null {
    return this.photo;
  }

  get view(): PhotoTransform | null {
    return this.transform;
  }

  get size(): { width: number; height: number; dpr: number } {
    return this.frame;
  }

  setVisible(visible: boolean): void {
    this.el.hidden = !visible;
    if (visible) {
      this.resize();
      this.requestDraw();
    }
  }

  setPhoto(photo: Photo | null): void {
    this.photo = photo;
    this.empty.hidden = !!photo;
    this.fit();
  }

  /** A message over the photo while something slow happens (null hides it). */
  setBusy(message: string | null): void {
    this.busy.hidden = message === null;
    this.busy.textContent = message ?? '';
  }

  fit(): void {
    this.autoFit = true;
    this.transform = null;
    this.requestDraw();
  }

  /** The photo's fitted scale, for zoom limits. */
  fittedScale(): number {
    return this.photo ? this.fitted(this.photo).scale : 1;
  }

  toPhoto(screen: Pt): Pt {
    const t = this.transform;
    return t ? { x: (screen.x - t.x) / t.scale, y: (screen.y - t.y) / t.scale } : screen;
  }

  toScreen(photo: Pt): Pt {
    const t = this.transform;
    return t ? { x: t.x + photo.x * t.scale, y: t.y + photo.y * t.scale } : photo;
  }

  requestDraw(): void {
    if (this.queued) return;
    this.queued = true;
    requestAnimationFrame(() => {
      this.queued = false;
      this.draw();
    });
  }

  private emptyState(sources: PhotoSources): HTMLElement {
    const sampleButtons = samples.map((sample) =>
      h('button', { type: 'button', class: 'pill-button sample-button', onclick: () => sources.useSample(sample) }, sample.title),
    );
    return h(
      'div',
      { class: 'photo-empty' },
      h('h2', {}, 'Tile a real room'),
      h('p', {}, 'Photograph a wall or floor and see the tiles on it in perspective. Your photo stays on this device: nothing is uploaded.'),
      h(
        'div',
        { class: 'photo-sources' },
        h('button', { type: 'button', class: 'pill-button primary', onclick: () => sources.take() }, icon(CAMERA), h('span', {}, 'Take photo')),
        h('button', { type: 'button', class: 'pill-button', onclick: () => sources.choose() }, icon(GALLERY), h('span', {}, 'Choose from gallery')),
      ),
      samples.length > 0 ? h('p', { class: 'photo-sample-label' }, 'Or try a sample photo:') : null,
      samples.length > 0 ? h('div', { class: 'photo-samples' }, ...sampleButtons) : null,
    );
  }

  private fitted(photo: Photo): PhotoTransform {
    const freeW = Math.max(40, this.frame.width - MARGIN.left - MARGIN.right);
    const freeH = Math.max(40, this.frame.height - MARGIN.top - MARGIN.bottom);
    const scale = Math.min(freeW / photo.width, freeH / photo.height);
    return {
      scale,
      x: MARGIN.left + (freeW - photo.width * scale) / 2,
      y: MARGIN.top + (freeH - photo.height * scale) / 2,
    };
  }

  private resize(): void {
    const rect = this.el.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));
    if (width === this.frame.width && height === this.frame.height && dpr === this.frame.dpr) return;
    if (this.transform && !this.autoFit) {
      this.transform = { ...this.transform, x: this.transform.x + (width - this.frame.width) / 2, y: this.transform.y + (height - this.frame.height) / 2 };
    } else {
      this.transform = null;
    }
    this.frame = { width, height, dpr };
    for (const canvas of [this.photoCanvas, this.overlayCanvas]) {
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
    }
    this.requestDraw();
  }

  private draw(): void {
    const { width, height, dpr } = this.frame;
    const ctx = this.photoCtx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#2f2e2b';
    ctx.fillRect(0, 0, width, height);
    const overlay = this.overlayCtx;
    overlay.setTransform(1, 0, 0, 1, 0, 0);
    overlay.clearRect(0, 0, this.overlayCanvas.width, this.overlayCanvas.height);
    const photo = this.photo;
    if (photo) {
      if (!this.transform) this.transform = this.fitted(photo);
      const t = this.transform;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(photo.canvas, t.x, t.y, photo.width * t.scale, photo.height * t.scale);
      overlay.setTransform(dpr, 0, 0, dpr, 0, 0);
      this.interaction?.drawOverlay(overlay, t, { width, height });
    }
    this.onFrame?.();
  }

  private gestures(): GestureTarget {
    const photoAt = (p: PointerPoint) => this.toPhoto(p);
    return {
      dragStart: (start) => (this.photo && this.interaction ? this.interaction.dragStart(photoAt(start), start) : null),
      longPress: (p) => (this.photo && this.interaction ? this.interaction.longPress(photoAt(p), p) : null),
      tap: (p) => {
        if (this.photo) this.interaction?.tap(photoAt(p), p);
      },
      doubleTap: () => this.fit(),
      zoom: (factor, x, y) => {
        const t = this.transform;
        if (!t || !this.photo) return;
        const fit = this.fittedScale();
        // Zooming out past the fit leaves room to put corner handles beyond the photo's edge.
        const scale = Math.min(fit * 12, Math.max(fit * 0.3, t.scale * factor));
        const k = scale / t.scale;
        this.transform = { scale, x: x - (x - t.x) * k, y: y - (y - t.y) * k };
        this.autoFit = false;
        this.requestDraw();
      },
      pan: (dx, dy) => {
        const t = this.transform;
        if (!t) return;
        this.transform = { ...t, x: t.x + dx, y: t.y + dy };
        this.autoFit = false;
        this.requestDraw();
      },
    };
  }
}

const CAMERA =
  '<path d="M4 8h3l2-3h6l2 3h3v11H4z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><circle cx="12" cy="13" r="3.5" fill="none" stroke="currentColor" stroke-width="2"/>';
const GALLERY =
  '<rect x="3" y="4" width="18" height="16" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><path d="m3 17 5-5 4 4 3-3 6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><circle cx="16" cy="9" r="1.6" fill="currentColor"/>';

export const PHOTO_ICONS = { camera: CAMERA, gallery: GALLERY, ...ICONS };
