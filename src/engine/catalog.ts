import { EPS } from './math';
import { isRotationAllowed } from './rotation';
import type {
  Design,
  DesignSlot,
  Finish,
  Placeholder,
  PlaceholderGroup,
  Preset,
  PresetBand,
  PresetRole,
  Rotation,
  Series,
  SurfaceType,
  Tile,
  TileRole,
} from './types';

export interface CatalogData {
  tiles: Tile[];
  series: Series[];
  designs: Design[];
  presets: Preset[];
}

/** Thrown when series data is invalid. Lists every problem found, not just the first. */
export class CatalogError extends Error {
  readonly problems: readonly string[];

  constructor(problems: readonly string[]) {
    super(`Invalid tile data:\n- ${problems.join('\n- ')}`);
    this.name = 'CatalogError';
    this.problems = problems;
  }
}

/** Validated tiles, series, designs and presets, with lookups. Build one with buildCatalog(). */
export class Catalog {
  readonly presets: readonly Preset[];
  private readonly tileById: ReadonlyMap<string, Tile>;
  private readonly seriesById: ReadonlyMap<string, Series>;
  private readonly designById: ReadonlyMap<string, Design>;

  constructor(data: CatalogData) {
    this.tileById = new Map(data.tiles.map((t) => [t.id, t]));
    this.seriesById = new Map(data.series.map((s) => [s.id, s]));
    this.designById = new Map(data.designs.map((d) => [d.id, d]));
    this.presets = data.presets;
  }

  hasTile(id: string): boolean {
    return this.tileById.has(id);
  }

  hasSeries(id: string): boolean {
    return this.seriesById.has(id);
  }

  hasDesign(id: string): boolean {
    return this.designById.has(id);
  }

  tile(id: string): Tile {
    return lookup(this.tileById, id, 'tile');
  }

  series(id: string): Series {
    return lookup(this.seriesById, id, 'series');
  }

  design(id: string): Design {
    return lookup(this.designById, id, 'design');
  }

  /** All series, or only those for one surface type. */
  seriesList(surface?: SurfaceType): Series[] {
    const all = [...this.seriesById.values()];
    return surface ? all.filter((s) => s.surface === surface) : all;
  }

  /** A series' tiles, in the order the series lists them. */
  tilesOf(seriesId: string): Tile[] {
    return this.series(seriesId).tileIds.map((id) => this.tile(id));
  }

  designsOf(seriesId: string): Design[] {
    return [...this.designById.values()].filter((d) => d.seriesId === seriesId);
  }

  /** Every tile in a series has the same size, so the grid is uniform. */
  tileSize(seriesId: string): { w: number; h: number } {
    const first = this.tilesOf(seriesId)[0];
    if (!first) throw new Error(`Series "${seriesId}" has no tiles`);
    return { w: first.widthMm, h: first.heightMm };
  }
}

function lookup<T>(map: ReadonlyMap<string, T>, id: string, kind: string): T {
  const value = map.get(id);
  if (value === undefined) throw new Error(`Unknown ${kind} "${id}"`);
  return value;
}

const TILE_ROLES: readonly TileRole[] = ['light', 'dark', 'highlighter', 'floor'];
const FINISHES: readonly Finish[] = ['matt', 'glossy'];
const SURFACES: readonly SurfaceType[] = ['wall', 'floor'];
const PRESET_ROLES: readonly PresetRole[] = ['light', 'dark', 'highlighter'];
const ROTATIONS: readonly Rotation[] = [0, 90, 180, 270];

/**
 * Validates raw series data (the parsed series.json) and builds a Catalog.
 * Throws a CatalogError listing every problem.
 */
export function buildCatalog(raw: unknown): Catalog {
  const r = new Reader();
  const root = r.object(raw, 'series data');
  const data: CatalogData = {
    tiles: r.list(root, 'tiles', 'series data').map((v, i) => parseTile(r, v, i)),
    series: r.list(root, 'series', 'series data').map((v, i) => parseSeries(r, v, i)),
    designs: r.list(root, 'designs', 'series data').map((v, i) => parseDesign(r, v, i)),
    presets: root['presets'] === undefined ? [] : r.list(root, 'presets', 'series data').map((v, i) => parsePreset(r, v, i)),
  };
  if (r.problems.length === 0) crossCheck(r, data);
  if (r.problems.length > 0) throw new CatalogError(r.problems);
  return new Catalog(data);
}

