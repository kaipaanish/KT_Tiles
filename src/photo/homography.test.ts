import { describe, expect, it } from 'vitest';
import { apply, invert, multiply, rectCorners, solveHomography, surfaceToPhoto, type Pt, type Quad } from './homography';

/** Repeatable pseudo-random numbers. */
function random(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a * 1664525 + 1013904223) >>> 0;
    return a / 4294967296;
  };
}

const distance = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);

// A 2400 × 2700 mm wall photographed at an angle: the right side is further away.
const wallQuad: Quad = [
  { x: 180, y: 1350 },
  { x: 1700, y: 1150 },
  { x: 1640, y: 330 },
  { x: 250, y: 300 },
];
// A floor seen from a doorway: strong perspective, the far edge much shorter.
const floorQuad: Quad = [
  { x: 120, y: 1500 },
  { x: 1900, y: 1520 },
  { x: 1350, y: 820 },
  { x: 640, y: 810 },
];

describe('homography', () => {
  for (const [name, quad, size] of [
    ['wall', wallQuad, { w: 2400, h: 2700 }],
    ['floor', floorQuad, { w: 1800, h: 2400 }],
  ] as const) {
    describe(`a ${name} in perspective`, () => {
      const toPhoto = surfaceToPhoto({ x: 0, y: 0, w: size.w, h: size.h }, quad);
      const toSurface = toPhoto && invert(toPhoto);

      it('maps the four corners exactly', () => {
        if (!toPhoto) throw new Error('no homography');
        rectCorners(0, 0, size.w, size.h).forEach((corner, i) => {
          expect(distance(apply(toPhoto, corner), quad[i]!)).toBeLessThan(1e-6);
        });
      });

      it('round-trips photo pixels through millimetres and back to within 0.5 px', () => {
        if (!toPhoto || !toSurface) throw new Error('no homography');
        const next = random(7);
        let worst = 0;
        for (let i = 0; i < 1000; i++) {
          const surface = { x: next() * size.w, y: next() * size.h };
          const pixel = apply(toPhoto, surface);
          worst = Math.max(worst, distance(apply(toPhoto, apply(toSurface, pixel)), pixel));
        }
        expect(worst).toBeLessThan(0.5);
      });

      it('round-trips random millimetre points through pixels and back', () => {
        if (!toPhoto || !toSurface) throw new Error('no homography');
        const next = random(11);
        let worst = 0;
        for (let i = 0; i < 1000; i++) {
          const p = { x: next() * size.w, y: next() * size.h };
          worst = Math.max(worst, distance(apply(toSurface, apply(toPhoto, p)), p));
        }
        expect(worst).toBeLessThan(0.01);
      });

      it('inverts to the identity', () => {
        if (!toPhoto || !toSurface) throw new Error('no homography');
        const product = multiply(toPhoto, toSurface);
        const scale = product[8];
        [1, 0, 0, 0, 1, 0, 0, 0, 1].forEach((v, i) => expect(product[i]! / scale).toBeCloseTo(v, 9));
      });
    });
  }

  it('keeps straight lines straight (grout lines stay straight)', () => {
    const toPhoto = surfaceToPhoto({ x: 0, y: 0, w: 2400, h: 2700 }, wallQuad);
    if (!toPhoto) throw new Error('no homography');
    const a = apply(toPhoto, { x: 300, y: 0 });
    const b = apply(toPhoto, { x: 300, y: 2700 });
    for (let y = 100; y < 2700; y += 400) {
      const p = apply(toPhoto, { x: 300, y });
      const cross = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
      expect(Math.abs(cross) / distance(a, b)).toBeLessThan(1e-6);
    }
  });

  it('rejects degenerate input', () => {
    const square = rectCorners(0, 0, 100, 100);
    expect(solveHomography(square, [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 2 }, { x: 3, y: 3 }])).toBeNull();
    expect(solveHomography(square, square.slice(0, 3))).toBeNull();
  });
});
