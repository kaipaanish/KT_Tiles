import { describe, expect, it } from 'vitest';
import { resolveAlignment, snapPatternOffset } from './alignment';
import { canonicalOffset } from './math';
import { cellKey, parseCellKey, rebaseOverrides, shiftOverrides } from './overrides';
import { align, AZURE, catalog, FLOOR, IVORY, plainWall, presetWall, run, wall } from './testkit';
import type { Layout, Point, Surface } from './types';

const snap = (surface: Surface, layout: Layout, raw: Point, magnetMm = 20) =>
  snapPatternOffset(surface, layout, catalog, raw, magnetMm);

describe('canonicalOffset', () => {
  it('maps any offset into (-period, 0]', () => {
    expect(canonicalOffset(0, 300)).toBe(0);
    expect(canonicalOffset(300, 300)).toBe(0);
    expect(canonicalOffset(1225, 300)).toBe(-275);
    expect(canonicalOffset(-275, 300)).toBe(-275);
    expect(canonicalOffset(-300, 300)).toBe(0);
    expect(canonicalOffset(-301, 300)).toBe(-1);
    expect(canonicalOffset(299.9999999, 300)).toBe(0);
  });
});

describe('resolveAlignment', () => {
  it('repeats wall columns over every band’s unit width', () => {
    const resolved = resolveAlignment(wall(2450, 2700), presetWall(AZURE, 'highlighter-band'), align('centre-motif'), catalog);
    expect(resolved.period).toEqual({ x: 600, y: 300 });
    expect(resolved.origin.x).toBe(-275);
    expect(resolved.motifBandIndex).toBe(2);
  });

  it('uses custom offsets as given horizontally', () => {
    expect(resolveAlignment(wall(2400, 2700), plainWall(IVORY, 'ivory-light-plain'), align(1234), catalog).origin.x).toBe(1234);
  });
});

describe('snapPatternOffset', () => {
  const surface = wall(2450, 2700);
  const light = plainWall(IVORY, 'ivory-light-plain');

  it('jumps to a magnet when close', () => {
    expect(snap(surface, light, { x: -130, y: 0 })).toMatchObject({
      alignment: { x: { mode: 'centre-tile' } },
      origin: { x: -125 },
      magnet: { x: 'centre-tile' },
    });
    expect(snap(surface, light, { x: -268, y: 0 }).alignment.x).toEqual({ mode: 'centre-joint' });
    expect(snap(surface, light, { x: 12, y: 0 }).alignment.x).toEqual({ mode: 'left' });
  });

  it('otherwise moves in half-tile steps', () => {
    expect(snap(surface, light, { x: -200, y: 0 })).toMatchObject({
      alignment: { x: { mode: 'custom', offsetMm: -150 } },
      magnet: { x: null },
    });
    expect(snap(surface, light, { x: 440, y: 0 }).alignment.x).toEqual({ mode: 'custom', offsetMm: 450 });
  });

  it('names a step that lands on a named alignment', () => {
    // 600 mm right is two whole tiles: still flush left.
    expect(snap(surface, light, { x: 610, y: 0 }, 5).alignment.x).toEqual({ mode: 'left' });
  });

  it('finds magnets a whole repeat away, and overrides can be rebased onto the named origin', () => {
    const result = snap(surface, light, { x: 172, y: 0 });
    expect(result.alignment.x).toEqual({ mode: 'centre-tile' });
    expect(result.origin.x).toBe(175);
    const named = resolveAlignment(surface, light, result.alignment, catalog).origin;
    expect(named.x).toBe(-125);
    // The same tiles are one column further from the named origin.
    expect(rebaseOverrides({ '0,0': { rotation: 180 } }, result.origin, named, { w: 300, h: 450 })).toEqual({
      '1,0': { rotation: 180 },
    });
  });

  it('centres the medallion motif or a tile on the 2450 wall', () => {
    const layout = presetWall(AZURE, 'highlighter-band');
    expect(snap(surface, layout, { x: -270, y: 0 }).alignment.x).toEqual({ mode: 'centre-motif' });
    expect(snap(surface, layout, { x: -120, y: 0 }).alignment.x).toEqual({ mode: 'centre-tile' });
  });

  it('on walls, vertical drag only sets the bottom cut', () => {
    expect(snap(surface, light, { x: 0, y: 80 }).alignment.y).toEqual({ mode: 'bottom' });
    expect(snap(surface, light, { x: 0, y: -230 }).alignment.y).toEqual({ mode: 'custom', offsetMm: -225 });
    expect(snap(surface, light, { x: 0, y: -440 }).alignment.y).toEqual({ mode: 'custom', offsetMm: -225 });
    expect(snap(surface, light, { x: 0, y: -900 }).alignment.y).toEqual({ mode: 'custom', offsetMm: -225 });
    // With tiles stopping at 2100 mm, a full tile at the top needs a 300 mm bottom row.
    expect(snap(wall(2450, 2700, 2100), light, { x: 0, y: -160 })).toMatchObject({
      alignment: { y: { mode: 'top' } },
      origin: { y: -150 },
    });
  });

  it('snaps both axes on floors', () => {
    const floor: Layout = { surface: 'floor', seriesId: FLOOR, designId: 'floor-checker' };
    const result = snap({ widthMm: 1800, heightMm: 2450 }, floor, { x: -440, y: -130 });
    expect(result.alignment).toEqual({ x: { mode: 'centre-tile' }, y: { mode: 'centre-tile' } });
  });
});

describe('override keys', () => {
  it('round-trip and shift', () => {
    expect(parseCellKey(cellKey(-3, 12))).toEqual({ col: -3, row: 12 });
    expect(parseCellKey('nope')).toBeNull();
    expect(shiftOverrides({ '0,0': { rotation: 90 }, '2,1': { tileId: 'x' } }, 1, -1)).toEqual({
      '1,-1': { rotation: 90 },
      '3,0': { tileId: 'x' },
    });
  });

  it('keep an override on its tile when a named origin replaces the dragged one', () => {
    const surface = wall(2450, 2700);
    const layout = plainWall(IVORY, 'ivory-light-plain');
    const dragged = run(surface, layout, align(175), { '2,0': { tileId: 'ivory-dark' } });
    const named = run(surface, layout, align('centre-tile'), rebaseOverrides({ '2,0': { tileId: 'ivory-dark' } }, { x: 175, y: 0 }, { x: -125, y: 0 }, { w: 300, h: 450 }));
    const darkX = (pieces: typeof dragged.pieces) => pieces.find((p) => p.tileId === 'ivory-dark')?.rect.x;
    expect(darkX(named.pieces)).toBe(darkX(dragged.pieces));
  });
});
