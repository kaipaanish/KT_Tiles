import { describe, expect, it } from 'vitest';
import { apply, invert, surfaceToPhoto, type Quad } from './homography';
import { dragDeltaMm, pixelsPerMm } from './pointer';

const quad: Quad = [
  { x: 180, y: 1350 },
  { x: 1700, y: 1150 },
  { x: 1640, y: 330 },
  { x: 250, y: 300 },
];
const toPhoto = surfaceToPhoto({ x: 0, y: 0, w: 2400, h: 2700 }, quad);
const toSurface = toPhoto && invert(toPhoto);

describe('pointer mapping on a photo', () => {
  it('a drag along the wall in the photo moves the pattern by the expected millimetres', () => {
    if (!toPhoto || !toSurface) throw new Error('no homography');
    for (const y of [300, 1350, 2400]) {
      const from = apply(toPhoto, { x: 600, y });
      const to = apply(toPhoto, { x: 900, y });
      const delta = dragDeltaMm(toSurface, from, to);
      expect(delta.x).toBeCloseTo(300, 6);
      expect(delta.y).toBeCloseTo(0, 6);
    }
  });

  it('the same 300 mm is fewer pixels on the far side of the wall', () => {
    if (!toPhoto) throw new Error('no homography');
    const nearSide = pixelsPerMm(toPhoto, { x: 200, y: 1350 });
    const farSide = pixelsPerMm(toPhoto, { x: 2200, y: 1350 });
    expect(nearSide).toBeGreaterThan(farSide);
    expect(farSide).toBeGreaterThan(0);
  });
});
