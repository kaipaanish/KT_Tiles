import { describe, expect, it } from 'vitest';
import { countTiles, tilesNeededFor } from './count';
import { align, catalog, IVORY, plainWall, presetWall, run, wall } from './testkit';

describe('tilesNeededFor', () => {
  it('rounds pieces × (1 + allowance) up, without floating-point surprises', () => {
    expect(tilesNeededFor(48, 5)).toBe(51);
    expect(tilesNeededFor(54, 5)).toBe(57);
    expect(tilesNeededFor(40, 5)).toBe(42); // 40 × 1.05 is 42.000000000000007 in floating point
    expect(tilesNeededFor(20, 0)).toBe(20);
    expect(tilesNeededFor(0, 5)).toBe(0);
    expect(tilesNeededFor(10, -5)).toBe(10);
  });
});

describe('countTiles', () => {
  it('counts each tile in the series order, with boxes per tile', () => {
    const result = run(wall(2400, 2700), presetWall(IVORY, 'highlighter-band'), align('left'));
    const count = countTiles(result.pieces, 5, catalog);
    expect(count.tiles.map((t) => [t.name, t.pieces, t.tilesNeeded, t.boxes])).toEqual([
      ['Light', 24, 26, 4],
      ['Dark', 8, 9, 2],
      ['HL-A', 8, 9, 2],
      ['HL-B', 8, 9, 2],
    ]);
    expect(count.totals).toMatchObject({ pieces: 48, tilesNeeded: 53, boxes: 10 });
  });

  it('reports covered area in m² and sq ft', () => {
    const result = run(wall(2400, 2700), plainWall(IVORY, 'ivory-light-plain'), align('centre-tile'));
    const { totals } = countTiles(result.pieces, 5, catalog);
    expect(totals.areaM2).toBeCloseTo(6.48, 6);
    expect(totals.areaSqFt).toBeCloseTo(6.48 * 10.7639, 4);
  });

  it('counts a cut piece as one whole tile', () => {
    const result = run(wall(2450, 2700), plainWall(IVORY, 'ivory-light-plain'), align('left'));
    const [light] = countTiles(result.pieces, 0, catalog).tiles;
    expect(light).toMatchObject({ full: 48, cut: 6, pieces: 54, tilesNeeded: 54, boxes: 7 });
  });
});
