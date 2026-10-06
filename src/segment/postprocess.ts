/**
 * Cleaning up a segmentation model's output for a photo. Pure, no DOM.
 *
 * The model sees a ~640 px copy of the photo and labels 4 × 4 pixel cells of it, so its edges
 * are coarse. `refine` scales its probabilities up to the working image, pulls the edges onto
 * edges in the photo (a guided filter), labels each pixel and absorbs specks.
 */
import { CEILING, FLOOR, OTHER, WALL, type ClassProbabilities, type RGBAImage } from './segmenter';

// ---- Resampling -------------------------------------------------------------------------------

interface Tap {
  index: number;
  weight: number;
}

/** For each output pixel along one axis, the input pixels it covers and by how much (weights sum to 1). */
function areaTaps(from: number, to: number): Tap[][] {
  const scale = from / to;
  const taps: Tap[][] = [];
  for (let o = 0; o < to; o++) {
    const start = o * scale;
    const end = Math.min(from, start + scale);
    const list: Tap[] = [];
    for (let i = Math.floor(start); i < end; i++) {
      const overlap = Math.min(end, i + 1) - Math.max(start, i);
      if (overlap > 1e-9) list.push({ index: i, weight: overlap / (end - start) });
    }
    taps.push(list);
  }
  return taps;
}

/** Scales an image down by averaging the pixels each output pixel covers (no aliasing). */
export function resizeArea(image: RGBAImage, width: number, height: number): RGBAImage {
  const { width: sw, height: sh, data } = image;
  const xTaps = areaTaps(sw, width);
  const yTaps = areaTaps(sh, height);
  const rows = new Float32Array(sh * width * 4);
  for (let y = 0; y < sh; y++) {
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      for (const { index, weight } of xTaps[x]!) {
        const i = (y * sw + index) * 4;
        rows[o] = rows[o]! + data[i]! * weight;
        rows[o + 1] = rows[o + 1]! + data[i + 1]! * weight;
        rows[o + 2] = rows[o + 2]! + data[i + 2]! * weight;
        rows[o + 3] = rows[o + 3]! + data[i + 3]! * weight;
      }
    }
  }
  const out = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (const { index, weight } of yTaps[y]!) {
        const i = (index * width + x) * 4;
        r += rows[i]! * weight;
        g += rows[i + 1]! * weight;
        b += rows[i + 2]! * weight;
        a += rows[i + 3]! * weight;
      }
      out[o] = r;
      out[o + 1] = g;
      out[o + 2] = b;
      out[o + 3] = a;
    }
  }
  return { width, height, data: out };
}

/** Where output pixel centres fall between input pixel centres along one axis. */
interface Lerp {
  i0: Int32Array;
  i1: Int32Array;
  t: Float32Array;
}

function lerpTable(from: number, to: number): Lerp {
  const i0 = new Int32Array(to);
  const i1 = new Int32Array(to);
  const t = new Float32Array(to);
  for (let o = 0; o < to; o++) {
    const s = Math.min(from - 1, Math.max(0, ((o + 0.5) * from) / to - 0.5));
    i0[o] = Math.floor(s);
    i1[o] = Math.min(from - 1, i0[o]! + 1);
    t[o] = s - i0[o]!;
  }
  return { i0, i1, t };
}

/** Scales a single-channel map with bilinear interpolation, pixel centres aligned. */
export function upsampleBilinear(src: Float32Array, sw: number, sh: number, width: number, height: number): Float32Array {
  const xs = lerpTable(sw, width);
  const ys = lerpTable(sh, height);
  const out = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    const r0 = ys.i0[y]! * sw;
    const r1 = ys.i1[y]! * sw;
    const ty = ys.t[y]!;
    for (let x = 0; x < width; x++) {
      const x0 = xs.i0[x]!;
      const x1 = xs.i1[x]!;
      const tx = xs.t[x]!;
      const top = src[r0 + x0]! + (src[r0 + x1]! - src[r0 + x0]!) * tx;
      const bottom = src[r1 + x0]! + (src[r1 + x1]! - src[r1 + x0]!) * tx;
      out[y * width + x] = top + (bottom - top) * ty;
    }
  }
  return out;
}

// ---- Box filter and guided filter -----------------------------------------------------------------

