/**
 * The room's light on tiles in AR, from WebXR's light estimate: the ambient light as spherical
 * harmonics, plus the main light's direction and intensity. A flat surface gets one colour gain
 * from the light falling on it. Pure maths, no DOM or WebXR objects.
 */
import type { Vec3 } from './surfaceFrame';

/** A frame's light estimate: 9 RGB spherical-harmonics coefficients (linear), and the main light. */
export interface LightEstimate {
  sh: ArrayLike<number>;
  /** Towards the main light, a unit vector in the room. */
  direction: Vec3;
  /** Its intensity, linear RGB. */
  intensity: Vec3;
}

/**
 * Irradiance from ambient light given as spherical harmonics (bands 0–2, in the usual order:
 * L00, L1−1, L10, L11, L2−2, L2−1, L20, L21, L22, each RGB), on a surface facing `n`.
 */
export function irradiance(sh: ArrayLike<number>, n: Vec3): Vec3 {
  const [x, y, z] = n;
  const basis = [0.886227, 2 * 0.511664 * y, 2 * 0.511664 * z, 2 * 0.511664 * x, 2 * 0.429043 * x * y, 2 * 0.429043 * y * z, 0.743125 * z * z - 0.247708, 2 * 0.429043 * x * z, 0.429043 * (x * x - y * y)];
  const out = [0, 0, 0];
  basis.forEach((b, k) => {
    for (let c = 0; c < 3; c++) out[c] = out[c]! + sh[k * 3 + c]! * b;
  });
  return [out[0]!, out[1]!, out[2]!];
}

/** The light a flat, matt surface facing `n` reflects (linear RGB): ambient plus the main light, over π. */
export function surfaceLight(estimate: LightEstimate, n: Vec3): Vec3 {
  const ambient = irradiance(estimate.sh, n);
  const facing = Math.max(0, n[0] * estimate.direction[0] + n[1] * estimate.direction[1] + n[2] * estimate.direction[2]);
  return [0, 1, 2].map((c) => Math.max(0, (ambient[c]! + facing * estimate.intensity[c]!) / Math.PI)) as Vec3;
}

/** Lighting never darkens tiles below this, or brightens them past this: estimates can be wild. */
export const GAIN_MIN = 0.45;
export const GAIN_MAX = 1.35;

/**
 * What to multiply the tiles' colours (as drawn, sRGB) by: the reflected light, brought to sRGB,
 * kept within GAIN_MIN–GAIN_MAX, and applied by `amount` (0 none, 1 all).
 */
export function tileGain(light: Vec3, amount: number): Vec3 {
  return light.map((l) => {
    const g = Math.min(GAIN_MAX, Math.max(GAIN_MIN, Math.pow(l, 1 / 2.2)));
    return 1 + (g - 1) * amount;
  }) as Vec3;
}
