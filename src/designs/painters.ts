/**
 * Procedural stand-ins for KT's printed tiles, until real images arrive.
 *
 * Each painter draws in millimetres on a canvas the caller has already scaled. A motif
 * spanning several tiles is painted once on a canvas covering the whole group, then sliced
 * into tiles (see textures.ts), so it lines up exactly across the joints.
 */

export interface PaintJob {
  ctx: CanvasRenderingContext2D;
  widthMm: number;
  heightMm: number;
  pxPerMm: number;
  colors: readonly string[];
  random: () => number;
}

export type Painter = (job: PaintJob) => void;

/** Small, fast, seeded random numbers (mulberry32), so every load paints the same tiles. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0 || 0x9e3779b9;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function rgba(hex: string, alpha: number): string {
  const match = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match?.[1]) return hex;
  const n = parseInt(match[1], 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

const colour = (colors: readonly string[], i: number, fallback: string) => colors[i] ?? colors[0] ?? fallback;

/** Soft round patches of colour. */
function clouds(job: PaintJob, palette: readonly string[], count: number, maxAlpha: number, minR: number, maxR: number): void {
  const { ctx, widthMm: w, heightMm: h, random } = job;
  for (let i = 0; i < count; i++) {
    const x = random() * w;
    const y = random() * h;
    const r = minR + random() * (maxR - minR);
    const c = palette[i % palette.length] ?? '#888888';
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, r);
    gradient.addColorStop(0, rgba(c, maxAlpha * (0.4 + random() * 0.6)));
    gradient.addColorStop(1, rgba(c, 0));
    ctx.fillStyle = gradient;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
}

/** Fine dots. Batched into a few paths by colour and opacity, so thousands stay cheap. */
function grain(job: PaintJob, palette: readonly string[], perMm2: number, minSize: number, maxSize: number, minAlpha: number, maxAlpha: number): void {
  const { ctx, widthMm: w, heightMm: h, random } = job;
  const levels = 3;
  const buckets = palette.flatMap((c) => Array.from({ length: levels }, (_, i) => ({ c, alpha: minAlpha + ((maxAlpha - minAlpha) * (i + 0.5)) / levels, path: new Path2D() })));
  const count = Math.round(w * h * perMm2);
  for (let i = 0; i < count; i++) {
    const bucket = buckets[Math.floor(random() * buckets.length)];
    const size = minSize + random() * (maxSize - minSize);
    bucket?.path.rect(random() * w, random() * h, size, size);
  }
  for (const bucket of buckets) {
    ctx.fillStyle = rgba(bucket.c, bucket.alpha);
    ctx.fill(bucket.path);
  }
}

interface Pt {
  x: number;
  y: number;
}

/** A smooth curve through the points (quadratic segments through the midpoints). */
function smoothPath(points: readonly Pt[]): Path2D {
  const path = new Path2D();
  const [first, ...rest] = points;
  if (!first) return path;
  path.moveTo(first.x, first.y);
  for (let i = 0; i < rest.length - 1; i++) {
    const p = rest[i];
    const q = rest[i + 1];
    if (p && q) path.quadraticCurveTo(p.x, p.y, (p.x + q.x) / 2, (p.y + q.y) / 2);
  }
  const last = rest[rest.length - 1];
  if (last) path.lineTo(last.x, last.y);
  return path;
}

/** A line wandering across the tile, edge to edge. */
function wander(w: number, h: number, random: () => number, segments: number): Pt[] {
  const across = random() < 0.5;
  const start = across ? { x: -10, y: random() * h } : { x: random() * w, y: -10 };
  const end = across ? { x: w + 10, y: random() * h } : { x: random() * w, y: h + 10 };
  return Array.from({ length: segments + 1 }, (_, i) => {
    const t = i / segments;
    const jitter = i === 0 || i === segments ? 0 : 1;
    return {
      x: start.x + (end.x - start.x) * t + jitter * (random() - 0.5) * w * 0.3,
      y: start.y + (end.y - start.y) * t + jitter * (random() - 0.5) * h * 0.2,
    };
  });
}

