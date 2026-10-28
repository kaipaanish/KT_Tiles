import { describe, expect, it } from 'vitest';
import { FOUND_SHARE_MIN, insidePolygon, isConvexQuad, markedRect, planeExtent, rasterPolygon, rectanglePlane, surfaceMatrix, surfaceOutline, tileArea } from './fit';
import { apply, rectCorners, surfaceToPhoto, type Pt, type Quad } from './homography';

// A 2400 × 2700 mm wall photographed at an angle (the right side further away).
const wallQuad: Quad = [
  { x: 180, y: 1350 },
  { x: 1700, y: 1150 },
  { x: 1640, y: 330 },
  { x: 250, y: 300 },
];
const wall = { widthMm: 2400, heightMm: 2700 };
const near = (a: Pt, b: Pt, tolerance = 1e-6) => Math.hypot(a.x - b.x, a.y - b.y) < tolerance;

describe('what the corners mark', () => {
  it("is the whole surface, following the surface's size", () => {
    expect(markedRect({ marks: 'surface', rect: { x: 5, y: 5, w: 5, h: 5 } }, wall)).toEqual({ x: 0, y: 0, w: 2400, h: 2700 });
  });

  it('or a rectangle of known size somewhere on the surface', () => {
    const fit = { quad: wallQuad, marks: 'rectangle' as const, rect: { x: 600, y: 0, w: 800, h: 2000 } };
    expect(markedRect(fit, wall)).toEqual(fit.rect);
    // The rectangle's corners land on the quad; the surface reaches beyond it.
    const toPhoto = surfaceMatrix(fit, wall)!;
    rectCorners(600, 0, 800, 2000).forEach((p, i) => expect(near(apply(toPhoto, p), wallQuad[i]!, 1e-6)).toBe(true));
    const outline = surfaceOutline(toPhoto, wall);
    expect(outline[0].x).toBeLessThan(wallQuad[0].x);
    expect(outline[1].x).toBeGreaterThan(wallQuad[1].x);
  });
});

describe('isConvexQuad', () => {
  it('accepts a fitted quad in either winding and rejects crossed or flat ones', () => {
    expect(isConvexQuad(wallQuad)).toBe(true);
    expect(isConvexQuad([...wallQuad].reverse())).toBe(true);
    const crossed: Quad = [wallQuad[0], wallQuad[2], wallQuad[1], wallQuad[3]];
    expect(isConvexQuad(crossed)).toBe(false);
    const flat: Quad = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }, { x: 0, y: 1 }];
    expect(isConvexQuad(flat)).toBe(false);
  });
});

describe('measuring a region on the plane', () => {
  it("finds the surface's size from a known rectangle on it", () => {
    // A door 800 × 2000 mm marked on a wall whose region spans the whole 2400 × 2700 mm wall.
    const toPhoto = surfaceToPhoto({ x: 0, y: 0, w: 2400, h: 2700 }, wallQuad)!;
    const door: Quad = rectCorners(600, 0, 800, 2000).map((p) => apply(toPhoto, p)) as Quad;
    const toPlane = rectanglePlane(door, { w: 800, h: 2000 })!;
    const extent = planeExtent(wallQuad, toPlane, door[0])!;
    expect(extent.minX).toBeCloseTo(-600, 3);
    expect(extent.maxX).toBeCloseTo(1800, 3);
    expect(extent.minY).toBeCloseTo(0, 3);
    expect(extent.maxY).toBeCloseTo(2700, 3);
  });

  it('skips points beyond the horizon and caps runaway sizes', () => {
    // A floor running away from the camera: its far edge is near the horizon.
    const floor: Quad = [
      { x: 100, y: 1000 },
      { x: 900, y: 1000 },
      { x: 600, y: 520 },
      { x: 400, y: 520 },
    ];
    const toPlane = rectanglePlane(floor, { w: 1000, h: 1000 })!;
    // Its sides meet at the horizon, y = 360: a point above it is skipped, one just below is capped.
    const extent = planeExtent([...floor, { x: 500, y: 10 }, { x: 500, y: 361 }], toPlane, { x: 500, y: 800 }, 20000)!;
    expect(extent.maxY).toBe(20000);
    expect(extent.minY).toBeCloseTo(0, 3);
    expect(extent.minX).toBeCloseTo(0, 3);
  });
});

describe('rasterPolygon', () => {
  it('fills pixels whose centres are inside', () => {
    const mask = rasterPolygon(rectCorners(2, 1, 4, 3).map((p) => ({ x: p.x, y: p.y })), 10, 6);
    const filled = [...mask].reduce((a, b) => a + b, 0);
    expect(filled).toBe(12);
    expect(mask[1 * 10 + 2]).toBe(1);
    expect(mask[1 * 10 + 6]).toBe(0);
    expect(mask[4 * 10 + 2]).toBe(0);
  });

  it('matches the point-in-polygon test on a perspective quad', () => {
    const quad = wallQuad.map((p) => ({ x: p.x / 10, y: p.y / 10 }));
    const mask = rasterPolygon(quad, 200, 150);
    let mismatches = 0;
    for (let y = 0; y < 150; y++) for (let x = 0; x < 200; x++) if (mask[y * 200 + x] !== (insidePolygon(quad, { x: x + 0.5, y: y + 0.5 }) ? 1 : 0)) mismatches++;
    expect(mismatches).toBe(0);
  });
});

describe('where the tiles go', () => {
  // 10 × 4 pixels, all inside the corners. Labels: 1 = wall, 0 = something else.
  const inside = new Uint8Array(40).fill(1);
  const labels = (wallShare: number) => Uint8Array.from({ length: 40 }, (_, i) => (i < Math.round(40 * wallShare) ? 1 : 0));
  const count = (area: Uint8Array) => area.reduce((a, b) => a + b, 0);

  it('keeps fixtures in front where the wall finder found most of the wall', () => {
    const result = tileArea(labels(0.8), 1, inside, 'auto');
    expect(result.cover).toBe('found');
    expect(result.found).toBeCloseTo(0.8, 6);
    expect(count(result.area)).toBe(32);
  });

  it("trusts the corners where the wall finder found too little of what's inside them", () => {
    // A plain wall taken for a door: the finder found a sliver of it.
    const result = tileArea(labels(0.05), 1, inside, 'auto');
    expect(result.cover).toBe('corners');
    expect(count(result.area)).toBe(40);
    expect(tileArea(labels(FOUND_SHARE_MIN), 1, inside, 'auto').cover).toBe('found');
  });

  it('follows an explicit choice either way, and never goes outside the corners', () => {
    expect(count(tileArea(labels(0.05), 1, inside, 'found').area)).toBe(2);
    expect(count(tileArea(labels(0.9), 1, inside, 'corners').area)).toBe(40);
    const half = Uint8Array.from({ length: 40 }, (_, i) => (i < 20 ? 1 : 0));
    expect(count(tileArea(labels(1), 1, half, 'corners').area)).toBe(20);
  });
});
