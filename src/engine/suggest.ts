import type { Catalog } from './catalog';
import { DEFAULT_MIN_CUT_FRACTION, layoutSurface } from './layout';
import { EPS, formatMm, mod } from './math';
import type { Alignment, AxisAlignment, Design, EdgeCuts, Layout, LayoutResult, Point, Surface, XMode, YMode } from './types';

/**
 * avoid-slivers: no slivers → symmetric → fewest cut motifs → fewest cut tiles → largest smallest cut.
 * symmetric: symmetric first, then the same order.
 */
export type SuggestPriority = 'avoid-slivers' | 'symmetric';

export interface SuggestOptions {
  priority?: SuggestPriority;
  minCutFraction?: number;
  /** Walls keep this vertical alignment while horizontal options are compared. Default: bottom. */
  current?: Alignment;
}

export interface AlignmentSuggestion {
  alignment: Alignment;
  label: string;
  /** Other named alignments that give exactly the same grid. */
  sameAs: string[];
  /** Smallest cut along the compared axes; null when nothing is cut. */
  smallestCutMm: number | null;
  hasSliver: boolean;
  /**
   * Mirror-symmetric about the centreline: a motif centre on it, or it exactly midway between
   * two neighbouring motif centres. For plain designs, the tile grid is symmetric.
   */
  symmetric: boolean;
  /** Motif repeat units crossing a surface edge; null when the layout has no motif. */
  cutMotifs: number | null;
  /** Motif repeat units entirely on the surface; null when the layout has no motif. */
  wholeMotifs: number | null;
  /** Pieces that need cutting. */
  cutTiles: number;
  /** A motif centre lies on the centreline (null with no motif). For information; ranking uses symmetric. */
  motifCentred: boolean | null;
  /** Distance from the nearest motif centre to the centre; null with no visible motif. */
  motifOffsetMm: number | null;
  edgeCuts: EdgeCuts;
  explanation: string;
}

const MOTIF_MODES: ReadonlySet<string> = new Set(['centre-motif', 'centre-between-motifs']);
// When two alignments give the same grid, the earlier one names the suggestion.
const X_ORDER: readonly XMode[] = ['centre-motif', 'centre-between-motifs', 'centre-tile', 'centre-joint', 'left', 'right'];
const Y_ORDER: readonly YMode[] = ['centre-motif', 'centre-between-motifs', 'centre-tile', 'centre-joint', 'bottom', 'top'];
const MODE_NAMES: Record<XMode | YMode, string> = {
  'centre-motif': 'Centre motif',
  'centre-between-motifs': 'Between motifs',
  'centre-tile': 'Centre tile',
  'centre-joint': 'Centre joint',
  left: 'Left',
  right: 'Right',
  bottom: 'Bottom',
  top: 'Top',
};

/**
 * Ranks the named alignments for a layout. Walls compare horizontal options only, keeping
 * the current vertical alignment; floors compare both axes. Alignments that produce the same
 * grid are merged into one suggestion.
 */
export function suggestAlignments(
  surface: Surface,
  layout: Layout,
  catalog: Catalog,
  options: SuggestOptions = {},
): AlignmentSuggestion[] {
  const priority = options.priority ?? 'avoid-slivers';
  const minCutFraction = options.minCutFraction ?? DEFAULT_MIN_CUT_FRACTION;
  const hasMotif = layoutHasMotif(layout, catalog);
  const xModes = X_ORDER.filter((mode) => hasMotif || !MOTIF_MODES.has(mode));
  const yModes = Y_ORDER.filter((mode) => hasMotif || !MOTIF_MODES.has(mode));

  const candidates: Alignment[] =
    layout.surface === 'wall'
      ? xModes.map((x) => ({ x: { mode: x }, y: options.current?.y ?? { mode: 'bottom' } }))
      : xModes.flatMap((x) => yModes.map((y) => ({ x: { mode: x }, y: { mode: y } })));

  const byGrid = new Map<string, AlignmentSuggestion>();
  for (const alignment of candidates) {
    const result = layoutSurface(surface, layout, alignment, {}, catalog, { minCutFraction });
    const label = labelFor(alignment, layout.surface);
    const key = `${result.origin.x},${result.origin.y}`;
    const existing = byGrid.get(key);
    if (existing) existing.sameAs.push(label);
    else byGrid.set(key, evaluate(alignment, label, result, layout, catalog, hasMotif));
  }
  return [...byGrid.values()].sort(compareBy(priority));
}

function layoutHasMotif(layout: Layout, catalog: Catalog): boolean {
  if (layout.surface === 'floor') return catalog.design(layout.designId).motifCentre !== undefined;
  return layout.bands.some((band) => catalog.design(band.designId).motifCentre !== undefined);
}