type Obj = Record<string, unknown>;

/** Reads untyped JSON, collecting problems instead of stopping at the first one. */
class Reader {
  readonly problems: string[] = [];

  fail(path: string, message: string): void {
    this.problems.push(`${path}: ${message}`);
  }

  object(value: unknown, path: string): Obj {
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) return value as Obj;
    this.fail(path, 'must be an object');
    return {};
  }

  list(obj: Obj, key: string, path: string): unknown[] {
    const value = obj[key];
    if (Array.isArray(value)) return value;
    this.fail(`${path}.${key}`, 'must be a list');
    return [];
  }

  text(obj: Obj, key: string, path: string): string {
    const value = obj[key];
    if (typeof value === 'string' && value.trim() !== '') return value;
    this.fail(`${path}.${key}`, 'must be a non-empty string');
    return '';
  }

  number(obj: Obj, key: string, path: string, valid: (n: number) => boolean = () => true, rule = 'must be a number'): number {
    const value = obj[key];
    if (typeof value === 'number' && Number.isFinite(value) && valid(value)) return value;
    this.fail(`${path}.${key}`, rule);
    return 0;
  }

  positive(obj: Obj, key: string, path: string): number {
    return this.number(obj, key, path, (n) => n > 0, 'must be a number above 0');
  }

  count(obj: Obj, key: string, path: string): number {
    return this.number(obj, key, path, (n) => Number.isInteger(n) && n > 0, 'must be a whole number above 0');
  }

  index(obj: Obj, key: string, path: string): number {
    return this.number(obj, key, path, (n) => Number.isInteger(n) && n >= 0, 'must be a whole number, 0 or more');
  }

  choice<T extends string | number>(obj: Obj, key: string, path: string, options: readonly T[]): T {
    const value = obj[key];
    const match = options.find((option) => option === value);
    if (match !== undefined) return match;
    this.fail(`${path}.${key}`, `must be one of: ${options.join(', ')}`);
    return options[0] as T;
  }
}

/** Names an entry by its id when it has one, so messages point at the right place. */
function where(kind: string, index: number, obj: Obj): string {
  const id = obj['id'];
  return typeof id === 'string' && id !== '' ? `${kind} "${id}"` : `${kind} #${index + 1}`;
}

function parseTile(r: Reader, value: unknown, index: number): Tile {
  const o = r.object(value, `tile #${index + 1}`);
  const path = where('tile', index, o);
  const tile: Tile = {
    id: r.text(o, 'id', path),
    seriesId: r.text(o, 'seriesId', path),
    name: r.text(o, 'name', path),
    role: r.choice(o, 'role', path, TILE_ROLES),
    widthMm: r.positive(o, 'widthMm', path),
    heightMm: r.positive(o, 'heightMm', path),
    finish: r.choice(o, 'finish', path, FINISHES),
    tilesPerBox: r.count(o, 'tilesPerBox', path),
    placeholder: parsePlaceholder(r, o['placeholder'], `${path}.placeholder`),
  };
  if (o['textureUrl'] !== undefined) tile.textureUrl = r.text(o, 'textureUrl', path);
  return tile;
}

function parsePlaceholder(r: Reader, value: unknown, path: string): Placeholder {
  const o = r.object(value, path);
  const placeholder: Placeholder = { painter: r.text(o, 'painter', path), colors: [] };
  const colors = r.list(o, 'colors', path);
  colors.forEach((colour, i) => {
    if (typeof colour === 'string' && colour.trim() !== '') placeholder.colors.push(colour);
    else r.fail(`${path}.colors[${i}]`, 'must be a colour string');
  });
  if (Array.isArray(o['colors']) && colors.length === 0) r.fail(`${path}.colors`, 'needs at least one colour');
  if (o['seed'] !== undefined) placeholder.seed = r.number(o, 'seed', path);
  if (o['group'] !== undefined) {
    const gp = `${path}.group`;
    const g = r.object(o['group'], gp);
    const group: PlaceholderGroup = {
      id: r.text(g, 'id', gp),
      cols: r.count(g, 'cols', gp),
      rows: r.count(g, 'rows', gp),
      col: r.index(g, 'col', gp),
      row: r.index(g, 'row', gp),
    };
    if (group.col >= group.cols) r.fail(`${gp}.col`, `must be below cols (${group.cols})`);
    if (group.row >= group.rows) r.fail(`${gp}.row`, `must be below rows (${group.rows})`);
    placeholder.group = group;
  }
  return placeholder;
}

