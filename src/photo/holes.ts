/**
 * Bits of a wall or floor the wall finder misread, filled back in. The photo is cut into
 * superpixels: small patches of like colour whose borders follow its edges. Inside a surface's
 * corners, a patch the finder gave another label joins the surface when it carries on from it:
 * much the same colour and texture as the surface beside it, with no real edge in between.
 * Things in front (a basin, a mirror, a cable) have an outline, so they stay out. Pure, no DOM.
 */
import type { RGBAImage } from '../segment/segmenter';

export interface Superpixels {
  width: number;
  height: number;
  /** Which superpixel each pixel is in. */
  of: Int32Array;
  count: number;
  /** Mean CIELAB colour, L, a, b for each superpixel in turn. */
  colour: Float32Array;
  /** Mean gradient of L (per pixel) inside each superpixel: how textured it is. */
  texture: Float32Array;
  /** Neighbouring superpixels, how long a border they share (pixel pairs), and the mean gradient along it. */
  borders: { a: number; b: number; length: number; edge: number }[];
}

const LINEAR = Float32Array.from({ length: 256 }, (_, v) => {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
});

const labF = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);

/** sRGB → CIELAB (D65), as three planes. */
function toLab(image: RGBAImage): [Float32Array, Float32Array, Float32Array] {
  const n = image.width * image.height;
  const L = new Float32Array(n);
  const A = new Float32Array(n);
  const B = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const r = LINEAR[image.data[i * 4]!]!;
    const g = LINEAR[image.data[i * 4 + 1]!]!;
    const b = LINEAR[image.data[i * 4 + 2]!]!;
    const fx = labF((0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047);
    const fy = labF(0.2126 * r + 0.7152 * g + 0.0722 * b);
    const fz = labF((0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883);
    L[i] = 116 * fy - 16;
    A[i] = 500 * (fx - fy);
    B[i] = 200 * (fy - fz);
  }
  return [L, A, B];
}

/** Gradient magnitude of a plane after a 3 × 3 box blur (central differences). */
function gradient(plane: Float32Array, width: number, height: number): Float32Array {
  const blurred = new Float32Array(plane.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let sum = 0;
      let n = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= height) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= width) continue;
          sum += plane[yy * width + xx]!;
          n++;
        }
      }
      blurred[y * width + x] = sum / n;
    }
  }
  const out = new Float32Array(plane.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const gx = (blurred[x < width - 1 ? i + 1 : i]! - blurred[x > 0 ? i - 1 : i]!) / 2;
      const gy = (blurred[y < height - 1 ? i + width : i]! - blurred[y > 0 ? i - width : i]!) / 2;
      out[i] = Math.hypot(gx, gy);
    }
  }
  return out;
}

/**
 * SLIC superpixels about `step` pixels across: k-means on colour and position from a grid of
 * centres, each searching twice its spacing around itself; then pieces cut off from their
 * superpixel are merged into a neighbour, so every superpixel is one connected patch.
 */
