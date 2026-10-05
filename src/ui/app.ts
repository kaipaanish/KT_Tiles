import { catalog } from '../designs/catalog';
import {
  cellKey,
  layoutSurface,
  rebaseOverrides,
  resolveAlignment,
  snapPatternOffset,
  type LayoutResult,
  type PlacedPiece,
  type SurfaceType,
} from '../engine';
import { toSurface, type Appearance, type Overlay } from '../render/renderer';
import { TextureCache } from '../render/textureCache';
import * as act from '../state/actions';
import { activePlan, applyQuery, createDefaultDocument, type DesignDoc } from '../state/document';
import { Store, type Mode, type Tab, type Toggles, type UiState } from '../state/store';
import { BandHandles } from './bandHandles';
import { CanvasView } from './canvasView';
import { modeHint, ModeSwitch, toast, ViewControls, WarningStrip } from './controls';
import { designChoices } from './designPicker';
import { h } from './dom';
import { attachGestures, type Drag, type PointerPoint } from './gestures';
import { Popover } from './popover';
import { Sheet } from './sheet';
import { alignTab } from './tabs/align';
import type { TabContext } from './tabs/context';
import { countTab } from './tabs/count';
import { designTab } from './tabs/design';
import { tilesTab } from './tabs/tiles';
import { TopBar } from './topbar';
import { fitView, panView, viewCentredOn, zoomAround, type Insets } from './viewport';

const TAB_VIEWS: Record<Tab, (ctx: TabContext) => HTMLElement> = {
  design: designTab,
  tiles: tilesTab,
  align: alignTab,
  count: countTab,
};

/** Space around the surface for the mode switch, dimension lines and warnings. */
const INSETS: Insets = { top: 64, right: 52, bottom: 84, left: 52 };
/** How close (in screen pixels) the pattern must come to a magnet to jump to it. */
const MAGNET_PX = 14;

type Cell = { col: number; row: number };
const sameCell = (a: Cell | null | undefined, b: Cell | null | undefined) => !!a && !!b && a.col === b.col && a.row === b.row;

function initialUi(params: URLSearchParams): UiState {
  const flag = (key: string, fallback: boolean) => (params.has(key) ? params.get(key) !== '0' : fallback);
  const mode = params.get('mode');
  const tab = params.get('tab');
  return {
    mode: mode === 'row' || mode === 'tile' ? mode : 'pattern',
    tab: tab === 'tiles' || tab === 'align' || tab === 'count' ? tab : 'design',
    selectedBand: null,
    selectedCell: null,
    toggles: { showCuts: flag('cuts', true), showRepeat: flag('repeat', false), showMotifs: flag('motifs', false), showDims: flag('dims', true) },
  };
}

export function startApp(root: HTMLElement): void {
  const params = new URLSearchParams(location.search);
  const store = new Store(applyQuery(createDefaultDocument(catalog), params, catalog), initialUi(params));

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
    setSurface: (surface) => switchSurface(surface),
    setSize: (patch) => store.commit((d) => act.setSurfaceSize(d, patch)),
    undo: () => store.undo(),
    redo: () => store.redo(),
  });
  root.append(topbar.el, stage);

  const textures = new TextureCache(catalog, () => canvas.requestDraw());
  const canvas = new CanvasView(stage, textures, () => INSETS);
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
  stage.append(bandHandles.el, h('div', { class: 'stage-top' }, modeSwitch.el), viewControls.el, warnings.el);

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
      sheet.render(TAB_VIEWS[tab](ctx), tab === sheetTab);
      sheetTab = tab;
    });
  }
  window.matchMedia('(min-width: 900px)').addEventListener('change', () => scheduleSheet());
  if (params.has('tab')) sheet.setOpen(true);

  // ---- Drawing
  /** Short-lived interaction state: a drag in progress, a tile being carried. */
  let overlay: Overlay = { dragging: params.get('drag') === '1' };
  const render = () => {
    const state = store.get();
    const current = layoutFor(state.doc);
    textures.prepare(catalog.tilesOf(activePlan(state.doc).layout.seriesId).map((t) => t.id));
    const { toggles, mode } = state.ui;
    const look: Appearance = { groutMm: state.doc.settings.groutMm, groutColor: state.doc.settings.groutColor, ...toggles };
    canvas.setScene({
      result: current,
      look,
      overlay: {
        ...overlay,
        selectedCell: mode === 'tile' ? state.ui.selectedCell : null,
        selectedBand: mode !== 'tile' && state.doc.active === 'wall' ? state.ui.selectedBand : null,
      },
    });
    topbar.update(state);
    modeSwitch.update(mode, state.doc.active);
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
  function setMode(mode: Mode): void {
    designPopover.close();
    if (store.get().doc.active === 'floor' && mode === 'row') return;
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
    const doc = store.get().doc;
    const band = doc.wall.layout.bands[index];
    if (!band) return;
    store.setUi({ selectedBand: index });
    const content = h(
      'div',
      {},
      h('p', { class: 'popover-title' }, `Band ${index + 1}: choose a design`),
      designChoices(doc.wall.layout.seriesId, band.designId, catalog, textures, (designId) => {
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
        const plan = activePlan(store.get().doc);
        const snap = snapPatternOffset(plan.surface, plan.layout, catalog, raw, MAGNET_PX / v.scale);
        // A named alignment's own origin can be whole repeats away from where the drag put it;
        // re-key the overrides so they stay on the same tiles.
        const named = resolveAlignment(plan.surface, plan.layout, snap.alignment, catalog).origin;
        const overrides = rebaseOverrides(startOverrides, snap.origin, named, tile);
        store.preview((d) => act.setAlignment(d, snap.alignment, overrides));
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
