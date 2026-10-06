/**
 * Room lighting for a surface: how much brighter or darker each part of it is than its average,
 * taken from the photo's own luminance. Pure, no DOM.
 *
 * The luminance is blurred heavily, so the old tiles and grout don't show through the new ones,
 * and only within the surface's region (a white WC beside the wall doesn't brighten it).
 */
import { boxFilter } from '../segment/postprocess';
import type { RGBAImage } from '../segment/segmenter';

export interface ShadingMap {
  width: number;
  height: number;
  /** Brightness relative to the surface's average, halved, as 0–255: 128 is average, 255 is twice it. */
  data: Uint8Array;
}

/**
 * @param image the photo, small: about 256 px on the long side is plenty after this much blur
 * @param mask the surface's region at the same size: how much of each pixel it covers (0–1)
 * @param radius blur radius in pixels, applied three times (close to a Gaussian)
 */
export function shadingMap(image: RGBAImage, mask: Float32Array, radius: number): ShadingMap {
  const { width, height, data } = image;
  const n = width * height;
  const lit = new Float32Array(n);
  let sum = 0;
  let weight = 0;
  for (let i = 0; i < n; i++) {
    // Rec. 709 luma on the stored (sRGB) values: the tiles are multiplied in the same space.
    const luma = (0.2126 * data[i * 4]! + 0.7152 * data[i * 4 + 1]! + 0.0722 * data[i * 4 + 2]!) / 255;
    lit[i] = luma * mask[i]!;
    sum += lit[i]!;
    weight += mask[i]!;
  }
  const out = new Uint8Array(n).fill(128);
  if (weight <= 0 || sum <= 0) return { width, height, data: out };
  const blur = (map: Float32Array) => boxFilter(boxFilter(boxFilter(map, width, height, radius), width, height, radius), width, height, radius);
  // Normalised convolution: the blurred luminance of the region alone, wherever the region is near.
  const top = blur(lit);
  const bottom = blur(mask);
  const mean = sum / weight;
  for (let i = 0; i < n; i++) {
    const relative = bottom[i]! > 1e-3 ? top[i]! / bottom[i]! / mean : 1;
    out[i] = Math.round(Math.min(2, Math.max(0, relative)) * 127.5);
  }
  return { width, height, data: out };
}
