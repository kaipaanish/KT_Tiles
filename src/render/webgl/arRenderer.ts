import type { LayoutResult } from '../../engine';
import type { TextureCache } from '../textureCache';
import { AR_TILE_FRAGMENT, AR_TILE_VERTEX, CAMERA_FRAGMENT, CAMERA_VERTEX, RECT_FRAGMENT, RECT_VERTEX, RETICLE_FRAGMENT, RETICLE_VERTEX } from './shaders';
import { deleteBatches, hexColour, linkProgram, meshAttributes, TileTextures, uploadBatches, type BatchGl, type MeshAttributes } from './tileGl';

type Rgb = [number, number, number];

/** Tiles placed in the room: a laid-out surface and where its millimetres go (room metres). */
export interface ArPatch {
  result: LayoutResult;
  /** Surface mm → room metres, column-major. */
  model: Float32Array;
}

/** A ring lying on a surface (the aim, or a marked corner): its model puts the ring in the model's x–z plane. */
export interface ArRing {
  model: Float32Array;
  colour: Rgb;
}

/** A rectangle being marked: a unit square in its model's x–y plane, `size` metres across. */
export interface ArRect {
  model: Float32Array;
  size: [number, number];
  colour: Rgb;
}

export interface ArScene {
  patches: readonly ArPatch[];
  rects: readonly ArRect[];
  rings: readonly ArRing[];
}

/** One view's depth picture from the phone's depth sensor, for hiding tiles behind real things. */
export interface ArDepth {
  width: number;
  height: number;
  /** Depth in metres, row by row from the picture's top-left; 0 where there's no reading. */
  metres: Float32Array;
  /** Normalised view coordinates → normalised depth-picture coordinates, column-major. */
  uvMatrix: Float32Array;
  /** The view's viewport in the framebuffer: x, y, width, height. */
  viewport: [number, number, number, number];
}

interface TileLocations extends MeshAttributes {
  projection: WebGLUniformLocation | null;
  view: WebGLUniformLocation | null;
  model: WebGLUniformLocation | null;
  tile: WebGLUniformLocation | null;
  grout: WebGLUniformLocation | null;
  groutMm: WebGLUniformLocation | null;
  depth: WebGLUniformLocation | null;
  depthUv: WebGLUniformLocation | null;
  viewportAt: WebGLUniformLocation | null;
  depthMode: WebGLUniformLocation | null;
  light: WebGLUniformLocation | null;
}

interface ShapeProgram {
  program: WebGLProgram;
  vao: WebGLVertexArrayObject;
  count: number;
  projection: WebGLUniformLocation | null;
  view: WebGLUniformLocation | null;
  model: WebGLUniformLocation | null;
  colour: WebGLUniformLocation | null;
  size: WebGLUniformLocation | null;
}

/**
 * Draws the AR scene into the XR session's framebuffer (bound by the caller), one view at a time:
 * the designer's tiles on placed surfaces, rectangles being marked, then rings. The camera
 * picture is behind, composited by the browser.
 */
export class ArRenderer {
  private readonly tileProgram: WebGLProgram | null;
  private readonly at: TileLocations | null = null;
  private readonly ring: ShapeProgram | null;
  private readonly rect: ShapeProgram | null;
  private readonly camera: ShapeProgram | null;
  private readonly tiles: TileTextures;
  private readonly meshes = new Map<LayoutResult, BatchGl[]>();
  private depthTexture: WebGLTexture | null = null;

  constructor(
    private readonly gl: WebGL2RenderingContext,
    textures: TextureCache,
  ) {
    this.tiles = new TileTextures(textures);
    this.tileProgram = linkProgram(gl, AR_TILE_VERTEX, AR_TILE_FRAGMENT, 'AR tile');
    if (this.tileProgram) {
      const p = this.tileProgram;
      this.at = {
        ...meshAttributes(gl, p),
        projection: gl.getUniformLocation(p, 'u_projection'),
        view: gl.getUniformLocation(p, 'u_view'),
        model: gl.getUniformLocation(p, 'u_model'),
        tile: gl.getUniformLocation(p, 'u_tile'),
        grout: gl.getUniformLocation(p, 'u_grout'),
        groutMm: gl.getUniformLocation(p, 'u_groutMm'),
        depth: gl.getUniformLocation(p, 'u_depth'),
        depthUv: gl.getUniformLocation(p, 'u_depthUv'),
        viewportAt: gl.getUniformLocation(p, 'u_viewport'),
        depthMode: gl.getUniformLocation(p, 'u_depthMode'),
        light: gl.getUniformLocation(p, 'u_light'),
      };
    }
    // Two triangles: the ring's square spans −1…1, the rectangle's 0…1.
    this.ring = this.shape(RETICLE_VERTEX, RETICLE_FRAGMENT, 'AR ring', [-1, -1, 1, -1, 1, 1, -1, -1, 1, 1, -1, 1]);
    this.rect = this.shape(RECT_VERTEX, RECT_FRAGMENT, 'AR rectangle', [0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1]);
    this.camera = this.shape(CAMERA_VERTEX, CAMERA_FRAGMENT, 'AR camera', [0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1]);
  }