/** Mean over a (2r+1)² window, the window clipped at the image edges. */
export function boxFilter(src: Float32Array, width: number, height: number, r: number): Float32Array {
  const rows = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    const row = y * width;
    let sum = 0;
    for (let x = 0; x <= Math.min(r, width - 1); x++) sum += src[row + x]!;
    for (let x = 0; x < width; x++) {
      const lo = Math.max(0, x - r);
      const hi = Math.min(width - 1, x + r);
      rows[row + x] = sum / (hi - lo + 1);
      if (x + r + 1 < width) sum += src[row + x + r + 1]!;
      if (x - r >= 0) sum -= src[row + x - r]!;
    }
  }
  const out = new Float32Array(width * height);
  for (let x = 0; x < width; x++) {
    let sum = 0;
    for (let y = 0; y <= Math.min(r, height - 1); y++) sum += rows[y * width + x]!;
    for (let y = 0; y < height; y++) {
      const lo = Math.max(0, y - r);
      const hi = Math.min(height - 1, y + r);
      out[y * width + x] = sum / (hi - lo + 1);
      if (y + r + 1 < height) sum += rows[(y + r + 1) * width + x]!;
      if (y - r >= 0) sum -= rows[(y - r) * width + x]!;
    }
  }
  return out;
}

export interface GuidedOptions {
  /** Window radius in working-image pixels: about two of the model's cells. */
  radius: number;
  /** Regularisation (guide channels run 0–1): larger keeps more of the model's own smooth edge. */
  eps: number;
  /** The filter's coefficients are worked out at 1/subsample of the working size (the "fast" guided filter). */
  subsample: number;
}

const mul = (a: Float32Array, b: Float32Array) => a.map((v, i) => v * b[i]!);

/**
 * Labels every pixel of the working image, with each class's probability passed through a colour
 * guided filter (He, Sun and Tang) that uses the photo as the guide. Where the model's
 * probability changes, the filter fits it as a linear function of the photo's colour in a small
 * window, so the edge moves onto the photo's own edge (a basin's rim, the side of a WC).
 */
