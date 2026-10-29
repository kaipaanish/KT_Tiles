/**
 * The segmentation worker: loads the model once, then for each photo runs it and cleans up its
 * output, all off the main thread so zooming and panning stay smooth.
 */
import { DEFAULT_REFINE, refine, type RefineOptions } from './postprocess';
import { SegFormer, type Backend, type Precision } from './segformer';
import type { RGBAImage, Segmentation, SegmentProgress } from './segmenter';

export interface WorkerRequest {
  type: 'segment';
  id: number;
  /** The working-size photo: the model's input is made from it, and it guides the edges. */
  image: RGBAImage;
  backend: Backend;
  edges: RefineOptions['edges'];
}

export type WorkerReply =
  | { type: 'progress'; id: number; progress: SegmentProgress }
  | { type: 'done'; id: number; segmentation: Segmentation }
  | { type: 'error'; id: number; message: string };

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null;
  postMessage(message: WorkerReply, transfer?: Transferable[]): void;
};

interface GpuNavigator {
  gpu?: { requestAdapter(): Promise<{ features: { has(name: string): boolean } } | null> };
}

let model: SegFormer | null = null;
/** Set once WebGPU fails, so later photos go straight to WASM. */
let gpuFailed = false;
/** One photo at a time, in order. */
let queue: Promise<void> = Promise.resolve();

/** fp16 where the GPU supports it (half the download of fp32), fp32 otherwise; null without WebGPU. */
async function gpuPrecision(): Promise<Precision | null> {
  try {
    const adapter = await (navigator as GpuNavigator).gpu?.requestAdapter();
    return adapter ? (adapter.features.has('shader-f16') ? 'fp16' : 'fp32') : null;
  } catch {
    return null;
  }
}

/** The model for a backend, loading it if needed. WebGPU falls back to WASM if it fails. */
async function modelFor(requested: Backend, onProgress: (loaded: number, total: number) => void): Promise<SegFormer> {
  const backend = requested === 'webgpu' && !gpuFailed ? 'webgpu' : 'wasm';
  if (model?.backend === backend) return model;
  if (backend === 'webgpu') {
    const precision = await gpuPrecision();
    if (precision) {
      const candidate = new SegFormer('webgpu', precision);
      try {
        await candidate.load(onProgress);
        return (model = candidate);
      } catch (error) {
        console.warn('WebGPU segmentation failed to load; using WASM', error);
      }
    }
    gpuFailed = true;
  }
  const candidate = new SegFormer('wasm', 'q8');
  await candidate.load(onProgress);
  return (model = candidate);
}

async function segment(request: WorkerRequest): Promise<void> {
  const { id, image } = request;
  const progress = (value: SegmentProgress) => scope.postMessage({ type: 'progress', id, progress: value });
  const loadStart = performance.now();
  let current = await modelFor(request.backend, (loaded, total) => progress({ phase: 'download', loaded, total }));
  const load = performance.now() - loadStart;
  progress({ phase: 'run' });
  const runStart = performance.now();
  let probabilities;
  try {
    probabilities = await current.run(image);
  } catch (error) {
    if (current.backend !== 'webgpu') throw error;
    console.warn('WebGPU segmentation failed; using WASM', error);
    gpuFailed = true;
    current = await modelFor('wasm', (loaded, total) => progress({ phase: 'download', loaded, total }));
    probabilities = await current.run(image);
  }
  const run = performance.now() - runStart;
  const refineStart = performance.now();
  const surfaceChance = new Uint8Array(image.width * image.height);
  const labels = refine(probabilities, image, { ...DEFAULT_REFINE, edges: request.edges }, surfaceChance);
  const segmentation: Segmentation = {
    width: image.width,
    height: image.height,
    labels,
    surfaceChance,
    model: current.name,
    timings: { load: Math.round(load), run: Math.round(run), refine: Math.round(performance.now() - refineStart) },
  };
  scope.postMessage({ type: 'done', id, segmentation }, [labels.buffer, surfaceChance.buffer]);
}

scope.onmessage = (event) => {
  const request = event.data;
  queue = queue.then(() =>
    segment(request).catch((error: unknown) => {
      scope.postMessage({ type: 'error', id: request.id, message: error instanceof Error ? error.message : String(error) });
    }),
  );
};
