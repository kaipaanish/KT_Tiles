/**
 * The straight lines on a wall and where they meet. When a wall runs past the photo's edges, its
 * outline says nothing about which way it faces, but its own lines do: tile joints, stripes,
 * skirting and its edges run towards two vanishing points, one for the wall's horizontal lines
 * and one for its vertical ones. Pure maths, no DOM.
 */
import type { RGBAImage } from '../segment/segmenter';
import type { Pt, Quad } from './homography';

/** Grey levels 0–1, row-major. */
export interface GreyImage {
  width: number;
  height: number;
  data: Float32Array;
}

export interface Segment {
  a: Pt;
  b: Pt;
  length: number;
}

/** A point as [x, y, w], meaning (x / w, y / w); with w = 0, a direction (a point at infinity). */
export type Homogeneous = [number, number, number];

/** Where the wall's horizontal lines meet (h) and its vertical ones (v), in photo pixels. */
export interface Vanishing {
  h: Homogeneous;
  v: Homogeneous;
}

/** The vanishing points and the lines that found them. */
export interface WallLines extends Vanishing {
  horizontal: Segment[];
  vertical: Segment[];
}

export function greyImage(image: RGBAImage): GreyImage {
  const data = new Float32Array(image.width * image.height);
  for (let i = 0; i < data.length; i++) data[i] = (0.299 * image.data[i * 4]! + 0.587 * image.data[i * 4 + 1]! + 0.114 * image.data[i * 4 + 2]!) / 255;
  return { width: image.width, height: image.height, data };
}

// ---- Homogeneous points and lines -----------------------------------------------------------

export function cross3(a: readonly number[], b: readonly number[]): Homogeneous {
  return [a[1]! * b[2]! - a[2]! * b[1]!, a[2]! * b[0]! - a[0]! * b[2]!, a[0]! * b[1]! - a[1]! * b[0]!];
}

const lift = (p: Pt): Homogeneous => [p.x, p.y, 1];

function unit(v: Homogeneous): Homogeneous {
  const n = Math.hypot(v[0], v[1], v[2]);
  return n > 0 ? [v[0] / n, v[1] / n, v[2] / n] : v;
}

/** The point, or null when it is at (or too near) infinity. */
function drop(v: Homogeneous): Pt | null {
  const scale = Math.hypot(v[0], v[1]);
  if (Math.abs(v[2]) <= scale * 1e-9) return null;
  const p = { x: v[0] / v[2], y: v[1] / v[2] };
  return Number.isFinite(p.x) && Number.isFinite(p.y) ? p : null;
}

/** The direction from a point towards a vanishing point (either way along the line). */
function towards(p: Pt, v: Homogeneous): Pt {
  return { x: v[0] - p.x * v[2], y: v[1] - p.y * v[2] };
}

// ---- Line segments ---------------------------------------------------------------------------

/** Pixels whose gradients point within this angle of a line's join it. */
const ANGLE_TOLERANCE = Math.PI / 8;
/** Gradients weaker than this (grey levels per pixel) are noise: LSD's 2 / sin(22.5°) on 0–255. */
const MIN_GRADIENT = 2 / 255 / Math.sin(ANGLE_TOLERANCE);

function angleBetween(a: number, b: number): number {
  const d = Math.abs(a - b) % (2 * Math.PI);
  return d > Math.PI ? 2 * Math.PI - d : d;
}

/** A 3 × 3 box blur, so fine texture (plaster, mesh, fabric) doesn't break lines up. */
function blur3(data: Float32Array, width: number, height: number): Float32Array {
  const across = new Float32Array(data.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      across[i] = (data[x > 0 ? i - 1 : i]! + data[i]! + data[x < width - 1 ? i + 1 : i]!) / 3;
    }
  }
  const out = new Float32Array(data.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      out[i] = (across[y > 0 ? i - width : i]! + across[i]! + across[y < height - 1 ? i + width : i]!) / 3;
    }
  }
  return out;
}

/**
 * Straight line segments, in the manner of LSD (the Line Segment Detector): starting from the
 * strongest gradients, it grows regions of neighbouring pixels whose gradients point the same way,
 * and keeps the long, thin, solid ones. Positions are in the image's pixels.
 */
