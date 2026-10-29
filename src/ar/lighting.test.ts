import { describe, expect, it } from 'vitest';
import { GAIN_MAX, GAIN_MIN, irradiance, surfaceLight, tileGain, type LightEstimate } from './lighting';
import type { Vec3 } from './surfaceFrame';

/** Ambient light of one level from every side: only the first coefficient. */
const even = (level: number) => Float32Array.from({ length: 27 }, (_, i) => (i < 3 ? level : 0));
const dark: Vec3 = [0, 0, 0];

describe('the room light on tiles', () => {
  it('lights every surface alike in even ambient light', () => {
    for (const n of [[0, 0, 1], [0, 1, 0], [1, 0, 0]] as Vec3[]) {
      const e = irradiance(even(1), n);
      e.forEach((v) => expect(v).toBeCloseTo(0.886227, 6));
    }
  });

  it('lights a surface facing the light, and not one facing away', () => {
    const estimate: LightEstimate = { sh: even(0), direction: [0, 0, 1], intensity: [Math.PI, Math.PI, Math.PI] };
    surfaceLight(estimate, [0, 0, 1]).forEach((v) => expect(v).toBeCloseTo(1, 6));
    surfaceLight(estimate, [0, 0, -1]).forEach((v) => expect(v).toBeCloseTo(0, 6));
    // Half-way round: half the light.
    surfaceLight(estimate, [0, Math.SQRT1_2, Math.SQRT1_2]).forEach((v) => expect(v).toBeCloseTo(Math.SQRT1_2, 6));
  });

  it('brings the light to the colours as drawn, gently and within bounds', () => {
    // Half the light reflected: 0.73 in sRGB; at 60% that is 0.84.
    tileGain([0.5, 0.5, 0.5], 0.6).forEach((g) => expect(g).toBeCloseTo(1 + (Math.pow(0.5, 1 / 2.2) - 1) * 0.6, 6));
    tileGain(dark, 1).forEach((g) => expect(g).toBeCloseTo(GAIN_MIN, 9));
    tileGain([9, 9, 9], 1).forEach((g) => expect(g).toBeCloseTo(GAIN_MAX, 9));
    expect(tileGain([0.2, 0.5, 2], 0)).toEqual([1, 1, 1]);
    // A warm light keeps its colour.
    const [r, , b] = tileGain([0.8, 0.6, 0.4], 1);
    expect(r).toBeGreaterThan(b);
  });
});