export function guidedLabels(probs: ClassProbabilities, guide: RGBAImage, options: GuidedOptions): Uint8Array {
  const { width, height } = guide;
  const fw = Math.max(1, Math.round(width / options.subsample));
  const fh = Math.max(1, Math.round(height / options.subsample));
  const r = Math.max(1, Math.round(options.radius / options.subsample));
  const small = resizeArea(guide, fw, fh);
  const n = fw * fh;
  const channel = (c: number) => {
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) out[i] = small.data[i * 4 + c]! / 255;
    return out;
  };
  const box = (map: Float32Array) => boxFilter(map, fw, fh, r);
  const I = [channel(0), channel(1), channel(2)] as const;
  const mean = I.map(box) as [Float32Array, Float32Array, Float32Array];
  // Colour covariance in each window: rr, rg, rb, gg, gb, bb.
  const pairs = [
    [0, 0],
    [0, 1],
    [0, 2],
    [1, 1],
    [1, 2],
    [2, 2],
  ] as const;
  const cov = pairs.map(([a, b]) => {
    const m = box(mul(I[a], I[b]));
    for (let i = 0; i < n; i++) m[i] = m[i]! - mean[a][i]! * mean[b][i]!;
    return m;
  });

  // Per class: coefficients A (3) and B, averaged over the windows that cover each pixel.
  const classes = [probs.wall, probs.floor, probs.ceiling];
  const coefficients = classes.map((prob) => {
    const p = upsampleBilinear(prob, probs.width, probs.height, fw, fh);
    const meanP = box(p);
    const meanIp = I.map((ch) => box(mul(ch, p)));
    const a = [new Float32Array(n), new Float32Array(n), new Float32Array(n)] as const;
    const b = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const c0 = meanIp[0]![i]! - mean[0][i]! * meanP[i]!;
      const c1 = meanIp[1]![i]! - mean[1][i]! * meanP[i]!;
      const c2 = meanIp[2]![i]! - mean[2][i]! * meanP[i]!;
      // Solve (Σ + eps·I) a = c for the symmetric 3 × 3 Σ, by cofactors.
      const s00 = cov[0]![i]! + options.eps;
      const s01 = cov[1]![i]!;
      const s02 = cov[2]![i]!;
      const s11 = cov[3]![i]! + options.eps;
      const s12 = cov[4]![i]!;
      const s22 = cov[5]![i]! + options.eps;
      const k00 = s11 * s22 - s12 * s12;
      const k01 = s02 * s12 - s01 * s22;
      const k02 = s01 * s12 - s02 * s11;
      const k11 = s00 * s22 - s02 * s02;
      const k12 = s01 * s02 - s00 * s12;
      const k22 = s00 * s11 - s01 * s01;
      const det = s00 * k00 + s01 * k01 + s02 * k02;
      const a0 = (k00 * c0 + k01 * c1 + k02 * c2) / det;
      const a1 = (k01 * c0 + k11 * c1 + k12 * c2) / det;
      const a2 = (k02 * c0 + k12 * c1 + k22 * c2) / det;
      a[0][i] = a0;
      a[1][i] = a1;
      a[2][i] = a2;
      b[i] = meanP[i]! - a0 * mean[0][i]! - a1 * mean[1][i]! - a2 * mean[2][i]!;
    }
    return [box(a[0]), box(a[1]), box(a[2]), box(b)] as const;
  });

  // Full resolution: q = A·I + B with the photo's own colour, then the most likely class. The
  // coefficients are scaled up bilinearly in two passes: across, once per row of the small grid...
  const xs = lerpTable(fw, width);
  const [wa0, wa1, wa2, wb, fa0, fa1, fa2, fb, ca0, ca1, ca2, cb] = coefficients.flat().map((m) => {
    const out = new Float32Array(fh * width);
    for (let fy = 0; fy < fh; fy++) {
      const row = fy * fw;
      const o = fy * width;
      for (let x = 0; x < width; x++) {
        const v0 = m[row + xs.i0[x]!]!;
        out[o + x] = v0 + (m[row + xs.i1[x]!]! - v0) * xs.t[x]!;
      }
    }
    return out;
  }) as Float32Array[] as [Float32Array, Float32Array, Float32Array, Float32Array, Float32Array, Float32Array, Float32Array, Float32Array, Float32Array, Float32Array, Float32Array, Float32Array];
  // ...then down, per pixel.
  const ys = lerpTable(fh, height);
  const labels = new Uint8Array(width * height);
  const data = guide.data;
  for (let y = 0; y < height; y++) {
    const k0 = ys.i0[y]! * width;
    const k1 = ys.i1[y]! * width;
    const ty = ys.t[y]!;
    for (let x = 0; x < width; x++) {
      const o = y * width + x;
      const red = data[o * 4]! / 255;
      const green = data[o * 4 + 1]! / 255;
      const blue = data[o * 4 + 2]! / 255;
      const a = k0 + x;
      const b = k1 + x;
      const wall = down(wa0, a, b, ty) * red + down(wa1, a, b, ty) * green + down(wa2, a, b, ty) * blue + down(wb, a, b, ty);
      const floor = down(fa0, a, b, ty) * red + down(fa1, a, b, ty) * green + down(fa2, a, b, ty) * blue + down(fb, a, b, ty);
      const ceiling = down(ca0, a, b, ty) * red + down(ca1, a, b, ty) * green + down(ca2, a, b, ty) * blue + down(cb, a, b, ty);
      labels[o] = pickLabel(wall, floor, ceiling, 1 - wall - floor - ceiling);
    }
  }
  return labels;
}

/** Labels every pixel from the model's probabilities scaled up bilinearly, with no help from the photo. */
export function bilinearLabels(probs: ClassProbabilities, width: number, height: number): Uint8Array {
  const up = [probs.wall, probs.floor, probs.ceiling].map((p) => upsampleBilinear(p, probs.width, probs.height, width, height));
  const labels = new Uint8Array(width * height);
  for (let i = 0; i < labels.length; i++) {
    const wall = up[0]![i]!;
    const floor = up[1]![i]!;
    const ceiling = up[2]![i]!;
    labels[i] = pickLabel(wall, floor, ceiling, 1 - wall - floor - ceiling);
  }
  return labels;
}

/** Between two rows of a map, a fraction t of the way down. */
function down(map: Float32Array, upper: number, lower: number, t: number): number {
  const v = map[upper]!;
  return v + (map[lower]! - v) * t;
}

function pickLabel(wall: number, floor: number, ceiling: number, other: number): number {
  let label = OTHER;
  let best = other;
  if (wall > best) {
    label = WALL;
    best = wall;
  }
  if (floor > best) {
    label = FLOOR;
    best = floor;
  }
  if (ceiling > best) label = CEILING;
  return label;
}

// ---- Specks ---------------------------------------------------------------------------------------

export interface IslandOptions {
  /** Wall, floor or ceiling patches smaller than this fraction of the image join their surroundings. */
  minSurface: number;
  /** "Other" specks smaller than this fraction join their surroundings. Kept tiny, so taps and soap dishes stay in front of the tiles. */
  minOther: number;
}

