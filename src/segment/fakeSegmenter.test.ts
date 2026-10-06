import { describe, expect, it } from 'vitest';
import { fitQuad } from '../photo/maskToQuad';
import { FakeSegmenter } from './fakeSegmenter';
import { labelMask } from './postprocess';
import { CEILING, FLOOR, OTHER, WALL, type RGBAImage, type SegmentProgress } from './segmenter';

/** A photo of a wall (cream) over a floor (grey) with a white basin on the wall. */
function room(width: number, height: number): RGBAImage {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const basin = (x - 160) ** 2 / 40 ** 2 + (y - 120) ** 2 / 25 ** 2 <= 1;
      const colour = basin ? [250, 250, 250] : y >= 180 ? [120, 120, 125] : [205, 190, 165];
      data.set([...colour, 255], (y * width + x) * 4);
    }
  }
  return { width, height, data };
}

describe('FakeSegmenter', () => {
  const width = 320;
  const height = 240;
  // The painter matches the photo, but at the fake model's coarse 6 px cells.
  const segmenter = new FakeSegmenter((u, v) => {
    const x = u * width;
    const y = v * height;
    if ((x - 160) ** 2 / 40 ** 2 + (y - 120) ** 2 / 25 ** 2 <= 1) return OTHER;
    return y >= 180 ? FLOOR : WALL;
  });

  it('labels every pixel through the same clean-up as the real model', async () => {
    const progress: SegmentProgress[] = [];
    const result = await segmenter.segment(room(width, height), (p) => progress.push(p));
    expect(progress).toEqual([{ phase: 'run' }]);
    expect(result).toMatchObject({ width, height, model: 'Fake segmenter' });
    const at = (x: number, y: number) => result.labels[y * width + x];
    expect(at(20, 20)).toBe(WALL);
    expect(at(160, 120)).toBe(OTHER);
    expect(at(20, 230)).toBe(FLOOR);
    expect(result.labels.includes(CEILING)).toBe(false);
  });

  it("follows the photo's edges, so the basin's rim lands within a pixel or two", async () => {
    const result = await segmenter.segment(room(width, height));
    // Along the basin's middle row its rim is at x = 120 and x = 200.
    const row = 120 * width;
    let left = 0;
    while (result.labels[row + left] === WALL) left++;
    let right = width - 1;
    while (result.labels[row + right] === WALL) right--;
    expect(Math.abs(left - 120)).toBeLessThanOrEqual(2);
    expect(Math.abs(right - 200)).toBeLessThanOrEqual(2);
  });

  it("gives the wall's region to the quad fit, with the basin as a hole", async () => {
    const result = await segmenter.segment(room(width, height));
    const fit = fitQuad({ width, height, data: labelMask(result.labels, WALL) }, { x: 40, y: 40 });
    expect(fit?.starter).toBe(false);
    const [bl, br, tr, tl] = fit!.quad;
    expect(Math.abs(bl.x) + Math.abs(tl.x) + Math.abs(tl.y) + Math.abs(tr.y)).toBeLessThan(4);
    expect(Math.abs(br.x - width) + Math.abs(tr.x - width)).toBeLessThan(4);
    expect(Math.abs(bl.y - 180) + Math.abs(br.y - 180)).toBeLessThan(4);
  });
});