function veins(job: PaintJob, c: string, count: number, alpha: number, minWidth: number, maxWidth: number): void {
  const { ctx, widthMm: w, heightMm: h, pxPerMm, random } = job;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.filter = `blur(${(0.45 * pxPerMm).toFixed(2)}px)`;
  for (let i = 0; i < count; i++) {
    const points = wander(w, h, random, 7);
    ctx.strokeStyle = rgba(c, alpha * (0.55 + random() * 0.45));
    ctx.lineWidth = minWidth + random() * (maxWidth - minWidth);
    ctx.stroke(smoothPath(points));
    // A thinner branch leaving the vein part-way along.
    const from = points[2 + Math.floor(random() * 3)];
    if (from && random() < 0.8) {
      const branch = [from, ...wander(w, h, random, 4).slice(2)];
      ctx.strokeStyle = rgba(c, alpha * 0.45);
      ctx.lineWidth = minWidth * 0.6;
      ctx.stroke(smoothPath(branch));
    }
  }
  ctx.restore();
}

/** Light stone with faint veining (Ivory Light). colors: base, vein, highlight. */
const marble: Painter = (job) => {
  const { ctx, widthMm: w, heightMm: h, colors } = job;
  const base = colour(colors, 0, '#eeeeee');
  const vein = colour(colors, 1, '#cccccc');
  const light = colour(colors, 2, '#ffffff');
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, w, h);
  clouds(job, [light, vein], Math.round((w * h) / 18000), 0.12, 40, 140);
  veins(job, vein, Math.max(2, Math.round((w * h) / 45000)), 0.55, 0.5, 1.8);
  grain(job, [vein, light], 0.01, 0.3, 0.9, 0.08, 0.22);
};

/** Mottled dark stone (Ivory Dark). colors: base, shade, highlight. */
const stone: Painter = (job) => {
  const { ctx, widthMm: w, heightMm: h, colors } = job;
  const base = colour(colors, 0, '#444444');
  const shade = colour(colors, 1, '#222222');
  const light = colour(colors, 2, '#666666');
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, w, h);
  clouds(job, [shade, light], Math.round((w * h) / 3500), 0.35, 12, 70);
  veins(job, light, 2, 0.22, 0.4, 1.2);
  grain(job, [shade, light], 0.06, 0.3, 1.1, 0.15, 0.4);
};

/** Plain glaze with a fine speckle (Azure Light and Dark). colors: base, speckle, second speckle. */
const speckle: Painter = (job) => {
  const { ctx, widthMm: w, heightMm: h, colors } = job;
  const base = colour(colors, 0, '#f4f4f4');
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, w, h);
  clouds(job, [colour(colors, 2, base)], 4, 0.18, 60, 160);
  grain(job, [colour(colors, 1, '#999999')], 0.03, 0.35, 1.3, 0.25, 0.7);
  grain(job, [colour(colors, 2, '#bbbbbb')], 0.015, 0.4, 1.0, 0.3, 0.6);
};

/** Matt anti-skid floor with dense grit. colors: base, dark grit, light grit. */
const antiskid: Painter = (job) => {
  const { ctx, widthMm: w, heightMm: h, colors } = job;
  ctx.fillStyle = colour(colors, 0, '#999999');
  ctx.fillRect(0, 0, w, h);
  clouds(job, [colour(colors, 1, '#777777'), colour(colors, 2, '#bbbbbb')], 10, 0.12, 30, 110);
  grain(job, [colour(colors, 1, '#777777'), colour(colors, 2, '#bbbbbb')], 0.16, 0.3, 0.9, 0.2, 0.5);
};

/** A single colour, e.g. while a real tile image loads. */
const flat: Painter = ({ ctx, widthMm, heightMm, colors }) => {
  ctx.fillStyle = colour(colors, 0, '#cccccc');
  ctx.fillRect(0, 0, widthMm, heightMm);
};

/** A leaf from (x, y) pointing along angle. */
function leaf(ctx: CanvasRenderingContext2D, x: number, y: number, angle: number, length: number, width: number, fill: string, rib: string): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  const path = new Path2D();
  path.moveTo(0, 0);
  path.quadraticCurveTo(length * 0.45, -width, length, 0);
  path.quadraticCurveTo(length * 0.45, width, 0, 0);
  ctx.fillStyle = fill;
  ctx.fill(path);
  ctx.strokeStyle = rib;
  ctx.lineWidth = 0.9;
  ctx.beginPath();
  ctx.moveTo(2, 0);
  ctx.lineTo(length * 0.85, 0);
  ctx.stroke();
  ctx.restore();
}

