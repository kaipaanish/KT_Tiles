import { describe, expect, it } from 'vitest';
import type { Pt } from './homography';
import { emptyMask, fitQuad, insideQuad, QUAD_MISMATCH_LIMIT, type Mask } from './maskToQuad';

const W = 400;
const H = 300;

/** Sets the pixels whose centres lie inside any of the convex polygons. */
function mask(width: number, height: number, ...polygons: Pt[][]): Mask {
  const m = emptyMask(width, height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (polygons.some((poly) => insideQuad(poly, { x: x + 0.5, y: y + 0.5 }))) m.data[y * width + x] = 1;
    }
  }
  return m;
}

const rect = (x0: number, y0: number, x1: number, y1: number): Pt[] => [
  { x: x0, y: y1 },
  { x: x1, y: y1 },
  { x: x1, y: y0 },
  { x: x0, y: y0 },
];

/** Clears the pixels inside a rectangle, e.g. a fixture standing in front of the wall. */
function cut(m: Mask, x0: number, y0: number, x1: number, y1: number): Mask {
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) m.data[y * m.width + x] = 0;
  return m;
}

const near = (a: Pt, b: Pt, tolerance: number) => Math.hypot(a.x - b.x, a.y - b.y) <= tolerance;

describe('maskToQuad', () => {
  it('fits a rectangle exactly, corners in surface order', () => {
    const fit = fitQuad(mask(W, H, rect(100, 50, 300, 250)), { x: 200, y: 150 });
    expect(fit?.starter).toBe(false);
    expect(fit?.quad).toEqual([
      { x: 100, y: 250 },
      { x: 300, y: 250 },
      { x: 300, y: 50 },
      { x: 100, y: 50 },
    ]);
    expect(fit?.mismatch).toBeLessThan(0.01);
  });

  it('finds the corners of a wall in perspective (a trapezoid)', () => {
    const corners = [
      { x: 40, y: 280 },
      { x: 360, y: 250 },
      { x: 340, y: 40 },
      { x: 60, y: 15 },
    ];
    const fit = fitQuad(mask(W, H, corners), { x: 200, y: 150 });
    expect(fit?.starter).toBe(false);
    fit?.quad.forEach((p, i) => expect(near(p, corners[i]!, 1.5)).toBe(true));
  });

  it('ignores a fixture standing in front of the wall (a hole in the region)', () => {
    const wall = cut(mask(W, H, rect(50, 30, 350, 270)), 150, 120, 230, 220);
    const fit = fitQuad(wall, { x: 80, y: 60 });
    expect(fit?.starter).toBe(false);
    expect(fit?.quad).toEqual(rect(50, 30, 350, 270));
    expect(fit?.mismatch).toBeLessThan(0.01);
  });

  it('ignores a fixture cutting into the bottom of the wall', () => {
    // A WC in front of the wall: the region has a notch, open at the bottom.
    const wall = cut(mask(W, H, rect(50, 30, 350, 270)), 160, 200, 240, 270);
    const fit = fitQuad(wall, { x: 80, y: 60 });
    expect(fit?.starter).toBe(false);
    expect(fit?.quad).toEqual(rect(50, 30, 350, 270));
    expect(fit?.mismatch).toBeGreaterThan(0.05);
    expect(fit?.mismatch).toBeLessThan(QUAD_MISMATCH_LIMIT);
  });

  it('two walls in one L-shaped region: no forced quad, a starter around the tap instead', () => {
    // A tall wall on the left and a lower one running off to the right, labelled as one region.
    const twoWalls = mask(800, 800, rect(100, 100, 300, 700), rect(100, 500, 700, 700));
    const fit = fitQuad(twoWalls, { x: 200, y: 400 });
    expect(fit?.starter).toBe(true);
    expect(fit?.mismatch).toBeGreaterThan(QUAD_MISMATCH_LIMIT);
    // As tall as the region at the tap, and centred on it.
    expect(fit?.quad).toEqual(rect(20, 100, 380, 700));
  });

  it('leaves out areas other surfaces already cover, so a second wall gets its own quad', () => {
    const both = mask(W, H, rect(0, 0, 400, 300));
    const firstWall = mask(W, H, rect(0, 0, 200, 300));
    const fit = fitQuad(both, { x: 300, y: 150 }, firstWall);
    expect(fit?.quad).toEqual(rect(200, 0, 400, 300));
  });

  it('falls back to the largest region when the tap misses, and gives up on an empty mask', () => {
    const regions = mask(W, H, rect(10, 10, 60, 60), rect(150, 50, 380, 280));
    expect(fitQuad(regions, { x: 100, y: 5 })?.quad).toEqual(rect(150, 50, 380, 280));
    expect(fitQuad(emptyMask(W, H), { x: 10, y: 10 })).toBeNull();
  });
});
