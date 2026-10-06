import { describe, expect, it } from 'vitest';
import type { RGBAImage } from '../segment/segmenter';
import { shadingMap } from './shading';

const W = 64;
const H = 48;

function image(grey: (x: number, y: number) => number): RGBAImage {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) data.set([grey(x, y), grey(x, y), grey(x, y), 255], (y * W + x) * 4);
  return { width: W, height: H, data };
}

const all = () => new Float32Array(W * H).fill(1);
const at = (map: { data: Uint8Array }, x: number, y: number) => map.data[y * W + x]! / 127.5;

describe('room lighting', () => {
  it('is 1 everywhere on an evenly lit surface', () => {
    const map = shadingMap(image(() => 150), all(), 6);
    expect([...map.data].every((v) => v === 128)).toBe(true);
  });

  it('follows light falling off across the surface, averaging 1', () => {
    const map = shadingMap(image((x) => 60 + x * 2), all(), 4);
    expect(at(map, 5, 24)).toBeLessThan(0.8);
    expect(at(map, 58, 24)).toBeGreaterThan(1.2);
    let sum = 0;
    for (const v of map.data) sum += v / 127.5;
    expect(sum / map.data.length).toBeCloseTo(1, 1);
  });

  it('blurs away old tiles and grout', () => {
    // Dark grout lines every 8 px over an even wall.
    const map = shadingMap(image((x, y) => (x % 8 === 0 || y % 8 === 0 ? 40 : 200)), all(), 8);
    const inner = [...map.data].filter((_, i) => i % W > 12 && i % W < W - 12 && i / W > 12 && i / W < H - 12).map((v) => v / 127.5);
    expect(Math.max(...inner) - Math.min(...inner)).toBeLessThan(0.05);
  });

  it("isn't brightened by a white fixture outside the surface", () => {
    // The surface is the left half; a bright WC fills the right half.
    const mask = new Float32Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W / 2; x++) mask[y * W + x] = 1;
    const plain = shadingMap(image(() => 120), mask, 6);
    const withFixture = shadingMap(image((x) => (x < W / 2 ? 120 : 255)), mask, 6);
    expect(at(withFixture, W / 2 - 2, 24)).toBeCloseTo(at(plain, W / 2 - 2, 24), 2);
    expect(at(withFixture, W / 2 - 2, 24)).toBeCloseTo(1, 2);
  });
});
