import { describe, expect, it } from 'vitest';
import { distanceToPlane, fromDepth, samplePoints, shifted, surfaceOffset, toNormView } from './depth';
import { wallFromCorners } from './marking';
import { surfaceFrame, type Vec3 } from './surfaceFrame';

const close = (a: readonly number[], b: readonly number[], digits = 5) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i]!, digits));

/** A perspective projection (column-major), 60° high, 3:4, optionally off-centre (as a phone camera's can be). */
function projection(shiftX = 0, shiftY = 0): Float32Array {
  const f = 1 / Math.tan(Math.PI / 6);
  const near = 0.05;
  const far = 100;
  return Float32Array.from([f / 0.75, 0, 0, 0, 0, f, 0, 0, shiftX, shiftY, (far + near) / (near - far), -1, 0, 0, (2 * far * near) / (near - far), 0]);
}
// The camera 1.5 m up looking straight ahead (−z): its pose, and room → view.
const camera = Float32Array.from([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 1.5, 0, 1]);
const view = Float32Array.from([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, -1.5, 0, 1]);
const viewer: Vec3 = [0, 1.5, 0];

describe('depth readings', () => {
  it('places room points in the view, from its top-left, with their depth along the view', () => {
    const centre = toNormView(projection(), view, [0, 1.5, -2])!;
    close([centre.x, centre.y, centre.depth], [0.5, 0.5, 2]);
    const upRight = toNormView(projection(), view, [0.4, 1.9, -2])!;
    expect(upRight.x).toBeGreaterThan(0.5);
    expect(upRight.y).toBeLessThan(0.5);
    expect(toNormView(projection(), view, [0, 1.5, 2])).toBeNull();
    expect(toNormView(projection(), view, [10, 1.5, -2])).toBeNull();
  });

  it('turns a reading back into the room point it came from, with an off-centre camera too', () => {
    for (const p of [projection(), projection(0.03, -0.02)]) {
      for (const point of [[0.3, 1.2, -2], [-0.3, 1.0, -1.4], [0.1, 2.1, -3]] as Vec3[]) {
        const seen = toNormView(p, view, point)!;
        close(fromDepth(p, camera, seen.x, seen.y, seen.depth), point);
      }
    }
  });
});

describe('the real surface against a marked one', () => {
  const hit = Float32Array.from([1, 0, 0, 0, 0, 0, 1, 0, 0, -1, 0, 0, -0.6, 1.0, -2, 1]);
  const marked = wallFromCorners(surfaceFrame(hit, viewer), [0.6, 2.0, -2])!;

  it('reads depth at a grid of points inside the marked area', () => {
    const points = samplePoints(marked);
    expect(points).toHaveLength(25);
    for (const p of points) {
      expect(distanceToPlane(p, marked.frame)).toBeCloseTo(0, 9);
      expect(p[0]).toBeGreaterThan(-0.6);
      expect(p[0]).toBeLessThan(0.6);
    }
  });

  it('finds how far the real wall lies behind the marked one, ignoring things in front', () => {
    // The real wall is 4 cm further away; three readings hit a hand 40 cm in front.
    const seen = samplePoints(marked).map(([x, y, z], i): Vec3 => (i < 3 ? [x, y, z + 0.4] : [x, y, z - 0.04]));
    expect(surfaceOffset(seen, marked.frame)).toBeCloseTo(-0.04, 6);
    const moved = shifted(marked, -0.04);
    close(moved.frame.origin, [-0.6, 1.0, -2.04]);
    expect(moved.widthMm).toBe(marked.widthMm);
  });

  it('says nothing without enough readings near the plane', () => {
    expect(surfaceOffset(samplePoints(marked).slice(0, 8), marked.frame)).toBeNull();
  });

  it('measures the straight distance to a surface, not along the line of sight', () => {
    expect(distanceToPlane([0.8, 1.5, 0], marked.frame)).toBeCloseTo(2, 6);
  });
});
