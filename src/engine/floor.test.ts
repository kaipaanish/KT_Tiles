import { describe, expect, it } from 'vitest';
import { countTiles } from './count';
import { LayoutError } from './validate';
import { align, catalog, FLOOR, run } from './testkit';
import type { Layout } from './types';

const checker: Layout = { surface: 'floor', seriesId: FLOOR, designId: 'floor-checker' };
const floor = { widthMm: 1800, heightMm: 2400 };

describe('floors', () => {
  it('centre-tile on both axes: 150 mm cuts on every side', () => {
    const result = run(floor, checker, align('centre-tile', 'centre-tile'));
    expect(result.origin).toEqual({ x: -450, y: -150 });
    expect(result.edgeCuts).toEqual({ left: 150, right: 150, bottom: 150, top: 150 });
    expect(result.pieces).toHaveLength(7 * 9);
    expect(result.warnings).toEqual([]);
    expect(result.bands).toEqual([]);
  });

  it('alternates grey and beige in a checkerboard', () => {
    const result = run(floor, checker, align('left', 'bottom'));
    for (const piece of result.pieces) {
      const even = (piece.cell.col + piece.cell.row) % 2 === 0;
      expect(piece.tileId).toBe(even ? 'floor-grey' : 'floor-beige');
    }
    const count = countTiles(result.pieces, 5, catalog);
    expect(count.tiles.map((t) => [t.name, t.pieces, t.boxes])).toEqual([
      ['Grey anti-skid', 24, 3],
      ['Beige anti-skid', 24, 3],
    ]);
  });

  it('floors ignore tiled height', () => {
    const result = run({ ...floor, tiledHeightMm: 1000 }, checker, align('left', 'bottom'));
    expect(result.tiledHeightMm).toBe(2400);
    expect(result.pieces).toHaveLength(48);
  });

  it('has no motif to centre in the demo floor designs', () => {
    const result = run(floor, checker, align('centre-motif', 'centre-motif'));
    expect(result.alignment).toEqual({ x: 'centre-tile', y: 'centre-tile' });
    expect(result.warnings.every((w) => w.code === 'alignment-fallback')).toBe(true);
  });

  it('rejects a wall design on a floor', () => {
    expect(() => run(floor, { surface: 'floor', seriesId: FLOOR, designId: 'ivory-light-plain' }, align('left'))).toThrow(LayoutError);
  });
});
