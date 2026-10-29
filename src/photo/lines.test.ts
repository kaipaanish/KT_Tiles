import { describe, expect, it } from 'vitest';
import { apply, invert, type Mat3, type Pt, type Quad } from './homography';
import { cross3, findSegments, linedRectangle, lockedCorner, rectangleAspect, wallLines, type GreyImage, type Homogeneous, type Vanishing } from './lines';

// A camera (focal length 0.72 of the long side, centred) looking at a wall turned 35° away:
// its horizontal lines run off to the right, its verticals stay vertical in the photo.
const W = 400;
const H = 300;
const f = 0.72 * W;
const angle = (35 * Math.PI) / 180;
const along: Homogeneous = [Math.cos(angle), 0, Math.sin(angle)]; // the wall's horizontal, in camera space
const up: Homogeneous = [0, -1, 0];
const origin: Homogeneous = [-900, 900, 1500]; // the wall's bottom-left corner, mm
const camera = (p: readonly number[]): Homogeneous => [f * p[0]! + (W / 2) * p[2]!, f * p[1]! + (H / 2) * p[2]!, p[2]!];
/** Wall mm (x along, y up) → photo pixels. */
const wallToPhoto: Mat3 = (() => {
  const [a, b, c] = [camera(along), camera(up), camera(origin)];
  return [a[0], b[0], c[0], a[1], b[1], c[1], a[2], b[2], c[2]];
})();
const trueH = camera(along);
const trueV = camera(up);
const truth: Vanishing = { h: trueH, v: trueV };

/** Stripes every 300 mm and joints every 600 mm, dark on a light wall, 2 × 2 supersampled. */
function wallImage(): GreyImage {
  const toWall = invert(wallToPhoto)!;
  const data = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let sum = 0;
      for (const [dx, dy] of [
        [0.25, 0.25],
        [0.75, 0.25],
        [0.25, 0.75],
        [0.75, 0.75],
      ]) {
        const p = apply(toWall, { x: x + dx!, y: y + dy! });
        const onWall = p.x >= 0 && p.x <= 4000 && p.y >= 0 && p.y <= 2700;
        const line = ((p.y % 300) + 300) % 300 < 20 || ((p.x % 600) + 600) % 600 < 12;
        sum += !onWall ? 0.6 : line ? 0.3 : 0.85;
      }
      data[y * W + x] = sum / 4;
    }
  }
  return { width: W, height: H, data };
}

const at = (v: Homogeneous): Pt => ({ x: v[0] / v[2], y: v[1] / v[2] });
/** Whether three points (one may be at infinity) lie on a line. */
function collinear(a: Pt, b: Pt, v: Homogeneous): boolean {
  const line = cross3([a.x, a.y, 1], [b.x, b.y, 1]);
  const n = Math.hypot(line[0], line[1]) * Math.hypot(v[0], v[1], v[2]);
  return Math.abs(line[0] * v[0] + line[1] * v[1] + line[2] * v[2]) / n < 1e-6;
}

describe('the lines on a wall', () => {
  const image = wallImage();
  const segments = findSegments(image);

  it('finds the stripes and joints as long straight segments', () => {
    expect(segments.length).toBeGreaterThan(10);
    expect(Math.max(...segments.map((s) => s.length))).toBeGreaterThan(W * 0.3);
  });

  it('finds where the horizontal lines meet, and that the verticals stay vertical', () => {
    const lines = wallLines(segments, image, { x: 150, y: 150 })!;
    expect(lines).not.toBeNull();
    const found = at(lines.h);
    const expected = at(trueH);
    // About 610 px right of the photo's left edge: within 2% of that distance.
    expect(Math.hypot(found.x - expected.x, found.y - expected.y)).toBeLessThan(12);
    // Straight down (or up): at infinity, or so far off that it might as well be.
    expect(Math.abs(lines.v[0]) / Math.hypot(lines.v[0], lines.v[1])).toBeLessThan(0.01);
    expect(Math.abs(lines.v[2]) * 2000).toBeLessThan(Math.hypot(lines.v[0], lines.v[1]));
  });

  it('gives up without enough horizontal lines', () => {
    const verticalsOnly = segments.filter((s) => Math.abs(s.b.x - s.a.x) < Math.abs(s.b.y - s.a.y) * 0.3);
    expect(wallLines(verticalsOnly, image)).toBeNull();
  });

  it('puts a rectangle around a tap, along the lines and on them where they are near', () => {
    const lines = wallLines(segments, image, { x: 150, y: 150 })!;
    const quad = linedRectangle(lines, { x: 150, y: 150 }, image)!;
    expect(quad).not.toBeNull();
    expect(collinear(quad[0], quad[1], lines.h) && collinear(quad[3], quad[2], lines.h)).toBe(true);
    expect(collinear(quad[0], quad[3], lines.v) && collinear(quad[1], quad[2], lines.v)).toBe(true);
    expect(quad.every((p) => p.x >= 0 && p.y >= 0 && p.x <= W && p.y <= H)).toBe(true);
    // Its corners land on the wall's stripes and joints: on the wall, near multiples of 300 and 600 mm.
    const toWall = invert(wallToPhoto)!;
    for (const corner of quad) {
      const p = apply(toWall, corner);
      const offY = Math.min(((p.y % 300) + 300) % 300, 300 - (((p.y % 300) + 300) % 300));
      const offX = Math.min(((p.x % 600) + 600) % 600, 600 - (((p.x % 600) + 600) % 600));
      expect(offY).toBeLessThan(40);
      expect(offX).toBeLessThan(40);
    }
  });
});

describe('a rectangle that follows the lines', () => {
  const marked: Quad = [
    { x: 600, y: 600 },
    { x: 1200, y: 600 },
    { x: 1200, y: 1800 },
    { x: 600, y: 1800 },
  ].map((p) => apply(wallToPhoto, p)) as Quad;

  it('stays one when a corner is dragged: the opposite one stays, the others slide along the lines', () => {
    const moved = lockedCorner(marked, 0, { x: marked[0].x - 20, y: marked[0].y + 15 }, truth)!;
    expect(moved[0]).toEqual({ x: marked[0].x - 20, y: marked[0].y + 15 });
    expect(moved[2]).toEqual(marked[2]);
    expect(collinear(moved[0], moved[1], trueH) && collinear(moved[3], moved[2], trueH)).toBe(true);
    expect(collinear(moved[0], moved[3], trueV) && collinear(moved[1], moved[2], trueV)).toBe(true);
    // Every corner works the same way.
    for (let corner = 0; corner < 4; corner++) {
      const q = lockedCorner(marked, corner, { x: marked[corner]!.x + 5, y: marked[corner]!.y - 5 }, truth)!;
      expect(q[(corner + 2) % 4]).toEqual(marked[(corner + 2) % 4]);
      expect(collinear(q[0], q[1], trueH) && collinear(q[1], q[2], trueV)).toBe(true);
    }
  });

  it("measures the real rectangle's shape from the photo", () => {
    // 600 wide × 1200 high on the wall, seen at 35°.
    expect(rectangleAspect(marked, truth, { width: W, height: H })).toBeCloseTo(0.5, 3);
  });
});
