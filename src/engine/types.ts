/**
 * Data model and engine input/output types.
 *
 * Units are millimetres. A surface's origin is its bottom-left corner, with x to the
 * right and y up; renderers flip y.
 */

export type Rotation = 0 | 90 | 180 | 270;
export type SurfaceType = 'wall' | 'floor';
export type TileRole = 'light' | 'dark' | 'highlighter' | 'floor';
export type Finish = 'matt' | 'glossy';

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A motif painted once across several tiles and then sliced, like a printed series. */
export interface PlaceholderGroup {
  id: string;
  cols: number;
  rows: number;
  /** This tile's slice, counted from the group's bottom-left. */
  col: number;
  row: number;
}

/** Procedural stand-in texture, used until the tile has a real image (textureUrl). */
export interface Placeholder {
  painter: string;
  colors: string[];
  seed?: number;
  group?: PlaceholderGroup;
}

export interface Tile {
  id: string;
  seriesId: string;
  name: string;
  role: TileRole;
  /** Size as laid on the surface. */
  widthMm: number;
  heightMm: number;
  finish: Finish;
  tilesPerBox: number;
  /** Real tile image; overrides the placeholder. */
  textureUrl?: string;
  placeholder: Placeholder;
}

export interface Series {
  id: string;
  name: string;
  surface: SurfaceType;
  tileIds: string[];
}

/** Rotation is clockwise as seen on the surface. Tiles are never mirrored. */
export interface DesignSlot {
  tileId: string;
  rotation: Rotation;
}

/** A repeat unit. A plain design is a 1 × 1 unit. */
export interface Design {
  id: string;
  name: string;
  seriesId: string;
  cols: number;
  rows: number;
  /** Row-major, starting with the bottom row. */
  slots: DesignSlot[];
  /** Motif centre in mm from the unit's bottom-left corner. */
  motifCentre?: Point;
}

export type PresetRole = 'light' | 'dark' | 'highlighter';

/** A preset band names a role rather than a design, so one preset works for any wall series. */
export interface PresetBand {
  role: PresetRole;
  /** Tile rows, 'unit' for one repeat unit, or 'fill' for the rest of the wall. */
  rows: number | 'unit' | 'fill';
}

export interface Preset {
  id: string;
  name: string;
  /** From the floor up. */
  bands: PresetBand[];
}

/** A horizontal band of one design on a wall. */
export interface Band {
  designId: string;
  /** Tile rows (a multiple of the design's rows), or 'fill' on the top band. */
  rows: number | 'fill';
}

export type Layout =
  | {
      surface: 'wall';
      seriesId: string;
      /** From the floor up. */
      bands: Band[];
    }
  | { surface: 'floor'; seriesId: string; designId: string };

export interface Surface {
  widthMm: number;
  /** Wall height, or floor length. */
  heightMm: number;
  /** Walls only: tiles stop here. Defaults to heightMm. */
  tiledHeightMm?: number;
}

/**
 * centre-motif puts a motif centre on the centreline; centre-between-motifs puts the
 * centreline exactly midway between two neighbouring motif centres. Both are symmetric.
 */
export type XMode = 'left' | 'right' | 'centre-joint' | 'centre-tile' | 'centre-motif' | 'centre-between-motifs';
export type YMode = 'bottom' | 'top' | 'centre-joint' | 'centre-tile' | 'centre-motif' | 'centre-between-motifs';
export type AxisMode = XMode | YMode;

/** custom: the distance of the pattern origin from the left (or bottom) edge, in mm. */
export type AxisAlignment<M extends AxisMode> = { mode: M } | { mode: 'custom'; offsetMm: number };

export interface Alignment {
  x: AxisAlignment<XMode>;
  /** On walls the vertical offset only sets the bottom row's cut, so it wraps within one tile. */
  y: AxisAlignment<YMode>;
}

export interface CellOverride {
  tileId?: string;
  rotation?: Rotation;
}

/** Per-cell exceptions keyed by cellKey(col, row), with cells counted from the layout origin. */
export type Overrides = Readonly<Record<string, CellOverride>>;

export interface LayoutOptions {
  /** A cut smaller than this fraction of the tile (on its axis) is a sliver. Default 1/3. */
  minCutFraction?: number;
}

export type Edge = 'left' | 'right' | 'bottom' | 'top';

/** Visible size of the cut piece along each edge, or null where a full tile meets the edge. */
export interface EdgeCuts {
  left: number | null;
  right: number | null;
  bottom: number | null;
  top: number | null;
}

export interface PlacedPiece {
  tileId: string;
  rotation: Rotation;
  cell: { col: number; row: number };
  /** The full tile. */
  rect: Rect;
  /** The part inside the tiled area. */
  visibleRect: Rect;
  isCut: boolean;
  cutWidthMm: number;
  cutHeightMm: number;
  /** Index into the wall's bands; 0 on floors. */
  bandIndex: number;
  designId: string;
  /** Position inside the design's repeat unit. */
  unitCell: { col: number; row: number };
  overridden: boolean;
}

export interface UnitOutline {
  rect: Rect;
  bandIndex: number;
  designId: string;
}

export interface Guide {
  orientation: 'vertical' | 'horizontal';
  atMm: number;
  kind: 'centre' | 'tiled-height';
}

/** Where a wall band ends up, in mm from the floor. */
export interface BandExtent {
  index: number;
  designId: string;
  fill: boolean;
  rowStart: number;
  rowCount: number;
  visibleRows: number;
  fromMm: number;
  toMm: number;
  /** Cut off at the tiled height. */
  clipped: boolean;
  /** Entirely above the tiled height, or a fill band with no room left. */
  hidden: boolean;
}

export type WarningCode =
  | 'sliver'
  | 'band-clipped'
  | 'band-hidden'
  | 'band-gap'
  | 'alignment-fallback'
  | 'invalid-override';

export interface LayoutWarning {
  code: WarningCode;
  message: string;
  edge?: Edge;
  sizeMm?: number;
  bandIndex?: number;
}

export interface LayoutResult {
  surfaceType: SurfaceType;
  widthMm: number;
  heightMm: number;
  /** On floors this is the full length. */
  tiledHeightMm: number;
  tile: { w: number; h: number };
  /** Bottom-left corner of grid cell (0, 0). */
  origin: Point;
  /** Shifting the pattern by this much looks identical. */
  period: { x: number; y: number };
  /** The alignment actually used, after any fallback. */
  alignment: { x: XMode | 'custom'; y: YMode | 'custom' };
  /** Grid cells that reach the tiled area. */
  grid: { colMin: number; colMax: number; rowMin: number; rowMax: number };
  pieces: PlacedPiece[];
  motifCentres: Point[];
  unitOutlines: UnitOutline[];
  guides: Guide[];
  edgeCuts: EdgeCuts;
  /** Smallest acceptable cut along each axis. */
  minCutMm: { x: number; y: number };
  /** Walls only, from the floor up. */
  bands: BandExtent[];
  warnings: LayoutWarning[];
}
