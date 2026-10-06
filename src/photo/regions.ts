import { CEILING, FLOOR, WALL, type Segmentation } from '../segment/segmenter';

/** How each kind of region is shown over the photo, and named in the legend. */
export const REGION_STYLES = [
  { label: WALL, name: 'Wall', rgb: [31, 111, 235], alpha: 0.42 },
  { label: FLOOR, name: 'Floor', rgb: [245, 158, 11], alpha: 0.5 },
  { label: CEILING, name: 'Ceiling', rgb: [148, 163, 184], alpha: 0.45 },
] as const;

export type RegionStyle = (typeof REGION_STYLES)[number];

export function styleFor(label: number): RegionStyle | undefined {
  return REGION_STYLES.find((style) => style.label === label);
}

export const cssColour = (style: RegionStyle, alpha = 1) => `rgba(${style.rgb.join(', ')}, ${alpha})`;

/**
 * Paints pixels as translucent colours on a canvas the size of the mask; drawn scaled over
 * the photo. `pick` returns the style for a pixel, or undefined to leave it clear.
 */
export function paintMask(width: number, height: number, pick: (i: number) => RegionStyle | undefined, alphaScale = 1): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;
  const image = ctx.createImageData(width, height);
  for (let i = 0; i < width * height; i++) {
    const style = pick(i);
    if (!style) continue;
    image.data[i * 4] = style.rgb[0];
    image.data[i * 4 + 1] = style.rgb[1];
    image.data[i * 4 + 2] = style.rgb[2];
    image.data[i * 4 + 3] = Math.round(Math.min(1, style.alpha * alphaScale) * 255);
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
}

/** Every wall, floor and ceiling region. */
export function paintRegions(segmentation: Segmentation): HTMLCanvasElement {
  return paintMask(segmentation.width, segmentation.height, (i) => styleFor(segmentation.labels[i]!));
}

/** The share of the image each label covers (0–1). */
export function labelShares(segmentation: Segmentation): Record<'wall' | 'floor' | 'ceiling' | 'other', number> {
  const counts = [0, 0, 0, 0];
  for (const label of segmentation.labels) counts[label] = (counts[label] ?? 0) + 1;
  const n = segmentation.labels.length || 1;
  return { other: counts[0]! / n, wall: counts[WALL]! / n, floor: counts[FLOOR]! / n, ceiling: counts[CEILING]! / n };
}
