import { planBands, type BandPlan } from './bands';
import type { Catalog } from './catalog';
import { canonicalOffset, clamp, clean, EPS, lcm, mod } from './math';
import type {
  Alignment,
  AxisAlignment,
  AxisMode,
  Design,
  Layout,
  LayoutWarning,
  Point,
  Surface,
  SurfaceType,
  XMode,
  YMode,
} from './types';

/** One axis of the grid, as alignment sees it. */
interface AxisFrame {
  /** Length to align within: the surface width, or the tiled height. */
  length: number;
  tile: number;
  /** Shifting the pattern by this much looks identical. */
  period: number;
  /** Motif centre within its repeat unit, when the layout has a motif. */
  motif: number | null;
  /** Length of that repeat unit along this axis: the distance between neighbouring motifs. */
  unit: number | null;
}

const MOTIF_MODES: readonly AxisMode[] = ['centre-motif', 'centre-between-motifs'];

export interface ResolvedAlignment {
  /** Bottom-left corner of grid cell (0, 0). */
  origin: Point;
  tile: { w: number; h: number };
  period: { x: number; y: number };
  effective: { x: XMode | 'custom'; y: YMode | 'custom' };
  /** Walls only. */
  bandPlan: BandPlan | null;
  /** The band whose motif centre-motif lines up (always 0 on a floor with a motif). */
  motifBandIndex: number | null;
  warnings: LayoutWarning[];
}

export function tiledHeightOf(surface: Surface, type: SurfaceType): number {
  const height = Math.max(0, surface.heightMm);
  if (type === 'floor' || surface.tiledHeightMm === undefined) return height;
  return clamp(surface.tiledHeightMm, 0, height);
}

/** Where a named mode puts the grid origin, in (-period, 0]. */
function namedOrigin(mode: AxisMode, frame: AxisFrame): number {
  switch (mode) {
    case 'left':
    case 'bottom':
      return 0;
    case 'right':
    case 'top':
      return canonicalOffset(frame.length, frame.period);
    case 'centre-joint':
      return canonicalOffset(frame.length / 2, frame.period);
    case 'centre-tile':
      return canonicalOffset(frame.length / 2 - frame.tile / 2, frame.period);
    case 'centre-motif':
      return canonicalOffset(frame.length / 2 - (frame.motif ?? frame.tile / 2), frame.period);
    case 'centre-between-motifs':
      // Neighbouring motifs are one unit apart, so the midpoint is half a unit past a motif.
      return canonicalOffset(frame.length / 2 - (frame.motif ?? 0) - (frame.unit ?? frame.tile) / 2, frame.period);
  }
}

function resolveAxis(
  align: AxisAlignment<AxisMode>,
  frame: AxisFrame,
  warnings: LayoutWarning[],
): { origin: number; mode: AxisMode | 'custom' } {
  if (align.mode === 'custom') return { origin: align.offsetMm, mode: 'custom' };
  if (align.mode === 'centre-motif' && frame.motif === null) {
    warnings.push({ code: 'alignment-fallback', message: 'This layout has no motif, so a tile is centred instead.' });
    return { origin: namedOrigin('centre-tile', frame), mode: 'centre-tile' };
  }
  if (align.mode === 'centre-between-motifs' && frame.motif === null) {
    warnings.push({ code: 'alignment-fallback', message: 'This layout has no motif, so the centreline sits on a joint instead.' });
    return { origin: namedOrigin('centre-joint', frame), mode: 'centre-joint' };
  }
  return { origin: namedOrigin(align.mode, frame), mode: align.mode };
}

function floorFrames(width: number, length: number, w: number, h: number, design: Design): { x: AxisFrame; y: AxisFrame } {
  const motif = design.motifCentre;
  return {
    x: { length: width, tile: w, period: w * design.cols, motif: motif?.x ?? null, unit: motif ? w * design.cols : null },
    y: { length, tile: h, period: h * design.rows, motif: motif?.y ?? null, unit: motif ? h * design.rows : null },
  };
}

/** Wall bands hang from the bottom row, so the vertical offset only sets the bottom cut. */
function wallYFrame(tiledHeight: number, h: number): AxisFrame {
  return { length: tiledHeight, tile: h, period: h, motif: null, unit: null };
}

