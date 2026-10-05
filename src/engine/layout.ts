import { resolveAlignment, tiledHeightOf } from './alignment';
import type { Catalog } from './catalog';
import { clamp, clean, EPS, formatMm, mod } from './math';
import { cellKey } from './overrides';
import { isRotationAllowed } from './rotation';
import { assertValidLayout } from './validate';
import type {
  Alignment,
  BandExtent,
  Design,
  Edge,
  EdgeCuts,
  Guide,
  Layout,
  LayoutOptions,
  LayoutResult,
  LayoutWarning,
  Overrides,
  PlacedPiece,
  Point,
  Rect,
  Surface,
  UnitOutline,
} from './types';

export const DEFAULT_MIN_CUT_FRACTION = 1 / 3;

const EDGES: readonly Edge[] = ['left', 'right', 'bottom', 'top'];
const EDGE_AXIS: Record<Edge, 'x' | 'y'> = { left: 'x', right: 'x', bottom: 'y', top: 'y' };

/** The design a grid row uses, and the row where its repeat units start. */
interface RowSource {
  bandIndex: number;
  design: Design;
  rowStart: number;
}

/**
 * Lays tiles on a surface. Returns a flat list of placed pieces plus guides, motif centres,
 * repeat-unit outlines, edge cuts, band extents and warnings. Renderers only draw this.
 *
 * Throws a LayoutError when the layout itself is invalid (unknown ids, wrong surface, or
 * band rows that aren't a multiple of the design's rows).
 */
