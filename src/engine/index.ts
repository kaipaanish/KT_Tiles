/**
 * The layout engine: pure functions with no DOM or canvas, so the flat designer (step 1),
 * photo mode (step 2) and AR (step 3) all draw the same placed pieces.
 */
export * from './types';
export { Catalog, CatalogError, buildCatalog, type CatalogData } from './catalog';
export { allowedRotations, isRotationAllowed, nextRotation } from './rotation';
export { validateBands, validateLayout, assertValidLayout, LayoutError } from './validate';
export { designRole, designForRole, designForTile, isPlainDesign, presetsFor, resolvePreset, type DesignRole } from './presets';
export { planBands, type BandPlan, type PlannedBand } from './bands';
export { resolveAlignment, snapPatternOffset, tiledHeightOf, type ResolvedAlignment, type SnapResult } from './alignment';
export { DEFAULT_MIN_CUT_FRACTION, layoutSurface } from './layout';
export { suggestAlignments, type AlignmentSuggestion, type SuggestOptions, type SuggestPriority } from './suggest';
export { countTiles, tilesNeededFor, DEFAULT_ALLOWANCE_PCT, SQ_FT_PER_M2, type CountResult, type TileCount } from './count';
export { cellKey, parseCellKey, rebaseOverrides, shiftOverrides } from './overrides';
export { canonicalOffset, formatMm } from './math';
