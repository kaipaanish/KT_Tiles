/**
 * A laid-out surface as triangles for WebGL, grouped by tile image. Pure, no DOM.
 *
 * Vertices are in surface millimetres; the vertex shader maps them into the photo with the
 * surface's homography, so the GPU's perspective-correct interpolation keeps textures and grout
 * straight.
 */
import type { LayoutResult, PlacedPiece, Rotation } from '../../engine';
import { multiply, type Mat3, type Pt } from '../../photo/homography';

/** Per vertex: position (mm) 2, place in the whole tile 2, texture 2, tile size (mm) 2, joint edges 4. */
export const FLOATS_PER_VERTEX = 12;

export interface TileBatch {
  tileId: string;
  vertices: Float32Array;
  indices: Uint16Array | Uint32Array;
}

/**
 * Texture coordinates (u across the image, v down it) of a point a fraction `across` and `up` a
 * tile as laid, for an image turned clockwise by `rotation`, as the designer draws it.
 */
export function textureCoord(across: number, up: number, rotation: Rotation): [number, number] {
  const down = 1 - up;
  switch (rotation) {
    case 0:
      return [across, down];
    case 90:
      return [down, 1 - across];
    case 180:
      return [1 - across, 1 - down];
    case 270:
      return [1 - down, across];
  }
}

const EPS = 0.01;

/** Which of a tile's edges are joints, where grout goes: the ones inside the tiled area, not on its border. */
export function jointEdges(piece: PlacedPiece, widthMm: number, topMm: number): [number, number, number, number] {
  const r = piece.rect;
  return [r.x > EPS ? 1 : 0, r.x + r.w < widthMm - EPS ? 1 : 0, r.y > EPS ? 1 : 0, r.y + r.h < topMm - EPS ? 1 : 0];
}

/** The visible part of every tile, as two triangles each, one batch per tile image. */
export function tileBatches(result: LayoutResult): TileBatch[] {
  let top = 0;
  for (const p of result.pieces) top = Math.max(top, p.visibleRect.y + p.visibleRect.h);
  const byTile = new Map<string, PlacedPiece[]>();
  for (const piece of result.pieces) {
    const list = byTile.get(piece.tileId);
    if (list) list.push(piece);
    else byTile.set(piece.tileId, [piece]);
  }
  const batches: TileBatch[] = [];
  for (const [tileId, pieces] of byTile) {
    const vertices = new Float32Array(pieces.length * 4 * FLOATS_PER_VERTEX);
    const indices = pieces.length * 4 > 65535 ? new Uint32Array(pieces.length * 6) : new Uint16Array(pieces.length * 6);
    pieces.forEach((piece, n) => {
      const { rect, visibleRect: v } = piece;
      const joints = jointEdges(piece, result.widthMm, top);
      const corners: Pt[] = [
        { x: v.x, y: v.y },
        { x: v.x + v.w, y: v.y },
        { x: v.x + v.w, y: v.y + v.h },
        { x: v.x, y: v.y + v.h },
      ];
      corners.forEach((c, k) => {
        const across = (c.x - rect.x) / rect.w;
        const up = (c.y - rect.y) / rect.h;
        const [u, tv] = textureCoord(across, up, piece.rotation);
        vertices.set([c.x, c.y, across, up, u, tv, rect.w, rect.h, ...joints], (n * 4 + k) * FLOATS_PER_VERTEX);
      });
      const base = n * 4;
      indices.set([base, base + 1, base + 2, base, base + 2, base + 3], n * 6);
    });
    batches.push({ tileId, vertices, indices });
  }
  return batches;
}

/**
 * Surface mm → clip space: the surface's homography into the photo, the photo's place on screen
 * (CSS pixels), then the canvas. The vertex shader passes the third component as w. A
 * homography's overall sign is arbitrary, so the matrix is flipped if w would be negative on the
 * surface (where nothing would be drawn).
 */
export function clipMatrix(toPhoto: Mat3, view: { scale: number; x: number; y: number }, frame: { width: number; height: number }, onSurface: Pt): Mat3 {
  const screen: Mat3 = [view.scale, 0, view.x, 0, view.scale, view.y, 0, 0, 1];
  const clip: Mat3 = [2 / frame.width, 0, -1, 0, -2 / frame.height, 1, 0, 0, 1];
  const m = multiply(clip, multiply(screen, toPhoto));
  const w = m[6] * onSurface.x + m[7] * onSurface.y + m[8];
  return w < 0 ? (m.map((v) => -v) as Mat3) : m;
}

/** gl_FragCoord (device pixels, origin bottom-left) → photo texture coordinates (0–1, origin top-left). */
export function fragToPhotoUv(view: { scale: number; x: number; y: number }, frame: { height: number; dpr: number }, photo: { width: number; height: number }): Mat3 {
  // u = (fx / dpr - x) / (scale · width); v = ((H·dpr - fy) / dpr - y) / (scale · height), H in CSS pixels.
  const su = 1 / (frame.dpr * view.scale * photo.width);
  const sv = 1 / (frame.dpr * view.scale * photo.height);
  return [su, 0, -view.x / (view.scale * photo.width), 0, -sv, (frame.height - view.y) / (view.scale * photo.height), 0, 0, 1];
}