export function findSegments(image: GreyImage, minLength = Math.max(image.width, image.height) * 0.04): Segment[] {
  const { width: W, height: H } = image;
  if (W < 3 || H < 3) return [];
  const smooth = blur3(image.data, W, H);
  // A 2 × 2 gradient, centred on the corner the four pixels share: (x + 1, y + 1).
  const magnitude = new Float32Array(W * H);
  const angle = new Float32Array(W * H);
  const used = new Uint8Array(W * H).fill(1);
  let strongest = 0;
  for (let y = 0; y < H - 1; y++) {
    for (let x = 0; x < W - 1; x++) {
      const i = y * W + x;
      const a = smooth[i]!;
      const b = smooth[i + 1]!;
      const c = smooth[i + W]!;
      const d = smooth[i + W + 1]!;
      const gx = (b + d - a - c) / 2;
      const gy = (c + d - a - b) / 2;
      const m = Math.hypot(gx, gy);
      magnitude[i] = m;
      angle[i] = Math.atan2(gy, gx);
      if (m >= MIN_GRADIENT) {
        used[i] = 0;
        if (m > strongest) strongest = m;
      }
    }
  }
  // Seeds strongest first, by bucket sort.
  const BUCKETS = 1024;
  const counts = new Int32Array(BUCKETS + 1);
  const bucketOf = (m: number) => Math.min(BUCKETS - 1, Math.floor((m / strongest) * BUCKETS));
  for (let i = 0; i < used.length; i++) if (!used[i]) counts[BUCKETS - 1 - bucketOf(magnitude[i]!)]!++;
  for (let k = 1; k <= BUCKETS; k++) counts[k]! += counts[k - 1]!;
  const order = new Int32Array(counts[BUCKETS - 1]!);
  const fill = new Int32Array(BUCKETS);
  for (let i = 0; i < used.length; i++) {
    if (used[i]) continue;
    const k = BUCKETS - 1 - bucketOf(magnitude[i]!);
    order[(k > 0 ? counts[k - 1]! : 0) + fill[k]!++] = i;
  }

  const segments: Segment[] = [];
  const region = new Int32Array(W * H);
  const minPixels = Math.max(5, Math.round(minLength / 2));
  for (const seed of order) {
    if (used[seed]) continue;
    let n = 0;
    region[n++] = seed;
    used[seed] = 1;
    let sx = Math.cos(angle[seed]!);
    let sy = Math.sin(angle[seed]!);
    let theta = angle[seed]!;
    for (let k = 0; k < n; k++) {
      const i = region[k]!;
      const x = i % W;
      const y = (i - x) / W;
      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= H - 1) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          if (nx < 0 || nx >= W - 1) continue;
          const j = ny * W + nx;
          if (used[j] || angleBetween(angle[j]!, theta) > ANGLE_TOLERANCE) continue;
          used[j] = 1;
          region[n++] = j;
          sx += Math.cos(angle[j]!);
          sy += Math.sin(angle[j]!);
          theta = Math.atan2(sy, sx);
        }
      }
    }
    if (n < minPixels) continue;
    const segment = fitSegment(region, n, W, magnitude, minLength);
    if (segment) segments.push(segment);
  }
  return segments;
}

/** The rectangle a region of pixels fills, as a segment along its middle; null unless long, thin and solid. */
function fitSegment(region: Int32Array, n: number, W: number, magnitude: Float32Array, minLength: number): Segment | null {
  let total = 0;
  let cx = 0;
  let cy = 0;
  for (let k = 0; k < n; k++) {
    const i = region[k]!;
    const x = i % W;
    const w = magnitude[i]!;
    total += w;
    cx += w * x;
    cy += w * ((i - x) / W);
  }
  cx /= total;
  cy /= total;
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (let k = 0; k < n; k++) {
    const i = region[k]!;
    const x = i % W;
    const w = magnitude[i]!;
    const ox = x - cx;
    const oy = (i - x) / W - cy;
    sxx += w * ox * ox;
    syy += w * oy * oy;
    sxy += w * ox * oy;
  }
  const phi = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  const dx = Math.cos(phi);
  const dy = Math.sin(phi);
  let lmin = Infinity;
  let lmax = -Infinity;
  let wmin = Infinity;
  let wmax = -Infinity;
  for (let k = 0; k < n; k++) {
    const i = region[k]!;
    const x = i % W;
    const ox = x - cx;
    const oy = (i - x) / W - cy;
    const l = ox * dx + oy * dy;
    const w = -ox * dy + oy * dx;
    if (l < lmin) lmin = l;
    if (l > lmax) lmax = l;
    if (w < wmin) wmin = w;
    if (w > wmax) wmax = w;
  }
  const length = lmax - lmin + 1;
  const thickness = wmax - wmin + 1;
  if (length < minLength || length < thickness * 4 || n / (length * thickness) < 0.5) return null;
  // The gradient sits on the corner the 2 × 2 pixels share.
  const ox = cx + 1;
  const oy = cy + 1;
  return { a: { x: ox + lmin * dx, y: oy + lmin * dy }, b: { x: ox + lmax * dx, y: oy + lmax * dy }, length };
}

