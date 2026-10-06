import type { LayoutResult } from '../../engine';
import type { Mat3, Pt } from '../../photo/homography';
import type { TextureCache } from '../textureCache';
import { clipMatrix, FLOATS_PER_VERTEX, fragToPhotoUv, tileBatches } from './mesh';
import { TILE_FRAGMENT, TILE_VERTEX } from './shaders';

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

interface Batch {
  tileId: string;
  vao: WebGLVertexArrayObject;
  buffers: WebGLBuffer[];
  count: number;
  type: number;
}

interface SurfaceGl {
  result: LayoutResult;
  batches: Batch[];
  maskSource: Plane;
  mask: WebGLTexture;
  shadingSource: Plane;
  shading: WebGLTexture;
}

interface Locations {
  position: number;
  local: number;
  uv: number;
  size: number;
  joints: number;
  matrix: WebGLUniformLocation | null;
  fragToUv: WebGLUniformLocation | null;
  light: WebGLUniformLocation | null;
  grout: WebGLUniformLocation | null;
  groutMm: WebGLUniformLocation | null;
  tile: WebGLUniformLocation | null;
  maskSampler: WebGLUniformLocation | null;
  shadeSampler: WebGLUniformLocation | null;
}

const hexColour = (hex: string): [number, number, number] => {
  const n = Number.parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};

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
  private anisotropy: { ext: EXT_texture_filter_anisotropic; max: number } | null = null;
  private readonly tiles = new Map<string, { source: HTMLCanvasElement; texture: WebGLTexture }>();
  private readonly surfaces = new Map<string, SurfaceGl>();
  /** Called when a lost GPU context comes back, to draw again. */
  onRestored: (() => void) | null = null;

  constructor(private readonly textures: TextureCache) {
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
    const program = this.link(gl);
    if (!program) return;
    this.program = program;
    this.at = {
      position: gl.getAttribLocation(program, 'a_position'),
      local: gl.getAttribLocation(program, 'a_local'),
      uv: gl.getAttribLocation(program, 'a_uv'),
      size: gl.getAttribLocation(program, 'a_size'),
      joints: gl.getAttribLocation(program, 'a_joints'),
      matrix: gl.getUniformLocation(program, 'u_matrix'),
      fragToUv: gl.getUniformLocation(program, 'u_fragToUv'),
      light: gl.getUniformLocation(program, 'u_light'),
      grout: gl.getUniformLocation(program, 'u_grout'),
      groutMm: gl.getUniformLocation(program, 'u_groutMm'),
      tile: gl.getUniformLocation(program, 'u_tile'),
      maskSampler: gl.getUniformLocation(program, 'u_mask'),
      shadeSampler: gl.getUniformLocation(program, 'u_shade'),
    };
    const ext = gl.getExtension('EXT_texture_filter_anisotropic');
    this.anisotropy = ext ? { ext, max: Math.min(8, gl.getParameter(ext.MAX_TEXTURE_MAX_ANISOTROPY_EXT) as number) } : null;
  }

  private link(gl: WebGL2RenderingContext): WebGLProgram | null {
    const compile = (type: number, source: string) => {
      const shader = gl.createShader(type);
      if (!shader) return null;
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        console.warn('Tile shader failed to compile', gl.getShaderInfoLog(shader));
        return null;
      }
      return shader;
    };
    const vertex = compile(gl.VERTEX_SHADER, TILE_VERTEX);
    const fragment = compile(gl.FRAGMENT_SHADER, TILE_FRAGMENT);
    const program = gl.createProgram();
    if (!vertex || !fragment || !program) return null;
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.warn('Tile shaders failed to link', gl.getProgramInfoLog(program));
      return null;
    }
    return program;
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
        gl.bindTexture(gl.TEXTURE_2D, this.tileTexture(gl, batch.tileId));
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
      this.deleteBatches(gl, surface.batches);
      surface.batches = this.buildBatches(gl, scene.result);
      surface.result = scene.result;
    }
    if (!surface) {
      surface = {
        result: scene.result,
        batches: this.buildBatches(gl, scene.result),
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

  private buildBatches(gl: WebGL2RenderingContext, result: LayoutResult): Batch[] {
    const at = this.at!;
    const stride = FLOATS_PER_VERTEX * 4;
    return tileBatches(result).map((batch) => {
      const vao = gl.createVertexArray()!;
      gl.bindVertexArray(vao);
      const vbo = gl.createBuffer()!;
      gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
      gl.bufferData(gl.ARRAY_BUFFER, batch.vertices, gl.STATIC_DRAW);
      const attribute = (location: number, size: number, offset: number) => {
        if (location < 0) return;
        gl.enableVertexAttribArray(location);
        gl.vertexAttribPointer(location, size, gl.FLOAT, false, stride, offset * 4);
      };
      attribute(at.position, 2, 0);
      attribute(at.local, 2, 2);
      attribute(at.uv, 2, 4);
      attribute(at.size, 2, 6);
      attribute(at.joints, 4, 8);
      const ibo = gl.createBuffer()!;
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, batch.indices, gl.STATIC_DRAW);
      gl.bindVertexArray(null);
      return { tileId: batch.tileId, vao, buffers: [vbo, ibo], count: batch.indices.length, type: batch.indices instanceof Uint32Array ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT };
    });
  }

  /** The tile's full-resolution texture from the designer's cache, uploaded again when a real image replaces its placeholder. */
  private tileTexture(gl: WebGL2RenderingContext, tileId: string): WebGLTexture {
    const source = this.textures.get(tileId, Number.POSITIVE_INFINITY);
    const cached = this.tiles.get(tileId);
    if (cached && cached.source === source) return cached.texture;
    if (cached) gl.deleteTexture(cached.texture);
    const texture = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    // Floors seen at a low angle stay sharp into the distance.
    if (this.anisotropy) gl.texParameterf(gl.TEXTURE_2D, this.anisotropy.ext.TEXTURE_MAX_ANISOTROPY_EXT, this.anisotropy.max);
    this.tiles.set(tileId, { source, texture });
    return texture;
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
      this.deleteBatches(gl, surface.batches);
      gl.deleteTexture(surface.mask);
      gl.deleteTexture(surface.shading);
      this.surfaces.delete(id);
    }
    const tileIds = new Set(scenes.flatMap((s) => s.result.pieces.map((p) => p.tileId)));
    for (const [id, tile] of this.tiles) {
      if (tileIds.has(id)) continue;
      gl.deleteTexture(tile.texture);
      this.tiles.delete(id);
    }
  }

  private deleteBatches(gl: WebGL2RenderingContext, batches: Batch[]): void {
    for (const batch of batches) {
      gl.deleteVertexArray(batch.vao);
      for (const buffer of batch.buffers) gl.deleteBuffer(buffer);
    }
  }

  /** After a lost context every GPU object is gone; they are made again on the next draw. */
  private forget(): void {
    this.tiles.clear();
    this.surfaces.clear();
    this.program = null;
    this.at = null;
  }
}
