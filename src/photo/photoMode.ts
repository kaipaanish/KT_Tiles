import samples from 'virtual:samples';
import { layoutSurface, type Catalog, type LayoutResult } from '../engine';
import { TileCompositor, type Plane, type SurfaceScene } from '../render/webgl/compositor';
import type { TextureCache } from '../render/textureCache';
import { FakeSegmenter } from '../segment/fakeSegmenter';
import { featherMask, labelMask, resizeArea } from '../segment/postprocess';
import type { Backend } from '../segment/segformer';
import { CEILING, FLOOR, WALL, type RGBAImage, type Segmentation, type Segmenter } from '../segment/segmenter';
import { WorkerSegmenter } from '../segment/workerSegmenter';
import * as act from '../state/actions';
import { photoSurface, photoSurfaceName, type DesignDoc, type PhotoSurface } from '../state/document';
import type { Store } from '../state/store';
import { h } from '../ui/dom';
import type { Drag, PointerPoint } from '../ui/gestures';
import { loadPhoto, loadPhotoFromUrl, pickPhotoFile, type Photo } from './capture';
import { insidePolygon, isConvexQuad, planeExtent, rasterPolygon, rectanglePlane, surfaceMatrix, surfaceOutline } from './fit';
import { FitCard } from './fitCard';
import { apply, type Mat3, type Pt, type Quad } from './homography';
import { drawLoupe } from './loupe';
import { convexHull, fitQuad, regionAt, rowExtremes, type Mask } from './maskToQuad';
import { PhotoView, type PhotoTransform, type Sample } from './photoView';
import { cssColour, labelShares, paintMask, paintRegions, REGION_STYLES, styleFor } from './regions';
import { shadingMap } from './shading';

/** Segmentation and masks work on the photo at up to this many pixels on its long side. */
export const WORK_SIDE = 1024;
/** The room's lighting is worked out at this size: after the heavy blur, more would add nothing. */
const SHADING_SIDE = 256;
/** Blur radius for the lighting, as a share of SHADING_SIDE: about two tiles in a typical photo. */
const SHADING_BLUR = 0.05;

export type SegmentStatus =
  | { state: 'idle' }
  | { state: 'downloading'; loaded: number; total: number }
  | { state: 'running' }
  | { state: 'ready'; segmentation: Segmentation }
  | { state: 'failed'; message: string };

export interface PhotoModeOptions {
  /** 'fake' skips the model (?segmenter=fake): a plain room layout, for quick checks. */
  segmenter: 'model' | 'fake';
  backend: Backend;
  edges: 'guided' | 'bilinear';
  /** False skips WebGL (?webgl=0): the tile grid shows instead of tiles, as where WebGL2 is missing. */
  webgl: boolean;
}

export interface PhotoModeHooks {
  /** Something the panels show has changed (a photo arrived, a status changed). */
  changed(): void;
  toast(message: string): void;
}

/** What is drawn for one photo surface, worked out again only when the surface or the segmentation changes. */
interface SurfaceView {
  surface: PhotoSurface;
  segmentation: Segmentation | null;
  /** Surface mm → photo pixels. */
  toPhoto: Mat3 | null;
  /** The whole surface in the photo. */
  outline: Quad | null;
  /** Its segmentation region, at the working size. */
  region: Mask | null;
  /** The region, tinted, for highlighting. */
  tint: HTMLCanvasElement | null;
  /** The region as an alpha mask, for clipping the grid and the region colours. */
  clip: HTMLCanvasElement | null;
  /** The region for the GPU: 255 where tiles go. */
  mask: Plane | null;
  /** The room's lighting over the region. */
  shading: Plane | null;
  /** The laid-out tiles, once the surface is confirmed. */
  result: LayoutResult | null;
  /** Every placed tile's visible part, in photo pixels (the grid shown without WebGL). */
  grid: Pt[][];
}

