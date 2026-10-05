import {
  isRotationAllowed,
  parseCellKey,
  validateLayout,
  type Alignment,
  type AxisAlignment,
  type Catalog,
  type CellOverride,
  type Layout,
  type Rotation,
  type Surface,
  type XMode,
  type YMode,
} from '../engine';
import { MAX_SIZE_MM, MIN_SIZE_MM } from './actions';
import { DEFAULT_SETTINGS, type DesignDoc, type FloorLayout, type Settings, type SurfacePlan, type WallLayout } from './document';
import type { Toggles } from './store';

/** Bump the version when the saved shape changes; older saves then start fresh. */
export const DESIGN_KEY = 'kt-tile-designer:design:v1';
export const VIEW_KEY = 'kt-tile-designer:view:v1';

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const isSize = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= MIN_SIZE_MM && v <= MAX_SIZE_MM;

const X_MODES: readonly string[] = ['left', 'right', 'centre-joint', 'centre-tile', 'centre-motif', 'centre-between-motifs'];
const Y_MODES: readonly string[] = ['bottom', 'top', 'centre-joint', 'centre-tile', 'centre-motif', 'centre-between-motifs'];

function axis<M extends XMode | YMode>(value: unknown, modes: readonly string[]): AxisAlignment<M> | null {
  if (!isObj(value) || typeof value['mode'] !== 'string') return null;
  if (value['mode'] === 'custom') {
    const offset = value['offsetMm'];
    return typeof offset === 'number' && Number.isFinite(offset) && Math.abs(offset) <= 100_000 ? { mode: 'custom', offsetMm: offset } : null;
  }
  return modes.includes(value['mode']) ? ({ mode: value['mode'] } as AxisAlignment<M>) : null;
}

function alignment(value: unknown): Alignment | null {
  if (!isObj(value)) return null;
  const x = axis<XMode>(value['x'], X_MODES);
  const y = axis<YMode>(value['y'], Y_MODES);
  return x && y ? { x, y } : null;
}

function surface(value: unknown, wall: boolean): Surface | null {
  if (!isObj(value) || !isSize(value['widthMm']) || !isSize(value['heightMm'])) return null;
  const result: Surface = { widthMm: value['widthMm'], heightMm: value['heightMm'] };
  if (wall) {
    const tiled = value['tiledHeightMm'] ?? value['heightMm'];
    if (!isSize(tiled) || tiled > result.heightMm) return null;
    result.tiledHeightMm = tiled;
  }
  return result;
}

function layout(value: unknown, wall: boolean, catalog: Catalog): Layout | null {
  if (!isObj(value) || typeof value['seriesId'] !== 'string') return null;
  let parsed: Layout;
  if (wall) {
    const bands = value['bands'];
    if (value['surface'] !== 'wall' || !Array.isArray(bands)) return null;
    const ok = bands.every((b) => isObj(b) && typeof b['designId'] === 'string' && (b['rows'] === 'fill' || (typeof b['rows'] === 'number' && Number.isInteger(b['rows']))));
    if (!ok) return null;
    parsed = { surface: 'wall', seriesId: value['seriesId'], bands: bands.map((b) => ({ designId: String((b as Obj)['designId']), rows: (b as Obj)['rows'] as number | 'fill' })) };
  } else {
    if (value['surface'] !== 'floor' || typeof value['designId'] !== 'string') return null;
    parsed = { surface: 'floor', seriesId: value['seriesId'], designId: value['designId'] };
  }
  // Unknown ids, a series for the other surface, or band rows that don't fit the design.
  return validateLayout(parsed, catalog).length === 0 ? parsed : null;
}

