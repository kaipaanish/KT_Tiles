/**
 * Brush corrections to a surface's region: each stroke adds to it or takes from it, in order.
 * Pure, no DOM.
 */
import type { BrushStroke } from '../state/document';
import type { Pt } from './homography';
import type { Mask } from './maskToQuad';

/** Squared distance from p to the segment ab. */
function distance2(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length2 = dx * dx + dy * dy;
  const t = length2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length2)) : 0;
  const x = a.x + t * dx - p.x;
  const y = a.y + t * dy - p.y;
  return x * x + y * y;
}

/**
 * Paints one stroke into a 0/1 mask: every pixel whose centre lies within the stroke's radius of
 * its path. Points and radius are in photo pixels; `scale` takes them to the mask's pixels.
 */
export function paintStroke(mask: Mask, stroke: BrushStroke, scale: { x: number; y: number }): void {
  const { width, height, data } = mask;
  const value = stroke.mode === 'add' ? 1 : 0;
  const r = stroke.radius * (scale.x + scale.y) / 2;
  const points = stroke.points.map((p) => ({ x: p.x * scale.x, y: p.y * scale.y }));
  const r2 = r * r;
  for (let i = 0; i < points.length; i++) {
    const a = points[Math.max(0, i - 1)]!;
    const b = points[i]!;
    const left = Math.max(0, Math.floor(Math.min(a.x, b.x) - r));
    const right = Math.min(width - 1, Math.ceil(Math.max(a.x, b.x) + r));
    const top = Math.max(0, Math.floor(Math.min(a.y, b.y) - r));
    const bottom = Math.min(height - 1, Math.ceil(Math.max(a.y, b.y) + r));
    for (let y = top; y <= bottom; y++) {
      for (let x = left; x <= right; x++) {
        if (distance2({ x: x + 0.5, y: y + 0.5 }, a, b) <= r2) data[y * width + x] = value;
      }
    }
  }
}

/** The region with every stroke applied, in order. */
export function applyStrokes(region: Mask, strokes: readonly BrushStroke[], photo: { width: number; height: number }): Mask {
  const mask: Mask = { width: region.width, height: region.height, data: region.data.slice() };
  const scale = { x: region.width / photo.width, y: region.height / photo.height };
  for (const stroke of strokes) paintStroke(mask, stroke, scale);
  return mask;
}