interface CornerDrag {
  id: PhotoSurface['id'];
  corner: number;
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

/** The photo at SHADING_SIDE on its long side. */
function smallImage(photo: Photo): RGBAImage {
  const scale = Math.min(1, SHADING_SIDE / Math.max(photo.width, photo.height));
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

/** The room's lighting over a region, from the small photo. */
function roomLighting(small: RGBAImage, region: Mask): Plane {
  // The region's coverage of each small pixel (it is at the working size, four times bigger).
  const data = new Uint8ClampedArray(region.width * region.height * 4);
  for (let i = 0; i < region.data.length; i++) data[i * 4] = region.data[i] ? 255 : 0;
  const shrunk = resizeArea({ width: region.width, height: region.height, data }, small.width, small.height);
  const coverage = new Float32Array(small.width * small.height);
  for (let i = 0; i < coverage.length; i++) coverage[i] = shrunk.data[i * 4]! / 255;
  return shadingMap(small, coverage, Math.max(2, Math.round(SHADING_BLUR * SHADING_SIDE)));
}

/** A white-on-transparent mask canvas, for clipping drawings to a region with 'destination-in'. */
function alphaCanvas(mask: Mask): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = mask.width;
  canvas.height = mask.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;
  const image = ctx.createImageData(mask.width, mask.height);
  for (let i = 0; i < mask.data.length; i++) image.data[i * 4 + 3] = mask.data[i] ? 255 : 0;
  ctx.putImageData(image, 0, 0);
  return canvas;
}

/**
 * Photo mode's controller: owns the photo in memory and the photo stage, finds the walls and floor
 * in the photo, and lets the user pick surfaces and fit their corners. The surfaces themselves
 * live in the design document, so they are undoable and edited through the usual tabs.
 */
export class PhotoMode {
  readonly view: PhotoView;
  photo: Photo | null = null;
  readonly samples: readonly Sample[] = samples;
  status: SegmentStatus = { state: 'idle' };
  showRegions = true;
  /** How much of the room's light and shadow shows on the tiles (the Room lighting slider). */
  light = 0.7;
  /** Null where WebGL2 isn't available (or with ?webgl=0). */
  readonly compositor: TileCompositor | null;
  private regions: HTMLCanvasElement | null = null;
  /** The photo at SHADING_SIDE, for the lighting. */
  private small: RGBAImage | null = null;
  private regionScratch: HTMLCanvasElement | null = null;
  private segmenter: Segmenter | null = null;
  private doc: DesignDoc;
  private readonly views = new Map<string, SurfaceView>();
  private drag: CornerDrag | null = null;
  /** The status or legend floating at the top of the photo. */
  private readonly top: HTMLElement;
  private readonly card: FitCard;
  private scratch: HTMLCanvasElement | null = null;

  constructor(
    stage: HTMLElement,
    private readonly store: Store,
    private readonly catalog: Catalog,
    textures: TextureCache,
    private readonly hooks: PhotoModeHooks,
    private readonly options: PhotoModeOptions,
  ) {
    this.doc = store.get().doc;
    this.view = new PhotoView(stage, {
      take: () => void this.take(),
      choose: () => void this.choose(),
      useSample: (sample) => void this.useSample(sample),
    });
    this.top = h('div', { class: 'photo-top', hidden: true });
    this.card = new FitCard({
      setMarks: (marks) => this.setMarks(marks),
      setSize: (patch) => this.setSize(patch),
      done: () => this.confirmFit(),
      remove: () => {
        const surface = this.activeSurface();
        if (surface) this.store.commit((d) => act.removePhotoSurface(d, surface.id));
      },
    });
    this.view.el.append(this.top, this.card.el);
    const compositor = options.webgl ? new TileCompositor(textures) : null;
    this.compositor = compositor?.available ? compositor : null;
    if (this.compositor) {
      this.view.layers.append(this.compositor.canvas);
      this.compositor.onRestored = () => this.view.requestDraw();
    }
    this.view.onFrame = () => this.renderTiles();
    // While the card shows, the photo fits above it, so no corner hides behind it.
    new ResizeObserver(() => this.view.setBottomInset(this.card.el.hidden ? 0 : this.card.el.offsetHeight + 24)).observe(this.card.el);
    this.view.interaction = {
      tap: (p) => this.tap(p),
      dragStart: (_p, screen) => this.startCornerDrag(screen),
      longPress: (_p, screen) => this.startCornerDrag(screen),
      drawOverlay: (ctx, t, frame) => this.drawOverlay(ctx, t, frame),
    };
  }

