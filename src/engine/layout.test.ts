import { describe, expect, it } from 'vitest';
import { countTiles } from './count';
import { LayoutError } from './validate';
import {
  align,
  AZURE,
  catalog,
  cutWidths,
  fullPieces,
  IVORY,
  pieceAt,
  plainWall,
  presetWall,
  rowsOf,
  run,
  wall,
  wallOf,
} from './testkit';

const LIGHT = 'ivory-light-plain';

describe('Ivory Bloom (300 wide × 450 high), plain Light, 2400 × 2700 wall', () => {
  const surface = wall(2400, 2700);
  const layout = plainWall(IVORY, LIGHT);

  it('left aligned: 8 full tiles per row, 6 rows, no cuts; 48 pieces, 51 tiles, 7 boxes', () => {
    const result = run(surface, layout, align('left'));
    const rows = rowsOf(result);
    expect(rows).toHaveLength(6);
    for (const row of rows) {
      expect(row).toHaveLength(8);
      expect(fullPieces(row)).toBe(8);
    }
    expect(result.pieces).toHaveLength(48);
    expect(result.edgeCuts).toEqual({ left: null, right: null, bottom: null, top: null });
    expect(result.warnings).toEqual([]);

    const count = countTiles(result.pieces, 5, catalog);
    expect(count.totals).toMatchObject({ full: 48, cut: 0, pieces: 48, tilesNeeded: 51, boxes: 7 });
  });

  it('centre-tile: 7 full + 2 cuts of 150 mm per row; 54 pieces (42 full, 12 cut), 57 tiles, 8 boxes', () => {
    const result = run(surface, layout, align('centre-tile'));
    for (const row of rowsOf(result)) {
      expect(fullPieces(row)).toBe(7);
      expect(cutWidths(row)).toEqual([150, 150]);
    }
    expect(result.edgeCuts).toMatchObject({ left: 150, right: 150 });
    expect(result.warnings).toEqual([]);

    const count = countTiles(result.pieces, 5, catalog);
    expect(count.totals).toMatchObject({ full: 42, cut: 12, pieces: 54, tilesNeeded: 57, boxes: 8 });
  });
});

describe('the same tiles on a 2450 mm wide wall', () => {
  const surface = wall(2450, 2700);
  const layout = plainWall(IVORY, LIGHT);

  it('left aligned: 8 full + one 50 mm cut per row, flagged as a sliver (minimum 100 mm)', () => {
    const result = run(surface, layout, align('left'));
    for (const row of rowsOf(result)) {
      expect(fullPieces(row)).toBe(8);
      expect(cutWidths(row)).toEqual([50]);
    }
    expect(result.minCutMm.x).toBe(100);
    expect(result.edgeCuts).toMatchObject({ left: null, right: 50 });
    expect(result.warnings).toEqual([
      { code: 'sliver', edge: 'right', sizeMm: 50, message: '50 mm sliver at right edge' },
    ]);
  });

  it('centre-joint: 25 mm cuts at both ends, flagged as slivers', () => {
    const result = run(surface, layout, align('centre-joint'));
    for (const row of rowsOf(result)) expect(cutWidths(row)).toEqual([25, 25]);
    expect(result.edgeCuts).toMatchObject({ left: 25, right: 25 });
    expect(result.warnings.map((w) => w.message)).toEqual(['25 mm sliver at left edge', '25 mm sliver at right edge']);
  });

  it('centre-tile: 175 mm cuts at both ends and no warning', () => {
    const result = run(surface, layout, align('centre-tile'));
    for (const row of rowsOf(result)) {
      expect(fullPieces(row)).toBe(7);
      expect(cutWidths(row)).toEqual([175, 175]);
    }
    expect(result.warnings).toEqual([]);
  });
});

