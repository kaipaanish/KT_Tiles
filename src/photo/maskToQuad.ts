/**
 * A starting quadrilateral for a surface, from its segmentation mask. Pure maths, no DOM.
 *
 * The region under the tap is taken (minus anything other surfaces already claim), its holes
 * filled, its convex hull reduced to four corners, and the result checked against the region.
 */
import type { Pt, Quad } from './homography';

/** A binary image: non-zero bytes are in the region. */
export interface Mask {
  width: number;
  height: number;
  data: Uint8Array;
}

export interface QuadFit {
  /** Bottom-left, bottom-right, top-right, top-left, in photo pixels. */
  quad: Quad;
  /** 1 − IoU of the quad and the region (holes filled): 0 is a perfect fit. */
  mismatch: number;
  /**
   * The region isn't one rectangle (two walls meeting in a corner, say), so `quad` is only a
   * starter around the tap, for the user to drag to the wall's edges.
   */
  starter: boolean;
}

/** Above this, a region is too far from a single quadrilateral to force one. */
export const QUAD_MISMATCH_LIMIT = 0.15;

export function emptyMask(width: number, height: number): Mask {
  return { width, height, data: new Uint8Array(width * height) };
}

/** Pixels 4-connected to the seed, or null when the seed isn't in the region. */
export function regionAt(mask: Mask, seed: Pt): Mask | null {
  const { width, height, data } = mask;
  const sx = Math.floor(seed.x);
  const sy = Math.floor(seed.y);
  if (sx < 0 || sy < 0 || sx >= width || sy >= height || !data[sy * width + sx]) return null;
  return flood(mask, sy * width + sx);
}

function flood(mask: Mask, start: number): Mask {
  const { width, height, data } = mask;
  const out = emptyMask(width, height);
  const queue = new Int32Array(width * height);
  let head = 0;
  let tail = 0;
  queue[tail++] = start;
  out.data[start] = 1;
  const seen = out.data;
  const last = width * (height - 1);
  while (head < tail) {
    const i = queue[head++]!;
    const x = i % width;
    // The four neighbours, inline: an array per pixel would cost a phone dearly.
    if (x > 0 && data[i - 1] && !seen[i - 1]) {
      seen[i - 1] = 1;
      queue[tail++] = i - 1;
    }
    if (x < width - 1 && data[i + 1] && !seen[i + 1]) {
      seen[i + 1] = 1;
      queue[tail++] = i + 1;
    }
    if (i >= width && data[i - width] && !seen[i - width]) {
      seen[i - width] = 1;
      queue[tail++] = i - width;
    }
    if (i < last && data[i + width] && !seen[i + width]) {
      seen[i + width] = 1;
      queue[tail++] = i + width;
    }
  }
  return out;
}

/** The biggest 4-connected region, or null for an empty mask. */
export function largestRegion(mask: Mask): Mask | null {
  const seen = new Uint8Array(mask.data.length);
  let best: Mask | null = null;
  let bestSize = 0;
  for (let i = 0; i < mask.data.length; i++) {
    if (!mask.data[i] || seen[i]) continue;
    const region = flood(mask, i);
    let size = 0;
    for (let j = 0; j < region.data.length; j++) {
      if (region.data[j]) {
        seen[j] = 1;
        size++;
      }
    }
    if (size > bestSize) {
      best = region;
      bestSize = size;
    }
  }
  return best;
}

/** Fills enclosed holes, such as a mirror or basin with wall all round it. */
export function fillHoles(mask: Mask): Mask {
  const { width, height, data } = mask;
  // Background reachable from the border stays background; everything else joins the region.
  const outside = new Uint8Array(width * height);
  const queue = new Int32Array(width * height);
  let tail = 0;
  const push = (i: number) => {
    if (!data[i] && !outside[i]) {
      outside[i] = 1;
      queue[tail++] = i;
    }
  };
  for (let x = 0; x < width; x++) {
    push(x);
    push((height - 1) * width + x);
  }
  for (let y = 0; y < height; y++) {
    push(y * width);
    push(y * width + width - 1);
  }
  for (let head = 0; head < tail; head++) {
    const i = queue[head]!;
    const x = i % width;
    if (x > 0) push(i - 1);
    if (x < width - 1) push(i + 1);
    if (i >= width) push(i - width);
    if (i < width * (height - 1)) push(i + width);
  }
  const out = emptyMask(width, height);
  for (let i = 0; i < out.data.length; i++) out.data[i] = outside[i] ? 0 : 1;
  return out;
}

