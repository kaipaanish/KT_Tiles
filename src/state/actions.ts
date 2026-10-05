import {
  cellKey,
  designForRole,
  designForTile,
  designRole,
  isRotationAllowed,
  LayoutError,
  nextRotation,
  parseCellKey,
  resolveAlignment,
  validateBands,
  type Alignment,
  type Band,
  type BandPlan,
  type Catalog,
  type CellOverride,
  type DesignSlot,
  type Overrides,
  type Rotation,
  type Surface,
  type SurfaceType,
} from '../engine';
import { activePlan, wallBandsFor, type DesignDoc, type FloorLayout, type Settings, type SurfacePlan, type WallLayout } from './document';

/** Pure edits to the design document. Each returns a new document, or the same one when nothing changes. */

export interface Cell {
  col: number;
  row: number;
}

export const MIN_SIZE_MM = 100;
export const MAX_SIZE_MM = 20000;
const MAX_BAND_ROWS = 60;

const mod = (a: number, n: number) => ((a % n) + n) % n;

type PlanPatch = Partial<Pick<SurfacePlan, 'surface' | 'alignment' | 'overrides'>>;

function patchActive(doc: DesignDoc, patch: PlanPatch): DesignDoc {
  return doc.active === 'wall' ? { ...doc, wall: { ...doc.wall, ...patch } } : { ...doc, floor: { ...doc.floor, ...patch } };
}

function patchWall(doc: DesignDoc, patch: Partial<SurfacePlan<WallLayout>>): DesignDoc {
  return { ...doc, wall: { ...doc.wall, ...patch } };
}

function patchFloor(doc: DesignDoc, patch: Partial<SurfacePlan<FloorLayout>>): DesignDoc {
  return { ...doc, floor: { ...doc.floor, ...patch } };
}

export function setActive(doc: DesignDoc, surface: SurfaceType): DesignDoc {
  return doc.active === surface ? doc : { ...doc, active: surface };
}

const clampSize = (mm: number) => Math.round(Math.min(MAX_SIZE_MM, Math.max(MIN_SIZE_MM, mm)));

/** Sets the active surface's size. On walls a tiled height equal to the full height follows the height. */
export function setSurfaceSize(doc: DesignDoc, patch: Partial<Surface>): DesignDoc {
  const old = activePlan(doc).surface;
  const widthMm = patch.widthMm === undefined ? old.widthMm : clampSize(patch.widthMm);
  const heightMm = patch.heightMm === undefined ? old.heightMm : clampSize(patch.heightMm);
  let surface: Surface = { widthMm, heightMm };
  if (doc.active === 'wall') {
    const oldTiled = old.tiledHeightMm ?? old.heightMm;
    const tiled = patch.tiledHeightMm === undefined ? (oldTiled >= old.heightMm ? heightMm : oldTiled) : clampSize(patch.tiledHeightMm);
    surface = { widthMm, heightMm, tiledHeightMm: Math.min(tiled, heightMm) };
  }
  const same = surface.widthMm === old.widthMm && surface.heightMm === old.heightMm && surface.tiledHeightMm === old.tiledHeightMm;
  return same ? doc : patchActive(doc, { surface });
}

export function setAlignment(doc: DesignDoc, alignment: Alignment, overrides?: Overrides): DesignDoc {
  const plan = activePlan(doc);
  const same = JSON.stringify(plan.alignment) === JSON.stringify(alignment) && (overrides === undefined || overrides === plan.overrides);
  return same ? doc : patchActive(doc, overrides ? { alignment, overrides } : { alignment });
}

export function setSettings(doc: DesignDoc, patch: Partial<Settings>): DesignDoc {
  const settings: Settings = { ...doc.settings, ...patch };
  settings.minCutFraction = Math.min(0.5, Math.max(0.05, settings.minCutFraction));
  settings.allowancePct = Math.min(50, Math.max(0, settings.allowancePct));
  settings.groutMm = Math.min(12, Math.max(0, settings.groutMm));
  return JSON.stringify(settings) === JSON.stringify(doc.settings) ? doc : { ...doc, settings };
}

