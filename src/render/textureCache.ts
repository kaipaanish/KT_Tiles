import type { Catalog } from '../engine';
import { context2d, createCanvas, loadImage, paintPlaceholder, PLACEHOLDER_PX_PER_MM } from '../designs/textures';

/** Smallest level kept: 0.125 px per mm is about 38 px for a 300 mm tile. */
const MIN_PX_PER_MM = 0.125;

interface Level {
  pxPerMm: number;
  image: HTMLCanvasElement;
}

/** One tile's texture at several resolutions (mipmaps), built from the largest by halving. */
class Texture {
  private readonly levels: Level[];

  constructor(base: HTMLCanvasElement, pxPerMm: number) {
    this.levels = [{ pxPerMm, image: base }];
  }

  /** The smallest level that still has at least `pxPerMm`, so drawing never shrinks a huge image. */
  forScale(pxPerMm: number): HTMLCanvasElement {
    let level = this.levels[0] as Level;
    for (let i = 1; level.pxPerMm / 2 >= pxPerMm && level.pxPerMm / 2 >= MIN_PX_PER_MM; i++) {
      level = this.levels[i] ?? this.halve(level);
    }
    return level.image;
  }

  private halve(level: Level): Level {
    const { image } = level;
    const half = createCanvas(image.width / 2, image.height / 2);
    const ctx = context2d(half);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(image, 0, 0, half.width, half.height);
    const next = { pxPerMm: level.pxPerMm / 2, image: half };
    this.levels.push(next);
    return next;
  }
}

/**
 * Tile textures, built once and cached. Placeholders are painted on first use; a real image
 * (textureUrl) replaces its placeholder when it has loaded, and onChange asks for a redraw.
 */
export class TextureCache {
  private readonly textures = new Map<string, Texture>();
  private readonly groups = new Map<string, HTMLCanvasElement>();
  private readonly loading = new Set<string>();

  constructor(
    private readonly catalog: Catalog,
    private readonly onChange: () => void,
  ) {}

  /** The image to draw a tile with, at `devicePxPerMm` device pixels per millimetre. */
  get(tileId: string, devicePxPerMm: number): HTMLCanvasElement {
    return (this.textures.get(tileId) ?? this.build(tileId)).forScale(devicePxPerMm);
  }

  /** Builds textures ahead of time, e.g. for the whole active series. */
  prepare(tileIds: readonly string[]): void {
    for (const id of tileIds) if (!this.textures.has(id)) this.build(id);
  }

  /**
   * Drops every texture except these tiles'. A 300 × 450 mm tile takes about 3 MB with its
   * mipmaps, so browsing many series would otherwise fill a phone's memory.
   */
  retain(tileIds: Iterable<string>): void {
    const keep = new Set(tileIds);
    for (const id of [...this.textures.keys()]) if (!keep.has(id)) this.textures.delete(id);
    const groups = new Set([...keep].map((id) => this.catalog.tile(id).placeholder.group?.id));
    for (const key of [...this.groups.keys()]) if (!groups.has(key.slice(0, key.lastIndexOf('@')))) this.groups.delete(key);
  }

  private build(tileId: string): Texture {
    const tile = this.catalog.tile(tileId);
    const texture = new Texture(paintPlaceholder(tile, PLACEHOLDER_PX_PER_MM, this.groups), PLACEHOLDER_PX_PER_MM);
    this.textures.set(tileId, texture);
    if (tile.textureUrl && !this.loading.has(tileId)) {
      this.loading.add(tileId);
      const url = tile.textureUrl;
      loadImage(url)
        .then((image) => {
          // The series may have been left (and its textures dropped) while the image loaded.
          if (!this.textures.has(tileId)) return;
          const canvas = createCanvas(image.naturalWidth, image.naturalHeight);
          context2d(canvas).drawImage(image, 0, 0);
          this.textures.set(tileId, new Texture(canvas, image.naturalWidth / tile.widthMm));
          this.onChange();
        })
        .catch(() => console.warn(`Couldn't load ${url} for tile "${tileId}"; showing its placeholder instead.`))
        .finally(() => this.loading.delete(tileId));
    }
    return texture;
  }
}