// ---- Vanishing points ------------------------------------------------------------------------

/** How far (degrees) a segment may point away from a vanishing point and still run towards it. */
const VANISHING_TOLERANCE = 1.5;
/** Segments within this many degrees of the photo's vertical are the wall's verticals. */
const VERTICAL_WITHIN = 25;
/** The longest segments, in pairs, propose vanishing points. */
const CANDIDATES = 40;

interface Weighted {
  segment: Segment;
  /** The segment's line, scaled so (a, b) is a unit normal. */
  line: Homogeneous;
  mid: Pt;
  dir: Pt;
  weight: number;
}

/** Whether a point (normalised coordinates) is at least this far from the photo's centre; points at infinity are. */
function farEnough(v: Homogeneous, distance: number): boolean {
  return Math.hypot(v[0], v[1]) >= distance * Math.abs(v[2]);
}

/** Whether a segment runs towards a vanishing point, to within the tolerance (or a pixel and a half at its ends). */
function runsTowards(s: Weighted, v: Homogeneous): boolean {
  const d = towards(s.mid, v);
  const n = Math.hypot(d.x, d.y);
  if (n === 0) return false;
  const sine = Math.abs(s.dir.x * d.y - s.dir.y * d.x) / n;
  const tolerance = Math.max(Math.sin((VANISHING_TOLERANCE * Math.PI) / 180), 1.5 / s.segment.length);
  return sine <= tolerance;
}

/** The eigenvector of a symmetric 3 × 3 matrix with the smallest eigenvalue (Jacobi rotations). */
function smallestEigenvector(m: number[]): Homogeneous {
  const a = [...m];
  const v = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  for (let sweep = 0; sweep < 30; sweep++) {
    const off = Math.abs(a[1]!) + Math.abs(a[2]!) + Math.abs(a[5]!);
    if (off < 1e-15) break;
    for (const [p, q] of [
      [0, 1],
      [0, 2],
      [1, 2],
    ] as const) {
      const apq = a[p * 3 + q]!;
      if (Math.abs(apq) < 1e-18) continue;
      const theta = (a[q * 3 + q]! - a[p * 3 + p]!) / (2 * apq);
      const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
      const c = 1 / Math.sqrt(t * t + 1);
      const s = t * c;
      for (let k = 0; k < 3; k++) {
        const akp = a[k * 3 + p]!;
        const akq = a[k * 3 + q]!;
        a[k * 3 + p] = c * akp - s * akq;
        a[k * 3 + q] = s * akp + c * akq;
      }
      for (let k = 0; k < 3; k++) {
        const apk = a[p * 3 + k]!;
        const aqk = a[q * 3 + k]!;
        a[p * 3 + k] = c * apk - s * aqk;
        a[q * 3 + k] = s * apk + c * aqk;
      }
      for (let k = 0; k < 3; k++) {
        const vkp = v[k * 3 + p]!;
        const vkq = v[k * 3 + q]!;
        v[k * 3 + p] = c * vkp - s * vkq;
        v[k * 3 + q] = s * vkp + c * vkq;
      }
    }
  }
  let best = 0;
  for (let k = 1; k < 3; k++) if (a[k * 4]! < a[best * 4]!) best = k;
  return [v[best]!, v[3 + best]!, v[6 + best]!];
}

/**
 * Where a family of segments meets: every pair of the longest proposes a point, the one the most
 * (weighted) length runs towards wins, and it is refined by least squares over those segments.
 * Null unless at least three segments, on at least two distinct lines, run towards it.
 */
