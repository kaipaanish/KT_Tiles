/**
 * Plane-to-plane projective maps (homographies) for laying a flat surface onto a photo.
 * Pure maths, no DOM. Matrices are 3 × 3, row-major.
 */

export type Mat3 = [number, number, number, number, number, number, number, number, number];

export interface Pt {
  x: number;
  y: number;
}

/** Corners of a surface rectangle in the photo, in surface order: bottom-left, bottom-right, top-right, top-left. */
export type Quad = [Pt, Pt, Pt, Pt];

export const IDENTITY: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];

export function multiply(a: Mat3, b: Mat3): Mat3 {
  const r = new Array<number>(9).fill(0);
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      r[i * 3 + j] = a[i * 3]! * b[j]! + a[i * 3 + 1]! * b[3 + j]! + a[i * 3 + 2]! * b[6 + j]!;
    }
  }
  return r as Mat3;
}

/** (X, Y, W) before the perspective divide. */
export function applyHomogeneous(h: Mat3, p: Pt): [number, number, number] {
  return [h[0] * p.x + h[1] * p.y + h[2], h[3] * p.x + h[4] * p.y + h[5], h[6] * p.x + h[7] * p.y + h[8]];
}

export function apply(h: Mat3, p: Pt): Pt {
  const [x, y, w] = applyHomogeneous(h, p);
  return { x: x / w, y: y / w };
}

export function invert(m: Mat3): Mat3 | null {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h;
  const B = -(d * i - f * g);
  const C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (!Number.isFinite(det) || Math.abs(det) < 1e-12) return null;
  const inv: Mat3 = [
    A / det,
    -(b * i - c * h) / det,
    (b * f - c * e) / det,
    B / det,
    (a * i - c * g) / det,
    -(a * f - c * d) / det,
    C / det,
    -(a * h - b * g) / det,
    (a * e - b * d) / det,
  ];
  return normalise(inv);
}

/** Scales so the bottom-right entry is 1 (when it can be), which keeps numbers comparable. */
function normalise(m: Mat3): Mat3 {
  const s = Math.abs(m[8]) > 1e-12 ? m[8] : 1;
  return m.map((v) => v / s) as Mat3;
}

/** Moves points to their centroid and scales them to an average distance of √2 (Hartley), for a well-conditioned solve. */
function conditioning(points: readonly Pt[]): Mat3 {
  const cx = points.reduce((s, p) => s + p.x, 0) / points.length;
  const cy = points.reduce((s, p) => s + p.y, 0) / points.length;
  const mean = points.reduce((s, p) => s + Math.hypot(p.x - cx, p.y - cy), 0) / points.length;
  const k = mean > 0 ? Math.SQRT2 / mean : 1;
  return [k, 0, -k * cx, 0, k, -k * cy, 0, 0, 1];
}

/** Solves the 8 × 8 system with partial pivoting. */
function solveLinear(a: number[][], b: number[]): number[] | null {
  const n = b.length;
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let row = col + 1; row < n; row++) if (Math.abs(a[row]![col]!) > Math.abs(a[pivot]![col]!)) pivot = row;
    if (Math.abs(a[pivot]![col]!) < 1e-12) return null;
    [a[col], a[pivot]] = [a[pivot]!, a[col]!];
    [b[col], b[pivot]] = [b[pivot]!, b[col]!];
    for (let row = col + 1; row < n; row++) {
      const f = a[row]![col]! / a[col]![col]!;
      for (let k = col; k < n; k++) a[row]![k]! -= f * a[col]![k]!;
      b[row]! -= f * b[col]!;
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let row = n - 1; row >= 0; row--) {
    let s = b[row]!;
    for (let k = row + 1; k < n; k++) s -= a[row]![k]! * x[k]!;
    x[row] = s / a[row]![row]!;
  }
  return x;
}

/**
 * The homography taking each `from[i]` to `to[i]` (four point pairs, no three collinear).
 * Returns null for degenerate input.
 */
export function solveHomography(from: readonly Pt[], to: readonly Pt[]): Mat3 | null {
  if (from.length !== 4 || to.length !== 4) return null;
  const tFrom = conditioning(from);
  const tTo = conditioning(to);
  const src = from.map((p) => apply(tFrom, p));
  const dst = to.map((p) => apply(tTo, p));
  const a: number[][] = [];
  const b: number[] = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = src[i]!;
    const { x: u, y: v } = dst[i]!;
    a.push([x, y, 1, 0, 0, 0, -x * u, -y * u]);
    b.push(u);
    a.push([0, 0, 0, x, y, 1, -x * v, -y * v]);
    b.push(v);
  }
  const h = solveLinear(a, b);
  if (!h) return null;
  const conditioned: Mat3 = [h[0]!, h[1]!, h[2]!, h[3]!, h[4]!, h[5]!, h[6]!, h[7]!, 1];
  const undo = invert(tTo);
  if (!undo) return null;
  const result = normalise(multiply(undo, multiply(conditioned, tFrom)));
  return result.every(Number.isFinite) ? result : null;
}

/** A rectangle on the surface (mm, y up), in surface corner order. */
export function rectCorners(x: number, y: number, w: number, h: number): Quad {
  return [
    { x, y },
    { x: x + w, y },
    { x: x + w, y: y + h },
    { x, y: y + h },
  ];
}

/** Maps surface mm to photo pixels, given where a known rectangle of the surface sits in the photo. */
export function surfaceToPhoto(rect: { x: number; y: number; w: number; h: number }, quad: Quad): Mat3 | null {
  return solveHomography(rectCorners(rect.x, rect.y, rect.w, rect.h), quad);
}
