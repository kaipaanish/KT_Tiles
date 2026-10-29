/**
 * What the photo's tile compositor and the AR renderer share: linking shaders, uploading a laid-out
 * surface's tile mesh, and the tile textures from the designer's cache.
 */
import type { LayoutResult } from '../../engine';
import type { TextureCache } from '../textureCache';
import { FLOATS_PER_VERTEX, tileBatches } from './mesh';

/** '#rrggbb' as 0–1 channels, for a shader. */
export function hexColour(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

export function linkProgram(gl: WebGL2RenderingContext, vertexSource: string, fragmentSource: string, name: string): WebGLProgram | null {
  const compile = (type: number, source: string) => {
    const shader = gl.createShader(type);
    if (!shader) return null;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      console.warn(`${name} shader failed to compile`, gl.getShaderInfoLog(shader));
      return null;
    }
    return shader;
  };
  const vertex = compile(gl.VERTEX_SHADER, vertexSource);
  const fragment = compile(gl.FRAGMENT_SHADER, fragmentSource);
  const program = gl.createProgram();
  if (!vertex || !fragment || !program) return null;
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.warn(`${name} shaders failed to link`, gl.getProgramInfoLog(program));
    return null;
  }
  return program;
}

/** Where a tile program takes the mesh's attributes (-1 for any it doesn't use). */
export interface MeshAttributes {
  position: number;
  local: number;
  uv: number;
  size: number;
  joints: number;
}

export function meshAttributes(gl: WebGL2RenderingContext, program: WebGLProgram): MeshAttributes {
  return {
    position: gl.getAttribLocation(program, 'a_position'),
    local: gl.getAttribLocation(program, 'a_local'),
    uv: gl.getAttribLocation(program, 'a_uv'),
    size: gl.getAttribLocation(program, 'a_size'),
    joints: gl.getAttribLocation(program, 'a_joints'),
  };
}

/** One tile image's triangles on the GPU. */
export interface BatchGl {
  tileId: string;
  vao: WebGLVertexArrayObject;
  buffers: WebGLBuffer[];
  count: number;
  type: number;
}

export function uploadBatches(gl: WebGL2RenderingContext, result: LayoutResult, at: MeshAttributes): BatchGl[] {
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

export function deleteBatches(gl: WebGL2RenderingContext, batches: readonly BatchGl[]): void {
  for (const batch of batches) {
    gl.deleteVertexArray(batch.vao);
    for (const buffer of batch.buffers) gl.deleteBuffer(buffer);
  }
}

/** The tiles' full-resolution textures from the designer's cache, for one GL context. */
export class TileTextures {
  private readonly tiles = new Map<string, { source: HTMLCanvasElement; texture: WebGLTexture }>();
  private anisotropy: { ext: EXT_texture_filter_anisotropic; max: number } | null | undefined;

  constructor(private readonly textures: TextureCache) {}

  /** The tile's texture, uploaded again when a real image replaces its placeholder. */
  get(gl: WebGL2RenderingContext, tileId: string): WebGLTexture {
    const source = this.textures.get(tileId, Number.POSITIVE_INFINITY);
    const cached = this.tiles.get(tileId);
    if (cached && cached.source === source) return cached.texture;
    if (cached) gl.deleteTexture(cached.texture);
    if (this.anisotropy === undefined) {
      const ext = gl.getExtension('EXT_texture_filter_anisotropic');
      this.anisotropy = ext ? { ext, max: Math.min(8, gl.getParameter(ext.MAX_TEXTURE_MAX_ANISOTROPY_EXT) as number) } : null;
    }
    const texture = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    // Surfaces seen at a low angle stay sharp into the distance.
    if (this.anisotropy) gl.texParameterf(gl.TEXTURE_2D, this.anisotropy.ext.TEXTURE_MAX_ANISOTROPY_EXT, this.anisotropy.max);
    this.tiles.set(tileId, { source, texture });
    return texture;
  }

  /** Frees the textures of tiles no longer drawn. */
  keep(gl: WebGL2RenderingContext, tileIds: ReadonlySet<string>): void {
    for (const [id, tile] of this.tiles) {
      if (tileIds.has(id)) continue;
      gl.deleteTexture(tile.texture);
      this.tiles.delete(id);
    }
  }

  /** After a lost context the textures are gone; they are uploaded again when next asked for. */
  forget(): void {
    this.tiles.clear();
    this.anisotropy = undefined;
  }
}
