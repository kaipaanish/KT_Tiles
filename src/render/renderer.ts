import { formatMm, type Edge, type LayoutResult, type PlacedPiece, type Rect, type Rotation } from '../engine';
import type { TextureCache } from './textureCache';

/** Maps surface millimetres (y up) to CSS pixels (y down). */
export interface View {
  /** CSS pixels per millimetre. */
  scale: number;
  /** CSS pixel position of the surface's bottom-left corner. */
  originX: number;
  originY: number;
}

export function toScreen(view: View, x: number, y: number): { x: number; y: number } {
  return { x: view.originX + x * view.scale, y: view.originY - y * view.scale };
}

export function toSurface(view: View, sx: number, sy: number): { x: number; y: number } {
  return { x: (sx - view.originX) / view.scale, y: (view.originY - sy) / view.scale };
}

/** A surface rectangle in screen pixels (top-left based). */
export function screenRect(view: View, r: Rect): Rect {
  return { x: view.originX + r.x * view.scale, y: view.originY - (r.y + r.h) * view.scale, w: r.w * view.scale, h: r.h * view.scale };
}

export interface Appearance {
  groutMm: number;
  groutColor: string;
  showCuts: boolean;
  showRepeat: boolean;
  showMotifs: boolean;
  showDims: boolean;
}

export interface Overlay {
  /** A pattern drag is in progress: show centrelines, motif centres and live edge cuts. */
  dragging?: boolean;
  selectedCell?: { col: number; row: number } | null;
  selectedBand?: number | null;
  /** A cell lifted in Tile mode: drawn faded where it was. */
  liftedCell?: { col: number; row: number } | null;
  /** Where the lifted tile would drop. */
  dropCell?: { col: number; row: number } | null;
  /** The tile being carried in Tile mode, drawn under the pointer (CSS px). */
  floatingTile?: { tileId: string; rotation: Rotation; x: number; y: number } | null;
}

export interface Frame {
  /** CSS pixels. */
  width: number;
  height: number;
  dpr: number;
}

export const COLOURS = {
  backdrop: '#e9e5dc',
  wallPaint: '#f6f2ea',
  floorSurround: '#d9d3c7',
  outline: '#3b3a36',
  dims: '#55524b',
  guide: '#1f6feb',
  motif: '#d6336c',
  repeat: 'rgba(31, 111, 235, 0.9)',
  sliver: '#d92d20',
  ok: '#1a7f37',
  select: '#ff8a00',
};

const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