/** Switches series. Walls keep their bands, role for role, when the new series has the same roles. */
export function setSeries(doc: DesignDoc, seriesId: string, catalog: Catalog): DesignDoc {
  const series = catalog.series(seriesId);
  if (series.surface === 'floor') {
    if (doc.floor.layout.seriesId === seriesId) return setActive(doc, 'floor');
    const current = catalog.design(doc.floor.layout.designId);
    const designs = catalog.designsOf(seriesId);
    const design = designs.find((d) => d.name === current.name) ?? designs[0];
    if (!design) return doc;
    return { ...doc, active: 'floor', floor: { ...doc.floor, layout: { surface: 'floor', seriesId, designId: design.id }, overrides: {} } };
  }
  if (doc.wall.layout.seriesId === seriesId) return setActive(doc, 'wall');
  const bands = bandsByRole(doc.wall.layout.bands, seriesId, catalog) ?? wallBandsFor(seriesId, catalog);
  return { ...doc, active: 'wall', wall: { ...doc.wall, layout: { surface: 'wall', seriesId, bands }, overrides: {} } };
}

function bandsByRole(bands: readonly Band[], seriesId: string, catalog: Catalog): Band[] | null {
  const mapped: Band[] = [];
  for (const band of bands) {
    const old = catalog.design(band.designId);
    const role = designRole(old, catalog);
    if (role !== 'light' && role !== 'dark' && role !== 'highlighter') return null;
    const design = designForRole(seriesId, role, catalog);
    if (!design) return null;
    const rows = band.rows === 'fill' ? 'fill' : Math.max(1, Math.round(band.rows / old.rows)) * design.rows;
    mapped.push({ designId: design.id, rows });
  }
  return mapped;
}

export function applyPreset(doc: DesignDoc, presetId: string, catalog: Catalog): DesignDoc {
  const bands = wallBandsFor(doc.wall.layout.seriesId, catalog, presetId);
  return { ...doc, active: 'wall', wall: { ...doc.wall, layout: { ...doc.wall.layout, bands }, overrides: {} } };
}

export function setFloorDesign(doc: DesignDoc, designId: string, catalog: Catalog): DesignDoc {
  const design = catalog.design(designId);
  if (design.seriesId !== doc.floor.layout.seriesId) throw new LayoutError([`"${design.name}" belongs to another series.`]);
  if (doc.floor.layout.designId === designId) return doc;
  return patchFloor(doc, { layout: { ...doc.floor.layout, designId }, overrides: {} });
}

// Bands -------------------------------------------------------------------------------------

/** Where the wall's bands sit right now. */
export function wallBandPlan(doc: DesignDoc, catalog: Catalog): BandPlan {
  const plan = resolveAlignment(doc.wall.surface, doc.wall.layout, doc.wall.alignment, catalog).bandPlan;
  if (!plan) throw new Error('A wall always has a band plan');
  return plan;
}

/** Fixed rows for a band that stops filling: what it shows now, rounded up to whole units. */
function fixedRows(rowsNow: number, unitRows: number): number {
  return Math.max(1, Math.ceil(rowsNow / unitRows)) * unitRows;
}

/**
 * Replaces the wall's bands. Overrides stay on their band's tiles: `bandFor` maps each old band
 * index to its new index (or null when the band's tiles are gone or its design changed).
 */
function withBands(doc: DesignDoc, bands: Band[], catalog: Catalog, bandFor: (oldIndex: number) => number | null): DesignDoc {
  const problems = validateBands(bands, doc.wall.layout.seriesId, catalog);
  if (problems.length > 0) throw new LayoutError(problems);
  const before = wallBandPlan(doc, catalog);
  const next = patchWall(doc, { layout: { ...doc.wall.layout, bands } });
  const after = wallBandPlan(next, catalog);
  const overrides: Record<string, CellOverride> = {};
  for (const [key, value] of Object.entries(doc.wall.overrides)) {
    const cell = parseCellKey(key);
    const old = cell && before.bands.find((b) => cell.row >= b.rowStart && cell.row < b.rowStart + b.rowCount);
    if (!cell || !old) continue;
    const index = bandFor(old.index);
    const target = index === null ? undefined : after.bands[index];
    const inBand = cell.row - old.rowStart;
    if (target && inBand < target.rowCount) overrides[cellKey(cell.col, target.rowStart + inBand)] = value;
  }
  return patchWall(next, { overrides });
}

