import {
  presetsFor,
  resolvePreset,
  suggestAlignments,
  type Alignment,
  type AxisAlignment,
  type Catalog,
  type Layout,
  type Overrides,
  type SuggestPriority,
  type Surface,
  type SurfaceType,
  type XMode,
  type YMode,
} from '../engine';

export type WallLayout = Extract<Layout, { surface: 'wall' }>;
export type FloorLayout = Extract<Layout, { surface: 'floor' }>;

/** Everything needed to lay out one surface. */
export interface SurfacePlan<L extends Layout = Layout> {
  surface: Surface;
  layout: L;
  alignment: Alignment;
  overrides: Overrides;
}

export interface Settings {
  /** Cuts below this fraction of the tile are slivers. */
  minCutFraction: number;
  allowancePct: number;
  groutMm: number;
  groutColor: string;
  suggestPriority: SuggestPriority;
}

/** The saved, undoable design: one wall, one floor, and which one is showing. */
export interface DesignDoc {
  version: 1;
  active: SurfaceType;
  wall: SurfacePlan<WallLayout>;
  floor: SurfacePlan<FloorLayout>;
  settings: Settings;
}

export const DEFAULT_SETTINGS: Settings = {
  minCutFraction: 1 / 3,
  allowancePct: 5,
  groutMm: 2,
  groutColor: '#d5d2cb',
  suggestPriority: 'avoid-slivers',
};

export const DEFAULT_PRESET = 'highlighter-band';

export function activePlan(doc: DesignDoc): SurfacePlan {
  return doc.active === 'wall' ? doc.wall : doc.floor;
}

/** Bands for a wall series from a preset, falling back to the first preset that fits. */
export function wallBandsFor(seriesId: string, catalog: Catalog, presetId = DEFAULT_PRESET): WallLayout['bands'] {
  const preset = catalog.presets.find((p) => p.id === presetId);
  const bands = (preset && resolvePreset(preset, seriesId, catalog)) ?? presetsFor(seriesId, catalog)[0]?.bands;
  if (bands) return bands;
  const first = catalog.designsOf(seriesId)[0];
  if (!first) throw new Error(`Series "${seriesId}" has no designs`);
  return [{ designId: first.id, rows: 'fill' }];
}

export function firstDesignOf(seriesId: string, catalog: Catalog): string {
  const design = catalog.designsOf(seriesId)[0];
  if (!design) throw new Error(`Series "${seriesId}" has no designs`);
  return design.id;
}

/** The best-ranked alignment for a plan (walls keep their vertical alignment). */
export function topSuggestion<L extends Layout>(plan: SurfacePlan<L>, catalog: Catalog, settings: Settings = DEFAULT_SETTINGS): Alignment {
  const [top] = suggestAlignments(plan.surface, plan.layout, catalog, {
    priority: settings.suggestPriority,
    minCutFraction: settings.minCutFraction,
    current: plan.alignment,
  });
  return top?.alignment ?? plan.alignment;
}

/** Opens on a "Highlighter band" wall in the first wall series, aligned by the top suggestion, with no setup. */
export function createDefaultDocument(catalog: Catalog): DesignDoc {
  const wallSeries = catalog.seriesList('wall')[0];
  const floorSeries = catalog.seriesList('floor')[0];
  if (!wallSeries || !floorSeries) throw new Error('The catalog needs at least one wall series and one floor series');
  const wall: SurfacePlan<WallLayout> = {
    surface: { widthMm: 2400, heightMm: 2700, tiledHeightMm: 2700 },
    layout: { surface: 'wall', seriesId: wallSeries.id, bands: wallBandsFor(wallSeries.id, catalog) },
    alignment: { x: { mode: 'centre-motif' }, y: { mode: 'bottom' } },
    overrides: {},
  };
  const floor: SurfacePlan<FloorLayout> = {
    surface: { widthMm: 1800, heightMm: 2400 },
    layout: { surface: 'floor', seriesId: floorSeries.id, designId: firstDesignOf(floorSeries.id, catalog) },
    alignment: { x: { mode: 'centre-joint' }, y: { mode: 'centre-joint' } },
    overrides: {},
  };
  return {
    version: 1,
    active: 'wall',
    wall: { ...wall, alignment: topSuggestion(wall, catalog) },
    floor: { ...floor, alignment: topSuggestion(floor, catalog) },
    settings: { ...DEFAULT_SETTINGS },
  };
}