describe('centre-motif', () => {
  it('Ivory Highlighter pair on the 2450 wall: same as centre-tile, no warning', () => {
    for (const layout of [presetWall(IVORY, 'highlighter-band'), presetWall(IVORY, 'feature-wall')]) {
      const motif = run(wall(2450, 2700), layout, align('centre-motif'));
      const tile = run(wall(2450, 2700), layout, align('centre-tile'));
      expect(motif.alignment.x).toBe('centre-motif');
      expect(motif.origin).toEqual(tile.origin);
      expect(motif.pieces).toEqual(tile.pieces);
      expect(motif.warnings).toEqual([]);
      // The sprig centre sits on the wall centreline, on a tile centre (not a joint).
      expect(motif.motifCentres.some((p) => p.x === 1225)).toBe(true);
      expect((1225 - motif.origin.x) % 300).toBe(150);
    }
  });

  it('Azure Medallion on the 2450 wall: motif on the joint at x = 1225, 25 mm slivers at both ends', () => {
    const result = run(wall(2450, 2700), presetWall(AZURE, 'highlighter-band'), align('centre-motif'));
    expect(result.motifCentres.some((p) => p.x === 1225)).toBe(true);
    expect((1225 - result.origin.x) % 300).toBe(0);
    expect(result.edgeCuts).toMatchObject({ left: 25, right: 25 });
    expect(result.warnings.map((w) => w.message)).toEqual(['25 mm sliver at left edge', '25 mm sliver at right edge']);
  });

  it('falls back to centre-tile, with a warning, when the layout has no motif', () => {
    const result = run(wall(2450, 2700), plainWall(IVORY, LIGHT), align('centre-motif'));
    expect(result.alignment.x).toBe('centre-tile');
    expect(result.edgeCuts).toMatchObject({ left: 175, right: 175 });
    expect(result.warnings.map((w) => w.code)).toEqual(['alignment-fallback']);
  });
});

describe('motifs line up across tiles', () => {
  it('the medallion forms around the corner its four tiles share', () => {
    const result = run(wall(2400, 2700), presetWall(AZURE, 'feature-wall'), align('left'));
    const centre = result.motifCentres.find((p) => p.x > 0 && p.y > 0);
    if (!centre) throw new Error('no motif centre');
    // The quarter medallion sits in the HL tile's top-right corner at 0°; turning clockwise
    // moves it to bottom-right, bottom-left, then top-left. Each tile must turn it towards the centre.
    const corners = ['top-right', 'bottom-right', 'bottom-left', 'top-left'];
    const around = [
      { x: -1, y: -1, corner: 'top-right' },
      { x: 1, y: -1, corner: 'top-left' },
      { x: -1, y: 1, corner: 'bottom-right' },
      { x: 1, y: 1, corner: 'bottom-left' },
    ];
    for (const { x, y, corner } of around) {
      const piece = pieceAt(result, centre.x + x * 150, centre.y + y * 150);
      expect(piece?.tileId).toBe('azure-hl');
      expect(corners[(piece?.rotation ?? 0) / 90]).toBe(corner);
    }
  });

  it('the sprig runs from HL-B up into HL-A across their shared joint', () => {
    const result = run(wall(2400, 2700), presetWall(IVORY, 'highlighter-band'), align('left'));
    const centre = result.motifCentres[0];
    if (!centre) throw new Error('no motif centre');
    expect(pieceAt(result, centre.x, centre.y - 10)?.tileId).toBe('ivory-hl-b');
    expect(pieceAt(result, centre.x, centre.y + 10)?.tileId).toBe('ivory-hl-a');
    expect((centre.y - result.origin.y) % 450).toBe(0);
  });
});