/**
 * The horizontal frame for a wall. All bands share one column grid; the repeat covers every
 * band's unit width. Centre-motif uses the lowest visible band that has a motif.
 */
function wallXFrame(
  width: number,
  w: number,
  h: number,
  tiledHeight: number,
  plan: BandPlan,
  originY: number,
): { frame: AxisFrame; motifBandIndex: number | null } {
  const unitCols = plan.bands.reduce((acc, band) => lcm(acc, band.design.cols), 1);
  const withMotif = plan.bands.filter((band) => band.design.motifCentre !== undefined && band.rowCount > 0);
  const motifBand = withMotif.find((band) => originY + band.rowStart * h < tiledHeight - EPS) ?? withMotif[0];
  return {
    frame: {
      length: width,
      tile: w,
      period: w * unitCols,
      motif: motifBand?.design.motifCentre?.x ?? null,
      unit: motifBand ? w * motifBand.design.cols : null,
    },
    motifBandIndex: motifBand?.index ?? null,
  };
}

/**
 * Turns an alignment into a grid origin. Named modes give an origin in (-period, 0];
 * custom offsets are used as given, except that a wall's vertical offset wraps within one tile.
 */
export function resolveAlignment(surface: Surface, layout: Layout, alignment: Alignment, catalog: Catalog): ResolvedAlignment {
  const { w, h } = catalog.tileSize(layout.seriesId);
  const width = Math.max(0, surface.widthMm);
  const tiledHeight = tiledHeightOf(surface, layout.surface);
  const warnings: LayoutWarning[] = [];

  if (layout.surface === 'floor') {
    const design = catalog.design(layout.designId);
    const frames = floorFrames(width, tiledHeight, w, h, design);
    const x = resolveAxis(alignment.x, frames.x, warnings);
    const y = resolveAxis(alignment.y, frames.y, warnings);
    return {
      origin: { x: clean(x.origin), y: clean(y.origin) },
      tile: { w, h },
      period: { x: frames.x.period, y: frames.y.period },
      effective: { x: x.mode as XMode | 'custom', y: y.mode as YMode | 'custom' },
      bandPlan: null,
      motifBandIndex: design.motifCentre ? 0 : null,
      warnings,
    };
  }

  let yAlign = alignment.y;
  if (MOTIF_MODES.includes(yAlign.mode as AxisMode)) {
    warnings.push({ code: 'alignment-fallback', message: "A wall motif can't be centred vertically, so the bottom row starts at the floor." });
    yAlign = { mode: 'bottom' };
  }
  const y = resolveAxis(yAlign, wallYFrame(tiledHeight, h), warnings);
  const originY = canonicalOffset(y.origin, h);
  const bandPlan = planBands(layout.bands, catalog, originY, h, tiledHeight);
  const { frame, motifBandIndex } = wallXFrame(width, w, h, tiledHeight, bandPlan, originY);
  const x = resolveAxis(alignment.x, frame, warnings);
  return {
    origin: { x: clean(x.origin), y: originY },
    tile: { w, h },
    period: { x: frame.period, y: h },
    effective: { x: x.mode as XMode | 'custom', y: y.mode as YMode | 'custom' },
    bandPlan,
    motifBandIndex,
    warnings,
  };
}

export interface SnapResult {
  alignment: Alignment;
  /**
   * Where the grid origin sits for this drag. A named mode's own origin can differ by whole
   * repeats (same tiles, different cell numbers); use rebaseOverrides() to keep overrides in place.
   */
  origin: Point;
  /** The magnet each axis jumped to, if any. */
  magnet: { x: XMode | null; y: YMode | null };
}

interface AxisSnap<M extends AxisMode> {
  value: number;
  mode: M | 'custom';
  magnet: boolean;
}

// On a tie the earlier magnet names the result, so motif-aware names come first.
const X_MAGNETS: readonly XMode[] = ['centre-motif', 'centre-between-motifs', 'centre-tile', 'centre-joint', 'left', 'right'];
const FLOOR_Y_MAGNETS: readonly YMode[] = ['centre-motif', 'centre-between-motifs', 'centre-tile', 'centre-joint', 'bottom', 'top'];
const WALL_Y_MAGNETS: readonly YMode[] = ['bottom', 'top'];