export function superpixels(image: RGBAImage, step: number, compactness = 10, iterations = 6): Superpixels {
  const { width: W, height: H } = image;
  const n = W * H;
  const [L, A, B] = toLab(image);
  const cols = Math.max(1, Math.round(W / step));
  const rows = Math.max(1, Math.round(H / step));
  const k = cols * rows;
  const cx = new Float32Array(k);
  const cy = new Float32Array(k);
  const cl = new Float32Array(k);
  const ca = new Float32Array(k);
  const cb = new Float32Array(k);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const j = r * cols + c;
      cx[j] = ((c + 0.5) * W) / cols;
      cy[j] = ((r + 0.5) * H) / rows;
      const i = Math.floor(cy[j]!) * W + Math.floor(cx[j]!);
      cl[j] = L[i]!;
      ca[j] = A[i]!;
      cb[j] = B[i]!;
    }
  }
  const label = new Int32Array(n);
  const dist = new Float32Array(n);
  const spatial = (compactness / step) ** 2;
  const sums = new Float64Array(k * 6);
  for (let iteration = 0; iteration < iterations; iteration++) {
    dist.fill(Infinity);
    for (let j = 0; j < k; j++) {
      const x0 = Math.max(0, Math.floor(cx[j]! - step));
      const x1 = Math.min(W - 1, Math.ceil(cx[j]! + step));
      const y0 = Math.max(0, Math.floor(cy[j]! - step));
      const y1 = Math.min(H - 1, Math.ceil(cy[j]! + step));
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const i = y * W + x;
          const dl = L[i]! - cl[j]!;
          const da = A[i]! - ca[j]!;
          const db = B[i]! - cb[j]!;
          const dx = x - cx[j]!;
          const dy = y - cy[j]!;
          const d = dl * dl + da * da + db * db + (dx * dx + dy * dy) * spatial;
          if (d < dist[i]!) {
            dist[i] = d;
            label[i] = j;
          }
        }
      }
    }
    sums.fill(0);
    for (let i = 0; i < n; i++) {
      const s = label[i]! * 6;
      sums[s]! += 1;
      sums[s + 1]! += i % W;
      sums[s + 2]! += Math.floor(i / W);
      sums[s + 3]! += L[i]!;
      sums[s + 4]! += A[i]!;
      sums[s + 5]! += B[i]!;
    }
    for (let j = 0; j < k; j++) {
      const count = sums[j * 6]!;
      if (count === 0) continue;
      cx[j] = sums[j * 6 + 1]! / count;
      cy[j] = sums[j * 6 + 2]! / count;
      cl[j] = sums[j * 6 + 3]! / count;
      ca[j] = sums[j * 6 + 4]! / count;
      cb[j] = sums[j * 6 + 5]! / count;
    }
  }

  // One connected patch each: pieces under a quarter of the usual size join the patch before them.
  const of = new Int32Array(n).fill(-1);
  const queue = new Int32Array(n);
  const minSize = Math.max(1, (step * step) >> 2);
  let count = 0;
  for (let start = 0; start < n; start++) {
    if (of[start]! >= 0) continue;
    const x0 = start % W;
    const before = x0 > 0 ? of[start - 1]! : start >= W ? of[start - W]! : -1;
    const own = label[start]!;
    let size = 0;
    queue[size++] = start;
    of[start] = count;
    for (let q = 0; q < size; q++) {
      const i = queue[q]!;
      const x = i % W;
      if (x > 0 && of[i - 1]! < 0 && label[i - 1] === own) {
        of[i - 1] = count;
        queue[size++] = i - 1;
      }
      if (x < W - 1 && of[i + 1]! < 0 && label[i + 1] === own) {
        of[i + 1] = count;
        queue[size++] = i + 1;
      }
      if (i >= W && of[i - W]! < 0 && label[i - W] === own) {
        of[i - W] = count;
        queue[size++] = i - W;
      }
      if (i < n - W && of[i + W]! < 0 && label[i + W] === own) {
        of[i + W] = count;
        queue[size++] = i + W;
      }
    }
    if (size < minSize && before >= 0) for (let q = 0; q < size; q++) of[queue[q]!] = before;
    else count++;
  }

  const grad = gradient(L, W, H);
  const colour = new Float32Array(count * 3);
  const texture = new Float32Array(count);
  const size = new Float32Array(count);
  for (let i = 0; i < n; i++) {
    const s = of[i]!;
    size[s]! += 1;
    colour[s * 3]! += L[i]!;
    colour[s * 3 + 1]! += A[i]!;
    colour[s * 3 + 2]! += B[i]!;
    texture[s]! += grad[i]!;
  }
  for (let s = 0; s < count; s++) {
    for (let c = 0; c < 3; c++) colour[s * 3 + c]! /= size[s]!;
    texture[s]! /= size[s]!;
  }
  // The gradient along each shared border, from the pixel pairs that straddle it.
  const along = new Map<number, { sum: number; n: number }>();
  const straddle = (i: number, j: number) => {
    const a = of[i]!;
    const b = of[j]!;
    if (a === b) return;
    const key = a < b ? a * count + b : b * count + a;
    const entry = along.get(key);
    const g = (grad[i]! + grad[j]!) / 2;
    if (entry) {
      entry.sum += g;
      entry.n++;
    } else along.set(key, { sum: g, n: 1 });
  };
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (x < W - 1) straddle(i, i + 1);
      if (y < H - 1) straddle(i, i + W);
    }
  }
  const borders = [...along].map(([key, { sum, n: pairs }]) => ({ a: Math.floor(key / count), b: key % count, length: pairs, edge: sum / pairs }));
  return { width: W, height: H, of, count, colour, texture, borders };
}