const X_MODES: readonly XMode[] = ['left', 'right', 'centre-joint', 'centre-tile', 'centre-motif', 'centre-between-motifs'];
const Y_MODES: readonly YMode[] = ['bottom', 'top', 'centre-joint', 'centre-tile', 'centre-motif', 'centre-between-motifs'];

function axisFromParam<M extends XMode | YMode>(value: string | null, modes: readonly M[]): AxisAlignment<M> | null {
  if (value === null || value === '') return null;
  const mode = modes.find((m) => m === value);
  if (mode) return { mode };
  const offset = Number(value);
  return Number.isFinite(offset) ? { mode: 'custom', offsetMm: offset } : null;
}

function mmParam(params: URLSearchParams, key: string): number | null {
  const value = Number(params.get(key));
  return params.has(key) && Number.isFinite(value) && value >= 100 && value <= 20000 ? Math.round(value) : null;
}

/**
 * Applies URL parameters to a document, for demos and browser checks, e.g.
 * ?series=demo-azure-medallion&preset=feature-wall&w=2450&x=centre-motif or ?surface=floor&design=floor-checker.
 * Unknown values are ignored.
 */
export function applyQuery(doc: DesignDoc, params: URLSearchParams, catalog: Catalog): DesignDoc {
  const next: DesignDoc = structuredClone(doc);
  const surface = params.get('surface');
  if (surface === 'wall' || surface === 'floor') next.active = surface;

  const seriesId = params.get('series');
  if (seriesId && catalog.hasSeries(seriesId)) {
    const series = catalog.series(seriesId);
    next.active = series.surface;
    if (series.surface === 'wall') next.wall.layout = { surface: 'wall', seriesId, bands: wallBandsFor(seriesId, catalog) };
    else next.floor.layout = { surface: 'floor', seriesId, designId: firstDesignOf(seriesId, catalog) };
  }

  const presetId = params.get('preset');
  if (presetId && catalog.presets.some((p) => p.id === presetId)) {
    next.active = 'wall';
    next.wall.layout = { ...next.wall.layout, bands: wallBandsFor(next.wall.layout.seriesId, catalog, presetId) };
  }

  const designId = params.get('design');
  if (designId && catalog.hasDesign(designId)) {
    const design = catalog.design(designId);
    const series = catalog.series(design.seriesId);
    next.active = series.surface;
    if (series.surface === 'floor') next.floor.layout = { surface: 'floor', seriesId: series.id, designId };
    else next.wall.layout = { surface: 'wall', seriesId: series.id, bands: [{ designId, rows: 'fill' }] };
  }

  const plan = next.active === 'wall' ? next.wall : next.floor;
  const w = mmParam(params, 'w');
  const h = mmParam(params, 'h');
  const th = mmParam(params, 'th');
  if (w !== null) plan.surface.widthMm = w;
  if (h !== null) plan.surface.heightMm = h;
  if (next.active === 'wall') {
    const height = next.wall.surface.heightMm;
    next.wall.surface.tiledHeightMm = Math.min(height, th ?? (h !== null ? height : (next.wall.surface.tiledHeightMm ?? height)));
  }
  const x = axisFromParam(params.get('x'), X_MODES);
  const y = axisFromParam(params.get('y'), Y_MODES);
  if (x) plan.alignment = { ...plan.alignment, x };
  if (y) plan.alignment = { ...plan.alignment, y };
  return next;
}
