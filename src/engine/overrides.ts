import type { CellOverride, Overrides, Point } from './types';

export function cellKey(col: number, row: number): string {
  return `${col},${row}`;
}

export function parseCellKey(key: string): { col: number; row: number } | null {
  const match = /^(-?\d+),(-?\d+)$/.exec(key);
  return match ? { col: Number(match[1]), row: Number(match[2]) } : null;
}

/** Moves every override by whole cells. */
export function shiftOverrides(overrides: Overrides, dCol: number, dRow: number): Overrides {
  if (dCol === 0 && dRow === 0) return overrides;
  const shifted: Record<string, CellOverride> = {};
  for (const [key, value] of Object.entries(overrides)) {
    const cell = parseCellKey(key);
    if (cell) shifted[cellKey(cell.col + dCol, cell.row + dRow)] = value;
  }
  return shifted;
}

/**
 * Keeps overrides on the same tiles when the grid origin moves from `from` to `to`
 * without the tiles moving (the two origins are whole repeats apart). Cells are counted
 * from the origin, so their keys change instead.
 */
export function rebaseOverrides(overrides: Overrides, from: Point, to: Point, tile: { w: number; h: number }): Overrides {
  return shiftOverrides(overrides, Math.round((from.x - to.x) / tile.w), Math.round((from.y - to.y) / tile.h));
}
