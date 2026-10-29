import { describe, expect, it } from 'vitest';
import type { RGBAImage } from '../segment/segmenter';
import { meanOf, misreadPatches, misreadPixels, shareOf, superpixels } from './holes';

// A 120 × 90 photo of a plain wall (a little noise, as a real one has), with things painted on it.
const W = 120;
const H = 90;
const WALL_RGB = [200, 195, 185];

type Painter = (x: number, y: number) => number[] | null;

function photo(...painters: Painter[]): RGBAImage {
  const data = new Uint8ClampedArray(W * H * 4);
  let seed = 7;
  const noise = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 6;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let rgb = WALL_RGB;
      for (const paint of painters) rgb = paint(x, y) ?? rgb;
      const n = noise();
      for (let k = 0; k < 3; k++) data[(y * W + x) * 4 + k] = rgb[k]! + n;
      data[(y * W + x) * 4 + 3] = 255;
    }
  }
  return { width: W, height: H, data };
}

const inBox = (x0: number, y0: number, x1: number, y1: number) => (x: number, y: number) => x >= x0 && x < x1 && y >= y0 && y < y1;
const inDisc = (cx: number, cy: number, r: number) => (x: number, y: number) => Math.hypot(x + 0.5 - cx, y + 0.5 - cy) < r;
const ring = (cx: number, cy: number, r: number, width: number) => (x: number, y: number) => {
  const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
  return d < r && d >= r - width;
};

/** Labels the finder gave (1 = the wall, 0 = something else) and the model's belief in a surface, as planes over the photo. */
function planes(misread: ((x: number, y: number) => boolean)[], belief: (x: number, y: number) => number) {
  const wall = new Uint8Array(W * H);
  const sure = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      wall[y * W + x] = misread.some((m) => m(x, y)) ? 0 : 1;
      sure[y * W + x] = belief(x, y);
    }
  }
  return { wall, sure };
}

/** The share of a region's pixels the fill adds. */
function filledShare(filled: Uint8Array, region: (x: number, y: number) => boolean): number {
  let n = 0;
  let set = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!region(x, y)) continue;
      n++;
      set += filled[y * W + x]!;
    }
  }
  return set / n;
}

function fill(image: RGBAImage, wall: Uint8Array, sure: Float32Array | null, inside = new Uint8Array(W * H).fill(1)) {
  const sp = superpixels(image, 6);
  const belief = sure ? meanOf(sp, sure, W, H) : null;
  return misreadPixels(sp, misreadPatches(sp, shareOf(sp, wall, W, H), shareOf(sp, inside, W, H), belief), wall, inside, W, H);
}

describe('filling in misread bits of a wall', () => {
  it('fills a patch that looks like the wall around it, and leaves a thing in front with its own colour', () => {
    const patch = inBox(15, 15, 50, 55);
    const dark = inDisc(88, 45, 14);
    const image = photo((x, y) => (dark(x, y) ? [80, 80, 90] : null));
    const { wall, sure } = planes([patch, dark], (x, y) => (dark(x, y) ? 0.05 : patch(x, y) ? 0.3 : 0.95));
    const filled = fill(image, wall, sure);
    expect(filledShare(filled, patch)).toBeGreaterThan(0.9);
    expect(filledShare(filled, dark)).toBeLessThan(0.05);
  });

  it('leaves a thing the colour of the wall when it has an outline', () => {
    // A plate the wall's colour, ringed by a dark rim: only the rim's edge tells it apart.
    const plate = inDisc(60, 45, 22);
    const image = photo((x, y) => (ring(60, 45, 22, 2)(x, y) ? [70, 70, 75] : null));
    const { wall, sure } = planes([plate], () => 0.6);
    expect(filledShare(fill(image, wall, sure), plate)).toBeLessThan(0.1);
  });

  it("leaves what the model was sure isn't a surface, unless the wall all but surrounds it", () => {
    const big = inBox(15, 15, 55, 60);
    const speck = inBox(85, 40, 91, 46);
    const image = photo();
    const { wall, sure } = planes([big, speck], (x, y) => (big(x, y) || speck(x, y) ? 0 : 0.95));
    const filled = fill(image, wall, sure);
    expect(filledShare(filled, big)).toBeLessThan(0.1);
    expect(filledShare(filled, speck)).toBeGreaterThan(0.9);
  });

  it('works from colour and edges alone where the model gives no probabilities', () => {
    const patch = inBox(15, 15, 50, 55);
    const dark = inDisc(88, 45, 14);
    const image = photo((x, y) => (dark(x, y) ? [80, 80, 90] : null));
    const { wall } = planes([patch, dark], () => 1);
    const filled = fill(image, wall, null);
    expect(filledShare(filled, patch)).toBeGreaterThan(0.9);
    expect(filledShare(filled, dark)).toBeLessThan(0.05);
  });

  it("leaves a thing that looks like the wall when it sits in something the model is sure of", () => {
    // A tap the colour of the tiles it reflects, half the model's idea of wall, set into a bath it is sure of.
    const tap = inBox(50, 40, 64, 52);
    const bath = (x: number, y: number) => inBox(36, 40, 78, 85)(x, y) && !tap(x, y);
    const image = photo((x, y) => (bath(x, y) ? [120, 95, 80] : null));
    const { wall, sure } = planes([tap, bath], (x, y) => (tap(x, y) ? 0.5 : bath(x, y) ? 0.02 : 0.95));
    expect(filledShare(fill(image, wall, sure), tap)).toBeLessThan(0.1);
  });

  it('fills a speck wholly inside the corners, but not the end of a thing the corners cut through', () => {
    // Two thin bits, too thin for superpixels of their own: one inside, one crossing the corners' edge (x = 60).
    const speck = inBox(10, 30, 24, 32);
    const cut = inBox(40, 60, 80, 62);
    const { wall, sure } = planes([speck, cut], (x, y) => (speck(x, y) || cut(x, y) ? 0 : 0.95));
    const left = Uint8Array.from({ length: W * H }, (_, i) => (i % W < 60 ? 1 : 0));
    const filled = fill(photo(), wall, sure, left);
    expect(filledShare(filled, speck)).toBe(1);
    expect(filledShare(filled, inBox(40, 60, 60, 62))).toBe(0);
  });

  it('stays inside the corners', () => {
    const patch = inBox(15, 15, 50, 55);
    const { wall, sure } = planes([patch], (x, y) => (patch(x, y) ? 0.3 : 0.95));
    const left = Uint8Array.from({ length: W * H }, (_, i) => (i % W < 30 ? 1 : 0));
    const filled = fill(photo(), wall, sure, left);
    expect(filledShare(filled, inBox(30, 15, 50, 55))).toBe(0);
    expect(filledShare(filled, inBox(15, 15, 26, 55))).toBeGreaterThan(0.9);
  });
});
