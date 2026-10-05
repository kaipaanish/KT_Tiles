// Shared helpers for the engine tests. They use the demo series shipped in series.json.
import { catalog } from '../designs/catalog';
import { layoutSurface } from './layout';
import { resolvePreset } from './presets';
import type { Alignment, Band, Layout, LayoutResult, Overrides, PlacedPiece, Surface, XMode, YMode } from './types';

export { catalog };

export const IVORY = 'demo-ivory-bloom';
export const AZURE = 'demo-azure-medallion';
export const FLOOR = 'demo-floor';

export function wall(widthMm: number, heightMm: number, tiledHeightMm?: number): Surface {
  return tiledHeightMm === undefined ? { widthMm, heightMm } : { widthMm, heightMm, tiledHeightMm };
}

export function wallOf(seriesId: string, bands: Band[]): Layout {
  return { surface: 'wall', seriesId, bands };
}

/** A wall covered in one design. */
export function plainWall(seriesId: string, designId: string): Layout {
  return wallOf(seriesId, [{ designId, rows: 'fill' }]);
}

export function presetWall(seriesId: string, presetId: string): Layout {
  const preset = catalog.presets.find((p) => p.id === presetId);
  if (!preset) throw new Error(`No preset "${presetId}"`);
  const bands = resolvePreset(preset, seriesId, catalog);
  if (!bands) throw new Error(`Preset "${presetId}" doesn't fit ${seriesId}`);
  return wallOf(seriesId, bands);
}

/** Named modes, or a number for a custom offset in mm. */
export function align(x: XMode | number, y: YMode | number = 'bottom'): Alignment {
  return {
    x: typeof x === 'number' ? { mode: 'custom', offsetMm: x } : { mode: x },
    y: typeof y === 'number' ? { mode: 'custom', offsetMm: y } : { mode: y },
  };
}

export function run(surface: Surface, layout: Layout, alignment: Alignment, overrides: Overrides = {}): LayoutResult {
  return layoutSurface(surface, layout, alignment, overrides, catalog);
}

/** Pieces grouped by grid row, bottom row first. */
export function rowsOf(result: LayoutResult): PlacedPiece[][] {
  const byRow = new Map<number, PlacedPiece[]>();
  for (const piece of result.pieces) byRow.set(piece.cell.row, [...(byRow.get(piece.cell.row) ?? []), piece]);
  return [...byRow.entries()].sort(([a], [b]) => a - b).map(([, pieces]) => pieces);
}

export const fullPieces = (pieces: readonly PlacedPiece[]) => pieces.filter((p) => !p.isCut).length;
export const cutWidths = (pieces: readonly PlacedPiece[]) => pieces.filter((p) => p.isCut).map((p) => p.cutWidthMm);

export function pieceAt(result: LayoutResult, x: number, y: number): PlacedPiece | undefined {
  return result.pieces.find((p) => x > p.rect.x && x < p.rect.x + p.rect.w && y > p.rect.y && y < p.rect.y + p.rect.h);
}