/** How far a patch may stray from the surface beside it and still carry on from it. */
export interface FillLimits {
  /** CIELAB distance between their mean colours. */
  colour: number;
  /** The smoother's texture over the rougher's at least this: a smooth basin isn't a textured wall. */
  texture: number;
  /** The gradient along their border over the smoother one's texture: above this, there's an edge. */
  edge: number;
  /**
   * The model's mean probability for any surface (wall, floor or ceiling) over the patch: at least
   * this, or it's a thing in front. Waived for a patch the added ones all but surround.
   */
  belief: number;
  /** A patch is all but surrounded when at least this share of its border is with the surface or added patches. */
  surrounded: number;
  /** An added group must blend (no edge) into what's around it along at least this share of its border. */
  blends: number;
  /** Below this belief, a patch is surely a thing in front. */
  sure: number;
  /** An unsure blob touching sure things in front along this share of its border or more is one itself (a tap set into a bath). */
  touches: number;
}

export const FILL_LIMITS: FillLimits = { colour: 8, texture: 0.5, edge: 1.6, belief: 0.2, surrounded: 0.75, blends: 0.5, sure: 0.1, touches: 0.25 };

/** Texture below this (L per pixel) is noise: the edge test compares against at least this much. */
const SMOOTH = 0.4;

/** No edge between two superpixels: the gradient along their border is like the texture inside them. */
function noEdge(sp: Superpixels, a: number, b: number, edge: number, limits: FillLimits): boolean {
  return edge <= Math.max(Math.min(sp.texture[a]!, sp.texture[b]!), SMOOTH) * limits.edge;
}

function carriesOn(sp: Superpixels, a: number, b: number, edge: number, limits: FillLimits): boolean {
  const dl = sp.colour[a * 3]! - sp.colour[b * 3]!;
  const da = sp.colour[a * 3 + 1]! - sp.colour[b * 3 + 1]!;
  const db = sp.colour[a * 3 + 2]! - sp.colour[b * 3 + 2]!;
  if (Math.hypot(dl, da, db) > limits.colour) return false;
  const smooth = Math.min(sp.texture[a]!, sp.texture[b]!);
  const rough = Math.max(sp.texture[a]!, sp.texture[b]!);
  if (smooth < rough * limits.texture && rough > SMOOTH) return false;
  return noEdge(sp, a, b, edge, limits);
}

/** What misreadPatches makes of each superpixel. */
export const NEITHER = 0;
export const SURFACE = 1;
export const ADDED = 2;

/**
 * Superpixels to add to a surface (ADDED) because they carry on from it. `surface` and `inside` give
 * each superpixel's share of pixels the finder labelled as the surface and inside its corners:
 * a superpixel at least half both is the surface. Growing from those, a neighbour at least half
 * inside the corners joins when it carries on from one already in and the model gave it some
 * chance of being a surface (`belief`, where there is one); then patches the added ones all but
 * surround join without that chance. Last, each connected group added must blend into what's
 * around it along much of its border: a thing in front has an outline most of the way round.
 * Returns SURFACE, ADDED or NEITHER for each superpixel.
 */
