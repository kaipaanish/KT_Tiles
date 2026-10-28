import { catalog } from '../designs/catalog';
import {
  cellKey,
  layoutSurface,
  type LayoutResult,
  type PlacedPiece,
  type SurfaceType,
} from '../engine';
import { toSurface, type Appearance, type Overlay } from '../render/renderer';
import { TextureCache } from '../render/textureCache';
import * as act from '../state/actions';
import { activeKind, activePlan, activeWall, applyQuery, createDefaultDocument, type DesignDoc, type PhotoSurfaceId } from '../state/document';
import { DESIGN_KEY, parseSavedDesign, parseSavedToggles, readStorage, serializeDesign, VIEW_KEY, writeStorage } from '../state/persist';
import { PhotoMode } from '../photo/photoMode';
import { largestRegion } from '../photo/maskToQuad';
import { labelShares } from '../photo/regions';
import { labelMask } from '../segment/postprocess';
import { Store, type Mode, type Tab, type Toggles, type UiState, type View } from '../state/store';
import { BandHandles } from './bandHandles';
import { CanvasView } from './canvasView';
import { modeHint, ModeSwitch, toast, ViewControls, WarningStrip } from './controls';
import { designChoices } from './designPicker';
import { h } from './dom';
import { attachGestures, MAGNET_PX, type Drag, type PointerPoint } from './gestures';
import { Popover } from './popover';
import { photoShareContent, sharePhoto, sharePicture } from './share';
import { Sheet } from './sheet';
import { alignTab } from './tabs/align';
import type { TabContext } from './tabs/context';
import { countTab } from './tabs/count';
import { designTab } from './tabs/design';
import { photoContext, photoTab } from './tabs/photo';
import { tilesTab } from './tabs/tiles';
import { clearThumbs } from './thumbs';
import { TopBar } from './topbar';
import { fitView, panView, viewCentredOn, zoomAround, type Insets } from './viewport';

const TAB_VIEWS: Record<Tab, (ctx: TabContext) => HTMLElement> = {
  photo: photoTab,
  design: designTab,
  tiles: tilesTab,
  align: alignTab,
  count: countTab,
};

/** Space around the surface for the mode switch, dimension lines and warnings. */
const INSETS: Insets = { top: 64, right: 52, bottom: 84, left: 52 };
/** How close (in screen pixels) the pattern must come to a magnet to jump to it. */

type Cell = { col: number; row: number };
const sameCell = (a: Cell | null | undefined, b: Cell | null | undefined) => !!a && !!b && a.col === b.col && a.row === b.row;

/** URL parameters that describe a design: a link with any of them opens that design, not the saved one. */
const DESIGN_PARAMS = ['surface', 'series', 'preset', 'design', 'w', 'h', 'th', 'x', 'y', 'fresh'];

function initialUi(params: URLSearchParams, saved: Toggles | null): UiState {
  const toggles = saved ?? { showCuts: true, showRepeat: false, showMotifs: false, showDims: true };
  const flag = (key: keyof Toggles, param: string) => (params.has(param) ? params.get(param) !== '0' : toggles[key]);
  const mode = params.get('mode');
  const tab = params.get('tab');
  const view: View = params.get('view') === 'photo' ? 'photo' : 'designer';
  return {
    view,
    mode: mode === 'row' || mode === 'tile' ? mode : 'pattern',
    tab: tab === 'tiles' || tab === 'align' || tab === 'count' || (tab === 'photo' && view === 'photo') ? tab : view === 'photo' ? 'photo' : 'design',
    selectedBand: null,
    selectedCell: null,
    toggles: { showCuts: flag('showCuts', 'cuts'), showRepeat: flag('showRepeat', 'repeat'), showMotifs: flag('showMotifs', 'motifs'), showDims: flag('showDims', 'dims') },
  };
}