export function layoutSurface(
  surface: Surface,
  layout: Layout,
  alignment: Alignment,
  overrides: Overrides,
  catalog: Catalog,
  options: LayoutOptions = {},
): LayoutResult {
  assertValidLayout(layout, catalog);
  const fraction = options.minCutFraction ?? DEFAULT_MIN_CUT_FRACTION;
  const resolved = resolveAlignment(surface, layout, alignment, catalog);
  const { w, h } = resolved.tile;
  const width = Math.max(0, surface.widthMm);
  const height = Math.max(0, surface.heightMm);
  const tiledHeight = tiledHeightOf(surface, layout.surface);
  const area: Rect = { x: 0, y: 0, w: width, h: tiledHeight };
  const { x: x0, y: y0 } = resolved.origin;
  const warnings: LayoutWarning[] = [...resolved.warnings];
  const minCutMm = { x: clean(w * fraction), y: clean(h * fraction) };

  // Which rows exist, and which design each one shows.
  const colMin = Math.floor(-x0 / w + 1e-9);
  const colMax = Math.ceil((width - x0) / w - 1e-9) - 1;
  let rowMin: number;
  let rowMax: number;
  let sourceAt: (row: number) => RowSource | undefined;
  const plan = resolved.bandPlan;
  if (layout.surface === 'floor') {
    const source: RowSource = { bandIndex: 0, design: catalog.design(layout.designId), rowStart: 0 };
    rowMin = Math.floor(-y0 / h + 1e-9);
    rowMax = Math.ceil((tiledHeight - y0) / h - 1e-9) - 1;
    sourceAt = () => source;
  } else {
    if (!plan) throw new Error('A wall layout needs a band plan');
    rowMin = 0;
    rowMax = Math.min(plan.rowsToTop, plan.stackRows) - 1;
    sourceAt = (row) => {
      const band = plan.bands.find((b) => row >= b.rowStart && row < b.rowStart + b.rowCount);
      return band && { bandIndex: band.index, design: band.design, rowStart: band.rowStart };
    };
  }

  const pieces: PlacedPiece[] = [];
  let ignoredOverrides = 0;
  for (let row = rowMin; row <= rowMax; row++) {
    const source = sourceAt(row);
    if (!source) continue;
    const { design } = source;
    const unitRow = mod(row - source.rowStart, design.rows);
    const y = y0 + row * h;
    const bottom = Math.max(y, 0);
    const visibleH = clean(Math.min(y + h, tiledHeight) - bottom);
    if (visibleH <= EPS) continue;

    for (let col = colMin; col <= colMax; col++) {
      const x = x0 + col * w;
      const left = Math.max(x, 0);
      const visibleW = clean(Math.min(x + w, width) - left);
      if (visibleW <= EPS) continue;
      const unitCol = mod(col, design.cols);
      const slot = design.slots[unitRow * design.cols + unitCol];
      if (!slot) continue;

      let tileId = slot.tileId;
      let rotation = slot.rotation;
      let overridden = false;
      const override = overrides[cellKey(col, row)];
      if (override?.tileId !== undefined) {
        if (catalog.hasTile(override.tileId) && catalog.tile(override.tileId).seriesId === layout.seriesId) {
          tileId = override.tileId;
          overridden = true;
        } else {
          ignoredOverrides++;
        }
      }
      if (override?.rotation !== undefined) {
        if (isRotationAllowed(catalog.tile(tileId), override.rotation)) {
          rotation = override.rotation;
          overridden = true;
        } else {
          ignoredOverrides++;
        }
      }

      pieces.push({
        tileId,
        rotation,
        cell: { col, row },
        rect: { x: clean(x), y: clean(y), w, h },
        visibleRect: { x: clean(left), y: clean(bottom), w: visibleW, h: visibleH },
        isCut: visibleW < w - EPS || visibleH < h - EPS,
        cutWidthMm: visibleW,
        cutHeightMm: visibleH,
        bandIndex: source.bandIndex,
        designId: design.id,
        unitCell: { col: unitCol, row: unitRow },
        overridden,
      });
    }
  }
  if (ignoredOverrides > 0) {
    warnings.push({
      code: 'invalid-override',
      message: `${ignoredOverrides} tile change${ignoredOverrides === 1 ? " doesn't" : "s don't"} fit this series and ${ignoredOverrides === 1 ? 'was' : 'were'} ignored`,
    });
  }

  const edgeCuts = findEdgeCuts(pieces, w, h);
  for (const edge of EDGES) {
    const size = edgeCuts[edge];
    if (size !== null && size < minCutMm[EDGE_AXIS[edge]] - EPS) {
      warnings.push({ code: 'sliver', edge, sizeMm: size, message: `${formatMm(size)} mm sliver at ${edge} edge` });
    }
  }

  const unitOutlines: UnitOutline[] = [];
  const motifCentres: Point[] = [];
  const bands: BandExtent[] = [];
  const addUnits = (design: Design, bandIndex: number, unitRows: Iterable<number>, rowStart: number, topLimit: number): void => {
    const unitW = design.cols * w;
    const unitH = design.rows * h;
    for (let u = Math.floor(colMin / design.cols); u <= Math.floor(colMax / design.cols); u++) {
      for (const v of unitRows) {
        const rect = { x: clean(x0 + u * unitW), y: clean(y0 + (rowStart + v * design.rows) * h), w: unitW, h: unitH };
        if (!overlaps(rect, area)) continue;
        unitOutlines.push({ rect, bandIndex, designId: design.id });
        const motif = design.motifCentre;
        if (!motif) continue;
        const centre = { x: clean(rect.x + motif.x), y: clean(rect.y + motif.y) };
        if (centre.x >= -EPS && centre.x <= width + EPS && centre.y >= -EPS && centre.y <= topLimit + EPS) motifCentres.push(centre);
      }
    }
  };

  if (layout.surface === 'floor') {
    const design = catalog.design(layout.designId);
    addUnits(design, 0, range(Math.floor(rowMin / design.rows), Math.floor(rowMax / design.rows)), 0, tiledHeight);
  } else if (plan) {
    for (const band of plan.bands) {
      const bottom = y0 + band.rowStart * h;
      const top = y0 + (band.rowStart + band.rowCount) * h;
      const hidden = band.rowCount === 0 || bottom >= tiledHeight - EPS;
      const clipped = !hidden && !band.fill && top > tiledHeight + EPS;
      bands.push({
        index: band.index,
        designId: band.design.id,
        fill: band.fill,
        rowStart: band.rowStart,
        rowCount: band.rowCount,
        visibleRows: hidden ? 0 : Math.min(band.rowCount, plan.rowsToTop - band.rowStart),
        fromMm: clean(clamp(bottom, 0, tiledHeight)),
        toMm: clean(clamp(top, 0, tiledHeight)),
        clipped,
        hidden,
      });
      const label = `Band ${band.index + 1} (${band.design.name})`;
      if (hidden) {
        warnings.push({
          code: 'band-hidden',
          bandIndex: band.index,
          message: band.fill ? `${label} has no room left below the tiled height` : `${label} is above the tiled height, so it isn't shown`,
        });
        continue;
      }
      if (clipped) {
        warnings.push({ code: 'band-clipped', bandIndex: band.index, message: `${label} is cut off at the tiled height (${formatMm(tiledHeight)} mm)` });
      }
      const units = Math.ceil(band.rowCount / band.design.rows);
      addUnits(band.design, band.index, range(0, units - 1), band.rowStart, Math.min(top, tiledHeight));
    }
    const last = plan.bands[plan.bands.length - 1];
    const stackTop = y0 + plan.stackRows * h;
    if (last && !last.fill && stackTop < tiledHeight - EPS) {
      warnings.push({
        code: 'band-gap',
        message: `Tiles stop at ${formatMm(stackTop)} mm, leaving ${formatMm(tiledHeight - stackTop)} mm untiled below the tiled height`,
      });
    }
  }

  const guides: Guide[] = [
    { orientation: 'vertical', atMm: clean(width / 2), kind: 'centre' },
    { orientation: 'horizontal', atMm: clean(height / 2), kind: 'centre' },
  ];
  if (layout.surface === 'wall' && tiledHeight < height - EPS) {
    guides.push({ orientation: 'horizontal', atMm: tiledHeight, kind: 'tiled-height' });
  }

  return {
    surfaceType: layout.surface,
    widthMm: width,
    heightMm: height,
    tiledHeightMm: tiledHeight,
    tile: { w, h },
    origin: resolved.origin,
    period: resolved.period,
    alignment: resolved.effective,
    grid: { colMin, colMax, rowMin, rowMax },
    pieces,
    motifCentres,
    unitOutlines,
    guides,
    edgeCuts,
    minCutMm,
    bands,
    warnings,
  };
}

/** Size of the cut piece at each edge, taken from the outermost columns and rows. */
function findEdgeCuts(pieces: readonly PlacedPiece[], w: number, h: number): EdgeCuts {
  const first = pieces[0];
  if (!first) return { left: null, right: null, bottom: null, top: null };
  let left = first;
  let right = first;
  let bottom = first;
  let top = first;
  for (const piece of pieces) {
    if (piece.cell.col < left.cell.col) left = piece;
    if (piece.cell.col > right.cell.col) right = piece;
    if (piece.cell.row < bottom.cell.row) bottom = piece;
    if (piece.cell.row > top.cell.row) top = piece;
  }
  const cut = (size: number, full: number): number | null => (size < full - EPS ? size : null);
  return {
    left: cut(left.cutWidthMm, w),
    right: cut(right.cutWidthMm, w),
    bottom: cut(bottom.cutHeightMm, h),
    top: cut(top.cutHeightMm, h),
  };
}

function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w - EPS && a.x + a.w > b.x + EPS && a.y < b.y + b.h - EPS && a.y + a.h > b.y + EPS;
}

function range(from: number, to: number): number[] {
  const values: number[] = [];
  for (let i = from; i <= to; i++) values.push(i);
  return values;
}
