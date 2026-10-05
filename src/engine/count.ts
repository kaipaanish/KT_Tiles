import type { Catalog } from './catalog';
import { clean } from './math';
import type { PlacedPiece, TileRole } from './types';

export const SQ_FT_PER_M2 = 10.7639;
export const DEFAULT_ALLOWANCE_PCT = 5;

export interface TileCount {
  tileId: string;
  name: string;
  role: TileRole;
  full: number;
  cut: number;
  pieces: number;
  tilesNeeded: number;
  tilesPerBox: number;
  boxes: number;
  /** Area these pieces cover on the surface. */
  areaM2: number;
  areaSqFt: number;
}

export interface CountResult {
  allowancePct: number;
  tiles: TileCount[];
  totals: Omit<TileCount, 'tileId' | 'name' | 'role' | 'tilesPerBox'>;
}

/** Tiles to buy for a number of pieces: ceil(pieces × (1 + allowance)). */
export function tilesNeededFor(pieces: number, allowancePct: number): number {
  // clean() first, so 40 pieces at 5% is 42 tiles and not 43 (40 × 1.05 = 42.000000000000007).
  return Math.ceil(clean(pieces * (1 + Math.max(0, allowancePct) / 100)));
}

/**
 * Counts pieces per tile. Each cut piece uses one full tile (offcuts aren't reused),
 * which is conservative.
 */
export function countTiles(pieces: readonly PlacedPiece[], allowancePct: number, catalog: Catalog): CountResult {
  const tally = new Map<string, { full: number; cut: number; areaMm2: number }>();
  for (const piece of pieces) {
    const entry = tally.get(piece.tileId) ?? { full: 0, cut: 0, areaMm2: 0 };
    if (piece.isCut) entry.cut++;
    else entry.full++;
    entry.areaMm2 += piece.visibleRect.w * piece.visibleRect.h;
    tally.set(piece.tileId, entry);
  }

  const tiles: TileCount[] = [...tally.entries()].map(([tileId, entry]) => {
    const tile = catalog.tile(tileId);
    const count = entry.full + entry.cut;
    const tilesNeeded = tilesNeededFor(count, allowancePct);
    const areaM2 = clean(entry.areaMm2 / 1e6);
    return {
      tileId,
      name: tile.name,
      role: tile.role,
      full: entry.full,
      cut: entry.cut,
      pieces: count,
      tilesNeeded,
      tilesPerBox: tile.tilesPerBox,
      boxes: Math.ceil(tilesNeeded / tile.tilesPerBox),
      areaM2,
      areaSqFt: clean(areaM2 * SQ_FT_PER_M2),
    };
  });
  const order = (id: string) => {
    const tile = catalog.tile(id);
    return catalog.series(tile.seriesId).tileIds.indexOf(id);
  };
  tiles.sort((a, b) => order(a.tileId) - order(b.tileId));

  const sum = (pick: (t: TileCount) => number) => tiles.reduce((total, t) => total + pick(t), 0);
  const areaM2 = clean(sum((t) => t.areaM2));
  return {
    allowancePct,
    tiles,
    totals: {
      full: sum((t) => t.full),
      cut: sum((t) => t.cut),
      pieces: sum((t) => t.pieces),
      tilesNeeded: sum((t) => t.tilesNeeded),
      boxes: sum((t) => t.boxes),
      areaM2,
      areaSqFt: clean(areaM2 * SQ_FT_PER_M2),
    },
  };
}