/** Corners of the leftmost and rightmost pixel in each row: enough to find the convex hull. */
export function rowExtremes(mask: Mask): Pt[] {
  const points: Pt[] = [];
  for (let y = 0; y < mask.height; y++) {
    let min = -1;
    let max = -1;
    for (let x = 0; x < mask.width; x++) {
      if (mask.data[y * mask.width + x]) {
        if (min < 0) min = x;
        max = x;
      }
    }
    if (min < 0) continue;
    points.push({ x: min, y }, { x: min, y: y + 1 }, { x: max + 1, y }, { x: max + 1, y: y + 1 });
  }
  return points;
}

const cross = (o: Pt, a: Pt, b: Pt) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

/** Convex hull (Andrew's monotone chain), counter-clockwise in y-up terms. */
export function convexHull(points: readonly Pt[]): Pt[] {
  const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  if (sorted.length < 3) return sorted;
  const lower: Pt[] = [];
  for (const p of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: Pt[] = [];
  for (let i = sorted.length - 1; i >= 0; i--) {
    const p = sorted[i]!;
    while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, p) <= 0) upper.pop();
    upper.push(p);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

export function polygonArea(points: readonly Pt[]): number {
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i]!;
    const b = points[(i + 1) % points.length]!;
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) / 2;
}

/** Drops hull vertices one at a time, always the one whose removal loses the least area, until four remain. */
export function simplifyToQuad(hull: readonly Pt[]): Pt[] | null {
  const poly = [...hull];
  if (poly.length < 4) return null;
  while (poly.length > 4) {
    let cheapest = 0;
    let loss = Infinity;
    for (let i = 0; i < poly.length; i++) {
      const prev = poly[(i - 1 + poly.length) % poly.length]!;
      const next = poly[(i + 1) % poly.length]!;
      const area = Math.abs(cross(prev, poly[i]!, next)) / 2;
      if (area < loss) {
        loss = area;
        cheapest = i;
      }
    }
    poly.splice(cheapest, 1);
  }
  return poly;
}

interface Line {
  point: Pt;
  dir: Pt;
}

/**
 * Best straight line through a chain of hull vertices. Each segment counts by its length, so the
 * long runs along a real edge outweigh the short ones where a pixelated corner is rounded off.
 */
function fitLine(chain: readonly Pt[]): Line | null {
  let total = 0;
  let cx = 0;
  let cy = 0;
  const segments: { mx: number; my: number; dx: number; dy: number; len: number }[] = [];
  for (let i = 0; i < chain.length - 1; i++) {
    const a = chain[i]!;
    const b = chain[i + 1]!;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len === 0) continue;
    segments.push({ mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2, dx: (b.x - a.x) / len, dy: (b.y - a.y) / len, len });
    total += len;
    cx += ((a.x + b.x) / 2) * len;
    cy += ((a.y + b.y) / 2) * len;
  }
  if (total === 0) return null;
  cx /= total;
  cy /= total;
  // Second moments of the segments (each a uniform line, not a point).
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (const s of segments) {
    const ox = s.mx - cx;
    const oy = s.my - cy;
    const k = (s.len * s.len) / 12;
    sxx += s.len * (ox * ox + k * s.dx * s.dx);
    syy += s.len * (oy * oy + k * s.dy * s.dy);
    sxy += s.len * (ox * oy + k * s.dx * s.dy);
  }
  const angle = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  return { point: { x: cx, y: cy }, dir: { x: Math.cos(angle), y: Math.sin(angle) } };
}

function intersect(a: Line, b: Line): Pt | null {
  const det = a.dir.x * b.dir.y - a.dir.y * b.dir.x;
  if (Math.abs(det) < 1e-9) return null;
  const t = ((b.point.x - a.point.x) * b.dir.y - (b.point.y - a.point.y) * b.dir.x) / det;
  return { x: a.point.x + t * a.dir.x, y: a.point.y + t * a.dir.y };
}

/**
 * Moves each corner to where the lines fitted along its two sides meet. The corners found by
 * simplifying the hull sit on the rounded tips of pixelated corners, a few pixels inside.
 */
function refineCorners(hull: readonly Pt[], corners: readonly Pt[]): Pt[] {
  const index = corners.map((c) => hull.indexOf(c)).sort((a, b) => a - b);
  if (index.some((i) => i < 0)) return [...corners];
  const lines: (Line | null)[] = index.map((start, k) => {
    const end = index[(k + 1) % 4]!;
    const chain: Pt[] = [];
    for (let i = start; ; i = (i + 1) % hull.length) {
      chain.push(hull[i]!);
      if (i === end) break;
    }
    return fitLine(chain);
  });
  const span = Math.max(...hull.map((p) => p.x)) - Math.min(...hull.map((p) => p.x)) + Math.max(...hull.map((p) => p.y)) - Math.min(...hull.map((p) => p.y));
  return index.map((hullIndex, k) => {
    const before = lines[(k + 3) % 4];
    const after = lines[k];
    const original = hull[hullIndex]!;
    const meet = before && after ? intersect(before, after) : null;
    // Keep the original when the sides are nearly parallel or the meeting point runs off.
    if (!meet || Math.hypot(meet.x - original.x, meet.y - original.y) > span * 0.1) return original;
    return { x: Math.round(meet.x * 1000) / 1000, y: Math.round(meet.y * 1000) / 1000 };
  });
}

