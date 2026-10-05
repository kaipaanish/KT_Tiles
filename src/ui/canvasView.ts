import type { LayoutResult } from '../engine';
import { drawScene, type Appearance, type Frame, type Overlay, type View } from '../render/renderer';
import type { TextureCache } from '../render/textureCache';
import { fitView, type Insets } from './viewport';

export interface Scene {
  result: LayoutResult;
  look: Appearance;
  overlay: Overlay;
}

/**
 * The drawing canvas: sized to its container at the device pixel ratio, redrawn on the next
 * animation frame only when something changed.
 */
export class CanvasView {
  readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private frame: Frame = { width: 1, height: 1, dpr: 1 };
  private scene: Scene | null = null;
  private view: View | null = null;
  /** True until the user zooms or pans; the surface then refits whenever its size changes. */
  private autoFit = true;
  private fittedFor = '';
  private queued = false;
  private drawn = false;
  onDraw: (() => void) | null = null;

  constructor(
    private readonly host: HTMLElement,
    private readonly textures: TextureCache,
    private readonly insets: () => Insets,
  ) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'surface-canvas';
    host.append(this.canvas);
    const ctx = this.canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('Canvas 2D is not available');
    this.ctx = ctx;
    new ResizeObserver(() => this.resize()).observe(host);
    this.resize();
  }

  get size(): Frame {
    return this.frame;
  }

  get currentView(): View | null {
    return this.view;
  }

  setScene(scene: Scene): void {
    this.scene = scene;
    const key = `${scene.result.surfaceType}:${scene.result.widthMm}x${scene.result.heightMm}`;
    if (this.autoFit && key !== this.fittedFor) this.view = null;
    this.requestDraw();
  }

  /** Sets the view directly (zoom, pan). Stops automatic fitting until fit() is called. */
  setView(view: View): void {
    this.view = view;
    this.autoFit = false;
    this.requestDraw();
  }

  fit(): void {
    this.autoFit = true;
    this.view = null;
    this.requestDraw();
  }

  requestDraw(): void {
    if (this.queued) return;
    this.queued = true;
    requestAnimationFrame(() => {
      this.queued = false;
      this.draw();
    });
  }

  private resize(): void {
    const rect = this.host.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));
    if (width === this.frame.width && height === this.frame.height && dpr === this.frame.dpr) return;
    // Keep the surface where it was relative to the canvas centre when not auto-fitting.
    if (this.view && !this.autoFit) {
      this.view = {
        ...this.view,
        originX: this.view.originX + (width - this.frame.width) / 2,
        originY: this.view.originY + (height - this.frame.height) / 2,
      };
    } else {
      this.view = null;
    }
    this.frame = { width, height, dpr };
    this.canvas.width = Math.round(width * dpr);
    this.canvas.height = Math.round(height * dpr);
    this.requestDraw();
  }

  private draw(): void {
    const scene = this.scene;
    if (!scene) return;
    const { result } = scene;
    if (!this.view) {
      this.view = fitView(result.widthMm, result.heightMm, this.frame.width, this.frame.height, this.insets());
      this.fittedFor = `${result.surfaceType}:${result.widthMm}x${result.heightMm}`;
    }
    drawScene(this.ctx, this.frame, result, this.view, this.textures, scene.look, scene.overlay);
    if (!this.drawn) {
      this.drawn = true;
      this.onDraw?.();
    }
  }
}