function parseSeries(r: Reader, value: unknown, index: number): Series {
  const o = r.object(value, `series #${index + 1}`);
  const path = where('series', index, o);
  return {
    id: r.text(o, 'id', path),
    name: r.text(o, 'name', path),
    surface: r.choice(o, 'surface', path, SURFACES),
    tileIds: r.list(o, 'tileIds', path).map((id, i) => {
      if (typeof id === 'string' && id !== '') return id;
      r.fail(`${path}.tileIds[${i}]`, 'must be a tile id');
      return '';
    }),
  };
}

function parseDesign(r: Reader, value: unknown, index: number): Design {
  const o = r.object(value, `design #${index + 1}`);
  const path = where('design', index, o);
  const design: Design = {
    id: r.text(o, 'id', path),
    name: r.text(o, 'name', path),
    seriesId: r.text(o, 'seriesId', path),
    cols: r.count(o, 'cols', path),
    rows: r.count(o, 'rows', path),
    slots: r.list(o, 'slots', path).map((slot, i) => parseSlot(r, slot, `${path}.slots[${i}]`)),
  };
  if (o['motifCentre'] !== undefined) {
    const mp = `${path}.motifCentre`;
    const m = r.object(o['motifCentre'], mp);
    design.motifCentre = { x: r.number(m, 'x', mp), y: r.number(m, 'y', mp) };
  }
  return design;
}

function parseSlot(r: Reader, value: unknown, path: string): DesignSlot {
  const o = r.object(value, path);
  return { tileId: r.text(o, 'tileId', path), rotation: r.choice(o, 'rotation', path, ROTATIONS) };
}

function parsePreset(r: Reader, value: unknown, index: number): Preset {
  const o = r.object(value, `preset #${index + 1}`);
  const path = where('preset', index, o);
  const bands = r.list(o, 'bands', path).map((band, i) => parsePresetBand(r, band, `${path}.bands[${i}]`));
  if (Array.isArray(o['bands']) && bands.length === 0) r.fail(`${path}.bands`, 'needs at least one band');
  bands.forEach((band, i) => {
    if (band.rows === 'fill' && i !== bands.length - 1) r.fail(`${path}.bands[${i}].rows`, 'only the top band can be "fill"');
  });
  return { id: r.text(o, 'id', path), name: r.text(o, 'name', path), bands };
}

function parsePresetBand(r: Reader, value: unknown, path: string): PresetBand {
  const o = r.object(value, path);
  const role = r.choice(o, 'role', path, PRESET_ROLES);
  const rows = o['rows'];
  if (rows === 'unit' || rows === 'fill') return { role, rows };
  if (typeof rows === 'number' && Number.isInteger(rows) && rows > 0) return { role, rows };
  r.fail(`${path}.rows`, 'must be a whole number above 0, "unit" or "fill"');
  return { role, rows: 1 };
}

