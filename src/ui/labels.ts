import { formatMm, type BandExtent, type Catalog } from '../engine';

/** "Highlighter pair: 1350–2250 mm", the way salespeople talk about band placement. */
export function bandRangeLabel(extent: BandExtent, catalog: Catalog): string {
  const name = catalog.design(extent.designId).name;
  if (extent.hidden) return `${name}: above the tiled height`;
  return `${name}: ${formatMm(extent.fromMm)}–${formatMm(extent.toMm)} mm${extent.clipped ? ' (cut)' : ''}`;
}

export function rowsLabel(rows: number): string {
  return `${rows} row${rows === 1 ? '' : 's'}`;
}