/** A lens-shaped petal along angle, from r0 to r1 out from the centre. Symmetric about its axis. */
function petal(angle: number, r0: number, r1: number, width: number): Path2D {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const at = (along: number, across: number) => ({ x: along * c - across * s, y: along * s + across * c });
  const mid = (r0 + r1) / 2;
  const a = at(r0, 0);
  const b = at(r1, 0);
  const left = at(mid, width);
  const right = at(mid, -width);
  const path = new Path2D();
  path.moveTo(a.x, a.y);
  path.quadraticCurveTo(left.x, left.y, b.x, b.y);
  path.quadraticCurveTo(right.x, right.y, a.x, a.y);
  return path;
}

function bloom(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, petals: number, fill: string, deep: string, centre: string, turn: number): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(turn);
  for (let i = 0; i < petals; i++) {
    const a = (i / petals) * Math.PI * 2;
    const p = petal(a, r * 0.12, r, r * 0.42);
    ctx.fillStyle = fill;
    ctx.fill(p);
    ctx.strokeStyle = deep;
    ctx.lineWidth = Math.max(0.8, r * 0.025);
    ctx.stroke(p);
  }
  for (let i = 0; i < petals; i++) {
    const a = ((i + 0.5) / petals) * Math.PI * 2;
    ctx.fillStyle = deep;
    ctx.fill(petal(a, r * 0.1, r * 0.55, r * 0.2));
  }
  ctx.fillStyle = centre;
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = deep;
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    ctx.beginPath();
    ctx.arc(Math.cos(a) * r * 0.12, Math.sin(a) * r * 0.12, r * 0.025, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/**
 * Ivory Bloom highlighter: one floral sprig across a 1 × 2 group (HL-A over HL-B), with its
 * main bloom on the shared joint. colors: base, vein, stem, petal, gold.
 */
const sprig: Painter = (job) => {
  const { ctx, widthMm: w, heightMm: h, colors, random } = job;
  marble({ ...job, colors: [colour(colors, 0, '#eeeeee'), colour(colors, 1, '#cccccc'), '#fbf8f0'] });
  const stem = colour(colors, 2, '#5c6b38');
  const petalColour = colour(colors, 3, '#b4553d');
  const gold = colour(colors, 4, '#c9a24a');
  const deep = rgba('#5a2416', 0.55);
  const rib = rgba('#2f3a1a', 0.5);
  const cx = w / 2;
  const cy = h / 2; // the joint between HL-A and HL-B

  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const main: Pt[] = [
    { x: cx - 16, y: h - 60 },
    { x: cx + 26, y: cy + 230 },
    { x: cx - 10, y: cy + 90 },
    { x: cx, y: cy },
    { x: cx + 12, y: cy - 110 },
    { x: cx - 24, y: cy - 240 },
    { x: cx + 12, y: 96 },
  ];
  ctx.strokeStyle = stem;
  ctx.lineWidth = 3.4;
  ctx.stroke(smoothPath(main));

  // Twigs to buds on either side.
  const twigs: [Pt, Pt, Pt][] = [
    [{ x: cx + 8, y: cy + 160 }, { x: cx + 60, y: cy + 150 }, { x: cx + 92, y: cy + 112 }],
    [{ x: cx - 12, y: cy - 175 }, { x: cx - 64, y: cy - 190 }, { x: cx - 94, y: cy - 232 }],
  ];
  ctx.lineWidth = 2.2;
  for (const twig of twigs) ctx.stroke(smoothPath(twig));

  const leaves: [number, number, number, number][] = [
    [cx + 4, cy + 300, -2.4, 70],
    [cx + 12, cy + 260, -0.6, 62],
    [cx - 8, cy + 200, -2.7, 66],
    [cx + 2, cy + 130, -0.35, 58],
    [cx - 6, cy - 150, -2.75, 60],
    [cx + 6, cy - 190, -0.45, 64],
    [cx - 14, cy - 280, -2.5, 56],
    [cx - 4, cy - 330, -0.8, 50],
    [cx + 72, cy + 136, -0.2, 34],
    [cx - 76, cy - 210, -2.9, 34],
  ];
  for (const [x, y, angle, length] of leaves) {
    leaf(ctx, x, y, angle + (random() - 0.5) * 0.15, length, length * 0.3, stem, rib);
  }

  bloom(ctx, cx, cy, 64, 7, petalColour, deep, gold, 0.2);
  bloom(ctx, cx + 12, 96, 34, 6, petalColour, deep, gold, 0.6);
  bloom(ctx, cx + 92, cy + 112, 18, 5, petalColour, deep, gold, 0.1);
  bloom(ctx, cx - 94, cy - 232, 18, 5, petalColour, deep, gold, 0.9);
  bloom(ctx, cx - 16, h - 60, 14, 5, petalColour, deep, gold, 0.4);

  // Pollen dots around the main bloom.
  ctx.fillStyle = rgba(gold, 0.8);
  for (let i = 0; i < 26; i++) {
    const a = random() * Math.PI * 2;
    const r = 78 + random() * 38;
    ctx.beginPath();
    ctx.arc(cx + Math.cos(a) * r, cy + Math.sin(a) * r, 0.9 + random() * 1.4, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
};

function ring(ctx: CanvasRenderingContext2D, r: number, width: number, stroke: string): void {
  ctx.strokeStyle = stroke;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.stroke();
}

/**
 * Azure Medallion highlighter: a medallion with 8-fold mirror symmetry, centred on a 2 × 2
 * group. The HL tile is the bottom-left quarter; the design turns it 0/90/180/270° so the
 * medallion re-forms where four tiles meet. colors: base, speckle, navy, blue, gold.
 */
const medallion: Painter = (job) => {
  const { ctx, widthMm: w, heightMm: h, colors } = job;
  speckle({ ...job, colors: [colour(colors, 0, '#f6f7f6'), colour(colors, 1, '#9eabb7'), colour(colors, 1, '#9eabb7')] });
  const navy = colour(colors, 2, '#1c2a49');
  const blue = colour(colors, 3, '#3f6aa6');
  const gold = colour(colors, 4, '#c9a24a');
  const R = (Math.min(w, h) / 2) * 0.93;

  ctx.save();
  ctx.translate(w / 2, h / 2);
  // Soft ground behind the medallion.
  const ground = ctx.createRadialGradient(0, 0, R * 0.2, 0, 0, R);
  ground.addColorStop(0, rgba(blue, 0.1));
  ground.addColorStop(1, rgba(blue, 0.02));
  ctx.fillStyle = ground;
  ctx.beginPath();
  ctx.arc(0, 0, R, 0, Math.PI * 2);
  ctx.fill();

  ring(ctx, R, 3.4, navy);
  ring(ctx, R - 9, 1.4, gold);
  for (let i = 0; i < 16; i++) {
    const p = petal((i / 16) * Math.PI * 2, R * 0.7, R * 0.95, R * 0.07);
    ctx.fillStyle = i % 2 ? blue : navy;
    ctx.fill(p);
  }
  ring(ctx, R * 0.68, 4, navy);
  ctx.fillStyle = gold;
  for (let i = 0; i < 32; i++) {
    const a = ((i + 0.5) / 32) * Math.PI * 2;
    ctx.beginPath();
    ctx.arc(Math.cos(a) * R * 0.61, Math.sin(a) * R * 0.61, 2.8, 0, Math.PI * 2);
    ctx.fill();
  }
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    ctx.fillStyle = navy;
    ctx.fill(petal(a, R * 0.13, R * 0.56, R * 0.11));
    ctx.fillStyle = blue;
    ctx.fill(petal(a, R * 0.2, R * 0.46, R * 0.05));
  }
  ctx.fillStyle = gold;
  for (let i = 0; i < 8; i++) ctx.fill(petal(((i + 0.5) / 8) * Math.PI * 2, R * 0.18, R * 0.42, R * 0.05));

  // Eight-point star at the centre.
  const star = new Path2D();
  for (let i = 0; i < 16; i++) {
    const r = i % 2 ? R * 0.075 : R * 0.16;
    const a = (i / 16) * Math.PI * 2;
    if (i === 0) star.moveTo(Math.cos(a) * r, Math.sin(a) * r);
    else star.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  star.closePath();
  ctx.fillStyle = gold;
  ctx.fill(star);
  ctx.fillStyle = navy;
  ctx.beginPath();
  ctx.arc(0, 0, R * 0.06, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = gold;
  ctx.beginPath();
  ctx.arc(0, 0, R * 0.022, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
};

export const painters: Readonly<Record<string, Painter>> = { marble, stone, speckle, antiskid, flat, sprig, medallion };
