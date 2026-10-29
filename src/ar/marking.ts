/**
 * Marking a real wall or floor in AR: rays from the phone, where they meet a surface, and the
 * rectangle a few taps mark. Pure maths, no DOM or WebXR objects (see surfaceFrame.ts for the
 * coordinate conventions: room metres, y up, column-major matrices).
 */
import { cross, dot, type Mat4, type SurfaceFrame, type Vec3 } from './surfaceFrame';

export interface Ray {
  origin: Vec3;
  /** A unit vector. */
  direction: Vec3;
}

const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
const length = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);
const normalise = (a: Vec3): Vec3 => scale(a, 1 / (length(a) || 1));
const WORLD_UP: Vec3 = [0, 1, 0];

/** The smallest surface marked, in mm: anything less is a slip of the finger. */
export const MIN_MARKED_MM = 100;

/** A pose's ray: from its position along its −z axis, as WebXR points the viewer and a touch's target ray. */
export function poseRay(pose: ArrayLike<number>): Ray {
  return { origin: [pose[12]!, pose[13]!, pose[14]!], direction: normalise([-pose[8]!, -pose[9]!, -pose[10]!]) };
}

/** Where a ray meets a plane ahead of it, or null (parallel, or behind). */
export function intersectPlane(ray: Ray, point: Vec3, normal: Vec3): Vec3 | null {
  const facing = dot(ray.direction, normal);
  if (Math.abs(facing) < 1e-6) return null;
  const t = dot(sub(point, ray.origin), normal) / facing;
  return t > 0 ? add(ray.origin, scale(ray.direction, t)) : null;
}

/** A point's place in a surface's frame, in metres: along its right and up from its origin. */
export function onFrame(frame: SurfaceFrame, p: Vec3): { x: number; y: number } {
  const d = sub(p, frame.origin);
  return { x: dot(d, frame.right), y: dot(d, frame.up) };
}

/** A marked wall or floor: its frame with the origin at its bottom-left corner, and its size. */
export interface MarkedSurface {
  kind: 'wall' | 'floor';
  frame: SurfaceFrame;
  widthMm: number;
  heightMm: number;
}

const mm = (m: number) => Math.round((m * 1000) / 10) * 10;

/** A rectangle in a frame, from its corners' places (metres) in it: the frame moved to its bottom-left. */
function rectangle(kind: 'wall' | 'floor', frame: SurfaceFrame, xs: number[], ys: number[]): MarkedSurface | null {
  const x0 = Math.min(...xs);
  const y0 = Math.min(...ys);
  const widthMm = mm(Math.max(...xs) - x0);
  const heightMm = mm(Math.max(...ys) - y0);
  if (widthMm < MIN_MARKED_MM || heightMm < MIN_MARKED_MM) return null;
  const origin = add(frame.origin, add(scale(frame.right, x0), scale(frame.up, y0)));
  return { kind, frame: { ...frame, kind, origin }, widthMm, heightMm };
}

/**
 * A wall from two opposite corners: the first as a hit on the wall (its frame), the second any
 * point on the wall's plane (where the aim meets it). Either diagonal, either order.
 */
export function wallFromCorners(first: SurfaceFrame, second: Vec3): MarkedSurface | null {
  const p = onFrame(first, second);
  return rectangle('wall', first, [0, p.x], [0, p.y]);
}

/**
 * A floor from three points on it: two corners along one edge (a, b), and a point on the opposite
 * edge (c). The design's up runs from the first edge towards c; right along the edge.
 */
export function floorFromCorners(a: Vec3, b: Vec3, c: Vec3, normal: Vec3): MarkedSurface | null {
  const n = normalise(normal);
  const along = sub(sub(b, a), scale(n, dot(sub(b, a), n)));
  if (length(along) * 1000 < MIN_MARKED_MM) return null;
  let up = normalise(cross(n, normalise(along)));
  if (dot(sub(c, a), up) < 0) up = scale(up, -1);
  const right = cross(up, n);
  const frame: SurfaceFrame = { kind: 'floor', origin: a, right, up, normal: n };
  return rectangle('floor', frame, [0, dot(sub(b, a), right)], [0, dot(sub(c, a), up)]);
}

/**
 * A wall standing on the floor along the line from a to b (two points where the wall meets the
 * floor), facing the viewer: for a plain wall the phone can't find. Its frame's origin is at the
 * base's left end; its height comes later (heightTo).
 */
export function wallFromBase(a: Vec3, b: Vec3, viewer: Vec3): { frame: SurfaceFrame; widthMm: number } | null {
  const along = sub(b, a);
  const flat: Vec3 = [along[0], 0, along[2]];
  if (length(flat) * 1000 < MIN_MARKED_MM) return null;
  let normal = normalise(cross(WORLD_UP, normalise(flat)));
  if (dot(normal, sub(viewer, a)) < 0) normal = scale(normal, -1);
  const right = cross(WORLD_UP, normal);
  const xb = dot(along, right);
  const origin = xb >= 0 ? a : b;
  return { frame: { kind: 'wall', origin, right, up: WORLD_UP, normal }, widthMm: mm(Math.abs(xb)) };
}

/** A wall from its base (wallFromBase) up to a point on it, or null when that's too low. */
export function wallUpTo(base: { frame: SurfaceFrame; widthMm: number }, top: Vec3): MarkedSurface | null {
  const heightMm = mm(onFrame(base.frame, top).y);
  return heightMm < MIN_MARKED_MM ? null : { kind: 'wall', frame: base.frame, widthMm: base.widthMm, heightMm };
}

/** Where a ray meets a surface, in the surface's millimetres (x right, y up from its origin). */
export function surfaceMm(ray: Ray, frame: SurfaceFrame): { x: number; y: number } | null {
  const p = intersectPlane(ray, frame.origin, frame.normal);
  if (!p) return null;
  const at = onFrame(frame, p);
  return { x: at.x * 1000, y: at.y * 1000 };
}

/** A ring of radius r (metres) lying on a surface at a point, for the ring shader (it draws in the model's x–z plane). */
export function ringOn(frame: Pick<SurfaceFrame, 'right' | 'up' | 'normal'>, at: Vec3, r: number): Mat4 {
  const { right: x, up: u, normal: n } = frame;
  return Float32Array.from([x[0] * r, x[1] * r, x[2] * r, 0, n[0], n[1], n[2], 0, u[0] * r, u[1] * r, u[2] * r, 0, at[0], at[1], at[2], 1]);
}

/** A rectangle w × h metres on a surface from a corner, for the outline shader (a unit square in the model's x–y plane). */
export function rectOn(frame: Pick<SurfaceFrame, 'right' | 'up' | 'normal'>, corner: Vec3, w: number, h: number): Mat4 {
  const { right: x, up: u, normal: n } = frame;
  return Float32Array.from([x[0] * w, x[1] * w, x[2] * w, 0, u[0] * h, u[1] * h, u[2] * h, 0, n[0], n[1], n[2], 0, corner[0], corner[1], corner[2], 1]);
}
