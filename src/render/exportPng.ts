import type { LayoutResult } from '../engine';
import { drawScene, type Appearance } from './renderer';
import type { TextureCache } from './textureCache';

export interface ShareSummary {
  /** First line, in bold. */
  title: string;
  lines: string[];
  footer: string;
}

/** Laid out at 700 CSS px and drawn at 2×, so labels stay readable on a phone (1400 px wide). */
const WIDTH = 700;
const PIXEL_RATIO = 2;
const MARGIN = 48;
const PAD = 20;
const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

/** Packs pieces into lines no wider than maxWidth, joining them with `glue`. */
function pack(ctx: CanvasRenderingContext2D, pieces: readonly string[], glue: string, maxWidth: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const piece of pieces) {
    const next = line ? `${line}${glue}${piece}` : piece;
    if (ctx.measureText(next).width > maxWidth && line) {
      lines.push(line);
      line = piece;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/** Wraps at " · " first, so "HL-B: 10 tiles (2 boxes of 8)" stays together; long parts wrap by word. */
function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  return pack(ctx, text.split(' · '), ' · ', maxWidth).flatMap((line) =>
    ctx.measureText(line).width > maxWidth ? pack(ctx, line.split(' '), ' ', maxWidth) : [line],
  );
}

/** The summary strip's lines, wrapped to the strip laid out WIDTH CSS pixels wide, and its height. */
function measureStrip(summary: ShareSummary): { titleLines: string[]; bodyLines: string[]; height: number } {
  const probe = document.createElement('canvas').getContext('2d');
  if (!probe) throw new Error('Canvas 2D is not available');
  const textWidth = WIDTH - PAD * 2;
  probe.font = `700 16px ${FONT}`;
  const titleLines = wrap(probe, summary.title, textWidth);
  probe.font = `500 13px ${FONT}`;
  const bodyLines = summary.lines.flatMap((line) => wrap(probe, line, textWidth));
  return { titleLines, bodyLines, height: 20 + titleLines.length * 22 + bodyLines.length * 19 + 34 };
}

/** Draws the strip at a vertical offset (device pixels), laid out at WIDTH CSS pixels and scaled by `ratio`. */
function drawStrip(ctx: CanvasRenderingContext2D, summary: ShareSummary, strip: ReturnType<typeof measureStrip>, top: number, ratio: number): void {
  ctx.setTransform(ratio, 0, 0, ratio, 0, top);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, WIDTH, strip.height);
  ctx.fillStyle = '#d9d3c7';
  ctx.fillRect(0, 0, WIDTH, 1);
  ctx.textBaseline = 'alphabetic';
  let y = 30;
  ctx.fillStyle = '#23221f';
  ctx.font = `700 16px ${FONT}`;
  for (const line of strip.titleLines) {
    ctx.fillText(line, PAD, y);
    y += 22;
  }
  ctx.fillStyle = '#3b3a36';
  ctx.font = `500 13px ${FONT}`;
  for (const line of strip.bodyLines) {
    ctx.fillText(line, PAD, y);
    y += 19;
  }
  ctx.fillStyle = '#8a857b';
  ctx.font = `500 11px ${FONT}`;
  ctx.fillText(summary.footer, PAD, y + 10);
}

/**
 * The surface with its dimensions, and a strip below it summarising the series, size and
 * tile counts: a picture a salesperson can send on WhatsApp.
 */
export function renderShareImage(result: LayoutResult, textures: TextureCache, look: Appearance, summary: ShareSummary): HTMLCanvasElement {
  const scale = (WIDTH - MARGIN * 2) / result.widthMm;
  const drawingHeight = Math.round(result.heightMm * scale + MARGIN * 2);
  // Measure the strip first, so the canvas is sized once.
  const strip = measureStrip(summary);
  const canvas = document.createElement('canvas');
  canvas.width = WIDTH * PIXEL_RATIO;
  canvas.height = (drawingHeight + strip.height) * PIXEL_RATIO;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D is not available');
  const view = { scale, originX: MARGIN, originY: drawingHeight - MARGIN };
  drawScene(ctx, { width: WIDTH, height: drawingHeight, dpr: PIXEL_RATIO }, result, view, textures, { ...look, showDims: true }, {}, '#f4f1ea');
  drawStrip(ctx, summary, strip, drawingHeight * PIXEL_RATIO, PIXEL_RATIO);
  return canvas;
}

/**
 * A picture (the photo with its tiles) with the same summary strip below it, laid out as the
 * designer's and scaled to the picture's width.
 */
export function renderPhotoShareImage(picture: HTMLCanvasElement, summary: ShareSummary): HTMLCanvasElement {
  const strip = measureStrip(summary);
  const ratio = picture.width / WIDTH;
  const canvas = document.createElement('canvas');
  canvas.width = picture.width;
  canvas.height = picture.height + Math.ceil(strip.height * ratio);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D is not available');
  ctx.drawImage(picture, 0, 0);
  drawStrip(ctx, summary, strip, picture.height, ratio);
  return canvas;
}

export function canvasToPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Could not make the picture'))), 'image/png');
  });
}