/**
 * Snaps a dragged grid origin. Magnets (centred joint, tile or motif; flush edges) win when
 * the origin is within magnetMm of one; otherwise the pattern moves in half-tile steps.
 * On walls the vertical drag only sets the bottom cut, from a full tile to half a tile.
 */
export function snapPatternOffset(surface: Surface, layout: Layout, catalog: Catalog, raw: Point, magnetMm: number): SnapResult {
  const { w, h } = catalog.tileSize(layout.seriesId);
  const width = Math.max(0, surface.widthMm);
  const tiledHeight = tiledHeightOf(surface, layout.surface);
  let x: AxisSnap<XMode>;
  let y: AxisSnap<YMode>;
  if (layout.surface === 'floor') {
    const frames = floorFrames(width, tiledHeight, w, h, catalog.design(layout.designId));
    x = snapAxis(raw.x, X_MAGNETS, frames.x, magnetMm);
    y = snapAxis(raw.y, FLOOR_Y_MAGNETS, frames.y, magnetMm);
  } else {
    y = snapWallY(raw.y, wallYFrame(tiledHeight, h), magnetMm);
    const plan = planBands(layout.bands, catalog, y.value, h, tiledHeight);
    x = snapAxis(raw.x, X_MAGNETS, wallXFrame(width, w, h, tiledHeight, plan, y.value).frame, magnetMm);
  }
  return {
    alignment: { x: toAxisAlignment(x), y: toAxisAlignment(y) },
    origin: { x: x.value, y: y.value },
    magnet: { x: magnetOf(x), y: magnetOf(y) },
  };
}

function snapAxis<M extends AxisMode>(raw: number, modes: readonly M[], frame: AxisFrame, magnetMm: number): AxisSnap<M> {
  const targets = modes
    .filter((mode) => !MOTIF_MODES.includes(mode) || frame.motif !== null)
    .map((mode) => ({ mode, origin: namedOrigin(mode, frame) }));
  let best: { mode: M; value: number; distance: number } | undefined;
  for (const target of targets) {
    const value = target.origin + frame.period * Math.round((raw - target.origin) / frame.period);
    const distance = Math.abs(raw - value);
    if (distance <= magnetMm && (best === undefined || distance < best.distance - EPS)) best = { mode: target.mode, value, distance };
  }
  if (best) return { value: clean(best.value), mode: best.mode, magnet: true };
  const step = frame.tile / 2;
  const value = clean(Math.round(raw / step) * step);
  const named = targets.find((target) => isMultipleOf(value - target.origin, frame.period));
  return { value, mode: named ? named.mode : 'custom', magnet: false };
}

function snapWallY(raw: number, frame: AxisFrame, magnetMm: number): AxisSnap<YMode> {
  const clamped = clamp(raw, -frame.tile, 0);
  let best: { mode: YMode; value: number; distance: number } | undefined;
  for (const mode of WALL_Y_MAGNETS) {
    const value = namedOrigin(mode, frame);
    const distance = Math.abs(clamped - value);
    if (distance <= magnetMm && (best === undefined || distance < best.distance - EPS)) best = { mode, value, distance };
  }
  if (best) return { value: best.value, mode: best.mode, magnet: true };
  // A whole tile below the floor isn't a cut, so the steps stop at half a tile.
  const step = frame.tile / 2;
  const value = clean(Math.max(-step, Math.round(clamped / step) * step));
  const mode = value === 0 ? 'bottom' : Math.abs(value - namedOrigin('top', frame)) < EPS ? 'top' : 'custom';
  return { value, mode, magnet: false };
}

function isMultipleOf(v: number, period: number): boolean {
  const r = mod(v, period);
  return r < EPS || period - r < EPS;
}

function toAxisAlignment<M extends AxisMode>(snap: AxisSnap<M>): AxisAlignment<M> {
  return snap.mode === 'custom' ? { mode: 'custom', offsetMm: snap.value } : { mode: snap.mode };
}

function magnetOf<M extends AxisMode>(snap: AxisSnap<M>): M | null {
  return snap.magnet && snap.mode !== 'custom' ? snap.mode : null;
}