  get segmentation(): Segmentation | null {
    return this.status.state === 'ready' ? this.status.segmentation : null;
  }

  /** The surfaces picked in the current photo. */
  get surfaces(): PhotoSurface[] {
    const id = this.photo?.id;
    return id ? this.doc.photo.filter((s) => s.photoId === id) : [];
  }

  /** The photo surface being edited, if it belongs to this photo. */
  activeSurface(): PhotoSurface | null {
    const surface = photoSurface(this.doc, this.doc.active);
    return surface && surface.photoId === this.photo?.id ? surface : null;
  }

  show(visible: boolean): void {
    this.view.setVisible(visible);
  }

  /** Called with every app state: follows the design document (surfaces, undo and redo). */
  update(doc: DesignDoc): void {
    if (doc === this.doc) return;
    this.doc = doc;
    for (const id of this.views.keys()) if (!doc.photo.some((s) => s.id === id)) this.views.delete(id);
    this.renderTop();
    this.renderCard();
    this.view.requestDraw();
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

  /** The Room lighting slider: redraws without rebuilding the panel, so the slider keeps its drag. */
  setLight(light: number): void {
    this.light = Math.min(1, Math.max(0, light));
    this.view.requestDraw();
  }

  /** What the tiles look like at a photo pixel (premultiplied RGBA), drawn now; for the browser check. */
  tilePixel(x: number, y: number): [number, number, number, number] | null {
    const t = this.view.view;
    if (!this.compositor || !t) return null;
    this.renderTiles();
    return this.compositor.readPixel(t.x + x * t.scale, t.y + y * t.scale, this.view.size.dpr);
  }

  setShowRegions(show: boolean): void {
    this.showRegions = show;
    this.view.requestDraw();
    this.hooks.changed();
  }

  /** Puts a confirmed surface back into corner fitting. */
  adjustCorners(id: PhotoSurface['id']): void {
    this.store.commit((d) => act.setPhotoFit(act.setActive(d, id), id, { confirmed: false }));
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
    this.regions = null;
    this.small = smallImage(photo);
    this.views.clear();
    // Surfaces belong to their photo; another photo starts with none.
    this.store.commit((d) => act.keepPhotoSurfaces(d, photo.id));
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

  // ---- Surfaces ---------------------------------------------------------------------------

  private surfaceView(surface: PhotoSurface): SurfaceView {
    const segmentation = this.segmentation;
    const cached = this.views.get(surface.id);
    if (cached && cached.surface === surface && cached.segmentation === segmentation) return cached;
    const plan = surface.plan;
    const toPhoto = surfaceMatrix(surface.fit, plan.surface);
    const outline = toPhoto && surfaceOutline(toPhoto, plan.surface);
    // The region only depends on the tap and the segmentation, so keep it while corners move.
    const sameRegion = cached && cached.segmentation === segmentation && cached.surface.seed === surface.seed;
    let region = sameRegion ? cached.region : null;
    let tint = sameRegion ? cached.tint : null;
    let clip = sameRegion ? cached.clip : null;
    let mask = sameRegion ? cached.mask : null;
    let shading = sameRegion ? cached.shading : null;
    if (!sameRegion && segmentation && this.photo) {
      const label = plan.layout.surface === 'wall' ? WALL : FLOOR;
      const sx = segmentation.width / this.photo.width;
      const sy = segmentation.height / this.photo.height;
      region = regionAt({ width: segmentation.width, height: segmentation.height, data: labelMask(segmentation.labels, label) }, { x: surface.seed.x * sx, y: surface.seed.y * sy });
      const style = styleFor(label);
      // Light, so the wall's own edges stay visible while its corners are placed.
      tint = region && paintMask(region.width, region.height, (i) => (region!.data[i] ? style : undefined), 0.6);
      clip = region && alphaCanvas(region);
      // Feathered by a pixel of the working size (about 2 photo pixels), then filtered linearly by the GPU.
      mask = region && { width: region.width, height: region.height, data: featherMask(region.data, region.width, region.height, 1) };
      shading = region && this.small && roomLighting(this.small, region);
    }
    let grid: Pt[][] = [];
    let result: LayoutResult | null = null;
    if (toPhoto && surface.fit.confirmed) {
      try {
        // Only the plan matters to the layout: reuse it while just the corners change.
        result = cached && cached.surface.plan === plan && cached.result ? cached.result : layoutSurface(plan.surface, plan.layout, plan.alignment, plan.overrides, this.catalog);
        grid = result.pieces.map(({ visibleRect: r }) =>
          [
            { x: r.x, y: r.y },
            { x: r.x + r.w, y: r.y },
            { x: r.x + r.w, y: r.y + r.h },
            { x: r.x, y: r.y + r.h },
          ].map((p) => apply(toPhoto, p)),
        );
      } catch (error) {
        console.warn('Could not lay out the photo surface', error);
      }
    }
    const view: SurfaceView = { surface, segmentation, toPhoto, outline, region, tint, clip, mask, shading, result, grid };
    this.views.set(surface.id, view);
    return view;
  }

  /** Selects the surface under a tap, or adds the wall or floor there. */
  private tap(p: Pt): void {
    const photo = this.photo;
    if (!photo) return;
    // An existing surface: edit it (the one being edited wins where outlines overlap).
    const contains = (s: PhotoSurface) => {
      const outline = this.surfaceView(s).outline;
      return !!outline && insidePolygon(outline, p);
    };
    const active = this.activeSurface();
    const target = active && contains(active) ? active : [...this.surfaces].reverse().find(contains);
    if (target) {
      if (this.doc.active !== target.id) this.store.commit((d) => act.setActive(d, target.id));
      return;
    }
    const segmentation = this.segmentation;
    if (!segmentation) return;
    const sx = segmentation.width / photo.width;
    const sy = segmentation.height / photo.height;
    const x = Math.floor(p.x * sx);
    const y = Math.floor(p.y * sy);
    const inside = x >= 0 && y >= 0 && x < segmentation.width && y < segmentation.height;
    const label = inside ? segmentation.labels[y * segmentation.width + x] : undefined;
    if (label !== WALL && label !== FLOOR) {
      if (label === CEILING) this.hooks.toast("Ceilings aren't tiled here. Tap a wall or the floor.");
      else if (inside) this.hooks.toast("That isn't a wall or the floor. Tap a blue or orange area.");
      return;
    }
    // Leave out what other surfaces already cover, so a second wall in the same region gets its own corners.
    const exclude = new Uint8Array(segmentation.width * segmentation.height);
    for (const surface of this.surfaces) {
      const outline = this.surfaceView(surface).outline;
      if (!outline) continue;
      const covered = rasterPolygon(
        outline.map((q) => ({ x: q.x * sx, y: q.y * sy })),
        segmentation.width,
        segmentation.height,
      );
      for (let i = 0; i < covered.length; i++) exclude[i] = exclude[i]! | covered[i]!;
    }
    const mask: Mask = { width: segmentation.width, height: segmentation.height, data: labelMask(segmentation.labels, label) };
    const fit = fitQuad(mask, { x: x + 0.5, y: y + 0.5 }, { width: segmentation.width, height: segmentation.height, data: exclude });
    if (!fit) {
      this.hooks.toast('That part is already tiled. Tap another wall or the floor.');
      return;
    }
    const quad = fit.quad.map((q) => ({ x: q.x / sx, y: q.y / sy })) as Quad;
    this.store.commit((d) => act.addPhotoSurface(d, { photoId: photo.id, kind: label === WALL ? 'wall' : 'floor', seed: { x: p.x, y: p.y }, quad, starter: fit.starter }));
  }

  /** A press near a corner of the surface being fitted drags that corner; anywhere else pans. */
  private startCornerDrag(screen: PointerPoint): Drag | null {
    const surface = this.activeSurface();
    const t = this.view.view;
    if (!surface || surface.fit.confirmed || !t) return null;
    const reach = screen.pointerType === 'mouse' ? 14 : 28;
    let corner = -1;
    let best = reach;
    surface.fit.quad.forEach((q, i) => {
      const d = Math.hypot(t.x + q.x * t.scale - screen.x, t.y + q.y * t.scale - screen.y);
      if (d < best) {
        best = d;
        corner = i;
      }
    });
    if (corner < 0) return null;
    // Keep the finger's offset from the corner, so the corner doesn't jump under it.
    const start = surface.fit.quad[corner]!;
    const grab = this.view.toPhoto(screen);
    const offset = { x: start.x - grab.x, y: start.y - grab.y };
    const id = surface.id;
    this.drag = { id, corner };
    this.view.requestDraw();
    const finish = () => {
      this.drag = null;
      this.view.requestDraw();
    };
    return {
      move: (p) => {
        const at = this.view.toPhoto(p);
        this.store.preview((d) => act.movePhotoCorner(d, id, corner, { x: at.x + offset.x, y: at.y + offset.y }));
      },
      end: () => {
        this.store.endGesture();
        finish();
      },
      cancel: () => {
        this.store.cancelGesture();
        finish();
      },
    };
  }

  private setMarks(marks: 'surface' | 'rectangle'): void {
    const surface = this.activeSurface();
    if (!surface) return;
    const { widthMm, heightMm } = surface.plan.surface;
    // A rectangle starts as the whole surface, so nothing moves until its real size is entered.
    this.store.commit((d) => act.setPhotoFit(d, surface.id, marks === 'rectangle' ? { marks, rect: { x: 0, y: 0, w: widthMm, h: heightMm } } : { marks }));
  }

  private setSize(patch: { w?: number; h?: number }): void {
    const surface = this.activeSurface();
    if (!surface) return;
    if (surface.fit.marks === 'rectangle') {
      const rect = { ...surface.fit.rect, ...patch };
      this.store.commit((d) => act.setPhotoFit(d, surface.id, { rect: { ...rect, w: Math.max(10, Math.round(rect.w)), h: Math.max(10, Math.round(rect.h)) } }));
    } else {
      this.store.commit((d) => act.setSurfaceSize(d, { widthMm: patch.w, heightMm: patch.h }));
    }
  }

  /** Done: tiles show from now on. A known rectangle also measures the surface from its region. */
  private confirmFit(): void {
    const surface = this.activeSurface();
    if (!surface || !isConvexQuad(surface.fit.quad)) return;
    if (surface.fit.marks === 'surface') {
      this.store.commit((d) => act.setPhotoFit(d, surface.id, { confirmed: true }));
      return;
    }
    const size = { w: surface.fit.rect.w, h: surface.fit.rect.h };
    const toPlane = rectanglePlane(surface.fit.quad, size);
    const view = this.surfaceView(surface);
    const photo = this.photo;
    // The region's outline (its convex hull is enough: straight lines stay straight on the plane).
    let points: Pt[] = surface.fit.quad;
    if (view.region && photo) {
      const sx = photo.width / view.region.width;
      const sy = photo.height / view.region.height;
      points = [...points, ...convexHull(rowExtremes(view.region)).map((q) => ({ x: q.x * sx, y: q.y * sy }))];
    }
    const centre = { x: surface.fit.quad.reduce((a, q) => a + q.x, 0) / 4, y: surface.fit.quad.reduce((a, q) => a + q.y, 0) / 4 };
    const extent = toPlane && planeExtent(points, toPlane, centre);
    if (!extent) {
      this.hooks.toast("Couldn't measure the surface from that rectangle. Check its corners.");
      return;
    }
    this.store.commit((d) => act.setPhotoFit(act.fitToRectangle(d, surface.id, size, extent), surface.id, { confirmed: true }));
  }

  // ---- Floating status, legend and fit card ---------------------------------------------------

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
      const fitting = this.activeSurface();
      if (fitting && !fitting.fit.confirmed) {
        const word = fitting.plan.layout.surface === 'wall' ? 'wall' : 'floor';
        const hint =
          fitting.fit.marks === 'rectangle'
            ? "Drag the corners to the rectangle's corners"
            : fitting.fit.starter
              ? `Drag the corners to this ${word}'s edges`
              : `Corners found: adjust them to the ${word}'s edges if needed`;
        this.top.append(h('div', { class: 'photo-pill photo-hint', role: 'status' }, hint));
        return;
      }
      const shares = labelShares(status.segmentation);
      const found = REGION_STYLES.filter((style) => shares[style.name.toLowerCase() as 'wall' | 'floor' | 'ceiling'] > 0.005);
      const hint = fitting
        ? `${photoSurfaceName(this.doc, fitting.id)} · tap another wall or the floor`
        : found.some((style) => style.label !== CEILING)
          ? 'Tap a wall or the floor to tile it'
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

  private renderCard(): void {
    const surface = this.activeSurface();
    if (!surface || surface.fit.confirmed) {
      this.card.update(null);
      return;
    }
    const rectangle = surface.fit.marks === 'rectangle';
    this.card.update({
      name: photoSurfaceName(this.doc, surface.id),
      kind: surface.plan.layout.surface,
      marks: surface.fit.marks,
      size: rectangle ? { w: surface.fit.rect.w, h: surface.fit.rect.h } : { w: surface.plan.surface.widthMm, h: surface.plan.surface.heightMm },
      valid: isConvexQuad(surface.fit.quad),
    });
  }

  // ---- Drawing --------------------------------------------------------------------------------

  private drawOverlay(ctx: CanvasRenderingContext2D, t: PhotoTransform, frame: { width: number; height: number }): void {
    const photo = this.photo;
    if (!photo) return;
    const width = photo.width * t.scale;
    const height = photo.height * t.scale;
    const toScreen = (p: Pt) => ({ x: t.x + p.x * t.scale, y: t.y + p.y * t.scale });
    const active = this.activeSurface();
    const tiled = this.compositor ? this.surfaces.filter((s) => s.fit.confirmed).map((s) => this.surfaceView(s)) : [];
    ctx.imageSmoothingEnabled = true;
    if (this.regions && this.showRegions) this.drawRegions(ctx, t, frame, width, height, active ? 0.3 : 1, tiled);
    for (const surface of this.surfaces) {
      const view = this.surfaceView(surface);
      const isActive = surface === active;
      const fitting = isActive && !surface.fit.confirmed;
      if (fitting && view.tint) ctx.drawImage(view.tint, t.x, t.y, width, height);
      // Without WebGL the grid shows where the tiles go; with it, the tiles speak for themselves.
      if (!this.compositor && view.grid.length > 0) this.drawGrid(ctx, view, t, frame, width, height);
      if (this.compositor && surface.fit.confirmed && !isActive) continue;
      const outline = fitting ? surface.fit.quad : view.outline;
      if (!outline) continue;
      const valid = isConvexQuad(surface.fit.quad);
      const corners = outline.map(toScreen);
      ctx.save();
      ctx.lineJoin = 'round';
      ctx.beginPath();
      corners.forEach((c, i) => (i === 0 ? ctx.moveTo(c.x, c.y) : ctx.lineTo(c.x, c.y)));
      ctx.closePath();
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.45)';
      ctx.lineWidth = isActive ? 4 : 3;
      ctx.stroke();
      if (fitting) ctx.setLineDash([8, 6]);
      ctx.strokeStyle = valid ? '#ffffff' : '#ff5a4f';
      ctx.lineWidth = isActive ? 2 : 1.25;
      ctx.stroke();
      ctx.restore();
      if (fitting) this.drawHandles(ctx, corners, frame);
    }
    const drag = this.drag;
    const dragged = drag && photoSurface(this.doc, drag.id);
    if (drag && dragged) drawLoupe(ctx, photo, t, frame, dragged.fit.quad, drag.corner);
  }

  /** The region colours, except where tiles are drawn (they would tint the tiles' soft edges). */
  private drawRegions(ctx: CanvasRenderingContext2D, t: PhotoTransform, frame: { width: number; height: number }, width: number, height: number, alpha: number, tiled: SurfaceView[]): void {
    if (!this.regions) return;
    const cut = tiled.filter((view) => view.clip);
    if (cut.length === 0) {
      ctx.globalAlpha = alpha;
      ctx.drawImage(this.regions, t.x, t.y, width, height);
      ctx.globalAlpha = 1;
      return;
    }
    const scratch = (this.regionScratch ??= document.createElement('canvas'));
    const dpr = ctx.getTransform().a;
    if (scratch.width !== Math.round(frame.width * dpr) || scratch.height !== Math.round(frame.height * dpr)) {
      scratch.width = Math.round(frame.width * dpr);
      scratch.height = Math.round(frame.height * dpr);
    }
    const g = scratch.getContext('2d');
    if (!g) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, frame.width, frame.height);
    g.imageSmoothingEnabled = true;
    g.drawImage(this.regions, t.x, t.y, width, height);
    g.globalCompositeOperation = 'destination-out';
    for (const view of cut) g.drawImage(view.clip!, t.x, t.y, width, height);
    g.globalCompositeOperation = 'source-over';
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = alpha;
    ctx.drawImage(scratch, 0, 0);
    ctx.restore();
  }

