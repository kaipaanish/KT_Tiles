import type { Catalog, Design, Rotation } from '../engine';
import type { TextureCache } from './textureCache';

/** Sizes a canvas for crisp drawing at the device pixel ratio and returns its context. */
function prepare(canvas: HTMLCanvasElement, cssW: number, cssH: number): CanvasRenderingContext2D | null {
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  canvas.style.width = `${cssW}px`;
  canvas.style.height = `${cssH}px`;
  const ctx = canvas.getContext('2d');
  ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
  return ctx;
}

function drawTile(ctx: CanvasRenderingContext2D, image: CanvasImageSource, x: number, y: number, w: number, h: number, rotation: Rotation): void {
  if (rotation === 0) {
    ctx.drawImage(image, x, y, w, h);
    return;
  }
  ctx.save();
  ctx.translate(x + w / 2, y + h / 2);
  ctx.rotate((rotation * Math.PI) / 180);
  ctx.drawImage(image, -w / 2, -h / 2, w, h);
  ctx.restore();
}

/** One repeat unit of a design, fitted into a box of maxW × maxH CSS pixels. */
export function drawDesignPreview(canvas: HTMLCanvasElement, design: Design, catalog: Catalog, textures: TextureCache, maxW: number, maxH: number): void {
  const { w, h } = catalog.tileSize(design.seriesId);
  const unitW = design.cols * w;
  const unitH = design.rows * h;
  const scale = Math.min(maxW / unitW, maxH / unitH);
  const cssW = Math.max(1, Math.round(unitW * scale));
  const cssH = Math.max(1, Math.round(unitH * scale));
  const ctx = prepare(canvas, cssW, cssH);
  if (!ctx) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  design.slots.forEach((slot, i) => {
    const col = i % design.cols;
    const row = Math.floor(i / design.cols);
    // Slots start from the bottom row.
    const x = col * w * scale;
    const y = (design.rows - 1 - row) * h * scale;
    drawTile(ctx, textures.get(slot.tileId, scale * dpr), x, y, w * scale, h * scale, slot.rotation);
  });
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.7)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let c = 1; c < design.cols; c++) {
    ctx.moveTo(c * w * scale, 0);
    ctx.lineTo(c * w * scale, cssH);
  }
  for (let r = 1; r < design.rows; r++) {
    ctx.moveTo(0, r * h * scale);
    ctx.lineTo(cssW, r * h * scale);
  }
  ctx.stroke();
}

/** A single tile, fitted into a box of maxW × maxH CSS pixels. */
export function drawTilePreview(canvas: HTMLCanvasElement, tileId: string, catalog: Catalog, textures: TextureCache, maxW: number, maxH: number): void {
  const tile = catalog.tile(tileId);
  const scale = Math.min(maxW / tile.widthMm, maxH / tile.heightMm);
  const cssW = Math.max(1, Math.round(tile.widthMm * scale));
  const cssH = Math.max(1, Math.round(tile.heightMm * scale));
  const ctx = prepare(canvas, cssW, cssH);
  if (!ctx) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  drawTile(ctx, textures.get(tileId, scale * dpr), 0, 0, cssW, cssH, 0);
}
