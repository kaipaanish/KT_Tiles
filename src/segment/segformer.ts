/**
 * SegFormer-B0 trained on ADE20K (150 scene classes), run with Transformers.js. Used inside the
 * segmentation worker.
 *
 * Licence: NVIDIA's SegFormer licence allows non-commercial use only. The model sits behind
 * `SurfaceModel`, so one with a commercial licence can replace it (see the README).
 */
import { classGroups, groupProbabilities, type ClassGroups } from './classes';
import { resizeArea } from './postprocess';
import type { ClassProbabilities, RGBAImage, SurfaceModel } from './segmenter';

/**
 * Transformers.js's self-contained browser build, pinned, from the CDN its own runtime files
 * come from. Loaded only when a photo is first segmented. (The npm package would also install
 * onnxruntime-node and sharp, which a static site never uses.)
 */
export const TRANSFORMERS_URL = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.0/dist/transformers.min.js';
export const MODEL_ID = 'Xenova/segformer-b0-finetuned-ade-512-512';
/** The model repository's commit, so its files can't change under the app. */
export const MODEL_REVISION = 'd3e5499fa8701ff0453ca940a8dfeae39b2f1504';

/** The model's normalisation (its preprocessor_config.json): ImageNet mean and standard deviation. */
const MEAN = [0.485, 0.456, 0.406] as const;
const STD = [0.229, 0.224, 0.225] as const;

export type Backend = 'wasm' | 'webgpu';
export type Precision = 'q8' | 'fp16' | 'fp32';

/** The parts of Transformers.js used here. */
interface Tensor {
  data: Float32Array;
  dims: number[];
}
interface Model {
  (inputs: { pixel_values: Tensor }): Promise<{ logits: Tensor }>;
  config: { id2label: Record<string, string> };
}
interface Progress {
  status: string;
  file?: string;
  loaded?: number;
  total?: number;
}
interface Transformers {
  AutoModel: {
    from_pretrained(
      id: string,
      options: { revision: string; device: Backend; dtype: Precision; progress_callback: (progress: Progress) => void },
    ): Promise<Model>;
  };
  Tensor: new (type: 'float32', data: Float32Array, dims: number[]) => Tensor;
}

/**
 * The model's input size for an image: about 640 px on the long side, keeping the image's
 * shape, in multiples of 32. Squashing a 4:3 photo into the 512 × 512 square the model was
 * trained on cost the same and found fixtures less well.
 */
export function inputSize(width: number, height: number, longSide = 640): { width: number; height: number } {
  const scale = longSide / Math.max(width, height);
  const round = (v: number) => Math.max(32, Math.round((v * scale) / 32) * 32);
  return { width: round(width), height: round(height) };
}

/** RGBA to the model's input: three normalised planes (red, green, blue). */
export function pixelValues(image: RGBAImage): Float32Array {
  const n = image.width * image.height;
  const out = new Float32Array(3 * n);
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < 3; c++) out[c * n + i] = (image.data[i * 4 + c]! / 255 - MEAN[c]!) / STD[c]!;
  }
  return out;
}

export class SegFormer implements SurfaceModel {
  private model: Model | null = null;
  private makeTensor: Transformers['Tensor'] | null = null;
  private groups: ClassGroups | null = null;

  constructor(
    readonly backend: Backend,
    readonly precision: Precision,
  ) {}

  get name(): string {
    const precision = this.precision === 'q8' ? '8-bit' : this.precision;
    return `SegFormer-B0, ${this.backend === 'webgpu' ? 'WebGPU' : 'WASM'} ${precision}`;
  }

  async load(onProgress: (loaded: number, total: number) => void): Promise<void> {
    if (this.model) return;
    const transformers = (await import(/* @vite-ignore */ TRANSFORMERS_URL)) as Transformers;
    // Progress per file (config, weights), reported as one total.
    const files = new Map<string, { loaded: number; total: number }>();
    const model = await transformers.AutoModel.from_pretrained(MODEL_ID, {
      revision: MODEL_REVISION,
      device: this.backend,
      dtype: this.precision,
      progress_callback: (progress) => {
        if (progress.status !== 'progress' || !progress.file || !progress.total) return;
        files.set(progress.file, { loaded: progress.loaded ?? 0, total: progress.total });
        let loaded = 0;
        let total = 0;
        for (const file of files.values()) {
          loaded += file.loaded;
          total += file.total;
        }
        onProgress(loaded, total);
      },
    });
    this.groups = classGroups(model.config.id2label);
    this.makeTensor = transformers.Tensor;
    this.model = model;
  }

  async run(image: RGBAImage): Promise<ClassProbabilities> {
    if (!this.model || !this.makeTensor || !this.groups) throw new Error('The model is not loaded');
    const size = inputSize(image.width, image.height);
    const input = resizeArea(image, size.width, size.height);
    const pixel_values = new this.makeTensor('float32', pixelValues(input), [1, 3, size.height, size.width]);
    const { logits } = await this.model({ pixel_values });
    const [, classes, height, width] = logits.dims;
    if (!classes || !height || !width) throw new Error(`Unexpected model output ${logits.dims.join(' × ')}`);
    return groupProbabilities(logits.data, classes, width, height, this.groups);
  }
}