  /** The confirmed surfaces' tiles, drawn by the GPU on its own canvas under the overlay. */
  private renderTiles(): void {
    const compositor = this.compositor;
    if (!compositor) return;
    const photo = this.photo;
    const t = this.view.view;
    const frame = this.view.size;
    const scenes: SurfaceScene[] = [];
    if (photo && t) {
      for (const surface of this.surfaces) {
        if (!surface.fit.confirmed) continue;
        const view = this.surfaceView(surface);
        if (!view.toPhoto || !view.result || !view.mask || !view.shading) continue;
        const { widthMm, heightMm } = surface.plan.surface;
        scenes.push({ id: surface.id, result: view.result, toPhoto: view.toPhoto, inside: { x: widthMm / 2, y: heightMm / 2 }, mask: view.mask, shading: view.shading });
      }
    }
    compositor.render(
      {
        width: frame.width,
        height: frame.height,
        dpr: frame.dpr,
        view: t ?? { scale: 1, x: 0, y: 0 },
        photo: photo ?? { width: 1, height: 1 },
        light: this.light,
        groutMm: this.doc.settings.groutMm,
        groutColor: this.doc.settings.groutColor,
      },
      scenes,
    );
  }

  /** The tiles' edges in perspective, only where the surface's region is (fixtures stay clear). */
  private drawGrid(ctx: CanvasRenderingContext2D, view: SurfaceView, t: PhotoTransform, frame: { width: number; height: number }, width: number, height: number): void {
    const scratch = (this.scratch ??= document.createElement('canvas'));
    const dpr = ctx.getTransform().a;
    if (scratch.width !== Math.round(frame.width * dpr) || scratch.height !== Math.round(frame.height * dpr)) {
      scratch.width = Math.round(frame.width * dpr);
      scratch.height = Math.round(frame.height * dpr);
    }
    const g = scratch.getContext('2d');
    if (!g) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, frame.width, frame.height);
    g.beginPath();
    for (const piece of view.grid) {
      piece.forEach((p, i) => {
        const x = t.x + p.x * t.scale;
        const y = t.y + p.y * t.scale;
        if (i === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      });
      g.closePath();
    }
    g.strokeStyle = 'rgba(255, 255, 255, 0.85)';
    g.lineWidth = 1;
    g.stroke();
    if (view.clip) {
      g.globalCompositeOperation = 'destination-in';
      g.imageSmoothingEnabled = true;
      g.drawImage(view.clip, t.x, t.y, width, height);
      g.globalCompositeOperation = 'source-over';
    }
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(scratch, 0, 0);
    ctx.restore();
  }

  private drawHandles(ctx: CanvasRenderingContext2D, corners: Pt[], frame: { width: number; height: number }): void {
    const touch = frame.width < 900;
    for (const c of corners) {
      ctx.beginPath();
      ctx.arc(c.x, c.y, touch ? 10 : 8, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      ctx.lineWidth = 3;
      ctx.strokeStyle = '#1f6feb';
      ctx.stroke();
    }
  }
}
