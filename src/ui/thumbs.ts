import type { Catalog, Design } from '../engine';
import { drawDesignPreview, drawTilePreview } from '../render/previews';
import type { TextureCache } from '../render/textureCache';
import { h } from './dom';

/** Small previews, drawn once and copied, since panels re-render often. */
const drawn = new Map<string, HTMLCanvasElement>();

function copy(source: HTMLCanvasElement, className: string): HTMLCanvasElement {
  const canvas = h('canvas', { class: className });
  canvas.width = source.width;
  canvas.height = source.height;
  canvas.style.width = source.style.width;
  canvas.style.height = source.style.height;
  canvas.getContext('2d')?.drawImage(source, 0, 0);
  return canvas;
}

export function designThumb(design: Design, catalog: Catalog, textures: TextureCache, maxW: number, maxH: number): HTMLCanvasElement {
  const key = `design:${design.id}:${maxW}x${maxH}`;
  let source = drawn.get(key);
  if (!source) {
    source = document.createElement('canvas');
    drawDesignPreview(source, design, catalog, textures, maxW, maxH);
    drawn.set(key, source);
  }
  return copy(source, 'thumb');
}

export function tileThumb(tileId: string, catalog: Catalog, textures: TextureCache, maxW: number, maxH: number): HTMLCanvasElement {
  const key = `tile:${tileId}:${maxW}x${maxH}`;
  let source = drawn.get(key);
  if (!source) {
    source = document.createElement('canvas');
    drawTilePreview(source, tileId, catalog, textures, maxW, maxH);
    drawn.set(key, source);
  }
  return copy(source, 'thumb');
}

/** Forget previews, e.g. after real tile images have loaded. */
export function clearThumbs(): void {
  drawn.clear();
}
