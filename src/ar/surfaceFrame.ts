/**
 * Where a surface found in AR sits in the room, and how the designer's surface millimetres map
 * onto it. Pure maths, no DOM or WebXR objects: poses come in as WebXR's 4 × 4 matrices.
 *
 * The room's coordinates are WebXR's: metres, y up (the reference space is gravity-aligned).
 * Matrices are column-major, as WebXR and WebGL give and take them.
 */

export type Vec3 = [number, number, number];
/** A 4 × 4 matrix, column-major. */
export type Mat4 = Float32Array;

export type SurfaceKind = 'wall' | 'floor' | 'ceiling' | 'slope';

/** A surface's place in the room: its axes for the designer's x (right) and y (up), and its normal. */
export interface SurfaceFrame {
  kind: SurfaceKind;
  /** The point that was hit, in metres. */
  origin: Vec3;
  /** Unit vectors in the room: the designer's x and y on the surface, and its normal towards the viewer. */
  right: Vec3;
  up: Vec3;
  normal: Vec3;
}

const WORLD_UP: Vec3 = [0, 1, 0];

export const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const scale = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const length = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);
const normalise = (a: Vec3): Vec3 => scale(a, 1 / (length(a) || 1));

/** A surface tilted less than this (degrees) from level is a floor or ceiling... */
const LEVEL_WITHIN = 25;
/** ...and one within this of upright is a wall. Anything between is a slope (a ramp, a bad reading). */
const UPRIGHT_WITHIN = 20;

/** What a surface is, from its normal (a unit vector). */
export function kindOf(normal: Vec3): SurfaceKind {
  const c = dot(normal, WORLD_UP);
  if (c >= Math.cos((LEVEL_WITHIN * Math.PI) / 180)) return 'floor';
  if (c <= -Math.cos((LEVEL_WITHIN * Math.PI) / 180)) return 'ceiling';
  if (Math.abs(c) <= Math.sin((UPRIGHT_WITHIN * Math.PI) / 180)) return 'wall';
  return 'slope';
}

/**
 * The surface a hit test found, from its pose (WebXR puts the pose's y axis along the surface
 * normal) and where the viewer is. The normal is turned to face the viewer. On a wall the
 * designer's up is the room's up; on a floor or ceiling it runs away from the viewer, so the
 * design reads the right way up as you look at it.
 */
export function surfaceFrame(pose: ArrayLike<number>, viewer: Vec3): SurfaceFrame {
  const origin: Vec3 = [pose[12]!, pose[13]!, pose[14]!];
  let normal = normalise([pose[4]!, pose[5]!, pose[6]!]);
  if (dot(normal, sub(viewer, origin)) < 0) normal = scale(normal, -1);
  const kind = kindOf(normal);
  let up: Vec3;
  if (kind === 'wall' || kind === 'slope') {
    up = sub(WORLD_UP, scale(normal, dot(WORLD_UP, normal)));
  } else {
    const away = sub(origin, viewer);
    up = sub(away, scale(normal, dot(away, normal)));
    // Straight above or below the viewer: any direction in the plane will do.
    if (length(up) < 1e-6) up = [pose[8]!, pose[9]!, pose[10]!];
  }
  up = normalise(up);
  return { kind, origin, right: normalise(cross(up, normal)), up, normal };
}

/**
 * Surface millimetres → room metres, with the surface point `at` (mm) on the frame's origin.
 * The surface's z (unused by flat tiles) runs along the normal, in metres.
 */
export function surfaceToRoom(frame: SurfaceFrame, at: { x: number; y: number }): Mat4 {
  const k = 0.001;
  const { right: r, up: u, normal: n, origin: o } = frame;
  const t = sub(o, [r[0] * at.x * k + u[0] * at.y * k, r[1] * at.x * k + u[1] * at.y * k, r[2] * at.x * k + u[2] * at.y * k]);
  return Float32Array.from([r[0] * k, r[1] * k, r[2] * k, 0, u[0] * k, u[1] * k, u[2] * k, 0, n[0], n[1], n[2], 0, t[0], t[1], t[2], 1]);
}

/** a × b, column-major. */
export function multiply(a: ArrayLike<number>, b: ArrayLike<number>): Mat4 {
  const out = new Float32Array(16);
  for (let col = 0; col < 4; col++) {
    for (let row = 0; row < 4; row++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) sum += a[k * 4 + row]! * b[col * 4 + k]!;
      out[col * 4 + row] = sum;
    }
  }
  return out;
}

/** The inverse of a rotation and translation (a pose), column-major. */
export function invertPose(m: ArrayLike<number>): Mat4 {
  const out = new Float32Array(16);
  // The rotation's inverse is its transpose.
  for (let col = 0; col < 3; col++) for (let row = 0; row < 3; row++) out[col * 4 + row] = m[row * 4 + col]!;
  for (let row = 0; row < 3; row++) out[12 + row] = -(out[row]! * m[12]! + out[4 + row]! * m[13]! + out[8 + row]! * m[14]!);
  out[15] = 1;
  return out;
}

/** A point through a matrix (w = 1). */
export function transformPoint(m: ArrayLike<number>, p: Vec3): Vec3 {
  return [m[0]! * p[0] + m[4]! * p[1] + m[8]! * p[2] + m[12]!, m[1]! * p[0] + m[5]! * p[1] + m[9]! * p[2] + m[13]!, m[2]! * p[0] + m[6]! * p[1] + m[10]! * p[2] + m[14]!];
}