/** Checks references between entries, once each entry is well formed. */
function crossCheck(r: Reader, data: CatalogData): void {
  const tiles = uniqueIndex(r, data.tiles, 'tile');
  const series = uniqueIndex(r, data.series, 'series');
  uniqueIndex(r, data.designs, 'design');
  uniqueIndex(r, data.presets, 'preset');

  for (const tile of data.tiles) {
    const owner = series.get(tile.seriesId);
    if (!owner) r.fail(`tile "${tile.id}"`, `unknown series "${tile.seriesId}"`);
    else if (!owner.tileIds.includes(tile.id)) r.fail(`tile "${tile.id}"`, `isn't listed in series "${owner.id}"`);
  }

  const sizes = new Map<string, { w: number; h: number }>();
  for (const s of data.series) {
    const path = `series "${s.id}"`;
    if (s.tileIds.length === 0) r.fail(path, 'has no tiles');
    const members: Tile[] = [];
    for (const id of s.tileIds) {
      const tile = tiles.get(id);
      if (!tile) r.fail(path, `unknown tile "${id}"`);
      else if (tile.seriesId !== s.id) r.fail(path, `tile "${id}" belongs to series "${tile.seriesId}"`);
      else members.push(tile);
    }
    const first = members[0];
    if (first) sizes.set(s.id, { w: first.widthMm, h: first.heightMm });
    for (const tile of members) {
      if (first && (Math.abs(tile.widthMm - first.widthMm) > EPS || Math.abs(tile.heightMm - first.heightMm) > EPS)) {
        r.fail(
          path,
          `all tiles must be the same size, but "${tile.id}" is ${tile.widthMm} × ${tile.heightMm} and "${first.id}" is ${first.widthMm} × ${first.heightMm}`,
        );
      }
      if (s.surface === 'floor' && tile.role !== 'floor') r.fail(`tile "${tile.id}"`, 'tiles in a floor series need the role "floor"');
      if (s.surface === 'wall' && tile.role === 'floor') r.fail(`tile "${tile.id}"`, 'tiles in a wall series must be light, dark or highlighter');
    }
  }

  for (const design of data.designs) {
    const path = `design "${design.id}"`;
    if (!series.has(design.seriesId)) {
      r.fail(path, `unknown series "${design.seriesId}"`);
      continue;
    }
    if (design.slots.length !== design.cols * design.rows) {
      r.fail(path, `has ${design.slots.length} slots, but ${design.cols} × ${design.rows} needs ${design.cols * design.rows}`);
    }
    design.slots.forEach((slot, i) => {
      const tile = tiles.get(slot.tileId);
      if (!tile) r.fail(path, `slot ${i + 1} uses unknown tile "${slot.tileId}"`);
      else if (tile.seriesId !== design.seriesId) r.fail(path, `slot ${i + 1} uses tile "${tile.id}" from another series`);
      else if (!isRotationAllowed(tile, slot.rotation)) {
        r.fail(
          path,
          `slot ${i + 1} turns the ${tile.widthMm} × ${tile.heightMm} tile "${tile.id}" by ${slot.rotation}°, but rectangular tiles only turn 0° or 180°`,
        );
      }
    });
    const size = sizes.get(design.seriesId);
    const m = design.motifCentre;
    if (m && size) {
      const unitW = design.cols * size.w;
      const unitH = design.rows * size.h;
      if (m.x < 0 || m.x > unitW || m.y < 0 || m.y > unitH) r.fail(path, `motifCentre must lie inside the ${unitW} × ${unitH} mm unit`);
    }
  }

  // Tiles sliced from one painted motif must agree on how it is painted.
  const groups = new Map<string, Tile[]>();
  for (const tile of data.tiles) {
    const group = tile.placeholder.group;
    if (group) groups.set(group.id, [...(groups.get(group.id) ?? []), tile]);
  }
  for (const [id, members] of groups) {
    const [first, ...rest] = members;
    if (!first?.placeholder.group) continue;
    const g = first.placeholder.group;
    const taken = new Set([`${g.col},${g.row}`]);
    for (const tile of rest) {
      const p = tile.placeholder;
      const tg = p.group;
      if (!tg) continue;
      const same =
        tile.seriesId === first.seriesId &&
        p.painter === first.placeholder.painter &&
        p.colors.join() === first.placeholder.colors.join() &&
        tg.cols === g.cols &&
        tg.rows === g.rows;
      if (!same) r.fail(`placeholder group "${id}"`, `tile "${tile.id}" must match "${first.id}" (series, painter, colours, cols and rows)`);
      const slice = `${tg.col},${tg.row}`;
      if (taken.has(slice)) r.fail(`placeholder group "${id}"`, `two tiles use slice ${slice}`);
      taken.add(slice);
    }
  }
}

function uniqueIndex<T extends { id: string }>(r: Reader, items: readonly T[], kind: string): Map<string, T> {
  const map = new Map<string, T>();
  for (const item of items) {
    if (map.has(item.id)) r.fail(`${kind} "${item.id}"`, 'id is used more than once');
    else map.set(item.id, item);
  }
  return map;
}
