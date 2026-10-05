import type { Catalog } from './catalog';
import type { Band, Design } from './types';

export interface PlannedBand {
  index: number;
  design: Design;
  fill: boolean;
  /** First grid row of the band; row 0 is the bottom row. */
  rowStart: number;
  rowCount: number;
}

export interface BandPlan {
  bands: PlannedBand[];
  /** Rows needed to reach the tiled height from the bottom row. */
  rowsToTop: number;
  /** Rows the bands take up altogether. */
  stackRows: number;
}

/** Stacks wall bands from the bottom row up. A fill band takes whatever rows are left. */
export function planBands(
  bands: readonly Band[],
  catalog: Catalog,
  originY: number,
  tileH: number,
  tiledHeight: number,
): BandPlan {
  const rowsToTop = Math.max(0, Math.ceil((tiledHeight - originY) / tileH - 1e-9));
  let next = 0;
  const planned = bands.map((band, index): PlannedBand => {
    const rowCount = band.rows === 'fill' ? Math.max(0, rowsToTop - next) : band.rows;
    const plannedBand = { index, design: catalog.design(band.designId), fill: band.rows === 'fill', rowStart: next, rowCount };
    next += rowCount;
    return plannedBand;
  });
  return { bands: planned, rowsToTop, stackRows: next };
}