function meetingPoint(family: Weighted[], spread: number, minDistance = 0): { point: Homogeneous; inliers: Weighted[] } | null {
  if (family.length < 3) return null;
  const candidates = [...family].sort((p, q) => q.segment.length - p.segment.length).slice(0, CANDIDATES);
  let best: Homogeneous | null = null;
  let bestScore = 0;
  for (let i = 0; i < candidates.length; i++) {
    for (let j = i + 1; j < candidates.length; j++) {
      const v = unit(cross3(candidates[i]!.line, candidates[j]!.line));
      if (!v.every(Number.isFinite) || Math.hypot(...v) === 0 || !farEnough(v, minDistance)) continue;
      let score = 0;
      for (const s of family) if (runsTowards(s, v)) score += s.weight;
      if (score > bestScore) {
        bestScore = score;
        best = v;
      }
    }
  }
  if (!best) return null;
  let inliers = family.filter((s) => runsTowards(s, best!));
  if (inliers.length >= 2) {
    // Least squares: the point closest to every inlier line, weighted.
    const m = new Array<number>(9).fill(0);
    for (const s of inliers) for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) m[r * 3 + c]! += s.weight * s.line[r]! * s.line[c]!;
    const refined = unit(smallestEigenvector(m));
    const again = family.filter((s) => runsTowards(s, refined));
    if (again.length >= inliers.length && farEnough(refined, minDistance)) {
      best = refined;
      inliers = again;
    }
  }
  if (inliers.length < 3) return null;
  // Two or more distinct lines: some segment's middle lies well off another's line.
  let apart = 0;
  for (const s of inliers) for (const t of inliers) apart = Math.max(apart, Math.abs(s.line[0] * t.mid.x + s.line[1] * t.mid.y + s.line[2]));
  return apart >= spread ? { point: best, inliers } : null;
}

/**
 * The wall's vanishing points from its segments. Its vertical lines are the ones near the photo's
 * vertical; if there are too few, they are taken as truly vertical in the photo (a point at
 * infinity straight down). Without enough horizontal lines there's nothing to go on: null.
 * `near` (a tap) weights segments by closeness, so the wall there wins over another plane.
 */
export function wallLines(segments: readonly Segment[], size: { width: number; height: number }, near?: Pt): WallLines | null {
  const long = Math.max(size.width, size.height);
  // Normalised coordinates (centred, ±1 across the long side) keep the arithmetic well conditioned.
  const c = { x: size.width / 2, y: size.height / 2 };
  const s = long / 2;
  const norm = (p: Pt): Pt => ({ x: (p.x - c.x) / s, y: (p.y - c.y) / s });
  const sigma = long * 0.35;
  const horizontal: Weighted[] = [];
  const vertical: Weighted[] = [];
  for (const segment of segments) {
    const a = norm(segment.a);
    const b = norm(segment.b);
    const raw = cross3(lift(a), lift(b));
    const n = Math.hypot(raw[0], raw[1]);
    if (n === 0) continue;
    const line: Homogeneous = [raw[0] / n, raw[1] / n, raw[2] / n];
    const dir = { x: (b.x - a.x) / Math.hypot(b.x - a.x, b.y - a.y), y: (b.y - a.y) / Math.hypot(b.x - a.x, b.y - a.y) };
    let weight = segment.length;
    if (near) {
      const d = distanceToSegment(near, segment);
      weight *= Math.exp(-((d / sigma) ** 2));
    }
    const entry: Weighted = { segment, line, mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, dir, weight };
    const fromVertical = (Math.acos(Math.min(1, Math.abs(dir.y))) * 180) / Math.PI;
    if (fromVertical <= VERTICAL_WITHIN) vertical.push(entry);
    else if (fromVertical >= VERTICAL_WITHIN + 5) horizontal.push(entry);
  }
  // Distinct lines: at least 5% of the long side apart (0.1 in normalised units).
  const h = meetingPoint(horizontal, 0.1);
  if (!h) return null;
  // A wall's verticals are nearly parallel in a photo: even tilting the phone 30° up or down puts
  // their meeting point over a long side and a quarter from the centre (2.5 in normalised units).
  const v = meetingPoint(vertical, 0.1, 2.5);
  const denorm = (p: Homogeneous): Homogeneous => unit([s * p[0] + c.x * p[2], s * p[1] + c.y * p[2], p[2]]);
  const result: WallLines = {
    h: denorm(h.point),
    v: v ? denorm(v.point) : [0, 1, 0],
    horizontal: h.inliers.map((w) => w.segment),
    vertical: v ? v.inliers.map((w) => w.segment) : [],
  };
  // The two directions must cross clearly where the wall is.
  const at = near ?? c;
  const dh = towards(at, result.h);
  const dv = towards(at, result.v);
  const sine = Math.abs(dh.x * dv.y - dh.y * dv.x) / (Math.hypot(dh.x, dh.y) * Math.hypot(dv.x, dv.y));
  return sine >= Math.sin((50 * Math.PI) / 180) ? result : null;
}