describe('tiled height and vertical alignment', () => {
  it('tiled height 2100 with 450 mm tiles: 4 full rows plus a 300 mm cut row at the top', () => {
    const result = run(wall(2400, 2700, 2100), plainWall(IVORY, LIGHT), align('left'));
    const rows = rowsOf(result);
    expect(rows).toHaveLength(5);
    for (const row of rows.slice(0, 4)) expect(row.every((p) => !p.isCut)).toBe(true);
    expect(rows[4]?.every((p) => p.isCut && p.cutHeightMm === 300)).toBe(true);
    expect(result.edgeCuts.top).toBe(300);
    expect(result.warnings).toEqual([]);
    expect(result.guides).toContainEqual({ orientation: 'horizontal', atMm: 2100, kind: 'tiled-height' });
  });

  it('a custom vertical offset sets the bottom cut and moves every band', () => {
    const result = run(wall(2400, 2700), presetWall(IVORY, 'highlighter-band'), align('left', -100));
    expect(result.edgeCuts.bottom).toBe(350);
    expect(result.bands.map((b) => [b.fromMm, b.toMm])).toEqual([
      [0, 350],
      [350, 1250],
      [1250, 2150],
      [2150, 2700],
    ]);
  });

  it('custom vertical offsets wrap within one tile on walls', () => {
    expect(run(wall(2400, 2700), plainWall(IVORY, LIGHT), align('left', -550)).origin.y).toBe(-100);
    expect(run(wall(2400, 2700), plainWall(IVORY, LIGHT), align('left', 100)).origin.y).toBe(-350);
  });

  it('"top" puts a full tile at the tiled height and the cut at the floor', () => {
    const result = run(wall(2400, 2700, 2100), plainWall(IVORY, LIGHT), align('left', 'top'));
    expect(result.origin.y).toBe(-150);
    expect(result.edgeCuts).toMatchObject({ bottom: 300, top: null });
  });
});

describe('bands', () => {
  it('reports each band as a height range from the floor', () => {
    const result = run(wall(2400, 2700), presetWall(IVORY, 'highlighter-band'), align('left'));
    expect(result.bands.map((b) => ({ design: b.designId, from: b.fromMm, to: b.toMm, rows: b.rowCount }))).toEqual([
      { design: 'ivory-dark-plain', from: 0, to: 450, rows: 1 },
      { design: 'ivory-light-plain', from: 450, to: 1350, rows: 2 },
      { design: 'ivory-hl-pair', from: 1350, to: 2250, rows: 2 },
      { design: 'ivory-light-plain', from: 2250, to: 2700, rows: 1 },
    ]);
  });

  it('a band taller than the tiled height is cut there; its pieces count as cuts, with a warning', () => {
    const result = run(wall(2400, 2700, 2100), presetWall(IVORY, 'highlighter-band'), align('left'));
    const [, , highlighter, fill] = result.bands;
    expect(highlighter).toMatchObject({ fromMm: 1350, toMm: 2100, clipped: true, hidden: false, visibleRows: 2 });
    expect(fill).toMatchObject({ rowCount: 0, hidden: true });
    expect(result.warnings.map((w) => w.code)).toEqual(['band-clipped', 'band-hidden']);
    expect(result.warnings.find((w) => w.code === 'band-clipped')).toMatchObject({
      bandIndex: 2,
      message: 'Band 3 (Highlighter pair) is cut off at the tiled height (2100 mm)',
    });

    const hlA = countTiles(result.pieces, 5, catalog).tiles.find((t) => t.tileId === 'ivory-hl-a');
    expect(hlA).toMatchObject({ full: 0, cut: 8, pieces: 8 });
    expect(result.pieces.filter((p) => p.tileId === 'ivory-hl-a').every((p) => p.cutHeightMm === 300)).toBe(true);
  });

  it('fixed bands that stop short of the tiled height leave a gap, with a warning', () => {
    const layout = wallOf(IVORY, [
      { designId: 'ivory-dark-plain', rows: 2 },
      { designId: LIGHT, rows: 2 },
    ]);
    const result = run(wall(2400, 2700), layout, align('left'));
    expect(result.pieces).toHaveLength(32);
    expect(Math.max(...result.pieces.map((p) => p.visibleRect.y + p.visibleRect.h))).toBe(1800);
    expect(result.edgeCuts.top).toBeNull();
    expect(result.warnings).toEqual([
      { code: 'band-gap', message: 'Tiles stop at 1800 mm, leaving 900 mm untiled below the tiled height' },
    ]);
  });

  it('a band entirely above the tiled height is hidden, with a warning', () => {
    const layout = wallOf(IVORY, [
      { designId: 'ivory-dark-plain', rows: 6 },
      { designId: LIGHT, rows: 2 },
    ]);
    const result = run(wall(2400, 2700), layout, align('left'));
    expect(result.bands[1]).toMatchObject({ hidden: true, visibleRows: 0 });
    expect(result.warnings.map((w) => w.message)).toEqual(["Band 2 (Light) is above the tiled height, so it isn't shown"]);
  });

  it('rejects a layout whose band rows are not a multiple of the design rows', () => {
    const layout = wallOf(IVORY, [{ designId: 'ivory-hl-pair', rows: 3 }]);
    expect(() => run(wall(2400, 2700), layout, align('left'))).toThrow(LayoutError);
  });
});