function overrides(value: unknown, seriesId: string, catalog: Catalog): Record<string, CellOverride> | null {
  if (value === undefined) return {};
  if (!isObj(value)) return null;
  const size = catalog.tileSize(seriesId);
  const result: Record<string, CellOverride> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (!parseCellKey(key) || !isObj(entry)) return null;
    const override: CellOverride = {};
    const tileId = entry['tileId'];
    if (tileId !== undefined) {
      if (typeof tileId !== 'string' || !catalog.hasTile(tileId) || catalog.tile(tileId).seriesId !== seriesId) return null;
      override.tileId = tileId;
    }
    const rotation = entry['rotation'];
    if (rotation !== undefined) {
      // Every tile in a series is the same size, so the series' size says which turns are allowed.
      if (typeof rotation !== 'number' || !isRotationAllowed({ widthMm: size.w, heightMm: size.h }, rotation)) return null;
      override.rotation = rotation as Rotation;
    }
    result[key] = override;
  }
  return result;
}

function plan<L extends Layout>(value: unknown, wall: boolean, catalog: Catalog): SurfacePlan<L> | null {
  if (!isObj(value)) return null;
  const s = surface(value['surface'], wall);
  const l = layout(value['layout'], wall, catalog);
  const a = alignment(value['alignment']);
  const o = l && overrides(value['overrides'], l.seriesId, catalog);
  return s && l && a && o ? { surface: s, layout: l as L, alignment: a, overrides: o } : null;
}

/** Missing settings take their defaults (so new settings don't wipe old saves); wrong ones fail. */
function settings(value: unknown): Settings | null {
  if (value !== undefined && !isObj(value)) return null;
  const merged = { ...DEFAULT_SETTINGS, ...(value ?? {}) } as Record<string, unknown>;
  const num = (key: string, min: number, max: number) => typeof merged[key] === 'number' && (merged[key] as number) >= min && (merged[key] as number) <= max;
  if (!num('minCutFraction', 0.05, 0.5) || !num('allowancePct', 0, 50) || !num('groutMm', 0, 12)) return null;
  if (typeof merged['groutColor'] !== 'string' || !/^#[0-9a-f]{6}$/i.test(merged['groutColor'])) return null;
  // Saves from before the ranking change used 'centre-motif' for what is now 'symmetric'.
  if (merged['suggestPriority'] === 'centre-motif') merged['suggestPriority'] = 'symmetric';
  if (merged['suggestPriority'] !== 'avoid-slivers' && merged['suggestPriority'] !== 'symmetric') return null;
  return {
    minCutFraction: merged['minCutFraction'] as number,
    allowancePct: merged['allowancePct'] as number,
    groutMm: merged['groutMm'] as number,
    groutColor: merged['groutColor'],
    suggestPriority: merged['suggestPriority'],
  };
}

/** A saved design, or null when it is missing, damaged, or no longer fits the catalog. */
export function parseSavedDesign(raw: string | null, catalog: Catalog): DesignDoc | null {
  if (!raw) return null;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isObj(data) || data['version'] !== 1 || (data['active'] !== 'wall' && data['active'] !== 'floor')) return null;
  try {
    const wall = plan<WallLayout>(data['wall'], true, catalog);
    const floor = plan<FloorLayout>(data['floor'], false, catalog);
    const s = settings(data['settings']);
    return wall && floor && s ? { version: 1, active: data['active'], wall, floor, settings: s } : null;
  } catch {
    return null;
  }
}

export function parseSavedToggles(raw: string | null): Toggles | null {
  if (!raw) return null;
  try {
    const data: unknown = JSON.parse(raw);
    if (!isObj(data)) return null;
    const keys = ['showCuts', 'showRepeat', 'showMotifs', 'showDims'] as const;
    if (!keys.every((k) => typeof data[k] === 'boolean')) return null;
    return { showCuts: data['showCuts'] as boolean, showRepeat: data['showRepeat'] as boolean, showMotifs: data['showMotifs'] as boolean, showDims: data['showDims'] as boolean };
  } catch {
    return null;
  }
}

/** localStorage can be missing, full or blocked (private windows); saving is best effort. */
export function readStorage(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeStorage(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Nothing to do: the design simply isn't kept for next time.
  }
}
