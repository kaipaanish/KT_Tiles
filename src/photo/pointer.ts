/**
 * Pointer maths for editing a surface on a photo: photo pixels ↔ surface millimetres through
 * the surface's homography. Pure, no DOM.
 */
import { apply, type Mat3, type Pt } from './homography';

/** How far a drag from `from` to `to` (photo pixels) moves along the surface, in mm. */
export function dragDeltaMm(toSurface: Mat3, from: Pt, to: Pt): Pt {
  const a = apply(toSurface, from);
  const b = apply(toSurface, to);
  return { x: b.x - a.x, y: b.y - a.y };
}

/**
 * Photo pixels per millimetre at a point on the surface: the local scale, which shrinks with
 * distance. Used to turn a magnet radius in screen pixels into millimetres.
 */
export function pixelsPerMm(toPhoto: Mat3, at: Pt): number {
  const p = apply(toPhoto, at);
  const dx = apply(toPhoto, { x: at.x + 1, y: at.y });
  const dy = apply(toPhoto, { x: at.x, y: at.y + 1 });
  return (Math.hypot(dx.x - p.x, dx.y - p.y) + Math.hypot(dy.x - p.x, dy.y - p.y)) / 2;
}