/** The opening design: a design link, else the autosaved design, else the default. */
function openingDesign(params: URLSearchParams): DesignDoc {
  const linked = DESIGN_PARAMS.some((key) => params.has(key));
  const saved = linked ? null : parseSavedDesign(readStorage(DESIGN_KEY), catalog);
  return saved ?? applyQuery(createDefaultDocument(catalog), params, catalog);
}

export function startApp(root: HTMLElement): void {
  const params = new URLSearchParams(location.search);
  const store = new Store(openingDesign(params), initialUi(params, parseSavedToggles(readStorage(VIEW_KEY))));

  // ---- Autosave: the design shortly after each change (and when the page is hidden), the view toggles at once.
  let saveTimer: number | undefined;
  let saved = '';
  const saveNow = () => {
    window.clearTimeout(saveTimer);
    saveTimer = undefined;
    // Photo surfaces aren't saved, so changes to them alone write nothing.
    const design = serializeDesign(store.get().doc);
    if (design !== saved) writeStorage(DESIGN_KEY, design);
    saved = design;
  };
  store.subscribe((state, previous) => {
    if (state.doc !== previous.doc) {
      window.clearTimeout(saveTimer);
      saveTimer = window.setTimeout(saveNow, 400);
    }
    if (state.ui.toggles !== previous.ui.toggles) writeStorage(VIEW_KEY, JSON.stringify(state.ui.toggles));
  });
  const flush = () => {
    if (saveTimer !== undefined) saveNow();
  };
  window.addEventListener('pagehide', flush);

  // ---- Photo work isn't autosaved (photos stay in memory), so the browser asks before the page is
  // left while there are photo surfaces that haven't been shared or downloaded since they changed.
  let photoWorkKept = true;
  store.subscribe((state, previous) => {
    if (state.doc.photo !== previous.doc.photo) photoWorkKept = state.doc.photo.length === 0;
  });
  window.addEventListener('beforeunload', (event) => {
    if (photoWorkKept) return;
    event.preventDefault();
    // Older browsers show the prompt only when returnValue is set.
    event.returnValue = '';
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush();
  });

  // The layout is recomputed only when the active plan or the minimum cut changes.
  let layoutInputs: [unknown, number] | null = null;
  let result: LayoutResult | null = null;
  let pieces = new Map<string, PlacedPiece>();
  const layoutFor = (doc: DesignDoc): LayoutResult => {
    const plan = activePlan(doc);
    if (!result || !layoutInputs || layoutInputs[0] !== plan || layoutInputs[1] !== doc.settings.minCutFraction) {
      result = layoutSurface(plan.surface, plan.layout, plan.alignment, plan.overrides, catalog, { minCutFraction: doc.settings.minCutFraction });
      pieces = new Map(result.pieces.map((p) => [cellKey(p.cell.col, p.cell.row), p]));
      layoutInputs = [plan, doc.settings.minCutFraction];
    }
    return result;
  };

  // ---- Page structure
  const stage = h('main', { class: 'stage' });
  const topbar = new TopBar(root, {
    setView: (view) => switchView(view),
    setSurface: (surface) => switchSurface(surface),
    setSize: (patch) => store.commit((d) => act.setSurfaceSize(d, patch)),
    undo: () => store.undo(),
    redo: () => store.redo(),
    share: () => void shareNow(),
  });
  root.append(topbar.el, stage);

  let sharing = false;
  async function shareNow(): Promise<void> {
    if (sharing) return;
    sharing = true;
    const state = store.get();
    const look: Appearance = { groutMm: state.doc.settings.groutMm, groutColor: state.doc.settings.groutColor, ...state.ui.toggles };
    try {
      let outcome;
      if (state.ui.view === 'photo') {
        // Photo mode shares the photo with its tiles, at the photo's own size.
        const picture = photoMode.composite();
        if (!picture) {
          toast(stage, 'Tile a wall or the floor first, then share the photo.');
          return;
        }
        outcome = await sharePhoto(picture, photoShareContent(photoMode.shareSurfaces(), catalog, state.doc.settings.allowancePct));
        // Shared or saved: leaving the page no longer loses the work.
        if (outcome !== 'cancelled') photoWorkKept = true;
      } else {
        outcome = await sharePicture(state.doc, layoutFor(state.doc), catalog, textures, look);
      }
      if (outcome === 'downloaded') toast(stage, 'Picture saved to your downloads.');
    } catch (error) {
      console.warn('Sharing failed', error);
      toast(stage, "Couldn't make the picture. Please try again.");
    } finally {
      sharing = false;
    }
  }

  const textures = new TextureCache(catalog, () => {
    // A real tile image has loaded: redraw, and redraw previews made from its placeholder.
    clearThumbs();
    canvas.requestDraw();
    photoMode.view.requestDraw();
    sheetTab = null;
    scheduleSheet();
  });
  // The designer and the photo stage share the stage; the hidden one keeps its size and zoom.
  const designerLayer = h('div', { class: 'stage-layer' });
  stage.append(designerLayer);
  const canvas = new CanvasView(designerLayer, textures, () => INSETS);
  const modeSwitch = new ModeSwitch((mode) => setMode(mode));
  const designPopover = new Popover(stage, 'Choose a design', 'design-popover');
  const bandHandles = new BandHandles(catalog, {
    pick: (index, anchor) => openDesignPicker(index, anchor),
    step: (index, direction) => store.commit((d) => act.stepBandRows(d, index, direction, catalog)),
    fill: (index, fill) => store.commit((d) => act.setBandFill(d, index, fill, catalog)),
    move: (from, to) => {
      store.commit((d) => act.moveBand(d, from, to, catalog));
      store.setUi({ selectedBand: to });
    },
    dragging: (index) => {
      designPopover.close();
      store.setUi({ selectedBand: index });
    },
  });
  const viewControls = new ViewControls(stage, {
    fit: () => canvas.fit(),
    toggle: (key: keyof Toggles) => store.setUi({ toggles: { ...store.get().ui.toggles, [key]: !store.get().ui.toggles[key] } }),
    resetTiles: () => {
      store.commit((d) => act.resetTiles(d));
      store.setUi({ selectedCell: null });
    },
  });
  const warnings = new WarningStrip();
  designerLayer.append(bandHandles.el, h('div', { class: 'stage-top' }, modeSwitch.el), viewControls.el, warnings.el);
  const photoMode = new PhotoMode(
    stage,
    store,
    catalog,
    textures,
    {
      changed: () => {
        sheetTab = null;
        render();
      },
      toast: (message) => toast(stage, message),
    },
    {
      // For checks and comparisons: ?segmenter=fake skips the model, ?backend=wasm skips the GPU,
      // ?edges=bilinear turns off the photo-guided edges, ?webgl=0 shows the tile grid instead of tiles.
      segmenter: params.get('segmenter') === 'fake' ? 'fake' : 'model',
      backend: params.get('backend') === 'wasm' ? 'wasm' : 'webgpu',
      edges: params.get('edges') === 'bilinear' ? 'bilinear' : 'guided',
      webgl: params.get('webgl') !== '0',
    },
  );

  // ---- The Design / Tiles / Align / Count panel
  const sheet = new Sheet(
    (tab) => store.setUi({ tab }),
    () => scheduleSheet(),
  );
  root.append(sheet.el);
  let sheetQueued = false;
  let sheetTab: Tab | null = null;
  const tabContext = (): TabContext => {
    const state = store.get();
    return {
      state,
      result: layoutFor(state.doc),
      catalog,
      textures,
      store,
      pickBandDesign: (index, anchor) => openDesignPicker(index, anchor),
      toast: (message) => toast(stage, message),
      refresh: () => {
        sheetTab = null;
        scheduleSheet();
      },
      photo: photoMode,
    };
  };
  function scheduleSheet(): void {
    if (sheetQueued) return;
    sheetQueued = true;
    requestAnimationFrame(() => {
      sheetQueued = false;
      const { tab } = store.get().ui;
      sheet.setTab(tab);
      if (!sheet.isOpen) return;
      const ctx = tabContext();
      const content = TAB_VIEWS[tab](ctx);
      const context = tab === 'photo' ? null : photoContext(ctx.state);
      if (context) content.prepend(context);
      sheet.render(content, tab === sheetTab);
      sheetTab = tab;
    });
  }
  window.matchMedia('(min-width: 900px)').addEventListener('change', () => scheduleSheet());
  if (params.has('tab')) sheet.setOpen(true);

  // ---- Drawing
  /** Short-lived interaction state: a drag in progress, a tile being carried. */
  let overlay: Overlay = {};
  let seriesInUse = '';
  const render = () => {
    const state = store.get();
    const current = layoutFor(state.doc);
    // Keep textures for the series in use only (the designer's wall and floor, and the photo's
    // surfaces), and paint the shown one up front.
    const inUse = [...new Set([state.doc.wall, state.doc.floor, ...state.doc.photo.map((s) => s.plan)].map((p) => p.layout.seriesId))];
    const key = `${inUse.join('|')}|${activePlan(state.doc).layout.seriesId}`;
    if (key !== seriesInUse) {
      seriesInUse = key;
      const tilesOf = (seriesId: string) => catalog.tilesOf(seriesId).map((t) => t.id);
      textures.retain(inUse.flatMap(tilesOf));
      textures.prepare(tilesOf(activePlan(state.doc).layout.seriesId));
    }
    const { toggles, mode } = state.ui;
    const look: Appearance = { groutMm: state.doc.settings.groutMm, groutColor: state.doc.settings.groutColor, ...toggles };
    canvas.setScene({
      result: current,
      look,
      overlay: {
        ...overlay,
        selectedCell: mode === 'tile' ? state.ui.selectedCell : null,
        selectedBand: mode !== 'tile' && activeKind(state.doc) === 'wall' ? state.ui.selectedBand : null,
      },
    });
    const photoView = state.ui.view === 'photo';
    designerLayer.classList.toggle('is-hidden', photoView);
    photoMode.update(state.doc);
    photoMode.show(photoView);
    sheet.showPhotoTab(photoView);
    topbar.update(state);
    modeSwitch.update(mode, activeKind(state.doc));
    viewControls.update(toggles, mode === 'tile' && Object.keys(activePlan(state.doc).overrides).length > 0);
    warnings.update(current.warnings, !!overlay.dragging);
    // The panel follows along, but not on every frame of a drag.
    if (!overlay.dragging && !overlay.floatingTile) scheduleSheet();
  };
  canvas.onFrame = (view) => {
    const state = store.get();
    if (result) bandHandles.update(result, state.doc, view, state.ui.mode === 'row', state.ui.selectedBand);
  };
  canvas.onDraw = () => {
    document.body.dataset.ready = 'true';
  };
  store.subscribe(render);
  render();

  // ---- Modes and surfaces
  function switchView(view: View): void {
    designPopover.close();
    const { tab } = store.get().ui;
    const nextTab: Tab = view === 'photo' ? 'photo' : tab === 'photo' ? 'design' : tab;
    store.setUi({ view, tab: nextTab, selectedBand: null, selectedCell: null });
    sheetTab = null;
  }

  function setMode(mode: Mode): void {
    designPopover.close();
    if (activeKind(store.get().doc) === 'floor' && mode === 'row') return;
    store.setUi({ mode, selectedCell: null, selectedBand: null });
    toast(stage, modeHint(mode));
  }

  function switchSurface(surface: SurfaceType): void {
    designPopover.close();
    store.commit((d) => act.setActive(d, surface));
    if (surface === 'floor' && store.get().ui.mode === 'row') store.setUi({ mode: 'pattern' });
    store.setUi({ selectedBand: null, selectedCell: null });
    canvas.fit();
  }

  function openDesignPicker(index: number, anchor: Element | { x: number; y: number }): void {
    const wall = activeWall(store.get().doc);
    const band = wall?.layout.bands[index];
    if (!wall || !band) return;
    store.setUi({ selectedBand: index });
    const content = h(
      'div',
      {},
      h('p', { class: 'popover-title' }, `Band ${index + 1}: choose a design`),
      designChoices(wall.layout.seriesId, band.designId, catalog, textures, (designId) => {
        store.commit((d) => act.setBandDesign(d, index, designId, catalog));
        designPopover.close();
      }),
    );
    designPopover.open(content, anchor);
  }

  // ---- Hit testing
  const cellAt = (p: PointerPoint): Cell | null => {
    const view = canvas.currentView;
    if (!view || !result) return null;
    const s = toSurface(view, p.x, p.y);
    if (s.x < 0 || s.y < 0 || s.x > result.widthMm || s.y > result.tiledHeightMm) return null;
    const col = Math.floor((s.x - result.origin.x) / result.tile.w);
    const row = Math.floor((s.y - result.origin.y) / result.tile.h);
    return pieces.has(cellKey(col, row)) ? { col, row } : null;
  };

  const bandAt = (p: PointerPoint): number | null => {
    const view = canvas.currentView;
    if (!view || !result || result.surfaceType !== 'wall') return null;
    const s = toSurface(view, p.x, p.y);
    if (s.x < 0 || s.x > result.widthMm) return null;
    return result.bands.find((b) => !b.hidden && s.y >= b.fromMm && s.y < b.toMm)?.index ?? null;
  };

  // ---- Pattern mode: drag the whole layout, with snapping
  function patternDrag(start: PointerPoint): Drag | null {
    const view = canvas.currentView;
    if (!view || !result) return null;
    const startOrigin = result.origin;
    const tile = result.tile;
    const startOverrides = activePlan(store.get().doc).overrides;
    const from = toSurface(view, start.x, start.y);
    store.beginGesture();
    designPopover.close();
    overlay = { ...overlay, dragging: true };
    render();
    const finish = () => {
      overlay = { ...overlay, dragging: false };
      render();
    };
    return {
      move(p) {
        const v = canvas.currentView;
        if (!v) return;
        const at = toSurface(v, p.x, p.y);
        const raw = { x: startOrigin.x + (at.x - from.x), y: startOrigin.y + (at.y - from.y) };
        store.preview((d) => act.dragPattern(d, { origin: startOrigin, overrides: startOverrides, tile }, raw, MAGNET_PX / v.scale, catalog));
      },
      end() {
        store.endGesture();
        finish();
      },
      cancel() {
        store.cancelGesture();
        finish();
      },
    };
  }

  // ---- Tile mode: tap to select, tap again to rotate; hold and drag to swap
  function tapTile(p: PointerPoint): void {
    const cell = cellAt(p);
    if (!cell) {
      store.setUi({ selectedCell: null });
      return;
    }
    if (sameCell(store.get().ui.selectedCell, cell)) store.commit((d) => act.rotateCell(d, cell, catalog));
    else store.setUi({ selectedCell: cell });
  }

  function liftTile(p: PointerPoint): Drag | null {
    const cell = cellAt(p);
    const piece = cell && pieces.get(cellKey(cell.col, cell.row));
    if (!cell || !piece) return null;
    navigator.vibrate?.(12);
    store.setUi({ selectedCell: cell });
    overlay = { ...overlay, liftedCell: cell, dropCell: null, floatingTile: { tileId: piece.tileId, rotation: piece.rotation, x: p.x, y: p.y } };
    render();
    const clear = () => {
      overlay = { ...overlay, liftedCell: null, dropCell: null, floatingTile: null };
      render();
    };
    return {
      move(q) {
        const target = cellAt(q);
        overlay = {
          ...overlay,
          dropCell: target && !sameCell(target, cell) ? target : null,
          floatingTile: { tileId: piece.tileId, rotation: piece.rotation, x: q.x, y: q.y },
        };
        render();
      },
      end(q) {
        const target = cellAt(q);
        clear();
        if (target && !sameCell(target, cell)) {
          store.commit((d) => act.swapCells(d, cell, target, catalog));
          store.setUi({ selectedCell: target });
        }
      },
      cancel: clear,
    };
  }

  // ---- Gestures
  attachGestures(canvas.canvas, {
    dragStart: (start) => (store.get().ui.mode === 'pattern' ? patternDrag(start) : null),
    longPress: (p) => (store.get().ui.mode === 'tile' ? liftTile(p) : null),
    tap: (p) => {
      const { mode } = store.get().ui;
      designPopover.close();
      if (mode === 'tile') tapTile(p);
      else if (mode === 'row') {
        const index = bandAt(p);
        store.setUi({ selectedBand: index });
        if (index !== null) openDesignPicker(index, { x: p.x, y: p.y });
      }
    },
    doubleTap: (p) => {
      // In Tile mode a quick second tap on a tile still rotates it.
      if (store.get().ui.mode === 'tile' && cellAt(p)) tapTile(p);
      else canvas.fit();
    },
    zoom: (factor, x, y) => {
      const view = canvas.currentView;
      if (!view) return;
      const fit = canvas.fittedScale();
      canvas.setView(zoomAround(view, factor, x, y, fit * 0.4, fit * 16));
    },
    pan: (dx, dy) => {
      const view = canvas.currentView;
      if (view) canvas.setView(panView(view, dx, dy));
    },
  });

  window.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    const mod = e.ctrlKey || e.metaKey;
    const key = e.key.toLowerCase();
    if (mod && key === 'z') {
      e.preventDefault();
      if (e.shiftKey) store.redo();
      else store.undo();
    } else if (mod && key === 'y') {
      e.preventDefault();
      store.redo();
    } else if (e.key === 'Escape') {
      store.setUi({ selectedCell: null, selectedBand: null });
    }
  });

  // ?debug=1 exposes state and coordinates to the browser check script.
  if (params.get('debug') === '1') {
    window.ktDebug = {
      state: () => store.get(),
      photo: () => {
        const photo = photoMode.photo;
        const view = photoMode.view.view;
        return photo ? { id: photo.id, name: photo.name, width: photo.width, height: photo.height, view } : null;
      },
      segmentation: () => {
        const status = photoMode.status;
        if (status.state !== 'ready') return { state: status.state, message: status.state === 'failed' ? status.message : undefined };
        const { model, timings, width, height } = status.segmentation;
        return { state: status.state, model, timings, width, height, shares: labelShares(status.segmentation) };
      },
      /** The surfaces picked in the current photo. */
      surfaces: () =>
        photoMode.surfaces.map((s) => ({
          id: s.id,
          kind: s.plan.layout.surface,
          series: s.plan.layout.seriesId,
          size: { w: s.plan.surface.widthMm, h: s.plan.surface.heightMm },
          active: store.get().doc.active === s.id,
          alignment: s.plan.alignment,
          strokes: s.strokes.length,
          tileCover: s.cover,
          coverInfo: photoMode.coverInfo(s.id),
          ...s.fit,
        })),
      /** A point on a photo surface (mm) in photo pixels. */
      surfacePoint: (id: string, x: number, y: number) => photoMode.surfacePoint(id as PhotoSurfaceId, { x, y }),
      /** A photo pixel well inside the biggest region with a label (1 wall, 2 floor), for checks to tap. */
      labelPoint: (label: number) => {
        const segmentation = photoMode.segmentation;
        const photo = photoMode.photo;
        if (!segmentation || !photo) return null;
        const { width, height, labels } = segmentation;
        const mask = { width, height, data: labelMask(labels, label) };
        const region = largestRegion(mask);
        if (!region) return null;
        // Distance (in pixels, 4-connected) from each region pixel to the region's edge; take the deepest.
        const depth = new Int32Array(width * height);
        for (let i = 0; i < depth.length; i++) depth[i] = region.data[i] ? 1 << 20 : 0;
        for (let pass = 0; pass < 2; pass++) {
          for (let k = 0; k < depth.length; k++) {
            const i = pass === 0 ? k : depth.length - 1 - k;
            if (!depth[i]) continue;
            const x = i % width;
            const step = pass === 0 ? -1 : 1;
            const nx = x + step;
            const ny = i + step * width;
            const fromX = nx >= 0 && nx < width ? depth[i + step]! : 0;
            const fromY = ny >= 0 && ny < depth.length ? depth[ny]! : 0;
            depth[i] = Math.min(depth[i]!, fromX + 1, fromY + 1);
          }
        }
        let best = 0;
        for (let i = 1; i < depth.length; i++) if (depth[i]! > depth[best]!) best = i;
        return { x: ((best % width) + 0.5) * (photo.width / width), y: (Math.floor(best / width) + 0.5) * (photo.height / height), depth: depth[best] };
      },
      /** The segmentation label at a photo pixel: 0 other, 1 wall, 2 floor, 3 ceiling. */
      labelAt: (x: number, y: number) => {
        const segmentation = photoMode.segmentation;
        const photo = photoMode.photo;
        if (!segmentation || !photo) return null;
        const sx = Math.floor((x * segmentation.width) / photo.width);
        const sy = Math.floor((y * segmentation.height) / photo.height);
        return segmentation.labels[sy * segmentation.width + sx] ?? null;
      },
      /** The tiles drawn at a photo pixel (premultiplied RGBA), or null without WebGL. */
      tilePixel: (x: number, y: number) => photoMode.tilePixel(x, y),
      webgl: () => !!photoMode.compositor,
      /** Zooms the photo to zoom × its fitted size around a photo pixel. */
      photoZoom: (x: number, y: number, zoom: number) => photoMode.view.zoomTo({ x, y }, zoom),
      /** A photo pixel in page coordinates. */
      photoScreen: (x: number, y: number) => {
        const view = photoMode.view.view;
        const rect = photoMode.view.el.getBoundingClientRect();
        return view ? { x: rect.left + view.x + x * view.scale, y: rect.top + view.y + y * view.scale } : null;
      },
      result: () => result,
      view: () => canvas.currentView,
      fittedScale: () => canvas.fittedScale(),
      screen: (x: number, y: number) => {
        const view = canvas.currentView;
        const rect = canvas.canvas.getBoundingClientRect();
        return view ? { x: rect.left + view.originX + x * view.scale, y: rect.top + view.originY - y * view.scale } : null;
      },
    };
  }

  // ?view=photo&sample=<file> opens photo mode on a sample photo (demos and browser checks).
  const sampleName = params.get('sample');
  const sample = sampleName ? photoMode.samples.find((s) => s.file === sampleName) : undefined;
  if (sample) void photoMode.useSample(sample);

  // ?zoom=4&cx=1200&cy=1800 opens zoomed in on a point (mm), e.g. to inspect a motif joint.
  const zoom = Number(params.get('zoom'));
  if (zoom > 0) {
    const opening = layoutFor(store.get().doc);
    const { width, height } = canvas.size;
    const fitted = fitView(opening.widthMm, opening.heightMm, width, height, INSETS);
    const cx = params.has('cx') ? Number(params.get('cx')) : opening.widthMm / 2;
    const cy = params.has('cy') ? Number(params.get('cy')) : opening.heightMm / 2;
    canvas.setView(viewCentredOn(fitted.scale * zoom, cx, cy, width, height, INSETS));
  }
}
