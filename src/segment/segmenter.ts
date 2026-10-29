/**
 * Finding the walls, floor and ceiling in a photo. Pure types, no DOM.
 *
 * The model sits behind two small interfaces so it can be replaced: the SegFormer weights used
 * now are licensed for non-commercial use only.
 * - `SurfaceModel` runs a model and returns, per pixel, how likely it is wall, floor or ceiling.
 *   Everything after that (sharpening edges, removing specks) doesn't depend on the model.
 * - `Segmenter` is what photo mode calls: a photo in, one label per pixel out.
 */

/** An RGBA image, row by row from the top-left, like ImageData without needing the DOM. */
export interface RGBAImage {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

/** Per-pixel labels. */
export const OTHER = 0;
export const WALL = 1;
export const FLOOR = 2;
export const CEILING = 3;
export type Label = typeof OTHER | typeof WALL | typeof FLOOR | typeof CEILING;
export const LABEL_NAMES = ['other', 'wall', 'floor', 'ceiling'] as const;

/** How likely each pixel is wall, floor or ceiling (the rest is "other"), at the model's resolution. */
export interface ClassProbabilities {
  width: number;
  height: number;
  wall: Float32Array;
  floor: Float32Array;
  ceiling: Float32Array;
}

export interface Segmentation {
  /** The size of the image that was segmented. */
  width: number;
  height: number;
  /** One label per pixel: OTHER, WALL, FLOOR or CEILING. */
  labels: Uint8Array;
  /**
   * How likely the model thought each pixel is some surface (wall, floor or ceiling), 0–255, with
   * the same photo-guided clean-up as the labels. Where it misread a bit of wall it usually still
   * gave it a fair chance; things in front, next to none.
   */
  surfaceChance?: Uint8Array;
  /** Which model and backend produced it, e.g. "SegFormer-B0, WASM 8-bit". */
  model: string;
  /** Milliseconds: loading the model (0 once it is loaded), running it, and cleaning up its output. */
  timings: { load: number; run: number; refine: number };
}

export type SegmentProgress = { phase: 'download'; loaded: number; total: number } | { phase: 'run' };

export interface Segmenter {
  segment(image: RGBAImage, onProgress?: (progress: SegmentProgress) => void): Promise<Segmentation>;
  dispose(): void;
}

/** A segmentation model, as the worker uses it. */
export interface SurfaceModel {
  /** Name and backend, for the panel and the README's timings. */
  readonly name: string;
  /** Downloads (or reads from the browser cache) and prepares the model. */
  load(onProgress: (loaded: number, total: number) => void): Promise<void>;
  run(image: RGBAImage): Promise<ClassProbabilities>;
}