/** Adds or removes one repeat unit's worth of rows. */
export function stepBandRows(doc: DesignDoc, index: number, direction: 1 | -1, catalog: Catalog): DesignDoc {
  const bands = doc.wall.layout.bands;
  const band = bands[index];
  if (!band || band.rows === 'fill') return doc;
  const unit = catalog.design(band.designId).rows;
  const rows = band.rows + direction * unit;
  if (rows < unit || rows > MAX_BAND_ROWS) return doc;
  return withBands(doc, bands.map((b, i) => (i === index ? { ...b, rows } : b)), catalog, (i) => i);
}

/** Only the top band can fill the remaining height. Turning fill off keeps the rows it shows now. */
export function setBandFill(doc: DesignDoc, index: number, fill: boolean, catalog: Catalog): DesignDoc {
  const bands = doc.wall.layout.bands;
  const band = bands[index];
  if (!band || index !== bands.length - 1 || (band.rows === 'fill') === fill) return doc;
  const unit = catalog.design(band.designId).rows;
  const rows = fill ? 'fill' : fixedRows(wallBandPlan(doc, catalog).bands[index]?.rowCount ?? unit, unit);
  return withBands(doc, bands.map((b, i) => (i === index ? { ...b, rows } : b)), catalog, (i) => i);
}

/** Moves a band to a new position. "Fill" stays with the top position. */
export function moveBand(doc: DesignDoc, from: number, to: number, catalog: Catalog): DesignDoc {
  const bands = doc.wall.layout.bands;
  if (from === to || !bands[from] || to < 0 || to >= bands.length) return doc;
  const plan = wallBandPlan(doc, catalog);
  const hadFill = bands.some((b) => b.rows === 'fill');
  const fixed = bands.map((b, i): Band => (b.rows === 'fill' ? { ...b, rows: fixedRows(plan.bands[i]?.rowCount ?? 0, catalog.design(b.designId).rows) } : b));
  const order = bands.map((_, i) => i);
  const [movedBand] = fixed.splice(from, 1);
  const [movedIndex] = order.splice(from, 1);
  if (!movedBand || movedIndex === undefined) return doc;
  fixed.splice(to, 0, movedBand);
  order.splice(to, 0, movedIndex);
  const top = fixed[fixed.length - 1];
  if (hadFill && top) fixed[fixed.length - 1] = { ...top, rows: 'fill' };
  return withBands(doc, fixed, catalog, (old) => order.indexOf(old));
}

/** Changes a band's design, keeping its number of repeat units. */
export function setBandDesign(doc: DesignDoc, index: number, designId: string, catalog: Catalog): DesignDoc {
  const bands = doc.wall.layout.bands;
  const band = bands[index];
  if (!band || band.designId === designId) return doc;
  const old = catalog.design(band.designId);
  const design = catalog.design(designId);
  const rows = band.rows === 'fill' ? 'fill' : Math.max(1, Math.round(band.rows / old.rows)) * design.rows;
  return withBands(doc, bands.map((b, i) => (i === index ? { designId, rows } : b)), catalog, (i) => (i === index ? null : i));
}

/** Assigns a tile to a band: its plain design, or the smallest design that contains it. */
export function setBandTile(doc: DesignDoc, index: number, tileId: string, catalog: Catalog): DesignDoc {
  const design = designForTile(tileId, catalog);
  return design ? setBandDesign(doc, index, design.id, catalog) : doc;
}

/** Adds a one-unit Light band just below the top band. */
export function addBand(doc: DesignDoc, catalog: Catalog): DesignDoc {
  const bands = doc.wall.layout.bands;
  const seriesId = doc.wall.layout.seriesId;
  const design = designForRole(seriesId, 'light', catalog) ?? catalog.designsOf(seriesId)[0];
  if (!design) return doc;
  const at = Math.max(0, bands.length - 1);
  const next = [...bands.slice(0, at), { designId: design.id, rows: design.rows }, ...bands.slice(at)];
  return withBands(doc, next, catalog, (i) => (i >= at ? i + 1 : i));
}

export function removeBand(doc: DesignDoc, index: number, catalog: Catalog): DesignDoc {
  const bands = doc.wall.layout.bands;
  if (bands.length <= 1 || !bands[index]) return doc;
  const next = bands.filter((_, i) => i !== index);
  const top = next[next.length - 1];
  // Removing the fill band hands "fill" to the new top band.
  if (bands[index]?.rows === 'fill' && top) next[next.length - 1] = { ...top, rows: 'fill' };
  return withBands(doc, next, catalog, (i) => (i === index ? null : i > index ? i - 1 : i));
}

