import { describe, expect, it } from 'vitest';
import { catalog } from '../designs/catalog';
import { layoutSurface } from '../engine';
import {
  addBand,
  applyPreset,
  assignTile,
  moveBand,
  removeBand,
  resetTiles,
  rotateCell,
  RotationError,
  setBandDesign,
  setBandFill,
  setBandTile,
  setCellRotation,
  setSeries,
  setSurfaceSize,
  stepBandRows,
  swapCells,
  tileAt,
} from './actions';
import { activePlan, createDefaultDocument, type DesignDoc } from './document';
import { Store, type UiState } from './store';

const fresh = () => createDefaultDocument(catalog);
const bandsOf = (doc: DesignDoc) => doc.wall.layout.bands.map((b) => `${catalog.design(b.designId).name}:${b.rows}`);
const ranges = (doc: DesignDoc) => {
  const plan = activePlan(doc);
  return layoutSurface(plan.surface, plan.layout, plan.alignment, plan.overrides, catalog).bands.map((b) => `${b.fromMm}-${b.toMm}`);
};

describe('surface size', () => {
  it('clamps to sensible sizes and keeps a full-height tiled height following the height', () => {
    const doc = setSurfaceSize(fresh(), { widthMm: 2450.4, heightMm: 3000 });
    expect(doc.wall.surface).toEqual({ widthMm: 2450, heightMm: 3000, tiledHeightMm: 3000 });
    const lower = setSurfaceSize(doc, { tiledHeightMm: 2100 });
    expect(setSurfaceSize(lower, { heightMm: 2800 }).wall.surface.tiledHeightMm).toBe(2100);
    expect(setSurfaceSize(lower, { tiledHeightMm: 5000 }).wall.surface.tiledHeightMm).toBe(3000);
    expect(setSurfaceSize(doc, { widthMm: 5 }).wall.surface.widthMm).toBe(100);
  });

  it('returns the same document when nothing changes', () => {
    const doc = fresh();
    expect(setSurfaceSize(doc, { widthMm: 2400 })).toBe(doc);
  });
});

describe('bands', () => {
  it('steps rows by whole repeat units and never below one unit', () => {
    let doc = fresh();
    doc = stepBandRows(doc, 2, 1, catalog); // Highlighter pair: 2 rows per unit
    expect(bandsOf(doc)).toEqual(['Dark:1', 'Light:2', 'Highlighter pair:4', 'Light:fill']);
    doc = stepBandRows(stepBandRows(doc, 2, -1, catalog), 2, -1, catalog);
    expect(bandsOf(doc)).toEqual(['Dark:1', 'Light:2', 'Highlighter pair:2', 'Light:fill']);
    expect(stepBandRows(doc, 3, 1, catalog)).toBe(doc); // the fill band has no stepper
  });

  it('moves bands; fill stays with the top position', () => {
    const doc = moveBand(fresh(), 2, 0, catalog);
    expect(bandsOf(doc)).toEqual(['Highlighter pair:2', 'Dark:1', 'Light:2', 'Light:fill']);
    expect(ranges(doc)).toEqual(['0-900', '900-1350', '1350-2250', '2250-2700']);
    const topDown = moveBand(fresh(), 3, 0, catalog);
    expect(bandsOf(topDown)).toEqual(['Light:1', 'Dark:1', 'Light:2', 'Highlighter pair:fill']);
  });

  it('keeps overrides on their band when bands move or grow', () => {
    let doc = fresh();
    doc = swapCells(doc, { col: 3, row: 3 }, { col: 3, row: 4 }, catalog); // HL-B and HL-A, in the highlighter band
    expect(Object.keys(doc.wall.overrides).sort()).toEqual(['3,3', '3,4']);
    doc = stepBandRows(doc, 1, 1, catalog); // Light band below grows by a row
    expect(Object.keys(doc.wall.overrides).sort()).toEqual(['3,4', '3,5']);
    doc = moveBand(doc, 2, 0, catalog); // highlighter band to the floor
    expect(Object.keys(doc.wall.overrides).sort()).toEqual(['3,0', '3,1']);
  });

  it('changes a band design, keeping its number of repeat units', () => {
    const doc = setBandDesign(fresh(), 1, 'ivory-hl-pair', catalog);
    expect(bandsOf(doc)).toEqual(['Dark:1', 'Highlighter pair:4', 'Highlighter pair:2', 'Light:fill']);
    expect(bandsOf(setBandTile(fresh(), 0, 'ivory-hl-a', catalog))[0]).toBe('Highlighter pair:2');
  });

  it('turns fill off at the rows it shows, and back on', () => {
    const fixed = setBandFill(fresh(), 3, false, catalog);
    expect(bandsOf(fixed)[3]).toBe('Light:1');
    expect(bandsOf(setBandFill(fixed, 3, true, catalog))[3]).toBe('Light:fill');
    expect(setBandFill(fresh(), 1, true, catalog)).toEqual(fresh());
  });

  it('adds a band below the top band and removes bands', () => {
    const added = addBand(fresh(), catalog);
    expect(bandsOf(added)).toEqual(['Dark:1', 'Light:2', 'Highlighter pair:2', 'Light:1', 'Light:fill']);
    expect(bandsOf(removeBand(added, 4, catalog))).toEqual(['Dark:1', 'Light:2', 'Highlighter pair:2', 'Light:fill']);
  });

  it('applies presets', () => {
    expect(bandsOf(applyPreset(fresh(), 'classic', catalog))).toEqual(['Dark:2', 'Light:fill']);
  });
});