  get available(): boolean {
    return !!this.tileProgram && !!this.ring && !!this.rect;
  }

  private shape(vertex: string, fragment: string, name: string, corners: number[]): ShapeProgram | null {
    const gl = this.gl;
    const program = linkProgram(gl, vertex, fragment, name);
    if (!program) return null;
    const vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, Float32Array.from(corners), gl.STATIC_DRAW);
    const corner = gl.getAttribLocation(program, 'a_corner');
    gl.enableVertexAttribArray(corner);
    gl.vertexAttribPointer(corner, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
    return {
      program,
      vao,
      count: corners.length / 2,
      projection: gl.getUniformLocation(program, 'u_projection'),
      view: gl.getUniformLocation(program, 'u_view'),
      model: gl.getUniformLocation(program, 'u_model'),
      colour: gl.getUniformLocation(program, 'u_colour'),
      size: gl.getUniformLocation(program, 'u_size'),
    };
  }

  /**
   * Draws one view (projection and view matrices from WebXR) into the current viewport. With the
   * view's depth picture, tiles behind real things aren't drawn.
   */
  draw(projection: Float32Array, view: Float32Array, scene: ArScene, look: { groutMm: number; groutColor: string; light?: [number, number, number] }, depth: ArDepth | null = null): void {
    const gl = this.gl;
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    if (this.tileProgram && this.at && scene.patches.length > 0) {
      const at = this.at;
      gl.useProgram(this.tileProgram);
      gl.uniformMatrix4fv(at.projection, false, projection);
      gl.uniformMatrix4fv(at.view, false, view);
      gl.uniform3fv(at.grout, hexColour(look.groutColor));
      gl.uniform1f(at.groutMm, look.groutMm);
      gl.uniform1i(at.tile, 0);
      gl.uniform3fv(at.light, look.light ?? [1, 1, 1]);
      gl.uniform1i(at.depth, 1);
      gl.uniform1i(at.depthMode, depth ? 1 : 0);
      if (depth) {
        gl.activeTexture(gl.TEXTURE1);
        this.uploadDepth(depth);
        gl.uniformMatrix4fv(at.depthUv, false, depth.uvMatrix);
        gl.uniform4fv(at.viewportAt, depth.viewport);
      }
      gl.activeTexture(gl.TEXTURE0);
      for (const patch of scene.patches) {
        gl.uniformMatrix4fv(at.model, false, patch.model);
        for (const batch of this.meshFor(patch.result)) {
          gl.bindTexture(gl.TEXTURE_2D, this.tiles.get(gl, batch.tileId));
          gl.bindVertexArray(batch.vao);
          gl.drawElements(gl.TRIANGLES, batch.count, batch.type, 0);
        }
      }
    }
    const shapes = (shape: ShapeProgram | null, items: readonly (ArRing | ArRect)[]) => {
      if (!shape || items.length === 0) return;
      gl.useProgram(shape.program);
      gl.uniformMatrix4fv(shape.projection, false, projection);
      gl.uniformMatrix4fv(shape.view, false, view);
      gl.bindVertexArray(shape.vao);
      for (const item of items) {
        gl.uniformMatrix4fv(shape.model, false, item.model);
        gl.uniform3fv(shape.colour, item.colour);
        if ('size' in item) gl.uniform2fv(shape.size, item.size);
        gl.drawArrays(gl.TRIANGLES, 0, shape.count);
      }
    };
    shapes(this.rect, scene.rects);
    shapes(this.ring, scene.rings);
    gl.bindVertexArray(null);
  }

  /** The camera's picture filling the current viewport, for an AR picture (drawn before the scene). */
  drawCamera(texture: WebGLTexture): void {
    const gl = this.gl;
    const shape = this.camera;
    if (!shape) return;
    gl.disable(gl.BLEND);
    gl.useProgram(shape.program);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.uniform1i(gl.getUniformLocation(shape.program, 'u_camera'), 0);
    gl.bindVertexArray(shape.vao);
    gl.drawArrays(gl.TRIANGLES, 0, shape.count);
    gl.bindVertexArray(null);
  }

  /**
   * The depth picture as a float texture. The shader blends the readings itself (leaving out
   * missing ones), so the texture is read exactly.
   */
  private uploadDepth(depth: ArDepth): void {
    const gl = this.gl;
    this.depthTexture ??= gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.depthTexture);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, depth.width, depth.height, 0, gl.RED, gl.FLOAT, depth.metres);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  /** Frees the meshes and textures of layouts no longer drawn. */
  keep(patches: readonly ArPatch[]): void {
    const results = new Set(patches.map((p) => p.result));
    for (const [result, batches] of this.meshes) {
      if (results.has(result)) continue;
      deleteBatches(this.gl, batches);
      this.meshes.delete(result);
    }
    this.tiles.keep(this.gl, new Set(patches.flatMap((p) => p.result.pieces.map((piece) => piece.tileId))));
  }

  private meshFor(result: LayoutResult): BatchGl[] {
    let batches = this.meshes.get(result);
    if (!batches) {
      batches = uploadBatches(this.gl, result, this.at!);
      this.meshes.set(result, batches);
    }
    return batches;
  }
}
