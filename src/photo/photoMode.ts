import samples from 'virtual:samples';
import { FakeSegmenter } from '../segment/fakeSegmenter';
import { labelMask } from '../segment/postprocess';
import type { Backend } from '../segment/segformer';
import { CEILING, FLOOR, WALL, type RGBAImage, type Segmentation, type Segmenter } from '../segment/segmenter';
import { WorkerSegmenter } from '../segment/workerSegmenter';
import { h } from '../ui/dom';
import { loadPhoto, loadPhotoFromUrl, pickPhotoFile, type Photo } from './capture';
import type { Pt, Quad } from './homography';
import { fitQuad, regionAt, type Mask } from './maskToQuad';
import { PhotoView, type PhotoTransform, type Sample } from './photoView';
import { cssColour, labelShares, paintMask, paintRegions, REGION_STYLES, styleFor } from './regions';

/** Segmentation and masks work on the photo at up to this many pixels on its long side. */
export const WORK_SIDE = 1024;

export type SegmentStatus =
  | { state: 'idle' }
  | { state: 'downloading'; loaded: number; total: number }
  | { state: 'running' }
  | { state: 'ready'; segmentation: Segmentation }
  | { state: 'failed'; message: string };

/** A wall or floor region the user tapped. */
export interface Selection {
  label: typeof WALL | typeof FLOOR;
  /** Its pixels, at the segmentation's (working) size. */
  region: Mask;
  /** The share of the photo it covers (0–1). */
  share: number;
  /** Its corners in photo pixels, or null if no quad could be fitted. */
  quad: Quad | null;
  /** True when the region isn't one quadrilateral (two walls, say) and `quad` is only a starter. */
  starter: boolean;
  mismatch: number;
  canvas: HTMLCanvasElement;
}

export interface PhotoModeOptions {
  /** 'fake' skips the model (?segmenter=fake): a plain room layout, for quick checks. */
  segmenter: 'model' | 'fake';
  backend: Backend;
  edges: 'guided' | 'bilinear';
}

export interface PhotoModeHooks {
  /** Something the panels show has changed (a photo arrived, a status changed). */
  changed(): void;
  toast(message: string): void;
}

const megabytes = (bytes: number) => (bytes / 1e6).toFixed(1);

