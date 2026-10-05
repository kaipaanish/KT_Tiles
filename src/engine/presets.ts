import type { Catalog } from './catalog';
import type { Band, Design, Preset, PresetRole, TileRole } from './types';

export type DesignRole = TileRole | 'mixed';

/** Highlighter if any tile is a highlighter, otherwise the role its tiles share. */
export function designRole(design: Design, catalog: Catalog): DesignRole {
  const roles = new Set(design.slots.map((slot) => catalog.tile(slot.tileId).role));
  if (roles.has('highlighter')) return 'highlighter';
  const [only] = roles;
  return roles.size === 1 && only ? only : 'mixed';
}

export function isPlainDesign(design: Design): boolean {
  return design.cols === 1 && design.rows === 1;
}

/** The design a preset role means in a series: the plain one for light and dark, the first highlighter design otherwise. */
export function designForRole(seriesId: string, role: PresetRole, catalog: Catalog): Design | undefined {
  const matches = catalog.designsOf(seriesId).filter((d) => designRole(d, catalog) === role);
  return role === 'highlighter' ? matches[0] : (matches.find(isPlainDesign) ?? matches[0]);
}

/** Turns a role-based preset into bands for one series, or null if the series lacks one of the roles. */
export function resolvePreset(preset: Preset, seriesId: string, catalog: Catalog): Band[] | null {
  const bands: Band[] = [];
  for (const band of preset.bands) {
    const design = designForRole(seriesId, band.role, catalog);
    if (!design) return null;
    const rows =
      band.rows === 'fill' ? 'fill' : band.rows === 'unit' ? design.rows : Math.ceil(band.rows / design.rows) * design.rows;
    bands.push({ designId: design.id, rows });
  }
  return bands;
}

/** The presets that work for a series, already turned into bands. */
export function presetsFor(seriesId: string, catalog: Catalog): { preset: Preset; bands: Band[] }[] {
  return catalog.presets.flatMap((preset) => {
    const bands = resolvePreset(preset, seriesId, catalog);
    return bands ? [{ preset, bands }] : [];
  });
}

/**
 * The design to use when a tile is assigned to a band: the tile's plain design, or else the
 * smallest design that contains it (HL-A gives the Highlighter pair).
 */
export function designForTile(tileId: string, catalog: Catalog): Design | undefined {
  const { seriesId } = catalog.tile(tileId);
  const containing = catalog.designsOf(seriesId).filter((d) => d.slots.some((slot) => slot.tileId === tileId));
  const plain = containing.find((d) => isPlainDesign(d) && d.slots[0]?.rotation === 0);
  return plain ?? [...containing].sort((a, b) => a.cols * a.rows - b.cols * b.rows)[0];
}