/**
 * Puts four corners in surface order for a photo (y down): bottom-left, bottom-right, top-right,
 * top-left. Bottom-left is the corner furthest down and to the left.
 */
export function orderCorners(points: readonly Pt[]): Quad {
  const cx = points.reduce((s, p) => s + p.x, 0) / points.length;
  const cy = points.reduce((s, p) => s + p.y, 0) / points.length;
  // Decreasing angle in y-down coordinates runs bottom → right → top → left on screen.
  const ring = [...points].sort((a, b) => Math.atan2(b.y - cy, b.x - cx) - Math.atan2(a.y - cy, a.x - cx));
  let start = 0;
  ring.forEach((p, i) => {
    const s = ring[start]!;
    if (p.y - p.x > s.y - s.x) start = i;
  });
  const q = [0, 1, 2, 3].map((k) => ring[(start + k) % 4]!);
  return [q[0]!, q[1]!, q[2]!, q[3]!];
}

/** Whether a point is inside a convex quad (either winding). */
export function insideQuad(quad: readonly Pt[], p: Pt): boolean {
  let sign = 0;
  for (let i = 0; i < quad.length; i++) {
    const c = cross(quad[i]!, quad[(i + 1) % quad.length]!, p);
    if (c === 0) continue;
    if (sign === 0) sign = Math.sign(c);
    else if (Math.sign(c) !== sign) return false;
  }
  return true;
}

/** 1 − intersection-over-union of the quad and the region, by pixel centres. */
export function quadMismatch(region: Mask, quad: Quad): number {
  let both = 0;
  let either = 0;
  const xs = quad.map((p) => p.x);
  const ys = quad.map((p) => p.y);
  const x0 = Math.max(0, Math.floor(Math.min(...xs)));
  const x1 = Math.min(region.width - 1, Math.ceil(Math.max(...xs)));
  const y0 = Math.max(0, Math.floor(Math.min(...ys)));
  const y1 = Math.min(region.height - 1, Math.ceil(Math.max(...ys)));
  let inRegion = 0;
  for (let i = 0; i < region.data.length; i++) if (region.data[i]) inRegion++;
  let regionInBox = 0;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const r = region.data[y * region.width + x] ? 1 : 0;
      const q = insideQuad(quad, { x: x + 0.5, y: y + 0.5 }) ? 1 : 0;
      regionInBox += r;
      if (r && q) both++;
      if (r || q) either++;
    }
  }
  either += inRegion - regionInBox; // region pixels outside the quad's bounding box
  return either === 0 ? 0 : 1 - both / either;
}

/** A rectangle around the tap as tall as the region is there, for the user to drag into place. */
export function starterQuad(region: Mask, tap: Pt): Quad {
  const { width, height, data } = region;
  const column = Math.min(width - 1, Math.max(0, Math.floor(tap.x)));
  let top = -1;
  let bottom = -1;
  for (let y = 0; y < height; y++) {
    if (data[y * width + column]) {
      if (top < 0) top = y;
      bottom = y + 1;
    }
  }
  if (top < 0) {
    top = Math.max(0, tap.y - height / 4);
    bottom = Math.min(height, tap.y + height / 4);
  }
  const half = Math.max(8, ((bottom - top) * 0.6) / 2);
  const left = Math.max(0, tap.x - half);
  const right = Math.min(width, tap.x + half);
  return [
    { x: left, y: bottom },
    { x: right, y: bottom },
    { x: right, y: top },
    { x: left, y: top },
  ];
}

/**
 * Fits a surface's starting quad: the region under the tap (or the largest region), without
 * `exclude` (areas other surfaces already cover). Null when nothing is left to fit.
 */
export function fitQuad(mask: Mask, tap: Pt, exclude?: Mask): QuadFit | null {
  let source = mask;
  if (exclude) {
    source = emptyMask(mask.width, mask.height);
    for (let i = 0; i < mask.data.length; i++) source.data[i] = mask.data[i] && !exclude.data[i] ? 1 : 0;
  }
  const region = regionAt(source, tap) ?? largestRegion(source);
  if (!region) return null;
  const solid = fillHoles(region);
  const hull = convexHull(rowExtremes(solid));
  const corners = simplifyToQuad(hull);
  if (!corners) return null;
  const quad = orderCorners(refineCorners(hull, corners));
  const mismatch = quadMismatch(solid, quad);
  if (mismatch <= QUAD_MISMATCH_LIMIT) return { quad, mismatch, starter: false };
  return { quad: starterQuad(solid, tap), mismatch, starter: true };
}
