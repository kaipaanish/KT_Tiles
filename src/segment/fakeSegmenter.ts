/**
 * A stand-in segmenter for tests and quick checks (?segmenter=fake): the labels come from a
 * function instead of a model, then go through the same clean-up as the real model's output.
 * Pure, no DOM.
 */
import { DEFAULT_REFINE, refine, type RefineOptions } from './postprocess';
import { CEILING, FLOOR, WALL, type Label, type RGBAImage, type Segmentation, type Segmenter, type SegmentProgress } from './segmenter';

/** Labels a point given as fractions of the image's width and height (0–1). */
export type Painter = (u: number, v: number) => Label;

/** A plain room: ceiling along the top, floor along the bottom, wall between. */
export const PLAIN_ROOM: Painter = (_u, v) => (v < 0.08 ? CEILING : v > 0.78 ? FLOOR : WALL);

/** A close-up of a wall: wall everywhere, running past every edge of the photo. */
export const WHOLE_WALL: Painter = () => WALL;

export class FakeSegmenter implements Segmenter {
  /**
   * @param cell the size of the fake model's cells in image pixels, like the real model's
   *   coarse output; probabilities are 1 for the painted label and 0 for the rest.
   */
  constructor(
    private readonly paint: Painter = PLAIN_ROOM,
    private readonly cell = 6,
    private readonly options: RefineOptions = DEFAULT_REFINE,
  ) {}

  async segment(image: RGBAImage, onProgress?: (progress: SegmentProgress) => void): Promise<Segmentation> {
    onProgress?.({ phase: 'run' });
    const width = Math.max(1, Math.round(image.width / this.cell));
    const height = Math.max(1, Math.round(image.height / this.cell));
    const n = width * height;
    const probs = { width, height, wall: new Float32Array(n), floor: new Float32Array(n), ceiling: new Float32Array(n) };
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const label = this.paint((x + 0.5) / width, (y + 0.5) / height);
        const i = y * width + x;
        if (label === WALL) probs.wall[i] = 1;
        else if (label === FLOOR) probs.floor[i] = 1;
        else if (label === CEILING) probs.ceiling[i] = 1;
      }
    }
    const started = Date.now();
    const surfaceChance = new Uint8Array(image.width * image.height);
    const labels = refine(probs, image, this.options, surfaceChance);
    return { width: image.width, height: image.height, labels, surfaceChance, model: 'Fake segmenter', timings: { load: 0, run: 0, refine: Date.now() - started } };
  }

  dispose(): void {}
}
