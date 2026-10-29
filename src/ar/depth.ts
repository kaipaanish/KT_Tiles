/**
 * Reading the phone's depth sensor in AR: where a room point falls in a view, the room point a
 * depth reading came from, and how far the real surface lies from a marked one. Pure maths, no
 * DOM or WebXR objects.
 *
 * WebXR's depth is along the view's −z axis (not along the ray), in metres. Its normalised view
 * coordinates run 0–1 from the view's top-left corner.
 */
import type { MarkedSurface } from './marking';
import { dot, type SurfaceFrame, type Vec3 } from './surfaceFrame';

/** A point through a column-major 4 × 4 matrix: [x, y, z, w]. */
function transform4(m: ArrayLike<number>, p: Vec3): [number, number, number, number] {
  return [
    m[0]! * p[0] + m[4]! * p[1] + m[8]! * p[2] + m[12]!,
    m[1]! * p[0] + m[5]! * p[1] + m[9]! * p[2] + m[13]!,
    m[2]! * p[0] + m[6]! * p[1] + m[10]! * p[2] + m[14]!,
    m[3]! * p[0] + m[7]! * p[1] + m[11]! * p[2] + m[15]!,
  ];
}

/**
 * Where a room point falls in a view: normalised view coordinates and its depth, or null when it
 * is behind the camera or outside the picture. `view` is room → view (the view transform's inverse).
 */
export function toNormView(projection: ArrayLike<number>, view: ArrayLike<number>, p: Vec3): { x: number; y: number; depth: number } | null {
  const [vx, vy, vz] = transform4(view, p);
  if (vz >= 0) return null;
  const [cx, cy, , cw] = transform4(projection, [vx, vy, vz]);
  const nx = cx / cw;
  const ny = cy / cw;
  if (Math.abs(nx) > 1 || Math.abs(ny) > 1) return null;
  return { x: (nx + 1) / 2, y: (1 - ny) / 2, depth: -vz };
}

/**
 * The room point a depth reading came from: through normalised view point (x, y), `depth`
 * metres along the view's −z axis. `camera` is view → room (the view transform's matrix).
 */
export function fromDepth(projection: ArrayLike<number>, camera: ArrayLike<number>, x: number, y: number, depth: number): Vec3 {
  const nx = 2 * x - 1;
  const ny = 1 - 2 * y;
  // On the plane z = −1 in view space, the projection gives ndc = P·(x, y) − (P[8], P[9]).
  const dir: Vec3 = [(nx + projection[8]!) / projection[0]!, (ny + projection[9]!) / projection[5]!, -1];
  const [rx, ry, rz] = transform4(camera, [dir[0] * depth, dir[1] * depth, dir[2] * depth]);
  return [rx, ry, rz];
}

/** Points to read depth at on a marked surface: an n × n grid, kept 10% in from its edges. */
export function samplePoints(surface: MarkedSurface, n = 5): Vec3[] {
  const { origin: o, right: r, up: u } = surface.frame;
  const w = surface.widthMm / 1000;
  const h = surface.heightMm / 1000;
  const points: Vec3[] = [];
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const a = w * (0.1 + (0.8 * i) / Math.max(1, n - 1));
      const b = h * (0.1 + (0.8 * j) / Math.max(1, n - 1));
      points.push([o[0] + r[0] * a + u[0] * b, o[1] + r[1] * a + u[1] * b, o[2] + r[2] * a + u[2] * b]);
    }
  }
  return points;
}

/** Readings further than this (metres) from the marked plane are something in front, or noise. */
const WITHIN_M = 0.25;
/** Fewer readings near the plane than this, and there's no telling. */
const MIN_READINGS = 12;

/**
 * How far the real surface lies from a marked plane, from points the depth sensor saw on it:
 * the median of their distances along its normal (positive: the real surface is nearer the
 * viewer). Null without enough readings near the plane.
 */
export function surfaceOffset(points: readonly Vec3[], frame: SurfaceFrame): number | null {
  const d = points.map((p) => dot([p[0] - frame.origin[0], p[1] - frame.origin[1], p[2] - frame.origin[2]], frame.normal)).filter((v) => Math.abs(v) <= WITHIN_M);
  if (d.length < MIN_READINGS) return null;
  d.sort((a, b) => a - b);
  const mid = d.length >> 1;
  return d.length % 2 ? d[mid]! : (d[mid - 1]! + d[mid]!) / 2;
}

/** A marked surface moved `metres` along its normal. */
export function shifted(surface: MarkedSurface, metres: number): MarkedSurface {
  const { origin: o, normal: n } = surface.frame;
  return { ...surface, frame: { ...surface.frame, origin: [o[0] + n[0] * metres, o[1] + n[1] * metres, o[2] + n[2] * metres] } };
}

/** The straight distance from a point (the phone) to a surface's plane, in metres. */
export function distanceToPlane(p: Vec3, frame: Pick<SurfaceFrame, 'origin' | 'normal'>): number {
  return Math.abs(dot([p[0] - frame.origin[0], p[1] - frame.origin[1], p[2] - frame.origin[2]], frame.normal));
}