/**
 * Relabels small connected patches (4-connected) with the label they share the longest border
 * with: stray wall pixels on a WC, say, or a speck of "other" in the middle of a wall.
 */
export function removeIslands(labels: Uint8Array, width: number, height: number, options: IslandOptions): Uint8Array {
  const n = width * height;
  const out = labels.slice();
  const component = new Int32Array(n).fill(-1);
  const sizes: number[] = [];
  const stack = new Int32Array(n);
  for (let start = 0; start < n; start++) {
    if (component[start] !== -1) continue;
    const id = sizes.length;
    const label = labels[start];
    let top = 0;
    let size = 0;
    stack[top++] = start;
    component[start] = id;
    const visit = (j: number) => {
      if (component[j] !== -1 || labels[j] !== label) return;
      component[j] = id;
      stack[top++] = j;
    };
    while (top > 0) {
      const i = stack[--top]!;
      size++;
      const x = i % width;
      if (x > 0) visit(i - 1);
      if (x < width - 1) visit(i + 1);
      if (i >= width) visit(i - width);
      if (i + width < n) visit(i + width);
    }
    sizes.push(size);
  }
  const small = (id: number, label: number) => sizes[id]! < (label === OTHER ? options.minOther : options.minSurface) * n;
  // Border lengths between each small patch and the labels around it.
  const borders = new Map<number, Int32Array>();
  for (let i = 0; i < n; i++) {
    const id = component[i]!;
    const label = labels[i]!;
    if (!small(id, label)) continue;
    const count = (j: number) => {
      const other = labels[j]!;
      if (other === label) return;
      let counts = borders.get(id);
      if (!counts) borders.set(id, (counts = new Int32Array(4)));
      counts[other] = counts[other]! + 1;
    };
    const x = i % width;
    if (x > 0) count(i - 1);
    if (x < width - 1) count(i + 1);
    if (i >= width) count(i - width);
    if (i + width < n) count(i + width);
  }
  const replacement = new Map<number, number>();
  for (const [id, counts] of borders) {
    let best = -1;
    let bestCount = 0;
    counts.forEach((count, label) => {
      if (count > bestCount) {
        best = label;
        bestCount = count;
      }
    });
    if (best >= 0) replacement.set(id, best);
  }
  for (let i = 0; i < n; i++) {
    const label = replacement.get(component[i]!);
    if (label !== undefined) out[i] = label;
  }
  return out;
}

// ---- Masks ------------------------------------------------------------------------------------------

/** 1 where the labels equal `label`, else 0. */
export function labelMask(labels: Uint8Array, label: number): Uint8Array {
  const out = new Uint8Array(labels.length);
  for (let i = 0; i < labels.length; i++) out[i] = labels[i] === label ? 1 : 0;
  return out;
}

/**
 * Softens a 0/1 mask's edge into a 0–255 ramp about 2·radius pixels wide (two box blurs, close
 * to a Gaussian), so tiles blend into the photo instead of ending in a jagged line.
 */
export function featherMask(mask: Uint8Array, width: number, height: number, radius: number): Uint8Array {
  const r = Math.max(1, Math.round(radius / 2));
  const hard = Float32Array.from(mask, (v) => (v ? 1 : 0));
  const soft = boxFilter(boxFilter(hard, width, height, r), width, height, r);
  return Uint8Array.from(soft, (v) => Math.round(v * 255));
}

// ---- The whole clean-up -------------------------------------------------------------------------------

export interface RefineOptions {
  /** 'guided' follows the photo's edges; 'bilinear' just scales the model's output up. */
  edges: 'guided' | 'bilinear';
  guided: GuidedOptions;
  islands: IslandOptions;
}

export const DEFAULT_REFINE: RefineOptions = {
  edges: 'guided',
  guided: { radius: 12, eps: 0.0004, subsample: 4 },
  islands: { minSurface: 0.002, minOther: 0.0002 },
};

/** Labels each pixel of the working image (the guide) from the model's probabilities. */
export function refine(probs: ClassProbabilities, guide: RGBAImage, options: RefineOptions = DEFAULT_REFINE): Uint8Array {
  const labels = options.edges === 'guided' ? guidedLabels(probs, guide, options.guided) : bilinearLabels(probs, guide.width, guide.height);
  return removeIslands(labels, guide.width, guide.height, options.islands);
}
