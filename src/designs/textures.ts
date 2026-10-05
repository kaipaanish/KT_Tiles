import type { Placeholder, Tile } from '../engine';
import { painters, seededRandom } from './painters';

/** Resolution of painted placeholders: a 300 × 450 mm tile becomes 600 × 900 px. */
export const PLACEHOLDER_PX_PER_MM = 2;

export function createCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  return canvas;
}

export function context2d(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D is not available');
  return ctx;
}

/**
 * Paints a tile's placeholder. A motif shared by several tiles is painted once for its whole
 * group (kept in `groups`) and this tile's slice is cut from it, so the motif lines up across
 * the joints exactly as a printed series does.
 */
export function paintPlaceholder(tile: Tile, pxPerMm: number, groups: Map<string, HTMLCanvasElement>): HTMLCanvasElement {
  const p = tile.placeholder;
  const tileW = Math.round(tile.widthMm * pxPerMm);
  const tileH = Math.round(tile.heightMm * pxPerMm);
  const group = p.group;
  if (!group) return paint(p, tile.widthMm, tile.heightMm, tileW, tileH);

  const key = `${group.id}@${pxPerMm}`;
  let source = groups.get(key);
  if (!source) {
    source = paint(p, group.cols * tile.widthMm, group.rows * tile.heightMm, group.cols * tileW, group.rows * tileH);
    groups.set(key, source);
  }
  const slice = createCanvas(tileW, tileH);
  // Group rows count from the bottom; canvas rows count from the top.
  context2d(slice).drawImage(source, group.col * tileW, (group.rows - 1 - group.row) * tileH, tileW, tileH, 0, 0, tileW, tileH);
  return slice;
}

function paint(p: Placeholder, widthMm: number, heightMm: number, pxW: number, pxH: number): HTMLCanvasElement {
  const canvas = createCanvas(pxW, pxH);
  const ctx = context2d(canvas);
  ctx.scale(pxW / widthMm, pxH / heightMm);
  const painter = painters[p.painter] ?? painters['flat'];
  painter?.({ ctx, widthMm, heightMm, pxPerMm: pxW / widthMm, colors: p.colors, random: seededRandom(p.seed ?? 1) });
  return canvas;
}

/** Loads a real tile image (textureUrl). */
export async function loadImage(url: string): Promise<HTMLImageElement> {
  const image = new Image();
  image.decoding = 'async';
  image.src = url;
  await image.decode();
  return image;
}
