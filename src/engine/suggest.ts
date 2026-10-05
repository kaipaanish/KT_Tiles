import type { Catalog } from './catalog';
import { DEFAULT_MIN_CUT_FRACTION, layoutSurface } from './layout';
import { EPS, formatMm } from './math';
import type { Alignment, AxisAlignment, EdgeCuts, Layout, LayoutResult, Surface, XMode, YMode } from './types';

/** avoid-slivers: options without slivers first. centre-motif: motif-centred options first. */
export type SuggestPriority = 'avoid-slivers' | 'centre-motif';

export interface SuggestOptions {
  priority?: SuggestPriority;
  minCutFraction?: number;
  /** Walls keep this vertical alignment while horizontal options are compared. Default: bottom. */
  current?: Alignment;
}

export interface AlignmentSuggestion {
  alignment: Alignment;
  label: string;
  /** Other named alignments that give exactly the same layout. */
  sameAs: string[];
  /** Smallest cut along the compared axes; null when nothing is cut. */
  smallestCutMm: number | null;
  hasSliver: boolean;
  symmetric: boolean;
  /** null when the layout has no motif. */
  motifCentred: boolean | null;
  /** Distance from the nearest motif centre to the centre; null with no visible motif. */
  motifOffsetMm: number | null;
  edgeCuts: EdgeCuts;
  explanation: string;
}

const X_ORDER: readonly XMode[] = ['centre-motif', 'centre-tile', 'centre-joint', 'left', 'right'];
const Y_ORDER: readonly YMode[] = ['centre-motif', 'centre-tile', 'centre-joint', 'bottom', 'top'];
const MODE_NAMES: Record<XMode | YMode, string> = {
  'centre-motif': 'Centre motif',
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
 * layout are merged into one suggestion.
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
  const xModes = X_ORDER.filter((mode) => mode !== 'centre-motif' || hasMotif);
  const yModes = Y_ORDER.filter((mode) => mode !== 'centre-motif' || hasMotif);

  const candidates: Alignment[] =
    layout.surface === 'wall'
      ? xModes.map((x) => ({ x: { mode: x }, y: options.current?.y ?? { mode: 'bottom' } }))
      : xModes.flatMap((x) => yModes.map((y) => ({ x: { mode: x }, y: { mode: y } })));

  const byLayout = new Map<string, AlignmentSuggestion>();
  for (const alignment of candidates) {
    const result = layoutSurface(surface, layout, alignment, {}, catalog, { minCutFraction });
    const label = labelFor(alignment, layout.surface);
    const key = `${result.origin.x},${result.origin.y}`;
    const existing = byLayout.get(key);
    if (existing) existing.sameAs.push(label);
    else byLayout.set(key, evaluate(alignment, label, result, hasMotif));
  }
  return [...byLayout.values()].sort(compareBy(priority));
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
}

function evaluate(alignment: Alignment, label: string, result: LayoutResult, hasMotif: boolean): AlignmentSuggestion {
  const { edgeCuts: cuts, minCutMm, tile } = result;
  const axes: AxisCuts[] =
    result.surfaceType === 'wall'
      ? [{ a: cuts.left, b: cuts.right, min: minCutMm.x, full: tile.w, names: ['left edge', 'right edge', 'at both ends'] }]
      : [
          { a: cuts.left, b: cuts.right, min: minCutMm.x, full: tile.w, names: ['left edge', 'right edge', 'at left and right'] },
          { a: cuts.bottom, b: cuts.top, min: minCutMm.y, full: tile.h, names: ['bottom edge', 'top edge', 'at top and bottom'] },
        ];
  const sizes = axes.flatMap((axis) => [axis.a, axis.b]).filter((size): size is number => size !== null);
  const hasSliver = axes.some((axis) => [axis.a, axis.b].some((size) => size !== null && size < axis.min - EPS));
  const symmetric = axes.every((axis) => Math.abs((axis.a ?? axis.full) - (axis.b ?? axis.full)) < 0.5);

  let motifCentred: boolean | null = null;
  let motifOffsetMm: number | null = null;
  if (hasMotif) {
    const cx = result.widthMm / 2;
    const cy = result.tiledHeightMm / 2;
    const offsets = result.motifCentres.map((p) =>
      result.surfaceType === 'wall' ? Math.abs(p.x - cx) : Math.hypot(p.x - cx, p.y - cy),
    );
    motifOffsetMm = offsets.length > 0 ? Math.min(...offsets) : null;
    motifCentred = motifOffsetMm !== null && motifOffsetMm < 0.5;
  }

  return {
    alignment,
    label,
    sameAs: [],
    smallestCutMm: sizes.length > 0 ? Math.min(...sizes) : null,
    hasSliver,
    symmetric,
    motifCentred,
    motifOffsetMm,
    edgeCuts: cuts,
    explanation: explain(axes, motifCentred, motifOffsetMm, result.surfaceType === 'wall'),
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

/** One line, e.g. "Motif centred, but 25 mm slivers at both ends" or "No slivers; motif 150 mm off-centre". */
function explain(axes: AxisCuts[], motifCentred: boolean | null, motifOffsetMm: number | null, wall: boolean): string {
  const described = axes.map(describeAxis);
  const cutText = described.filter((d) => d.cut).map((d) => d.text).join('; ');
  const sliverText = described.filter((d) => d.sliver).map((d) => d.text).join('; ');
  const anyCut = described.some((d) => d.cut);
  const anySliver = described.some((d) => d.sliver);
  const noCuts = wall ? 'No cuts; full tiles at both ends' : 'No cuts; full tiles at every edge';

  let text: string;
  if (motifCentred === true) {
    text = anySliver ? `Motif centred, but ${sliverText}` : anyCut ? `Motif centred; no slivers (${cutText})` : `Motif centred; ${noCuts.toLowerCase()}`;
  } else if (motifCentred === false) {
    const motif = motifOffsetMm === null ? 'motif not visible' : `motif ${formatMm(motifOffsetMm)} mm off-centre`;
    text = anySliver ? `${sliverText}; ${motif}` : `No slivers; ${motif}`;
  } else {
    text = anySliver ? sliverText : anyCut ? `No slivers; ${cutText}` : noCuts;
  }
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function compareBy(priority: SuggestPriority): (a: AlignmentSuggestion, b: AlignmentSuggestion) => number {
  const motifRank = (s: AlignmentSuggestion) => (s.motifCentred === false ? 1 : 0);
  return (a, b) => {
    const sliver = Number(a.hasSliver) - Number(b.hasSliver);
    const motif = motifRank(a) - motifRank(b);
    const symmetric = Number(!a.symmetric) - Number(!b.symmetric);
    const biggerCut = (b.smallestCutMm ?? Infinity) - (a.smallestCutMm ?? Infinity);
    const order = priority === 'centre-motif' ? [motif, sliver, symmetric, biggerCut] : [sliver, motif, symmetric, biggerCut];
    return order.find((v) => v !== 0 && !Number.isNaN(v)) ?? 0;
  };
}
