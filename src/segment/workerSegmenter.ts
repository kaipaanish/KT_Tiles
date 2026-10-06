import type { RefineOptions } from './postprocess';
import type { Backend } from './segformer';
import type { RGBAImage, Segmentation, Segmenter, SegmentProgress } from './segmenter';
import type { WorkerReply, WorkerRequest } from './worker';

interface Pending {
  resolve(segmentation: Segmentation): void;
  reject(error: Error): void;
  onProgress?: (progress: SegmentProgress) => void;
}

/**
 * The real segmenter: the model runs in a Web Worker, which (with Transformers.js) is only
 * created when the first photo needs segmenting.
 */
export class WorkerSegmenter implements Segmenter {
  private worker: Worker | null = null;
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();

  constructor(private readonly options: { backend: Backend; edges: RefineOptions['edges'] }) {}

  /** Segments the image. Its pixel buffer is handed to the worker, so the caller can't use it afterwards. */
  segment(image: RGBAImage, onProgress?: (progress: SegmentProgress) => void): Promise<Segmentation> {
    const worker = this.ensureWorker();
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, onProgress });
      const request: WorkerRequest = { type: 'segment', id, image, ...this.options };
      worker.postMessage(request, [image.data.buffer]);
    });
  }

  dispose(): void {
    this.worker?.terminate();
    this.worker = null;
    this.failAll(new Error('Segmentation stopped'));
  }

  private ensureWorker(): Worker {
    if (this.worker) return this.worker;
    const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module', name: 'segmentation' });
    worker.onmessage = (event: MessageEvent<WorkerReply>) => {
      const reply = event.data;
      const pending = this.pending.get(reply.id);
      if (!pending) return;
      if (reply.type === 'progress') {
        pending.onProgress?.(reply.progress);
      } else {
        this.pending.delete(reply.id);
        if (reply.type === 'done') pending.resolve(reply.segmentation);
        else pending.reject(new Error(reply.message));
      }
    };
    worker.onerror = (event) => {
      // The worker itself failed (e.g. the model library didn't load): start a fresh one next time.
      event.preventDefault();
      worker.terminate();
      if (this.worker === worker) this.worker = null;
      this.failAll(new Error(event.message || 'The segmentation worker failed'));
    };
    this.worker = worker;
    return worker;
  }

  private failAll(error: Error): void {
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  }
}
