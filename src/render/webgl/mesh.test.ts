import { describe, expect, it } from 'vitest';
import { catalog } from '../../designs/catalog';
import { layoutSurface, type Rotation } from '../../engine';
import { apply, rectCorners, surfaceToPhoto, type Quad } from '../../photo/homography';
import { clipMatrix, FLOATS_PER_VERTEX, fragToPhotoUv, jointEdges, textureCoord, tileBatches } from './mesh';

describe('texture coordinates', () => {
  // Image corners: (0, 0) top-left, (1, 0) top-right. The tile's corners as laid: bottom-left (0, 0) and top-right (1, 1).
  it('show the image upright at 0°', () => {
    expect(textureCoord(0, 1, 0)).toEqual([0, 0]);
    expect(textureCoord(1, 0, 0)).toEqual([1, 1]);
  });

  it('turn the image clockwise, as the designer draws it', () => {
    // Turned 90° clockwise, the image's top edge (v = 0) runs down the tile's right side,
    // and its left edge (u = 0) along the tile's top.
    const top = (rotation: Rotation, across: number, up: number) => textureCoord(across, up, rotation);
    expect(top(90, 1, 0.3)[1]).toBe(0);
    expect(top(90, 0.3, 1)[0]).toBe(0);
    expect(top(180, 0.5, 0)[1]).toBe(0);
    expect(top(270, 0, 0.6)[1]).toBe(0);
    // A half turn shows the point diametrically opposite in the image.
    const [u, v] = textureCoord(0.2, 0.7, 180);
    expect(u).toBeCloseTo(0.8, 9);
    expect(v).toBeCloseTo(0.7, 9);
  });
});

describe('tile batches', () => {
  const doc = { widthMm: 2450, heightMm: 2700, tiledHeightMm: 2700 };
  const layout = { surface: 'wall' as const, seriesId: 'demo-ivory-bloom', bands: [{ designId: 'ivory-light-plain', rows: 'fill' as const }] };

  it('give every visible piece one quad, grouped by tile', () => {
    const designs = catalog.designsOf('demo-ivory-bloom');
    const plain = designs.find((d) => d.cols === 1 && d.rows === 1)!;
    const result = layoutSurface(doc, { ...layout, bands: [{ designId: plain.id, rows: 'fill' }] }, { x: { mode: 'centre-tile' }, y: { mode: 'bottom' } }, {}, catalog);
    const batches = tileBatches(result);
    const quads = batches.reduce((n, b) => n + b.vertices.length / (4 * FLOATS_PER_VERTEX), 0);
    expect(quads).toBe(result.pieces.length);
    for (const b of batches) expect(b.indices.length).toBe((b.vertices.length / FLOATS_PER_VERTEX / 4) * 6);
  });

  it('put grout on joints only, never on the edge of the tiled area', () => {
    const result = layoutSurface(doc, { ...layout, bands: [{ designId: catalog.designsOf('demo-ivory-bloom')[0]!.id, rows: 'fill' }] }, { x: { mode: 'left' }, y: { mode: 'bottom' } }, {}, catalog);
    const first = result.pieces.find((p) => p.cell.col === 0 && p.cell.row === 0)!;
    // Flush with the left edge and the floor: no grout there, grout on the right and above.
    expect(jointEdges(first, result.widthMm, result.tiledHeightMm)).toEqual([0, 1, 0, 1]);
  });

  it('place a cut piece within its whole tile', () => {
    const result = layoutSurface(doc, layout, { x: { mode: 'centre-tile' }, y: { mode: 'bottom' } }, {}, catalog);
    const cut = result.pieces.find((p) => p.isCut && p.visibleRect.x === 0)!;
    const batch = tileBatches(result).find((b) => b.tileId === cut.tileId)!;
    // Find the vertex at the cut piece's bottom-left: its place across the tile is where the cut is.
    for (let i = 0; i < batch.vertices.length; i += FLOATS_PER_VERTEX) {
      if (batch.vertices[i] === 0 && batch.vertices[i + 1] === cut.visibleRect.y) {
        expect(batch.vertices[i + 2]).toBeCloseTo((0 - cut.rect.x) / cut.rect.w, 6);
        return;
      }
    }
    throw new Error('cut vertex not found');
  });
});

describe('matrices', () => {
  const quad: Quad = [
    { x: 180, y: 1350 },
    { x: 1700, y: 1150 },
    { x: 1640, y: 330 },
    { x: 250, y: 300 },
  ];
  const toPhoto = surfaceToPhoto({ x: 0, y: 0, w: 2400, h: 2700 }, quad)!;
  const view = { scale: 0.25, x: 30, y: 40 };
  const frame = { width: 600, height: 500 };

  it('map surface millimetres to clip space through the photo, with w positive on the surface', () => {
    for (const flip of [1, -1]) {
      const m = clipMatrix(toPhoto.map((v) => v * flip) as typeof toPhoto, view, frame, { x: 1200, y: 1350 });
      rectCorners(0, 0, 2400, 2700).forEach((p, i) => {
        const w = m[6] * p.x + m[7] * p.y + m[8];
        expect(w).toBeGreaterThan(0);
        const clip = apply(m, p);
        const screen = { x: view.x + quad[i]!.x * view.scale, y: view.y + quad[i]!.y * view.scale };
        expect(clip.x).toBeCloseTo((screen.x / frame.width) * 2 - 1, 6);
        expect(clip.y).toBeCloseTo(1 - (screen.y / frame.height) * 2, 6);
      });
    }
  });

  it('map a fragment back to the photo pixel under it', () => {
    const dpr = 2;
    const photo = { width: 2048, height: 1536 };
    const m = fragToPhotoUv(view, { height: frame.height, dpr }, photo);
    // The photo pixel (1000, 700) is at CSS (280, 215), device (560, 430) from the top, so fragCoord y = 1000 - 430.
    const uv = apply(m, { x: 560, y: frame.height * dpr - 430 });
    expect(uv.x * photo.width).toBeCloseTo(1000, 6);
    expect(uv.y * photo.height).toBeCloseTo(700, 6);
  });
});