function labelFor(alignment: Alignment, surface: Layout['surface']): string {
  const x = axisName(alignment.x);
  if (surface === 'wall') return x;
  const y = axisName(alignment.y);
  return x === y ? `${x} both ways` : `${x} across, ${y.toLowerCase()} along`;
}

function axisName(axis: AxisAlignment<XMode> | AxisAlignment<YMode>): string {
  return axis.mode === 'custom' ? `Offset ${formatMm(axis.offsetMm)} mm` : MODE_NAMES[axis.mode];
}

interface AxisCuts {
  a: number | null;
  b: number | null;
  min: number;
  full: number;
  /** "left edge", "right edge", "at both ends" */
  names: [string, string, string];
  /** Where the grid starts along this axis, the surface length, and the motifs repeating along it. */
  origin: number;
  length: number;
  motifs: { offset: number; unit: number }[];
}

type WithMotif = Design & { motifCentre: Point };
const hasMotifCentre = (design: Design): design is WithMotif => design.motifCentre !== undefined;

/** The motif designs on show: the floor's design, or the visible wall bands' designs. */
function motifDesigns(layout: Layout, result: LayoutResult, catalog: Catalog): WithMotif[] {
  const designs =
    layout.surface === 'floor' ? [catalog.design(layout.designId)] : result.bands.filter((b) => !b.hidden).map((b) => catalog.design(b.designId));
  return [...new Map(designs.filter(hasMotifCentre).map((d) => [d.id, d])).values()];
}

/** On a motif centre, or midway between two: either way a whole number of half-units from a motif. */
function axisSymmetric(axis: AxisCuts): boolean {
  if (axis.motifs.length === 0) return Math.abs((axis.a ?? axis.full) - (axis.b ?? axis.full)) < 0.5;
  return axis.motifs.every(({ offset, unit }) => {
    const d = mod(axis.length / 2 - (axis.origin + offset), unit / 2);
    return d < 0.5 || unit / 2 - d < 0.5;
  });
}

function evaluate(alignment: Alignment, label: string, result: LayoutResult, layout: Layout, catalog: Catalog, hasMotif: boolean): AlignmentSuggestion {
  const { edgeCuts: cuts, minCutMm, tile, origin } = result;
  const designs = motifDesigns(layout, result, catalog);
  const along = (axis: 'x' | 'y') =>
    designs.map((d) => (axis === 'x' ? { offset: d.motifCentre.x, unit: d.cols * tile.w } : { offset: d.motifCentre.y, unit: d.rows * tile.h }));
  const across: AxisCuts = {
    a: cuts.left,
    b: cuts.right,
    min: minCutMm.x,
    full: tile.w,
    names: ['left edge', 'right edge', result.surfaceType === 'wall' ? 'at both ends' : 'at left and right'],
    origin: origin.x,
    length: result.widthMm,
    motifs: along('x'),
  };
  const axes: AxisCuts[] =
    result.surfaceType === 'wall'
      ? [across]
      : [
          across,
          {
            a: cuts.bottom,
            b: cuts.top,
            min: minCutMm.y,
            full: tile.h,
            names: ['bottom edge', 'top edge', 'at top and bottom'],
            origin: origin.y,
            length: result.tiledHeightMm,
            motifs: along('y'),
          },
        ];
  const sizes = axes.flatMap((axis) => [axis.a, axis.b]).filter((size): size is number => size !== null);
  const hasSliver = axes.some((axis) => [axis.a, axis.b].some((size) => size !== null && size < axis.min - EPS));
  const symmetric = axes.every(axisSymmetric);

  // Motif units cut by an edge, against those wholly on the surface.
  let wholeMotifs: number | null = null;
  let cutMotifs: number | null = null;
  if (hasMotif) {
    const ids = new Set(designs.map((d) => d.id));
    wholeMotifs = 0;
    cutMotifs = 0;
    for (const unit of result.unitOutlines) {
      if (!ids.has(unit.designId)) continue;
      const r = unit.rect;
      const inside = r.x >= -EPS && r.y >= -EPS && r.x + r.w <= result.widthMm + EPS && r.y + r.h <= result.tiledHeightMm + EPS;
      if (inside) wholeMotifs++;
      else cutMotifs++;
    }
  }

  let motifCentred: boolean | null = null;
  let motifOffsetMm: number | null = null;
  if (hasMotif) {
    const cx = result.widthMm / 2;
    const cy = result.tiledHeightMm / 2;
    const offsets = result.motifCentres.map((p) => (result.surfaceType === 'wall' ? Math.abs(p.x - cx) : Math.hypot(p.x - cx, p.y - cy)));
    motifOffsetMm = offsets.length > 0 ? Math.min(...offsets) : null;
    motifCentred = motifOffsetMm !== null && motifOffsetMm < 0.5;
  }

  const motifName = designs.length === 1 && designs[0] ? designs[0].name.toLowerCase() : 'motif';
  return {
    alignment,
    label,
    sameAs: [],
    smallestCutMm: sizes.length > 0 ? Math.min(...sizes) : null,
    hasSliver,
    symmetric,
    cutMotifs,
    wholeMotifs,
    cutTiles: result.pieces.filter((p) => p.isCut).length,
    motifCentred,
    motifOffsetMm,
    edgeCuts: cuts,
    explanation:
      wholeMotifs === null || cutMotifs === null
        ? explainPlain(axes, result.surfaceType === 'wall')
        : explainMotifs(axes, { whole: wholeMotifs, cut: cutMotifs, name: motifName }, symmetric),
  };
}

