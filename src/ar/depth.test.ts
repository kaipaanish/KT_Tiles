import { describe, expect, it } from 'vitest';
import { checkWithDepth, distanceToPlane, fromDepth, samplePoints, shifted, surfaceOffset, toNormView } from './depth';
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

describe('checking a marked wall with depth', () => {
  const hit = Float32Array.from([1, 0, 0, 0, 0, 0, 1, 0, 0, -1, 0, 0, -0.6, 1.0, -2, 1]);
  const marked = wallFromCorners(surfaceFrame(hit, viewer), [0.6, 2.0, -2])!;
  /** Readings across the marked area of a real wall through (0, 1.5, z0), turned `deg` about the vertical; some noise and a few things in front. */
  const readings = (deg: number, z0: number, noise = 0.003): Vec3[] => {
    const a = (deg * Math.PI) / 180;
    let seed = 3;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 2 * noise;
    const points: Vec3[] = [];
    for (let i = 0; i < 12; i++) {
      for (let j = 0; j < 8; j++) {
        const x = -0.55 + (1.1 * i) / 11;
        const y = 1.05 + (0.9 * j) / 7;
        // On the turned wall: z changes along x by tan(a).
        points.push([x, y, z0 + x * Math.tan(a) + rand()]);
      }
    }
    // A hand 30 cm in front.
    for (let k = 0; k < 6; k++) points.push([0.1 * k - 0.3, 1.4, z0 + 0.3]);
    return points;
  };

  it('turns and moves the wall onto the readings, keeping it plumb and its size', () => {
    const check = checkWithDepth(readings(5, -2.03), marked);
    expect(check.ok).toBe(true);
    if (!check.ok) return;
    expect(check.turnDeg).toBeCloseTo(5, 0);
    expect(check.moveM).toBeCloseTo(-0.03, 2);
    expect(check.surface.frame.up).toEqual([0, 1, 0]);
    expect(check.surface.widthMm).toBe(marked.widthMm);
    // The corrected wall faces the real one: its normal turned 5° about the vertical.
    const n = check.surface.frame.normal;
    expect(Math.atan2(-n[0], n[2]) * (180 / Math.PI)).toBeCloseTo(5, 0);
  });

  it("doesn't trust readings that spread widely, or that call for a large correction", () => {
    expect(checkWithDepth(readings(0, -2, 0.08), marked)).toMatchObject({ ok: false, reason: 'uncertain' });
    expect(checkWithDepth(readings(0, -1.9), marked)).toMatchObject({ ok: false, reason: 'large' });
    expect(checkWithDepth(readings(15, -2), marked)).toMatchObject({ ok: false, reason: 'large' });
    expect(checkWithDepth(readings(0, -2).slice(0, 20), marked)).toMatchObject({ ok: false, reason: 'few' });
  });
});