/** Draws a laid-out surface. The same function draws the screen and the exported PNG. */
export function drawScene(
  ctx: CanvasRenderingContext2D,
  frame: Frame,
  result: LayoutResult,
  view: View,
  textures: TextureCache,
  look: Appearance,
  overlay: Overlay = {},
  background: string = COLOURS.backdrop,
): void {
  const W = result.widthMm;
  const H = result.heightMm;
  const tiledH = result.tiledHeightMm;
  const surface = screenRect(view, { x: 0, y: 0, w: W, h: H });
  const tiled = screenRect(view, { x: 0, y: 0, w: W, h: tiledH });

  ctx.save();
  ctx.setTransform(frame.dpr, 0, 0, frame.dpr, 0, 0);
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, frame.width, frame.height);

  // The surface itself; on walls the part above the tiled height is painted plaster.
  ctx.fillStyle = result.surfaceType === 'wall' ? COLOURS.wallPaint : COLOURS.floorSurround;
  ctx.fillRect(surface.x, surface.y, surface.w, surface.h);
  if (result.surfaceType === 'wall' && tiledH < H && surface.h - tiled.h > 28) {
    ctx.fillStyle = 'rgba(85, 82, 75, 0.55)';
    ctx.font = `500 12px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Painted wall', surface.x + surface.w / 2, surface.y + (surface.h - tiled.h) / 2);
  }

  ctx.save();
  ctx.beginPath();
  ctx.rect(tiled.x, tiled.y, tiled.w, tiled.h);
  ctx.clip();
  drawPieces(ctx, frame, result, view, textures, overlay);
  drawGrout(ctx, frame, result, view, look);
  if (look.showCuts) drawCutHatching(ctx, frame, result, view);
  if (look.showRepeat) drawRepeat(ctx, result, view);
  ctx.restore();

  ctx.strokeStyle = COLOURS.outline;
  ctx.lineWidth = 1.5;
  ctx.strokeRect(surface.x, surface.y, surface.w, surface.h);
  if (result.surfaceType === 'wall' && tiledH < H) {
    ctx.strokeStyle = 'rgba(59, 58, 54, 0.55)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(tiled.x, tiled.y);
    ctx.lineTo(tiled.x + tiled.w, tiled.y);
    ctx.stroke();
  }

  drawSelection(ctx, result, view, overlay);
  if (overlay.dragging) drawGuides(ctx, result, view);
  if (look.showMotifs || overlay.dragging) drawMotifCentres(ctx, result, view);
  if (look.showDims) drawDimensions(ctx, result, view);
  if (look.showDims || overlay.dragging) drawEdgeCutLabels(ctx, result, view, !!overlay.dragging);
  if (overlay.floatingTile) drawFloatingTile(ctx, frame, result, view, textures, overlay.floatingTile);
  ctx.restore();
}

/** The carried tile, lifted above the finger with a shadow. */
function drawFloatingTile(
  ctx: CanvasRenderingContext2D,
  frame: Frame,
  result: LayoutResult,
  view: View,
  textures: TextureCache,
  tile: NonNullable<Overlay['floatingTile']>,
): void {
  const w = result.tile.w * view.scale * 1.08;
  const h = result.tile.h * view.scale * 1.08;
  ctx.save();
  ctx.translate(tile.x, tile.y - h * 0.35);
  ctx.rotate((tile.rotation * Math.PI) / 180);
  ctx.shadowColor = 'rgba(0, 0, 0, 0.35)';
  ctx.shadowBlur = 16;
  ctx.shadowOffsetY = 6;
  ctx.drawImage(textures.get(tile.tileId, view.scale * frame.dpr), -w / 2, -h / 2, w, h);
  ctx.shadowColor = 'transparent';
  ctx.strokeStyle = COLOURS.guide;
  ctx.lineWidth = 2;
  ctx.strokeRect(-w / 2, -h / 2, w, h);
  ctx.restore();
}

function onScreen(r: Rect, frame: Frame): boolean {
  return r.x < frame.width && r.y < frame.height && r.x + r.w > 0 && r.y + r.h > 0;
}

function drawPieces(ctx: CanvasRenderingContext2D, frame: Frame, result: LayoutResult, view: View, textures: TextureCache, overlay: Overlay): void {
  const devicePxPerMm = view.scale * frame.dpr;
  const lifted = overlay.liftedCell;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'medium';
  for (const piece of result.pieces) {
    const r = screenRect(view, piece.rect);
    if (!onScreen(r, frame)) continue;
    const image = textures.get(piece.tileId, devicePxPerMm);
    const isLifted = lifted && lifted.col === piece.cell.col && lifted.row === piece.cell.row;
    if (isLifted) ctx.globalAlpha = 0.25;
    if (piece.rotation === 0) {
      ctx.drawImage(image, r.x, r.y, r.w, r.h);
    } else {
      ctx.save();
      ctx.translate(r.x + r.w / 2, r.y + r.h / 2);
      ctx.rotate((piece.rotation * Math.PI) / 180);
      ctx.drawImage(image, -r.w / 2, -r.h / 2, r.w, r.h);
      ctx.restore();
    }
    if (isLifted) ctx.globalAlpha = 1;
  }
}

/** Joints between tiles, drawn over the tile edges (grout doesn't change the spacing). */
function drawGrout(ctx: CanvasRenderingContext2D, frame: Frame, result: LayoutResult, view: View, look: Appearance): void {
  const { tile, origin, grid, widthMm: W } = result;
  if (result.pieces.length === 0) return;
  let top = 0;
  for (const p of result.pieces) top = Math.max(top, p.visibleRect.y + p.visibleRect.h);
  ctx.strokeStyle = look.groutColor;
  ctx.lineWidth = Math.max(look.groutMm * view.scale, 1 / frame.dpr);
  ctx.beginPath();
  for (let c = grid.colMin + 1; c <= grid.colMax; c++) {
    const x = origin.x + c * tile.w;
    if (x <= 0 || x >= W) continue;
    const a = toScreen(view, x, 0);
    const b = toScreen(view, x, top);
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
  }
  for (let r = grid.rowMin + 1; r <= grid.rowMax; r++) {
    const y = origin.y + r * tile.h;
    if (y <= 0 || y >= top) continue;
    const a = toScreen(view, 0, y);
    const b = toScreen(view, W, y);
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
  }
  ctx.stroke();
}

const hatchCache = new Map<string, CanvasPattern | null>();

function hatch(ctx: CanvasRenderingContext2D, dpr: number, colour: string): CanvasPattern | null {
  const key = `${colour}@${dpr}`;
  if (hatchCache.has(key)) return hatchCache.get(key) ?? null;
  const size = Math.round(9 * dpr);
  const tileCanvas = document.createElement('canvas');
  tileCanvas.width = size;
  tileCanvas.height = size;
  const t = tileCanvas.getContext('2d');
  let pattern: CanvasPattern | null = null;
  if (t) {
    t.strokeStyle = colour;
    t.lineWidth = 1.4 * dpr;
    t.beginPath();
    for (const offset of [-size, 0, size]) {
      t.moveTo(offset, size);
      t.lineTo(offset + size, 0);
    }
    t.stroke();
    pattern = ctx.createPattern(tileCanvas, 'repeat');
    pattern?.setTransform(new DOMMatrix().scale(1 / dpr));
  }
  hatchCache.set(key, pattern);
  return pattern;
}

function isSliver(piece: PlacedPiece, result: LayoutResult): boolean {
  const { tile, minCutMm } = result;
  return (piece.cutWidthMm < tile.w - 1e-6 && piece.cutWidthMm < minCutMm.x - 1e-6) || (piece.cutHeightMm < tile.h - 1e-6 && piece.cutHeightMm < minCutMm.y - 1e-6);
}

function drawCutHatching(ctx: CanvasRenderingContext2D, frame: Frame, result: LayoutResult, view: View): void {
  const normal = hatch(ctx, frame.dpr, 'rgba(40, 40, 40, 0.38)');
  const sliver = hatch(ctx, frame.dpr, 'rgba(217, 45, 32, 0.75)');
  for (const piece of result.pieces) {
    if (!piece.isCut) continue;
    const r = screenRect(view, piece.visibleRect);
    if (!onScreen(r, frame)) continue;
    const pattern = isSliver(piece, result) ? sliver : normal;
    if (!pattern) continue;
    ctx.fillStyle = pattern;
    ctx.fillRect(r.x, r.y, r.w, r.h);
  }
}

function drawRepeat(ctx: CanvasRenderingContext2D, result: LayoutResult, view: View): void {
  // One path, stroked once: edges shared by neighbouring units are drawn a single time.
  ctx.beginPath();
  for (const unit of result.unitOutlines) {
    // A plain design repeats every tile, which the grout already shows.
    if (unit.rect.w <= result.tile.w && unit.rect.h <= result.tile.h) continue;
    const r = screenRect(view, unit.rect);
    ctx.rect(r.x, r.y, r.w, r.h);
  }
  ctx.strokeStyle = COLOURS.repeat;
  ctx.lineWidth = 2.5;
  ctx.stroke();
}

function drawSelection(ctx: CanvasRenderingContext2D, result: LayoutResult, view: View, overlay: Overlay): void {
  const band = overlay.selectedBand;
  if (band !== null && band !== undefined) {
    const extent = result.bands[band];
    if (extent && !extent.hidden) {
      const r = screenRect(view, { x: 0, y: extent.fromMm, w: result.widthMm, h: extent.toMm - extent.fromMm });
      ctx.fillStyle = 'rgba(255, 138, 0, 0.12)';
      ctx.fillRect(r.x, r.y, r.w, r.h);
      ctx.strokeStyle = COLOURS.select;
      ctx.lineWidth = 2.5;
      ctx.strokeRect(r.x, r.y, r.w, r.h);
    }
  }
  for (const [cell, colour, dash] of [
    [overlay.selectedCell, COLOURS.select, false],
    [overlay.dropCell, COLOURS.guide, true],
  ] as const) {
    if (!cell) continue;
    const piece = result.pieces.find((p) => p.cell.col === cell.col && p.cell.row === cell.row);
    if (!piece) continue;
    const r = screenRect(view, piece.visibleRect);
    ctx.strokeStyle = colour;
    ctx.lineWidth = 3;
    ctx.setLineDash(dash ? [5, 4] : []);
    ctx.strokeRect(r.x + 1.5, r.y + 1.5, r.w - 3, r.h - 3);
    ctx.setLineDash([]);
  }
}

function drawGuides(ctx: CanvasRenderingContext2D, result: LayoutResult, view: View): void {
  ctx.strokeStyle = COLOURS.guide;
  ctx.lineWidth = 1.5;
  ctx.setLineDash([8, 6]);
  ctx.beginPath();
  for (const guide of result.guides) {
    if (guide.kind !== 'centre') continue;
    // A wall's horizontal centre isn't an alignment target: bands set the vertical layout.
    if (guide.orientation === 'horizontal' && result.surfaceType === 'wall') continue;
    if (guide.orientation === 'vertical') {
      const a = toScreen(view, guide.atMm, -60);
      const b = toScreen(view, guide.atMm, result.heightMm + 60);
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
    } else {
      const a = toScreen(view, -60, guide.atMm);
      const b = toScreen(view, result.widthMm + 60, guide.atMm);
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
    }
  }
  ctx.stroke();
  ctx.setLineDash([]);
}

function drawMotifCentres(ctx: CanvasRenderingContext2D, result: LayoutResult, view: View): void {
  const centreX = result.widthMm / 2;
  for (const p of result.motifCentres) {
    const s = toScreen(view, p.x, p.y);
    const centred = Math.abs(p.x - centreX) < 0.5;
    ctx.beginPath();
    ctx.arc(s.x, s.y, centred ? 7 : 5, 0, Math.PI * 2);
    ctx.fillStyle = COLOURS.motif;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();
  }
}

/** A rounded label, as the edge cuts and dimensions use. */
export function pill(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, colour: string, strong: boolean): void {
  ctx.font = `${strong ? 700 : 600} 12px ${FONT}`;
  const w = ctx.measureText(text).width + 12;
  const h = 20;
  ctx.fillStyle = 'rgba(255, 255, 255, 0.92)';
  ctx.strokeStyle = colour;
  ctx.lineWidth = strong ? 2 : 1;
  ctx.beginPath();
  ctx.roundRect(x - w / 2, y - h / 2, w, h, 10);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = colour;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x, y + 0.5);
}

/** Cut sizes at each edge; cuts below the minimum turn red. */
function drawEdgeCutLabels(ctx: CanvasRenderingContext2D, result: LayoutResult, view: View, live: boolean): void {
  const { edgeCuts, minCutMm, widthMm: W, tiledHeightMm: Ht } = result;
  const tiled = screenRect(view, { x: 0, y: 0, w: W, h: Ht });
  const position: Record<Edge, { x: number; y: number }> = {
    left: { x: tiled.x + 30, y: tiled.y + tiled.h / 2 },
    right: { x: tiled.x + tiled.w - 30, y: tiled.y + tiled.h / 2 },
    bottom: { x: tiled.x + tiled.w / 2, y: tiled.y + tiled.h - 14 },
    top: { x: tiled.x + tiled.w / 2, y: tiled.y + 14 },
  };
  for (const edge of ['left', 'right', 'bottom', 'top'] as const) {
    const size = edgeCuts[edge];
    const axisMin = edge === 'left' || edge === 'right' ? minCutMm.x : minCutMm.y;
    if (size === null) {
      if (live) pill(ctx, 'full', position[edge].x, position[edge].y, COLOURS.ok, false);
      continue;
    }
    const sliver = size < axisMin - 1e-6;
    pill(ctx, `${formatMm(size)} mm`, position[edge].x, position[edge].y, sliver ? COLOURS.sliver : COLOURS.dims, sliver);
  }
}

function dimensionLine(ctx: CanvasRenderingContext2D, ax: number, ay: number, bx: number, by: number, label: string): void {
  const vertical = Math.abs(ax - bx) < 0.5;
  ctx.strokeStyle = COLOURS.dims;
  ctx.fillStyle = COLOURS.dims;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(ax, ay);
  ctx.lineTo(bx, by);
  const tick = 5;
  if (vertical) {
    ctx.moveTo(ax - tick, ay);
    ctx.lineTo(ax + tick, ay);
    ctx.moveTo(bx - tick, by);
    ctx.lineTo(bx + tick, by);
  } else {
    ctx.moveTo(ax, ay - tick);
    ctx.lineTo(ax, ay + tick);
    ctx.moveTo(bx, by - tick);
    ctx.lineTo(bx, by + tick);
  }
  ctx.stroke();
  ctx.font = `600 12px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const mx = (ax + bx) / 2;
  const my = (ay + by) / 2;
  const w = ctx.measureText(label).width + 8;
  ctx.save();
  ctx.translate(mx, my);
  if (vertical) ctx.rotate(-Math.PI / 2);
  ctx.fillStyle = COLOURS.backdrop;
  ctx.fillRect(-w / 2, -8, w, 16);
  ctx.fillStyle = COLOURS.dims;
  ctx.fillText(label, 0, 0.5);
  ctx.restore();
}

function drawDimensions(ctx: CanvasRenderingContext2D, result: LayoutResult, view: View): void {
  const W = result.widthMm;
  const H = result.heightMm;
  const s = screenRect(view, { x: 0, y: 0, w: W, h: H });
  const below = s.y + s.h + 18;
  dimensionLine(ctx, s.x, below, s.x + s.w, below, `${formatMm(W)} mm`);
  const left = s.x - 18;
  dimensionLine(ctx, left, s.y + s.h, left, s.y, `${formatMm(H)} mm`);
  if (result.surfaceType === 'wall' && result.tiledHeightMm < H) {
    const top = toScreen(view, 0, result.tiledHeightMm).y;
    const right = s.x + s.w + 18;
    dimensionLine(ctx, right, s.y + s.h, right, top, `tiled ${formatMm(result.tiledHeightMm)} mm`);
  }
}
