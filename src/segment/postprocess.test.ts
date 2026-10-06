import { describe, expect, it } from 'vitest';
import {
  bilinearLabels,
  boxFilter,
  featherMask,
  guidedLabels,
  removeIslands,
  resizeArea,
  resizePlane,
  upsampleBilinear,
  type GuidedOptions,
} from './postprocess';
import { FLOOR, OTHER, WALL, type ClassProbabilities, type RGBAImage } from './segmenter';

function image(width: number, height: number, colour: (x: number, y: number) => [number, number, number]): RGBAImage {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      data.set([...colour(x, y), 255], (y * width + x) * 4);
    }
  }
  return { width, height, data };
}

/** Wall probability at model resolution (cells of `cell` px), from a function of the image x. */
function wallProbability(width: number, height: number, cell: number, wall: (x: number) => number): ClassProbabilities {
  const w = width / cell;
  const h = height / cell;
  const p = { width: w, height: h, wall: new Float32Array(w * h), floor: new Float32Array(w * h), ceiling: new Float32Array(w * h) };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) p.wall[y * w + x] = wall(x * cell + cell / 2);
  return p;
}

/** The first column (in the middle row) not labelled wall. */
function edgeColumn(labels: Uint8Array, width: number, height: number): number {
  const row = Math.floor(height / 2) * width;
  for (let x = 0; x < width; x++) if (labels[row + x] !== WALL) return x;
  return width;
}

const CREAM: [number, number, number] = [200, 190, 170];
const WHITE: [number, number, number] = [245, 245, 245];
const GUIDED: GuidedOptions = { radius: 12, eps: 0.0004, subsample: 4 };

describe('resampling', () => {
  it('averages the pixels each output pixel covers', () => {
    const img = image(4, 2, (x, y) => [x * 40 + y * 100, 0, 0]);
    const small = resizeArea(img, 2, 1);
    // Blocks: (0, 40, 100, 140) and (80, 120, 180, 220).
    expect(small.data[0]).toBe(70);
    expect(small.data[4]).toBe(150);
  });

  it('interpolates between pixel centres and holds the ends', () => {
    expect([...upsampleBilinear(new Float32Array([0, 1]), 2, 1, 4, 1)]).toEqual([0, 0.25, 0.75, 1]);
    const flat = upsampleBilinear(new Float32Array(6).fill(0.3), 3, 2, 7, 5);
    expect(flat.every((v) => Math.abs(v - 0.3) < 1e-6)).toBe(true);
  });

  it('box filters with the window clipped at the edges', () => {
    const impulse = new Float32Array(25);
    impulse[12] = 9;
    const out = boxFilter(impulse, 5, 5, 1);
    expect(out[12]).toBeCloseTo(1, 6);
    expect(out[6]).toBeCloseTo(1, 6);
    expect(out[0]).toBe(0);
    const flat = boxFilter(new Float32Array(30).fill(2), 6, 5, 3);
    expect(flat.every((v) => Math.abs(v - 2) < 1e-6)).toBe(true);
  });
});

describe('guided edges', () => {
  // A cream wall meeting a white fixture at x = 100. The model's edge, a two-cell ramp, is 4 px off.
  const width = 256;
  const height = 64;
  const photo = image(width, height, (x) => (x < 100 ? CREAM : WHITE));
  const probs = wallProbability(width, height, 4, (x) => Math.min(1, Math.max(0, 0.5 - (x - 104) / 8)));

  it('scaling the model up keeps its edge where the model put it', () => {
    const edge = edgeColumn(bilinearLabels(probs, width, height), width, height);
    expect(Math.abs(edge - 104)).toBeLessThanOrEqual(1);
  });

  it("the guided filter moves the edge onto the photo's edge", () => {
    const edge = edgeColumn(guidedLabels(probs, photo, GUIDED), width, height);
    expect(Math.abs(edge - 100)).toBeLessThanOrEqual(1);
  });

  it("doesn't invent edges where the photo has none", () => {
    const plain = image(width, height, () => CREAM);
    const edge = edgeColumn(guidedLabels(probs, plain, GUIDED), width, height);
    expect(Math.abs(edge - 104)).toBeLessThanOrEqual(2);
  });

  it('leaves confident areas alone', () => {
    const labels = guidedLabels(probs, photo, GUIDED);
    const row = 32 * width;
    expect(labels[row + 20]).toBe(WALL);
    expect(labels[row + 200]).toBe(OTHER);
  });
});