export function misreadPatches(sp: Superpixels, surface: Float32Array, inside: Float32Array, belief: Float32Array | null, limits: FillLimits = FILL_LIMITS): Uint8Array {
  const state = new Uint8Array(sp.count); // SURFACE, ADDED or NEITHER
  const neighbours: { other: number; length: number; edge: number }[][] = Array.from({ length: sp.count }, () => []);
  for (const { a, b, length, edge } of sp.borders) {
    neighbours[a]!.push({ other: b, length, edge });
    neighbours[b]!.push({ other: a, length, edge });
  }
  const candidate = (s: number) => !state[s] && inside[s]! >= 0.5;
  const grow = (queue: number[], believed: (s: number) => boolean) => {
    while (queue.length) {
      const s = queue.pop()!;
      for (const { other, edge } of neighbours[s]!) {
        if (!candidate(other) || !believed(other) || !carriesOn(sp, s, other, edge, limits)) continue;
        state[other] = ADDED;
        queue.push(other);
      }
    }
  };
  const seeds: number[] = [];
  for (let s = 0; s < sp.count; s++) {
    if (surface[s]! >= 0.5 && inside[s]! >= 0.5) {
      state[s] = SURFACE;
      seeds.push(s);
    }
  }
  grow(seeds, (s) => !belief || belief[s]! >= limits.belief);

  // Patches the surface and the added ones all but surround: islands where the model's belief dipped.
  for (let changed = true; changed; ) {
    changed = false;
    for (let s = 0; s < sp.count; s++) {
      if (!candidate(s)) continue;
      let total = 0;
      let enclosed = 0;
      let continues = false;
      for (const { other, length, edge } of neighbours[s]!) {
        total += length;
        if (!state[other]) continue;
        enclosed += length;
        continues ||= carriesOn(sp, other, s, edge, limits);
      }
      if (continues && enclosed >= total * limits.surrounded) {
        state[s] = ADDED;
        changed = true;
      }
    }
  }

  // Each added group must blend into what's around it along much of its border: into the surface,
  // and into the rest of a misread patch. A thing in front has an edge against the wall and
  // against whatever else it touches.
  const groups = (member: (s: number) => boolean, reject: (members: number[], border: number, counted: number) => boolean, counts: (s: number, other: number, edge: number) => boolean) => {
    const seen = new Uint8Array(sp.count);
    for (let start = 0; start < sp.count; start++) {
      if (!member(start) || seen[start]) continue;
      const members = [start];
      seen[start] = 1;
      let border = 0;
      let counted = 0;
      for (let k = 0; k < members.length; k++) {
        const s = members[k]!;
        for (const { other, length, edge } of neighbours[s]!) {
          if (member(other)) {
            if (!seen[other]) {
              seen[other] = 1;
              members.push(other);
            }
          } else {
            border += length;
            if (counts(s, other, edge)) counted += length;
          }
        }
      }
      if (reject(members, border, counted)) for (const s of members) if (state[s] === ADDED) state[s] = NEITHER;
    }
  };
  groups(
    (s) => state[s] === ADDED,
    (_, border, blended) => blended < border * limits.blends,
    (s, other, edge) => noEdge(sp, s, other, edge, limits),
  );
  // And a misread patch lies among the surface and other unsure bits, while a thing in front often
  // touches others the model is sure of: a chrome tap reflecting the tiles can pass every other
  // test, but it is set into the bath. So each unsure blob (added patches and the unsure bits
  // joined to them) that touches sure things along much of its border loses its added patches.
  if (belief) {
    const sure = (s: number) => state[s] !== SURFACE && state[s] !== ADDED && belief[s]! < limits.sure;
    groups(
      (s) => state[s] === ADDED || (state[s] === NEITHER && inside[s]! >= 0.5 && belief[s]! >= limits.sure),
      (members, border, things) => members.some((s) => state[s] === ADDED) && things >= border * limits.touches,
      (_, other) => sure(other),
    );
  }
  return state;
}

/**
 * The pixels to add to a surface (0/1, width × height): those in ADDED superpixels, and any
 * connected bit the finder didn't label as the surface that lies wholly within SURFACE and ADDED
 * superpixels, such as a speck, or the edge of a misread patch where a superpixel straddles it.
 * A sliver at the edge of a thing in front is joined to the thing, so it stays out, and so does
 * a bit at the edge of the corners with no added patch in it, which may be the end of a thing
 * they cut through. `surface` and `inside` are the finder's labels for the surface and the
 * inside of the corners, 0/1.
 */