describe('overrides', () => {
  const surface = wall(2400, 2700);

  it('rotates and swaps tiles in single cells', () => {
    const layout = presetWall(AZURE, 'highlighter-band');
    const result = run(surface, layout, align('left'), {
      '0,3': { rotation: 90 },
      '1,3': { tileId: 'azure-light', rotation: 0 },
    });
    const at = (col: number, row: number) => result.pieces.find((p) => p.cell.col === col && p.cell.row === row);
    expect(at(0, 3)).toMatchObject({ tileId: 'azure-hl', rotation: 90, overridden: true });
    expect(at(1, 3)).toMatchObject({ tileId: 'azure-light', rotation: 0, overridden: true });
    expect(at(2, 3)).toMatchObject({ tileId: 'azure-hl', rotation: 0, overridden: false });
    expect(result.warnings).toEqual([]);
  });

  it('ignores a 90° turn on a rectangular tile and a tile from another series', () => {
    const result = run(surface, plainWall(IVORY, LIGHT), align('left'), {
      '0,0': { rotation: 90 },
      '1,0': { tileId: 'azure-hl' },
    });
    expect(result.pieces.slice(0, 2).map((p) => [p.tileId, p.rotation, p.overridden])).toEqual([
      ['ivory-light', 0, false],
      ['ivory-light', 0, false],
    ]);
    expect(result.warnings).toEqual([{ code: 'invalid-override', message: "2 tile changes don't fit this series and were ignored" }]);
  });

  it('move with the pattern when it is dragged', () => {
    const overrides = { '2,0': { tileId: 'ivory-dark' } };
    const before = run(surface, plainWall(IVORY, LIGHT), align(0), overrides);
    const after = run(surface, plainWall(IVORY, LIGHT), align(120), overrides);
    const dark = (r: typeof before) => r.pieces.find((p) => p.tileId === 'ivory-dark')?.rect.x;
    expect((dark(after) ?? 0) - (dark(before) ?? 0)).toBe(120);
  });
});

describe('engine output', () => {
  it('outlines each repeat unit and lists motif centres inside the surface', () => {
    const result = run(wall(2400, 2700), presetWall(AZURE, 'highlighter-band'), align('left'));
    const medallions = result.unitOutlines.filter((u) => u.designId === 'azure-medallion-2x2');
    expect(medallions).toHaveLength(4);
    expect(medallions[0]?.rect).toEqual({ x: 0, y: 900, w: 600, h: 600 });
    expect(result.motifCentres).toEqual([300, 900, 1500, 2100].map((x) => ({ x, y: 1200 })));
  });

  it('gives the surface centrelines as guides', () => {
    const result = run(wall(2450, 2700), plainWall(IVORY, LIGHT), align('left'));
    expect(result.guides).toEqual([
      { orientation: 'vertical', atMm: 1225, kind: 'centre' },
      { orientation: 'horizontal', atMm: 1350, kind: 'centre' },
    ]);
  });

  it('marks pieces as cut from both edges on a wall narrower than one tile', () => {
    const result = run(wall(200, 450), plainWall(IVORY, LIGHT), align('centre-tile'));
    expect(result.pieces).toHaveLength(1);
    expect(result.pieces[0]).toMatchObject({ isCut: true, cutWidthMm: 200, cutHeightMm: 450 });
  });
});
