import type { LayoutResult } from '../../engine';
import type { Mat3, Pt } from '../../photo/homography';
import type { TextureCache } from '../textureCache';
import { clipMatrix, fragToPhotoUv } from './mesh';
import { TILE_FRAGMENT, TILE_VERTEX } from './shaders';
import { deleteBatches, hexColour, linkProgram, meshAttributes, TileTextures, uploadBatches, type BatchGl, type MeshAttributes } from './tileGl';

/** A single-channel image, 0–255, covering the whole photo. */
export interface Plane {
  width: number;
  height: number;
  data: Uint8Array;
}

/** One surface to draw. New objects (result, mask, shading) are uploaded again; the same ones are reused. */
export interface SurfaceScene {
  id: string;
  result: LayoutResult;
  /** Surface mm → photo pixels. */
  toPhoto: Mat3;
  /** A point on the surface (mm), to keep w positive. */
  inside: Pt;
  /** Where tiles go (255) and don't (0), at any size: it is stretched over the photo. */
  mask: Plane;
  /** The room's lighting: brightness relative to the surface's average, halved (128 = average). */
  shading: Plane;
}

export interface TileFrame {
  /** The stage in CSS pixels. */
  width: number;
  height: number;
  dpr: number;
  /** Where the photo is drawn: CSS pixels per photo pixel, and its top-left corner. */
  view: { scale: number; x: number; y: number };
  photo: { width: number; height: number };
  /** How much of the room's lighting to keep, 0–1. */
  light: number;
  groutMm: number;
  groutColor: string;
}

interface SurfaceGl {
  result: LayoutResult;
  batches: BatchGl[];
  maskSource: Plane;
  mask: WebGLTexture;
  shadingSource: Plane;
  shading: WebGLTexture;
}

interface Locations extends MeshAttributes {
  matrix: WebGLUniformLocation | null;
  fragToUv: WebGLUniformLocation | null;
  light: WebGLUniformLocation | null;
  grout: WebGLUniformLocation | null;
  groutMm: WebGLUniformLocation | null;
  tile: WebGLUniformLocation | null;
  maskSampler: WebGLUniformLocation | null;
  shadeSampler: WebGLUniformLocation | null;
}

/**
 * Draws the tiles of the photo's surfaces with WebGL2, on a transparent canvas between the
 * photo and the overlay: the designer's tile textures and grout, mapped in perspective, masked
 * by each surface's region and shaded with the room's lighting.
 */
export class TileCompositor {
  readonly canvas: HTMLCanvasElement;
  private gl: WebGL2RenderingContext | null = null;
  private program: WebGLProgram | null = null;
  private at: Locations | null = null;
  private readonly tiles: TileTextures;
  private readonly surfaces = new Map<string, SurfaceGl>();
  /** Called when a lost GPU context comes back, to draw again. */
  onRestored: (() => void) | null = null;

  constructor(textures: TextureCache) {
    this.tiles = new TileTextures(textures);
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'photo-tiles';
    this.canvas.addEventListener('webglcontextlost', (event) => {
      event.preventDefault();
      this.forget();
    });
    this.canvas.addEventListener('webglcontextrestored', () => {
      this.init();
      this.onRestored?.();
    });
    this.init();
  }

  /** False where WebGL2 isn't available; photo mode then shows the tile grid instead. */
  get available(): boolean {
    return !!this.gl && !!this.program;
  }

  private init(): void {
    const gl = this.canvas.getContext('webgl2', { antialias: true, alpha: true, premultipliedAlpha: true });
    if (!gl) return;
    this.gl = gl;
    const program = linkProgram(gl, TILE_VERTEX, TILE_FRAGMENT, 'Tile');
    if (!program) return;
    this.program = program;
    this.at = {
      ...meshAttributes(gl, program),
      matrix: gl.getUniformLocation(program, 'u_matrix'),
      fragToUv: gl.getUniformLocation(program, 'u_fragToUv'),
      light: gl.getUniformLocation(program, 'u_light'),
      grout: gl.getUniformLocation(program, 'u_grout'),
      groutMm: gl.getUniformLocation(program, 'u_groutMm'),
      tile: gl.getUniformLocation(program, 'u_tile'),
      maskSampler: gl.getUniformLocation(program, 'u_mask'),
      shadeSampler: gl.getUniformLocation(program, 'u_shade'),
    };
  }