export function misreadPixels(sp: Superpixels, state: Uint8Array, surface: Uint8Array, inside: Uint8Array, width: number, height: number): Uint8Array {
  const index = superpixelIndex(sp, width, height);
  const kind = new Uint8Array(width * height);
  for (let i = 0; i < kind.length; i++) kind[i] = state[index[i]!]!;
  const out = new Uint8Array(width * height);
  const seen = new Uint8Array(width * height);
  const queue = new Int32Array(width * height);
  const open = (i: number) => !surface[i] && inside[i] && !seen[i];
  /** Next to the edge of the corners or of the photo: there, a bit may be the cut-off end of a thing in front. */
  const atEdge = (i: number, x: number) =>
    x === 0 || x === width - 1 || i < width || i >= out.length - width || !inside[i - 1] || !inside[i + 1] || !inside[i - width] || !inside[i + width];
  for (let start = 0; start < out.length; start++) {
    if (!open(start)) continue;
    let size = 0;
    queue[size++] = start;
    seen[start] = 1;
    let within = true;
    let added = false;
    let edge = false;
    for (let q = 0; q < size; q++) {
      const i = queue[q]!;
      const x = i % width;
      if (kind[i] === NEITHER) within = false;
      if (kind[i] === ADDED) added = true;
      if (!edge && atEdge(i, x)) edge = true;
      if (x > 0 && open(i - 1)) {
        seen[i - 1] = 1;
        queue[size++] = i - 1;
      }
      if (x < width - 1 && open(i + 1)) {
        seen[i + 1] = 1;
        queue[size++] = i + 1;
      }
      if (i >= width && open(i - width)) {
        seen[i - width] = 1;
        queue[size++] = i - width;
      }
      if (i < out.length - width && open(i + width)) {
        seen[i + width] = 1;
        queue[size++] = i + width;
      }
    }
    // A bit with no added patch in it at the edge of the corners may be a thing they cut through.
    if (edge && !added) within = false;
    for (let q = 0; q < size; q++) {
      const i = queue[q]!;
      if (within || kind[i] === ADDED) out[i] = 1;
    }
  }
  return out;
}

const indexes = new WeakMap<Superpixels, { width: number; height: number; index: Int32Array }>();

/** The superpixel under each pixel of a width × height image covering the same photo (kept for the last size asked). */
function superpixelIndex(sp: Superpixels, width: number, height: number): Int32Array {
  const known = indexes.get(sp);
  if (known && known.width === width && known.height === height) return known.index;
  const index = new Int32Array(width * height);
  const sx = sp.width / width;
  const sy = sp.height / height;
  for (let y = 0; y < height; y++) {
    const row = Math.min(sp.height - 1, Math.floor((y + 0.5) * sy)) * sp.width;
    for (let x = 0; x < width; x++) index[y * width + x] = sp.of[row + Math.min(sp.width - 1, Math.floor((x + 0.5) * sx))]!;
  }
  indexes.set(sp, { width, height, index });
  return index;
}

/** Each superpixel's mean of a plane of values (any size covering the same photo), times `scale`. */
export function meanOf(sp: Superpixels, values: ArrayLike<number>, width: number, height: number, scale = 1): Float32Array {
  const index = superpixelIndex(sp, width, height);
  const total = new Float32Array(sp.count);
  const sum = new Float32Array(sp.count);
  for (let i = 0; i < index.length; i++) {
    const s = index[i]!;
    total[s]! += 1;
    sum[s]! += values[i]!;
  }
  for (let s = 0; s < sp.count; s++) sum[s] = total[s]! > 0 ? (sum[s]! / total[s]!) * scale : 0;
  return sum;
}

/** Each superpixel's share of a 0/1 mask (any size covering the same photo). */
export function shareOf(sp: Superpixels, mask: Uint8Array, width: number, height: number): Float32Array {
  return meanOf(sp, mask, width, height);
}