describe('removeIslands', () => {
  const W = 100;
  const H = 100;
  /** All wall, with square patches [left, top, size, label]. */
  function labelsWith(...patches: [number, number, number, number][]): Uint8Array {
    const labels = new Uint8Array(W * H).fill(WALL);
    for (const [x0, y0, size, label] of patches) {
      for (let y = y0; y < y0 + size; y++) for (let x = x0; x < x0 + size; x++) labels[y * W + x] = label;
    }
    return labels;
  }
  const options = { minSurface: 0.002, minOther: 0.0002 };

  it('absorbs specks of other, but keeps small objects such as a tap', () => {
    const labels = labelsWith([10, 10, 1, OTHER], [50, 50, 5, OTHER]);
    const out = removeIslands(labels, W, H, options);
    expect(out[10 * W + 10]).toBe(WALL);
    expect(out[52 * W + 52]).toBe(OTHER);
  });

  it('absorbs stray surface patches, but keeps real ones', () => {
    const labels = labelsWith([20, 20, 4, OTHER], [21, 21, 1, FLOOR], [60, 60, 10, FLOOR]);
    const out = removeIslands(labels, W, H, options);
    // A 1-pixel floor patch inside a 4 × 4 object takes the object's label.
    expect(out[21 * W + 21]).toBe(OTHER);
    expect(out[65 * W + 65]).toBe(FLOOR);
  });

  it('gives a patch the label it shares the longest border with', () => {
    // A 2 × 2 floor speck (0.04%) on the boundary: 3 sides touch other, 1 touches wall.
    const labels = new Uint8Array(W * H).fill(OTHER);
    for (let y = 0; y < H; y++) for (let x = 0; x < 50; x++) labels[y * W + x] = WALL;
    labels[40 * W + 50] = FLOOR;
    labels[40 * W + 51] = FLOOR;
    labels[41 * W + 50] = FLOOR;
    labels[41 * W + 51] = FLOOR;
    const out = removeIslands(labels, W, H, options);
    expect(out[40 * W + 51]).toBe(OTHER);
  });
});

describe('featherMask', () => {
  it('softens the edge into a short ramp', () => {
    const width = 40;
    const height = 10;
    const mask = new Uint8Array(width * height);
    for (let y = 0; y < height; y++) for (let x = 0; x < 20; x++) mask[y * width + x] = 1;
    const soft = featherMask(mask, width, height, 2);
    const row = [...soft.subarray(5 * width, 6 * width)];
    expect(row[5]).toBe(255);
    expect(row[35]).toBe(0);
    expect(row[19]).toBeGreaterThan(128);
    expect(row[20]).toBeLessThan(128);
    for (let x = 1; x < width; x++) expect(row[x]).toBeLessThanOrEqual(row[x - 1]!);
    expect(row.filter((v) => v > 0 && v < 255).length).toBeLessThanOrEqual(4);
  });
});

describe('resizePlane', () => {
  it('averages a single channel the same way resizeArea averages colours', () => {
    const plane = Float32Array.from({ length: 8 * 6 }, (_, i) => (i * 37) % 11);
    const rgba = new Uint8ClampedArray(8 * 6 * 4);
    plane.forEach((v, i) => (rgba[i * 4] = v));
    const small = resizePlane(plane, 8, 6, 3, 2);
    const reference = resizeArea({ width: 8, height: 6, data: rgba }, 3, 2);
    small.forEach((v, i) => expect(Math.abs(v - reference.data[i * 4]!)).toBeLessThanOrEqual(0.5));
  });
});