  /** Draws the surfaces for one frame; with none, clears the canvas. */
  render(frame: TileFrame, scenes: readonly SurfaceScene[]): void {
    const gl = this.gl;
    const at = this.at;
    if (!gl || !this.program || !at || gl.isContextLost()) return;
    const width = Math.max(1, Math.round(frame.width * frame.dpr));
    const height = Math.max(1, Math.round(frame.height * frame.dpr));
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
    gl.viewport(0, 0, width, height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    this.prune(scenes);
    if (scenes.length === 0) return;

    gl.useProgram(this.program);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.uniformMatrix3fv(at.fragToUv, true, fragToPhotoUv(frame.view, { height: frame.height, dpr: frame.dpr }, frame.photo));
    gl.uniform1f(at.light, frame.light);
    gl.uniform3fv(at.grout, hexColour(frame.groutColor));
    gl.uniform1f(at.groutMm, frame.groutMm);
    gl.uniform1i(at.tile, 0);
    gl.uniform1i(at.maskSampler, 1);
    gl.uniform1i(at.shadeSampler, 2);
    for (const scene of scenes) {
      const surface = this.surfaceFor(gl, scene);
      gl.uniformMatrix3fv(at.matrix, true, clipMatrix(scene.toPhoto, frame.view, frame, scene.inside));
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, surface.mask);
      gl.activeTexture(gl.TEXTURE2);
      gl.bindTexture(gl.TEXTURE_2D, surface.shading);
      for (const batch of surface.batches) {
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.tiles.get(gl, batch.tileId));
        gl.bindVertexArray(batch.vao);
        gl.drawElements(gl.TRIANGLES, batch.count, batch.type, 0);
      }
    }
    gl.bindVertexArray(null);
  }

  /** The drawn colour at a point (CSS pixels from the stage's top-left), premultiplied; for checks, right after render(). */
  readPixel(x: number, y: number, dpr: number): [number, number, number, number] {
    const gl = this.gl;
    if (!gl) return [0, 0, 0, 0];
    const out = new Uint8Array(4);
    gl.readPixels(Math.floor(x * dpr), this.canvas.height - 1 - Math.floor(y * dpr), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, out);
    return [out[0]!, out[1]!, out[2]!, out[3]!];
  }

  private surfaceFor(gl: WebGL2RenderingContext, scene: SurfaceScene): SurfaceGl {
    let surface = this.surfaces.get(scene.id);
    if (surface && surface.result !== scene.result) {
      deleteBatches(gl, surface.batches);
      surface.batches = uploadBatches(gl, scene.result, this.at!);
      surface.result = scene.result;
    }
    if (!surface) {
      surface = {
        result: scene.result,
        batches: uploadBatches(gl, scene.result, this.at!),
        maskSource: scene.mask,
        mask: this.planeTexture(gl, scene.mask),
        shadingSource: scene.shading,
        shading: this.planeTexture(gl, scene.shading),
      };
      this.surfaces.set(scene.id, surface);
    }
    if (surface.maskSource !== scene.mask) {
      gl.deleteTexture(surface.mask);
      surface.mask = this.planeTexture(gl, scene.mask);
      surface.maskSource = scene.mask;
    }
    if (surface.shadingSource !== scene.shading) {
      gl.deleteTexture(surface.shading);
      surface.shading = this.planeTexture(gl, scene.shading);
      surface.shadingSource = scene.shading;
    }
    return surface;
  }

  /** A mask or shading map, filtered linearly (which also softens the mask's edge). */
  private planeTexture(gl: WebGL2RenderingContext, plane: Plane): WebGLTexture {
    const texture = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, plane.width, plane.height, 0, gl.RED, gl.UNSIGNED_BYTE, plane.data);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return texture;
  }

  /** Frees the GPU memory of surfaces and tiles no longer drawn. */
  private prune(scenes: readonly SurfaceScene[]): void {
    const gl = this.gl!;
    const ids = new Set(scenes.map((s) => s.id));
    for (const [id, surface] of this.surfaces) {
      if (ids.has(id)) continue;
      deleteBatches(gl, surface.batches);
      gl.deleteTexture(surface.mask);
      gl.deleteTexture(surface.shading);
      this.surfaces.delete(id);
    }
    this.tiles.keep(gl, new Set(scenes.flatMap((s) => s.result.pieces.map((p) => p.tileId))));
  }

  /** After a lost context every GPU object is gone; they are made again on the next draw. */
  private forget(): void {
    this.tiles.forget();
    this.surfaces.clear();
    this.program = null;
    this.at = null;
  }
}