function distanceToSegment(p: Pt, s: Segment): number {
  const dx = s.b.x - s.a.x;
  const dy = s.b.y - s.a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((p.x - s.a.x) * dx + (p.y - s.a.y) * dy) / len2)) : 0;
  return Math.hypot(p.x - (s.a.x + t * dx), p.y - (s.a.y + t * dy));
}

// ---- Rectangles that follow the lines --------------------------------------------------------

/** Corners from the four edge lines: bottom and top through h, left and right through v. */
function cornersOf(bottom: Homogeneous, top: Homogeneous, left: Homogeneous, right: Homogeneous): Quad | null {
  const corners = [cross3(bottom, left), cross3(bottom, right), cross3(top, right), cross3(top, left)].map(drop);
  return corners.every((p): p is Pt => p !== null) ? (corners as Quad) : null;
}

/**
 * A rectangle on the wall around a tap, its edges along the wall's lines, for the user to put on
 * something of known size. Where a line of the wall runs near the tap on a side, that edge sits
 * on it, so on a tiled wall the rectangle often lands on one tile. Stays inside the image (null if
 * it can't).
 */
export function linedRectangle(lines: WallLines, tap: Pt, size: { width: number; height: number }): Quad | null {
  const long = Math.max(size.width, size.height);
  const minGap = long * 0.04;
  const maxGap = long * 0.25;
  const t = lift(tap);
  const throughV = cross3(t, lines.v);
  const throughH = cross3(t, lines.h);
  type Edge = { line: Homogeneous; at: number };
  /**
   * The lines through `vanishing` either side of the tap (where they cross the line through it),
   * the nearest on each side, moving outwards while the two are too close to make a rectangle
   * (the two sides of one grout line, say).
   */
  const nearest = (segments: Segment[], vanishing: Homogeneous, across: Homogeneous, axis: 'x' | 'y') => {
    const before: Edge[] = [];
    const after: Edge[] = [];
    for (const segment of segments) {
      const mid = { x: (segment.a.x + segment.b.x) / 2, y: (segment.a.y + segment.b.y) / 2 };
      const line = cross3(lift(mid), vanishing);
      const meet = drop(cross3(line, across));
      if (!meet) continue;
      const at = meet[axis] - tap[axis];
      if (at < 0 && at >= -maxGap) before.push({ line, at });
      else if (at > 0 && at <= maxGap) after.push({ line, at });
    }
    before.sort((p, q) => q.at - p.at);
    after.sort((p, q) => p.at - q.at);
    if (!before.length || !after.length) return { before: before.find((e) => e.at <= -minGap) ?? null, after: after.find((e) => e.at >= minGap) ?? null };
    let i = 0;
    let j = 0;
    while (after[j]!.at - before[i]!.at < minGap * 2) {
      const outBefore = before[i + 1];
      const outAfter = after[j + 1];
      if (!outBefore && !outAfter) return { before: null, after: null };
      if (outAfter && (!outBefore || outAfter.at < -outBefore.at)) j++;
      else i++;
    }
    return { before: before[i]!, after: after[j]! };
  };
  const rows = nearest(lines.horizontal, lines.h, throughV, 'y');
  const columns = nearest(lines.vertical, lines.v, throughH, 'x');
  const inside = (q: Quad) => q.every((p) => p.x >= 0 && p.y >= 0 && p.x <= size.width && p.y <= size.height);
  // An edge at an offset from the tap, along the line through it: up/down for rows, left/right for columns.
  const rowAt = (dy: number) => cross3(lift({ x: tap.x, y: tap.y + dy }), lines.h);
  const columnAt = (dx: number) => cross3(lift({ x: tap.x + dx, y: tap.y }), lines.v);
  for (const gap of [0.12, 0.08, 0.05]) {
    const g = long * gap;
    const snapped = gap === 0.12;
    const top = snapped && rows.before ? rows.before.line : rowAt(-g);
    const bottom = snapped && rows.after ? rows.after.line : rowAt(g);
    const left = snapped && columns.before ? columns.before.line : columnAt(-g);
    const right = snapped && columns.after ? columns.after.line : columnAt(g);
    const quad = cornersOf(bottom, top, left, right);
    if (quad && inside(quad)) return quad;
  }
  return null;
}

