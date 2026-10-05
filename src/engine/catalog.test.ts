import { describe, expect, it } from 'vitest';
import seriesData from '../designs/series.json';
import { buildCatalog, CatalogError } from './catalog';
import { designForTile, designRole, presetsFor, resolvePreset } from './presets';
import { allowedRotations, isRotationAllowed, nextRotation } from './rotation';
import { AZURE, catalog, FLOOR, IVORY } from './testkit';
import { validateBands, validateLayout } from './validate';

/** A deep copy of series.json to break on purpose. */
const copy = (): typeof seriesData => structuredClone(seriesData);

function problemsOf(raw: unknown): readonly string[] {
  try {
    buildCatalog(raw);
  } catch (error) {
    if (error instanceof CatalogError) return error.problems;
    throw error;
  }
  return [];
}

describe('series.json', () => {
  it('passes validation', () => {
    expect(problemsOf(seriesData)).toEqual([]);
  });

  it('offers only the series for the current surface', () => {
    expect(catalog.seriesList('wall').map((s) => s.name)).toEqual(['Demo Ivory Bloom', 'Demo Azure Medallion']);
    expect(catalog.seriesList('floor').map((s) => s.name)).toEqual(['Demo Floor']);
  });
});

describe('rotation rules', () => {
  const rectangle = catalog.tile('ivory-light'); // 300 × 450
  const square = catalog.tile('azure-light'); // 300 × 300

  it('rejects 90° on a 300 × 450 tile and allows it on a 300 × 300 tile', () => {
    expect(isRotationAllowed(rectangle, 90)).toBe(false);
    expect(isRotationAllowed(rectangle, 270)).toBe(false);
    expect(isRotationAllowed(rectangle, 180)).toBe(true);
    expect(isRotationAllowed(square, 90)).toBe(true);
    expect(allowedRotations(rectangle)).toEqual([0, 180]);
    expect(allowedRotations(square)).toEqual([0, 90, 180, 270]);
  });

  it('steps through allowed rotations only', () => {
    expect(nextRotation(rectangle, 0)).toBe(180);
    expect(nextRotation(rectangle, 180)).toBe(0);
    expect(nextRotation(rectangle, 90)).toBe(0);
    expect(nextRotation(square, 270)).toBe(0);
    expect(nextRotation(square, 90)).toBe(180);
  });

  it('rejects series data that turns a rectangular tile 90°', () => {
    const data = copy();
    const pair = data.designs.find((d) => d.id === 'ivory-hl-pair');
    if (pair?.slots[0]) pair.slots[0].rotation = 90;
    expect(problemsOf(data)).toEqual([
      'design "ivory-hl-pair": slot 1 turns the 300 × 450 tile "ivory-hl-b" by 90°, but rectangular tiles only turn 0° or 180°',
    ]);
  });
});

describe('band validation', () => {
  it("rejects a band whose rows aren't a multiple of its design's rows", () => {
    expect(validateBands([{ designId: 'ivory-hl-pair', rows: 3 }], IVORY, catalog)).toEqual([
      "Band 1 (Highlighter pair): 3 rows isn't a multiple of the design's 2 rows.",
    ]);
    expect(validateBands([{ designId: 'ivory-hl-pair', rows: 4 }], IVORY, catalog)).toEqual([]);
  });

  it('allows fill only on the top band', () => {
    const problems = validateBands(
      [
        { designId: 'ivory-light-plain', rows: 'fill' },
        { designId: 'ivory-dark-plain', rows: 1 },
      ],
      IVORY,
      catalog,
    );
    expect(problems).toEqual(['Band 1 (Light): only the top band can fill the remaining height.']);
  });

  it('rejects empty, zero-row, unknown and cross-series bands', () => {
    expect(validateBands([], IVORY, catalog)).toEqual(['A wall needs at least one band.']);
    expect(validateBands([{ designId: 'ivory-light-plain', rows: 0 }], IVORY, catalog)).toHaveLength(1);
    expect(validateBands([{ designId: 'nope', rows: 1 }], IVORY, catalog)).toEqual(['Band 1 uses an unknown design "nope".']);
    expect(validateBands([{ designId: 'azure-light-plain', rows: 1 }], IVORY, catalog)).toEqual([
      'Band 1 uses "Light" from another series.',
    ]);
  });

  it('checks that a layout matches its surface', () => {
    expect(validateLayout({ surface: 'floor', seriesId: IVORY, designId: 'ivory-light-plain' }, catalog)).toEqual([
      'Demo Ivory Bloom is a wall series, not a floor series.',
    ]);
    expect(validateLayout({ surface: 'floor', seriesId: FLOOR, designId: 'floor-checker' }, catalog)).toEqual([]);
  });
});