/** The photo at the working size, as RGBA pixels. */
function workingImage(photo: Photo): RGBAImage {
  const scale = Math.min(1, WORK_SIDE / Math.max(photo.width, photo.height));
  const width = Math.max(1, Math.round(photo.width * scale));
  const height = Math.max(1, Math.round(photo.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Canvas 2D is not available');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(photo.canvas, 0, 0, width, height);
  return { width, height, data: ctx.getImageData(0, 0, width, height).data };
}

/**
 * Photo mode's controller: owns the photo in memory, the photo stage, and finding the walls and
 * floor in the photo. Surfaces, tiles and editing build on it in later steps.
 */
export class PhotoMode {
  readonly view: PhotoView;
  photo: Photo | null = null;
  readonly samples: readonly Sample[] = samples;
  status: SegmentStatus = { state: 'idle' };
  selection: Selection | null = null;
  showRegions = true;
  private regions: HTMLCanvasElement | null = null;
  private segmenter: Segmenter | null = null;
  /** The status or legend floating at the top of the photo. */
  private readonly top: HTMLElement;

  constructor(
    stage: HTMLElement,
    private readonly hooks: PhotoModeHooks,
    private readonly options: PhotoModeOptions,
  ) {
    this.view = new PhotoView(stage, {
      take: () => void this.take(),
      choose: () => void this.choose(),
      useSample: (sample) => void this.useSample(sample),
    });
    this.top = h('div', { class: 'photo-top', hidden: true });
    this.view.el.append(this.top);
    this.view.interaction = {
      tap: (p) => this.select(p),
      dragStart: () => null,
      longPress: () => null,
      drawOverlay: (ctx, t) => this.drawOverlay(ctx, t),
    };
  }

  get segmentation(): Segmentation | null {
    return this.status.state === 'ready' ? this.status.segmentation : null;
  }

  show(visible: boolean): void {
    this.view.setVisible(visible);
  }

  async take(): Promise<void> {
    const file = await pickPhotoFile(true);
    if (file) await this.load(() => loadPhoto(file, file.name || 'Camera photo'));
  }

  async choose(): Promise<void> {
    const file = await pickPhotoFile(false);
    if (file) await this.load(() => loadPhoto(file, file.name || 'Photo'));
  }

  async useSample(sample: Sample): Promise<void> {
    await this.load(() => loadPhotoFromUrl(sample.url, sample.title));
  }

  /** Tries segmentation again, e.g. after the model failed to download. */
  retry(): void {
    if (this.photo) void this.segment(this.photo);
  }

  setShowRegions(show: boolean): void {
    this.showRegions = show;
    this.view.requestDraw();
    this.hooks.changed();
  }

  private async load(read: () => Promise<Photo>): Promise<void> {
    this.view.setBusy('Opening the photo…');
    let photo: Photo;
    try {
      photo = await read();
    } catch (error) {
      console.warn('Could not open the photo', error);
      this.hooks.toast("Couldn't open that photo. Please try another one.");
      return;
    } finally {
      this.view.setBusy(null);
    }
    this.photo = photo;
    this.selection = null;
    this.regions = null;
    this.view.setPhoto(photo);
    this.hooks.changed();
    void this.segment(photo);
  }

  private async segment(photo: Photo): Promise<void> {
    this.segmenter ??=
      this.options.segmenter === 'fake' ? new FakeSegmenter() : new WorkerSegmenter({ backend: this.options.backend, edges: this.options.edges });
    this.setStatus({ state: 'running' });
    try {
      const segmentation = await this.segmenter.segment(workingImage(photo), (progress) => {
        if (this.photo !== photo) return;
        this.setStatus(progress.phase === 'download' ? { state: 'downloading', loaded: progress.loaded, total: progress.total } : { state: 'running' });
      });
      if (this.photo !== photo) return;
      this.regions = paintRegions(segmentation);
      this.setStatus({ state: 'ready', segmentation });
    } catch (error) {
      if (this.photo !== photo) return;
      console.warn('Segmentation failed', error);
      this.setStatus({ state: 'failed', message: error instanceof Error ? error.message : String(error) });
    }
  }

  private setStatus(status: SegmentStatus): void {
    const newState = status.state !== this.status.state;
    this.status = status;
    this.renderTop();
    this.view.requestDraw();
    // Download progress only updates the floating status; the panel changes with the state.
    if (newState) this.hooks.changed();
  }

  /** Selects the wall or floor region under a tap, and fits its corners. */
  private select(p: Pt): void {
    const segmentation = this.segmentation;
    const photo = this.photo;
    if (!segmentation || !photo) return;
    const sx = segmentation.width / photo.width;
    const sy = segmentation.height / photo.height;
    const x = Math.floor(p.x * sx);
    const y = Math.floor(p.y * sy);
    const inside = x >= 0 && y >= 0 && x < segmentation.width && y < segmentation.height;
    const label = inside ? segmentation.labels[y * segmentation.width + x] : undefined;
    if (label !== WALL && label !== FLOOR) {
      this.selection = null;
      if (label === CEILING) this.hooks.toast("Ceilings aren't tiled here. Tap a wall or the floor.");
      else if (inside) this.hooks.toast("That isn't a wall or the floor. Tap a blue or orange area.");
      this.changedSelection();
      return;
    }
    const mask: Mask = { width: segmentation.width, height: segmentation.height, data: labelMask(segmentation.labels, label) };
    const region = regionAt(mask, { x, y });
    if (!region) return;
    const fit = fitQuad(region, { x: x + 0.5, y: y + 0.5 });
    let count = 0;
    for (const v of region.data) count += v;
    const style = styleFor(label);
    this.selection = {
      label,
      region,
      share: count / region.data.length,
      quad: fit ? (fit.quad.map((q) => ({ x: q.x / sx, y: q.y / sy })) as Quad) : null,
      starter: fit?.starter ?? false,
      mismatch: fit?.mismatch ?? 1,
      canvas: paintMask(region.width, region.height, (i) => (region.data[i] ? style : undefined), 1.5),
    };
    this.changedSelection();
  }

  private changedSelection(): void {
    this.renderTop();
    this.view.requestDraw();
    this.hooks.changed();
  }

  private renderTop(): void {
    const status = this.status;
    this.top.hidden = !this.photo || status.state === 'idle';
    this.top.replaceChildren();
    if (status.state === 'downloading') {
      const share = status.total ? status.loaded / status.total : 0;
      this.top.append(
        h(
          'div',
          { class: 'photo-pill', role: 'status' },
          h('span', {}, `Getting the wall finder ready · ${megabytes(status.loaded)} of ${megabytes(status.total)} MB`),
          h('span', { class: 'photo-progress' }, h('span', { style: { width: `${Math.round(share * 100)}%` } })),
        ),
      );
    } else if (status.state === 'running') {
      this.top.append(h('div', { class: 'photo-pill', role: 'status' }, h('span', { class: 'spinner' }), h('span', {}, 'Finding walls and floor…')));
    } else if (status.state === 'failed') {
      this.top.append(
        h(
          'div',
          { class: 'photo-pill is-error', role: 'status' },
          h('span', {}, "Couldn't find the walls automatically."),
          h('button', { type: 'button', class: 'pill-link', onclick: () => this.retry() }, 'Try again'),
        ),
      );
    } else if (status.state === 'ready') {
      const shares = labelShares(status.segmentation);
      const found = REGION_STYLES.filter((style) => shares[style.name.toLowerCase() as 'wall' | 'floor' | 'ceiling'] > 0.005);
      const selected = this.selection && styleFor(this.selection.label);
      const hint = selected
        ? `${selected.name} selected: ${Math.round(this.selection!.share * 100)}% of the photo`
        : found.some((style) => style.label !== CEILING)
          ? 'Tap a wall or the floor'
          : 'No wall or floor found in this photo';
      this.top.append(
        h(
          'div',
          { class: 'photo-pill photo-legend' },
          ...found.map((style) => h('span', { class: 'legend-chip' }, h('span', { class: 'legend-swatch', style: { background: cssColour(style, 0.85) } }), style.name)),
          h('span', { class: 'legend-hint' }, hint),
        ),
      );
    }
  }

  private drawOverlay(ctx: CanvasRenderingContext2D, t: PhotoTransform): void {
    const photo = this.photo;
    if (!photo) return;
    const width = photo.width * t.scale;
    const height = photo.height * t.scale;
    ctx.imageSmoothingEnabled = true;
    if (this.regions && this.showRegions) {
      ctx.globalAlpha = this.selection ? 0.45 : 1;
      ctx.drawImage(this.regions, t.x, t.y, width, height);
      ctx.globalAlpha = 1;
    }
    const selection = this.selection;
    if (!selection) return;
    ctx.drawImage(selection.canvas, t.x, t.y, width, height);
    if (!selection.quad) return;
    const corners = selection.quad.map((q) => ({ x: t.x + q.x * t.scale, y: t.y + q.y * t.scale }));
    ctx.save();
    ctx.lineJoin = 'round';
    ctx.beginPath();
    corners.forEach((c, i) => (i === 0 ? ctx.moveTo(c.x, c.y) : ctx.lineTo(c.x, c.y)));
    ctx.closePath();
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.45)';
    ctx.lineWidth = 4;
    ctx.stroke();
    ctx.setLineDash([8, 6]);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.setLineDash([]);
    for (const c of corners) {
      ctx.beginPath();
      ctx.arc(c.x, c.y, 5, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.6)';
      ctx.stroke();
    }
    ctx.restore();
  }
}