describe('series', () => {
  it('keeps the band structure role for role in another wall series', () => {
    const doc = setSeries(fresh(), 'demo-azure-medallion', catalog);
    expect(bandsOf(doc)).toEqual(['Dark:1', 'Light:2', 'Medallion:2', 'Light:fill']);
    expect(doc.wall.layout.seriesId).toBe('demo-azure-medallion');
  });

  it('switching to a floor series shows the floor', () => {
    const doc = setSeries(fresh(), 'demo-floor', catalog);
    expect(doc.active).toBe('floor');
  });
});

describe('tiles', () => {
  const highlighterCell = { col: 2, row: 3 }; // HL-B (300 × 450)

  it('rotates rectangular tiles 0° ↔ 180° only', () => {
    let doc = rotateCell(fresh(), highlighterCell, catalog);
    expect(tileAt(doc, highlighterCell, catalog)).toEqual({ tileId: 'ivory-hl-b', rotation: 180 });
    doc = rotateCell(doc, highlighterCell, catalog);
    expect(tileAt(doc, highlighterCell, catalog)?.rotation).toBe(0);
    expect(doc.wall.overrides).toEqual({});
  });

  it('rejects a 90° turn on a rectangular tile', () => {
    expect(() => setCellRotation(fresh(), highlighterCell, 90, catalog)).toThrow(RotationError);
  });

  it('turns square tiles in quarter turns', () => {
    let doc = setSeries(fresh(), 'demo-azure-medallion', catalog);
    const cell = { col: 1, row: 0 };
    const seen = [];
    for (let i = 0; i < 4; i++) {
      doc = rotateCell(doc, cell, catalog);
      seen.push(tileAt(doc, cell, catalog)?.rotation);
    }
    expect(seen).toEqual([90, 180, 270, 0]);
  });

  it('swaps two tiles, and swapping back leaves no overrides', () => {
    const a = { col: 0, row: 0 };
    const b = { col: 0, row: 3 };
    const swapped = swapCells(fresh(), a, b, catalog);
    expect(tileAt(swapped, a, catalog)?.tileId).toBe('ivory-hl-b');
    expect(tileAt(swapped, b, catalog)?.tileId).toBe('ivory-dark');
    expect(swapCells(swapped, a, b, catalog).wall.overrides).toEqual({});
  });

  it('assigns tiles from the same series only, and resets', () => {
    const doc = assignTile(fresh(), { col: 1, row: 1 }, 'ivory-dark', catalog);
    expect(tileAt(doc, { col: 1, row: 1 }, catalog)?.tileId).toBe('ivory-dark');
    expect(() => assignTile(fresh(), { col: 1, row: 1 }, 'azure-hl', catalog)).toThrow();
    expect(resetTiles(doc).wall.overrides).toEqual({});
  });
});

describe('store', () => {
  const ui: UiState = {
    view: 'designer',
    mode: 'pattern',
    tab: 'design',
    selectedBand: null,
    selectedCell: null,
    toggles: { showCuts: true, showRepeat: false, showMotifs: false, showDims: true },
  };

  it('undoes and redoes every change', () => {
    const store = new Store(fresh(), ui);
    store.commit((doc) => setSurfaceSize(doc, { widthMm: 2450 }));
    store.commit((doc) => stepBandRows(doc, 0, 1, catalog));
    expect(store.get().canUndo).toBe(true);
    store.undo();
    expect(bandsOf(store.get().doc)[0]).toBe('Dark:1');
    store.undo();
    expect(store.get().doc.wall.surface.widthMm).toBe(2400);
    expect(store.get().canUndo).toBe(false);
    store.redo();
    expect(store.get().doc.wall.surface.widthMm).toBe(2450);
    expect(store.get().canRedo).toBe(true);
  });

  it('records a whole drag as one step, and can cancel it', () => {
    const store = new Store(fresh(), ui);
    for (const width of [2410, 2420, 2430]) store.preview((doc) => setSurfaceSize(doc, { widthMm: width }));
    store.endGesture();
    expect(store.get().doc.wall.surface.widthMm).toBe(2430);
    store.undo();
    expect(store.get().doc.wall.surface.widthMm).toBe(2400);
    store.preview((doc) => setSurfaceSize(doc, { widthMm: 3000 }));
    store.cancelGesture();
    expect(store.get().doc.wall.surface.widthMm).toBe(2400);
    expect(store.get().canUndo).toBe(false);
  });

  it('ignores edits that change nothing', () => {
    const store = new Store(fresh(), ui);
    store.commit((doc) => doc);
    expect(store.get().canUndo).toBe(false);
  });
});

describe('opening design', () => {
  it('uses the top suggestion: on 2400 mm, the sprigs sit between motifs with no cuts', () => {
    const doc = fresh();
    expect(doc.wall.alignment).toEqual({ x: { mode: 'centre-between-motifs' }, y: { mode: 'bottom' } });
    const plan = doc.wall;
    const result = layoutSurface(plan.surface, plan.layout, plan.alignment, plan.overrides, catalog);
    expect(result.pieces.filter((p) => p.isCut)).toHaveLength(0);
    expect(doc.floor.alignment).toEqual({ x: { mode: 'centre-joint' }, y: { mode: 'centre-joint' } });
  });
});
