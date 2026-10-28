/**
 * Geometry for fitting a surface to the photo: which rectangle the corners mark, where the whole
 * surface lands in the photo, and measuring a region in the surface's plane. Pure, no DOM.
 */
import { apply, applyHomogeneous, invert, rectCorners, surfaceToPhoto, type Mat3, type Pt, type Quad } from './homography';

/**
 * Where a tiled photo surface's tiles go, inside its corners: wherever the wall finder found that
 * kind of surface (so fixtures stay in front), everywhere inside the corners, or (auto) the first
 * unless the wall finder found too little of the area to trust.
 */
export type TileCover = 'auto' | 'found' | 'corners';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Extent {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** What a photo surface's corners mark, in surface mm: the whole surface, or a rectangle on it. */
export function markedRect(fit: { marks: 'surface' | 'rectangle'; rect: Rect }, surface: { widthMm: number; heightMm: number }): Rect {
  return fit.marks === 'surface' ? { x: 0, y: 0, w: surface.widthMm, h: surface.heightMm } : fit.rect;
}

/** Surface mm (y up) → photo pixels, or null if the corners are degenerate. */
export function surfaceMatrix(fit: { quad: Quad; marks: 'surface' | 'rectangle'; rect: Rect }, surface: { widthMm: number; heightMm: number }): Mat3 | null {
  return surfaceToPhoto(markedRect(fit, surface), fit.quad);
}

/** The whole surface's corners in the photo (bottom-left, bottom-right, top-right, top-left). */
export function surfaceOutline(toPhoto: Mat3, surface: { widthMm: number; heightMm: number }): Quad {
  return rectCorners(0, 0, surface.widthMm, surface.heightMm).map((p) => apply(toPhoto, p)) as Quad;
}

/** Whether four corners make a convex quadrilateral with no corners crossing over. */
export function isConvexQuad(quad: readonly Pt[]): boolean {
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const a = quad[i]!;
    const b = quad[(i + 1) % 4]!;
    const c = quad[(i + 2) % 4]!;
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (Math.abs(cross) < 1e-9) return false;
    if (sign === 0) sign = Math.sign(cross);
    else if (Math.sign(cross) !== sign) return false;
  }
  return true;
}

/**
 * The extent of photo points on a surface's plane, in mm. `onPlane` is a photo point known to be
 * on the surface (the marked rectangle's centre, say): points on the far side of the horizon
 * from it, where the plane has run off to infinity, are skipped. The extent is capped at ±limit.
 */
export function planeExtent(points: readonly Pt[], toPlane: Mat3, onPlane: Pt, limit = 20000): Extent | null {
  // A homography's overall sign is arbitrary, so "in front" is the side the known point is on.
  const side = Math.sign(applyHomogeneous(toPlane, onPlane)[2]);
  let extent: Extent | null = null;
  for (const p of points) {
    const [X, Y, W] = applyHomogeneous(toPlane, p);
    if (W * side <= 1e-9) continue;
    const x = Math.max(-limit, Math.min(limit, X / W));
    const y = Math.max(-limit, Math.min(limit, Y / W));
    extent = extent ? { minX: Math.min(extent.minX, x), minY: Math.min(extent.minY, y), maxX: Math.max(extent.maxX, x), maxY: Math.max(extent.maxY, y) } : { minX: x, minY: y, maxX: x, maxY: y };
  }
  return extent;
}

/** The photo → plane map for a rectangle of known size marked by four corners, with the rectangle at the origin. */
export function rectanglePlane(quad: Quad, size: { w: number; h: number }): Mat3 | null {
  const toPhoto = surfaceToPhoto({ x: 0, y: 0, w: size.w, h: size.h }, quad);
  return toPhoto && invert(toPhoto);
}

/**
 * Where the scanline at height y crosses each polygon edge, sorted left to right. Edges are taken
 * lower end first, so an edge gives the same crossing whichever way round the polygon runs.
 */
function crossings(points: readonly Pt[], y: number): number[] {
  const xs: number[] = [];
  for (let i = 0; i < points.length; i++) {
    let a = points[i]!;
    let b = points[(i + 1) % points.length]!;
    if (a.y > y === b.y > y) continue;
    if (a.y > b.y) [a, b] = [b, a];
    xs.push(a.x + ((y - a.y) / (b.y - a.y)) * (b.x - a.x));
  }
  return xs.sort((p, q) => p - q);
}

/** 1 for pixels whose centre lies inside a polygon (even-odd rule, as insidePolygon), 0 elsewhere. */
export function rasterPolygon(points: readonly Pt[], width: number, height: number): Uint8Array {
  const out = new Uint8Array(width * height);
  if (points.length < 3) return out;
  const ys = points.map((p) => p.y);
  const top = Math.max(0, Math.floor(Math.min(...ys)));
  const bottom = Math.min(height - 1, Math.ceil(Math.max(...ys)));
  for (let y = top; y <= bottom; y++) {
    const xs = crossings(points, y + 0.5);
    // A centre x + 0.5 is inside when xs[k] <= x + 0.5 < xs[k + 1].
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const from = Math.max(0, Math.ceil(xs[k]! - 0.5));
      const to = Math.min(width - 1, Math.ceil(xs[k + 1]! - 0.5) - 1);
      for (let x = from; x <= to; x++) out[y * width + x] = 1;
    }
  }
  return out;
}

/** Whether a point is inside a polygon (even-odd rule). */
export function insidePolygon(points: readonly Pt[], p: Pt): boolean {
  let right = 0;
  for (const x of crossings(points, p.y)) if (x > p.x) right++;
  return right % 2 === 1;
}

/**
 * Below this share of the area inside the corners, the wall finder has most likely missed the
 * surface (taken a plain wall for a door, say): the user's corners are trusted instead.
 */
export const FOUND_SHARE_MIN = 0.4;

/**
 * Where a tiled surface's tiles go, as a 0/1 mask: inside its corners (`inside`), either where
 * the wall finder labelled that kind of surface, or everywhere. Also returns how much of the
 * inside the wall finder found, and which of the two `cover` came to.
 */
export function tileArea(labels: Uint8Array, label: number, inside: Uint8Array, cover: TileCover): { area: Uint8Array; found: number; cover: 'found' | 'corners' } {
  let total = 0;
  let found = 0;
  for (let i = 0; i < inside.length; i++) {
    if (!inside[i]) continue;
    total++;
    if (labels[i] === label) found++;
  }
  const share = total > 0 ? found / total : 0;
  const resolved = cover === 'auto' ? (share >= FOUND_SHARE_MIN ? 'found' : 'corners') : cover;
  const area = new Uint8Array(inside.length);
  for (let i = 0; i < inside.length; i++) area[i] = inside[i] && (resolved === 'corners' || labels[i] === label) ? 1 : 0;
  return { area, found: share, cover: resolved };
}