// Tiles -------------------------------------------------------------------------------------

export class RotationError extends Error {
  override name = 'RotationError';
}

/** The design slot a grid cell shows before overrides, or null outside the tiled rows. */
export function slotAt(doc: DesignDoc, cell: Cell, catalog: Catalog): DesignSlot | null {
  const plan = activePlan(doc);
  if (plan.layout.surface === 'floor') {
    const design = catalog.design(plan.layout.designId);
    return design.slots[mod(cell.row, design.rows) * design.cols + mod(cell.col, design.cols)] ?? null;
  }
  const band = wallBandPlan(doc, catalog).bands.find((b) => cell.row >= b.rowStart && cell.row < b.rowStart + b.rowCount);
  if (!band) return null;
  const d = band.design;
  return d.slots[mod(cell.row - band.rowStart, d.rows) * d.cols + mod(cell.col, d.cols)] ?? null;
}

/** The tile and rotation a cell shows, overrides included. */
export function tileAt(doc: DesignDoc, cell: Cell, catalog: Catalog): { tileId: string; rotation: Rotation } | null {
  const slot = slotAt(doc, cell, catalog);
  if (!slot) return null;
  const override = activePlan(doc).overrides[cellKey(cell.col, cell.row)];
  return { tileId: override?.tileId ?? slot.tileId, rotation: override?.rotation ?? slot.rotation };
}

/** Sets what a cell shows, storing an override only where it differs from the design. */
function setCell(doc: DesignDoc, cell: Cell, value: { tileId: string; rotation: Rotation }, catalog: Catalog): DesignDoc {
  const slot = slotAt(doc, cell, catalog);
  if (!slot) return doc;
  const key = cellKey(cell.col, cell.row);
  const overrides: Record<string, CellOverride> = { ...activePlan(doc).overrides };
  if (value.tileId === slot.tileId && value.rotation === slot.rotation) delete overrides[key];
  else overrides[key] = value.tileId === slot.tileId ? { rotation: value.rotation } : { tileId: value.tileId, rotation: value.rotation };
  return patchActive(doc, { overrides });
}

/** Turns a cell's tile to its next allowed rotation (rectangles: 0° and 180° only). */
export function rotateCell(doc: DesignDoc, cell: Cell, catalog: Catalog): DesignDoc {
  const current = tileAt(doc, cell, catalog);
  if (!current) return doc;
  return setCell(doc, cell, { tileId: current.tileId, rotation: nextRotation(catalog.tile(current.tileId), current.rotation) }, catalog);
}

/** Sets a rotation, rejecting one the tile doesn't allow. */
export function setCellRotation(doc: DesignDoc, cell: Cell, rotation: Rotation, catalog: Catalog): DesignDoc {
  const current = tileAt(doc, cell, catalog);
  if (!current) return doc;
  const tile = catalog.tile(current.tileId);
  if (!isRotationAllowed(tile, rotation)) {
    throw new RotationError(`A ${tile.widthMm} × ${tile.heightMm} mm tile can only turn 0° or 180°, not ${rotation}°.`);
  }
  return setCell(doc, cell, { tileId: current.tileId, rotation }, catalog);
}

export function swapCells(doc: DesignDoc, a: Cell, b: Cell, catalog: Catalog): DesignDoc {
  if (a.col === b.col && a.row === b.row) return doc;
  const first = tileAt(doc, a, catalog);
  const second = tileAt(doc, b, catalog);
  if (!first || !second) return doc;
  return setCell(setCell(doc, a, second, catalog), b, first, catalog);
}

/** Puts a different tile from the same series in one cell. */
export function assignTile(doc: DesignDoc, cell: Cell, tileId: string, catalog: Catalog): DesignDoc {
  const plan = activePlan(doc);
  if (catalog.tile(tileId).seriesId !== plan.layout.seriesId) throw new LayoutError([`"${catalog.tile(tileId).name}" belongs to another series.`]);
  return setCell(doc, cell, { tileId, rotation: 0 }, catalog);
}

export function resetTiles(doc: DesignDoc): DesignDoc {
  return Object.keys(activePlan(doc).overrides).length === 0 ? doc : patchActive(doc, { overrides: {} });
}