/**
 * Moves one corner of a rectangle that follows the wall's lines, keeping it one: the opposite
 * corner stays, and the other two slide along the lines towards the vanishing points. Corner
 * order as Quad: bottom-left, bottom-right, top-right, top-left.
 */
export function lockedCorner(quad: Quad, corner: number, to: Pt, vanishing: Vanishing): Quad | null {
  const p = lift(to);
  const o = lift(quad[(corner + 2) % 4]!);
  // Corners sharing a horizontal edge: 0–1 and 2–3; a vertical edge: 0–3 and 1–2.
  const alongH = corner ^ 1;
  const alongV = 3 - corner;
  const a = drop(cross3(cross3(p, vanishing.h), cross3(o, vanishing.v)));
  const b = drop(cross3(cross3(p, vanishing.v), cross3(o, vanishing.h)));
  if (!a || !b) return null;
  const next = [...quad] as Quad;
  next[corner] = { x: to.x, y: to.y };
  next[alongH] = a;
  next[alongV] = b;
  return next;
}

/** A phone's main camera sees about 70° across the photo's long side: a focal length of 0.72 of it. */
const TYPICAL_FOCAL = 0.72;

/**
 * Width ÷ height of the real rectangle a lined quad marks. Needs the camera's focal length: from
 * the two vanishing points where they give a plausible one (lines at right angles on the wall),
 * else a typical phone camera's. The photo's centre is taken as the camera's axis.
 */
export function rectangleAspect(quad: Quad, vanishing: Vanishing, size: { width: number; height: number }): number | null {
  const cx = size.width / 2;
  const cy = size.height / 2;
  const typical = TYPICAL_FOCAL * Math.max(size.width, size.height);
  let f = typical;
  const h = drop(vanishing.h);
  const v = drop(vanishing.v);
  if (h && v) {
    const f2 = -((h.x - cx) * (v.x - cx) + (h.y - cy) * (v.y - cy));
    if (f2 > (typical * 0.6) ** 2 && f2 < (typical * 1.6) ** 2) f = Math.sqrt(f2);
  }
  const ray = (p: Homogeneous): Homogeneous => [(p[0] - cx * p[2]) / f, (p[1] - cy * p[2]) / f, p[2]];
  const normal = cross3(ray(vanishing.h), ray(vanishing.v));
  const onPlane = quad.map((q) => {
    const r = ray(lift(q));
    const k = normal[0] * r[0] + normal[1] * r[1] + normal[2] * r[2];
    return [r[0] / k, r[1] / k, r[2] / k];
  });
  const dist = (i: number, j: number) => Math.hypot(onPlane[i]![0]! - onPlane[j]![0]!, onPlane[i]![1]! - onPlane[j]![1]!, onPlane[i]![2]! - onPlane[j]![2]!);
  const width = (dist(0, 1) + dist(3, 2)) / 2;
  const height = (dist(0, 3) + dist(1, 2)) / 2;
  const aspect = width / height;
  return Number.isFinite(aspect) && aspect > 0 ? aspect : null;
}

/** Scales vanishing points (and the lines' segments) from one image size to another, such as the analysis image to the photo. */
export function scaleLines(lines: WallLines, sx: number, sy: number): WallLines {
  const point = (v: Homogeneous): Homogeneous => unit([v[0] * sx, v[1] * sy, v[2]]);
  const segment = (s: Segment): Segment => {
    const a = { x: s.a.x * sx, y: s.a.y * sy };
    const b = { x: s.b.x * sx, y: s.b.y * sy };
    return { a, b, length: Math.hypot(b.x - a.x, b.y - a.y) };
  };
  return { h: point(lines.h), v: point(lines.v), horizontal: lines.horizontal.map(segment), vertical: lines.vertical.map(segment) };
}