function describeAxis(axis: AxisCuts): { text: string; cut: boolean; sliver: boolean } {
  const { a, b, min, names } = axis;
  const isSliver = (size: number) => size < min - EPS;
  if (a === null && b === null) return { text: '', cut: false, sliver: false };
  if (a !== null && b !== null && Math.abs(a - b) < 0.5) {
    return { text: `${formatMm(a)} mm ${isSliver(a) ? 'slivers' : 'cuts'} ${names[2]}`, cut: true, sliver: isSliver(a) };
  }
  const parts: string[] = [];
  if (a !== null) parts.push(`${formatMm(a)} mm ${isSliver(a) ? 'sliver' : 'cut'} at ${names[0]}`);
  if (b !== null) parts.push(`${formatMm(b)} mm ${isSliver(b) ? 'sliver' : 'cut'} at ${names[1]}`);
  return { text: parts.join(' and '), cut: true, sliver: (a !== null && isSliver(a)) || (b !== null && isSliver(b)) };
}

const capitalise = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** Plain designs: "No slivers; 175 mm cuts at both ends", "50 mm sliver at right edge". */
function explainPlain(axes: AxisCuts[], wall: boolean): string {
  const described = axes.map(describeAxis);
  const cutText = described.filter((d) => d.cut).map((d) => d.text).join('; ');
  const sliverText = described.filter((d) => d.sliver).map((d) => d.text).join('; ');
  const anyCut = described.some((d) => d.cut);
  const anySliver = described.some((d) => d.sliver);
  const noCuts = wall ? 'No cuts; full tiles at both ends' : 'No cuts; full tiles at every edge';
  return capitalise(anySliver ? sliverText : anyCut ? `No slivers; ${cutText}` : noCuts);
}

/** Motif designs: "4 whole medallions, no cuts, symmetric", "3 whole medallions + 2 cut at the edges, 25 mm slivers at both ends, symmetric". */
function explainMotifs(axes: AxisCuts[], motifs: { whole: number; cut: number; name: string }, symmetric: boolean): string {
  const described = axes.map(describeAxis);
  const plural = (n: number) => (n === 1 ? motifs.name : `${motifs.name}s`);
  const whole = `${motifs.whole} whole ${plural(motifs.whole)}${motifs.cut > 0 ? ` + ${motifs.cut} cut at the edges` : ''}`;
  const tiles = described.some((d) => d.cut)
    ? described.filter((d) => d.cut).map((d) => d.text).join('; ')
    : motifs.cut > 0
      ? 'no tile cuts'
      : 'no cuts';
  return capitalise(`${whole}, ${tiles}, ${symmetric ? 'symmetric' : 'not symmetric'}`);
}

function compareBy(priority: SuggestPriority): (a: AlignmentSuggestion, b: AlignmentSuggestion) => number {
  return (a, b) => {
    const sliver = Number(a.hasSliver) - Number(b.hasSliver);
    const symmetric = Number(!a.symmetric) - Number(!b.symmetric);
    const cutMotifs = (a.cutMotifs ?? 0) - (b.cutMotifs ?? 0);
    const cutTiles = a.cutTiles - b.cutTiles;
    const biggerCut = (b.smallestCutMm ?? Infinity) - (a.smallestCutMm ?? Infinity);
    const order =
      priority === 'symmetric' ? [symmetric, sliver, cutMotifs, cutTiles, biggerCut] : [sliver, symmetric, cutMotifs, cutTiles, biggerCut];
    return order.find((v) => v !== 0 && !Number.isNaN(v)) ?? 0;
  };
}
