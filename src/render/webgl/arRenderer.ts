import type { LayoutResult } from '../../engine';
import type { TextureCache } from '../textureCache';
import { AR_TILE_FRAGMENT, AR_TILE_VERTEX, RETICLE_FRAGMENT, RETICLE_VERTEX } from './shaders';
import { deleteBatches, hexColour, linkProgram, meshAttributes, TileTextures, uploadBatches, type BatchGl, type MeshAttributes } from './tileGl';

/** Tiles placed in the room: a laid-out surface and where its millimetres go (room metres). */
export interface ArPatch {
  result: LayoutResult;
  /** Surface mm → room metres, column-major. */
  model: Float32Array;
}

/** The aiming ring on the surface the camera points at: the hit's pose, scaled to the ring's size. */
export interface ArReticle {
  model: Float32Array;
  colour: [number, number, number];
}

interface TileLocations extends MeshAttributes {
  projection: WebGLUniformLocation | null;
  view: WebGLUniformLocation | null;
  model: WebGLUniformLocation | null;
  tile: WebGLUniformLocation | null;
  grout: WebGLUniformLocation | null;
  groutMm: WebGLUniformLocation | null;
}

/**
 * Draws the AR scene into the XR session's framebuffer (bound by the caller), one view at a time:
 * the designer's tiles on each placed patch, then the aiming ring. The camera picture is behind,
 * composited by the browser.
 */
export class ArRenderer {
  private readonly tileProgram: WebGLProgram | null;
  private readonly reticleProgram: WebGLProgram | null;
  private readonly at: TileLocations | null = null;
  private readonly reticleAt: { corner: number; projection: WebGLUniformLocation | null; view: WebGLUniformLocation | null; model: WebGLUniformLocation | null; colour: WebGLUniformLocation | null } | null = null;
  private readonly reticleVao: WebGLVertexArrayObject | null = null;
  private readonly tiles: TileTextures;
  private readonly meshes = new Map<LayoutResult, BatchGl[]>();

  constructor(
    private readonly gl: WebGL2RenderingContext,
    textures: TextureCache,
  ) {
    this.tiles = new TileTextures(textures);
    this.tileProgram = linkProgram(gl, AR_TILE_VERTEX, AR_TILE_FRAGMENT, 'AR tile');
    this.reticleProgram = linkProgram(gl, RETICLE_VERTEX, RETICLE_FRAGMENT, 'AR reticle');
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
      };
    }
    if (this.reticleProgram) {
      const p = this.reticleProgram;
      this.reticleAt = {
        corner: gl.getAttribLocation(p, 'a_corner'),
        projection: gl.getUniformLocation(p, 'u_projection'),
        view: gl.getUniformLocation(p, 'u_view'),
        model: gl.getUniformLocation(p, 'u_model'),
        colour: gl.getUniformLocation(p, 'u_colour'),
      };
      this.reticleVao = gl.createVertexArray();
      gl.bindVertexArray(this.reticleVao);
      const vbo = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
      gl.bufferData(gl.ARRAY_BUFFER, Float32Array.from([-1, -1, 1, -1, 1, 1, -1, -1, 1, 1, -1, 1]), gl.STATIC_DRAW);
      gl.enableVertexAttribArray(this.reticleAt.corner);
      gl.vertexAttribPointer(this.reticleAt.corner, 2, gl.FLOAT, false, 0, 0);
      gl.bindVertexArray(null);
    }
  }

  get available(): boolean {
    return !!this.tileProgram && !!this.reticleProgram;
  }

  /** Draws one view (projection and view matrices from WebXR) into the current viewport. */
  draw(projection: Float32Array, view: Float32Array, patches: readonly ArPatch[], reticle: ArReticle | null, look: { groutMm: number; groutColor: string }): void {
    const gl = this.gl;
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    if (this.tileProgram && this.at && patches.length > 0) {
      const at = this.at;
      gl.useProgram(this.tileProgram);
      gl.uniformMatrix4fv(at.projection, false, projection);
      gl.uniformMatrix4fv(at.view, false, view);
      gl.uniform3fv(at.grout, hexColour(look.groutColor));
      gl.uniform1f(at.groutMm, look.groutMm);
      gl.uniform1i(at.tile, 0);
      gl.activeTexture(gl.TEXTURE0);
      for (const patch of patches) {
        gl.uniformMatrix4fv(at.model, false, patch.model);
        for (const batch of this.meshFor(patch.result)) {
          gl.bindTexture(gl.TEXTURE_2D, this.tiles.get(gl, batch.tileId));
          gl.bindVertexArray(batch.vao);
          gl.drawElements(gl.TRIANGLES, batch.count, batch.type, 0);
        }
      }
    }
    if (this.reticleProgram && this.reticleAt && reticle) {
      const at = this.reticleAt;
      gl.useProgram(this.reticleProgram);
      gl.uniformMatrix4fv(at.projection, false, projection);
      gl.uniformMatrix4fv(at.view, false, view);
      gl.uniformMatrix4fv(at.model, false, reticle.model);
      gl.uniform3fv(at.colour, reticle.colour);
      gl.bindVertexArray(this.reticleVao);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    }
    gl.bindVertexArray(null);
  }

  /** Frees the meshes and textures of patches no longer placed. */
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