describe('data validation', () => {
  it('lists every problem at once', () => {
    const data = copy();
    const light = data.tiles.find((t) => t.id === 'azure-light');
    if (light) light.widthMm = 600;
    const medallion = data.designs.find((d) => d.id === 'azure-medallion-2x2');
    medallion?.slots.pop();
    const checker = data.designs.find((d) => d.id === 'floor-checker');
    if (checker?.slots[0]) checker.slots[0].tileId = 'missing-tile';
    expect(problemsOf(data)).toEqual([
      'series "demo-azure-medallion": all tiles must be the same size, but "azure-dark" is 300 × 300 and "azure-light" is 600 × 300',
      'series "demo-azure-medallion": all tiles must be the same size, but "azure-hl" is 300 × 300 and "azure-light" is 600 × 300',
      'design "azure-medallion-2x2": has 3 slots, but 2 × 2 needs 4',
      'design "floor-checker": slot 1 uses unknown tile "missing-tile"',
    ]);
  });

  it('reports missing fields by path', () => {
    const data = copy();
    const tile: Record<string, unknown> | undefined = data.tiles[0];
    if (tile) {
      delete tile['tilesPerBox'];
      tile['role'] = 'accent';
    }
    expect(problemsOf(data)).toEqual([
      'tile "ivory-light".role: must be one of: light, dark, highlighter, floor',
      'tile "ivory-light".tilesPerBox: must be a whole number above 0',
    ]);
    expect(problemsOf(null)).toEqual(['series data: must be an object', 'series data.tiles: must be a list', 'series data.series: must be a list', 'series data.designs: must be a list']);
  });

  it('keeps floor and wall roles apart', () => {
    const data = copy();
    const grey = data.tiles.find((t) => t.id === 'floor-grey');
    if (grey) grey.role = 'light';
    expect(problemsOf(data)).toEqual(['tile "floor-grey": tiles in a floor series need the role "floor"']);
  });

  it('checks that tiles sliced from one motif agree', () => {
    const data = copy();
    const hlA = data.tiles.find((t) => t.id === 'ivory-hl-a');
    if (hlA?.placeholder.group) hlA.placeholder.group.row = 0;
    expect(problemsOf(data)).toEqual(['placeholder group "ivory-sprig": two tiles use slice 0,0']);
  });

  it('keeps motif centres inside their unit', () => {
    const data = copy();
    const pair = data.designs.find((d) => d.id === 'ivory-hl-pair');
    if (pair?.motifCentre) pair.motifCentre.y = 1000;
    expect(problemsOf(data)).toEqual(['design "ivory-hl-pair": motifCentre must lie inside the 300 × 900 mm unit']);
  });
});

describe('presets', () => {
  it('resolves the role-based presets for each wall series', () => {
    const highlighterBand = catalog.presets.find((p) => p.id === 'highlighter-band');
    if (!highlighterBand) throw new Error('missing preset');
    expect(resolvePreset(highlighterBand, IVORY, catalog)).toEqual([
      { designId: 'ivory-dark-plain', rows: 1 },
      { designId: 'ivory-light-plain', rows: 2 },
      { designId: 'ivory-hl-pair', rows: 2 },
      { designId: 'ivory-light-plain', rows: 'fill' },
    ]);
    expect(resolvePreset(highlighterBand, AZURE, catalog)).toEqual([
      { designId: 'azure-dark-plain', rows: 1 },
      { designId: 'azure-light-plain', rows: 2 },
      { designId: 'azure-medallion-2x2', rows: 2 },
      { designId: 'azure-light-plain', rows: 'fill' },
    ]);
    expect(presetsFor(IVORY, catalog).map((p) => p.preset.name)).toEqual(['Classic', 'Highlighter band', 'Feature wall']);
    expect(presetsFor(FLOOR, catalog)).toEqual([]);
  });

  it('knows each design’s role', () => {
    expect(designRole(catalog.design('ivory-hl-pair'), catalog)).toBe('highlighter');
    expect(designRole(catalog.design('azure-dark-plain'), catalog)).toBe('dark');
    expect(designRole(catalog.design('floor-checker'), catalog)).toBe('floor');
  });

  it('picks a design when a tile is assigned to a band', () => {
    expect(designForTile('ivory-light', catalog)?.id).toBe('ivory-light-plain');
    expect(designForTile('ivory-hl-a', catalog)?.id).toBe('ivory-hl-pair');
    expect(designForTile('azure-hl', catalog)?.id).toBe('azure-medallion-2x2');
  });
});

describe('demo motifs are sliced consistently', () => {
  it('the sprig pair stacks its slices in the order the design does', () => {
    const pair = catalog.design('ivory-hl-pair');
    pair.slots.forEach((slot, i) => {
      const group = catalog.tile(slot.tileId).placeholder.group;
      expect(slot.rotation).toBe(0);
      expect(group).toMatchObject({ col: i % pair.cols, row: Math.floor(i / pair.cols) });
    });
    // The motif centre is the middle of the painted group.
    expect(pair.motifCentre).toEqual({ x: 150, y: 450 });
  });

  it('the medallion tile is the bottom-left quarter of its painted group', () => {
    const group = catalog.tile('azure-hl').placeholder.group;
    expect(group).toMatchObject({ cols: 2, rows: 2, col: 0, row: 0 });
    expect(catalog.design('azure-medallion-2x2').motifCentre).toEqual({ x: 300, y: 300 });
  });
});
