/** GLSL ES 3.00 shaders for the tiles on the photo and in AR. */

/**
 * How much grout covers a fragment, 0–1: grout centred on the tile's joint edges (millimetres on
 * the surface), at least a pixel wide as in the designer, thinner grout showing as a fainter line.
 */
const GROUT = `
float groutAmount(vec2 local, vec2 size, vec4 joints, float groutMm) {
  // Distance (mm) to the nearest joint edge of this tile.
  vec2 mm = local * size;
  vec2 rest = size - mm;
  float d = 1e6;
  if (joints.x > 0.5) d = min(d, mm.x);
  if (joints.y > 0.5) d = min(d, rest.x);
  if (joints.z > 0.5) d = min(d, mm.y);
  if (joints.w > 0.5) d = min(d, rest.y);
  float pixel = max(fwidth(d), 1e-4);
  float width = max(groutMm, pixel);
  float grout = 1.0 - smoothstep(0.5 * width - 0.5 * pixel, 0.5 * width + 0.5 * pixel, d);
  return grout * min(1.0, groutMm / pixel);
}
`;

/**
 * The surface's homography (with the photo's place on screen) maps millimetres to clip space;
 * its third component goes in w, so the GPU divides per pixel and interpolates the texture
 * coordinates in perspective: grout lines stay straight and converge as the room's lines do.
 */
export const TILE_VERTEX = `#version 300 es
uniform mat3 u_matrix;
in vec2 a_position;
in vec2 a_local;
in vec2 a_uv;
in vec2 a_size;
in vec4 a_joints;
out vec2 v_local;
out vec2 v_uv;
flat out vec2 v_size;
flat out vec4 v_joints;
void main() {
  vec3 p = u_matrix * vec3(a_position, 1.0);
  gl_Position = vec4(p.xy, 0.0, p.z);
  v_local = a_local;
  v_uv = a_uv;
  v_size = a_size;
  v_joints = a_joints;
}
`;

/**
 * A tile's texture, grout on its joint edges (in millimetres on the surface), only where the
 * surface's mask is, multiplied by the room's lighting.
 */
export const TILE_FRAGMENT = `#version 300 es
precision highp float;
uniform sampler2D u_tile;
uniform sampler2D u_mask;
uniform sampler2D u_shade;
uniform mat3 u_fragToUv;
uniform float u_light;
uniform vec3 u_grout;
uniform float u_groutMm;
in vec2 v_local;
in vec2 v_uv;
flat in vec2 v_size;
flat in vec4 v_joints;
out vec4 outColor;
${GROUT}
void main() {
  vec2 uv = (u_fragToUv * vec3(gl_FragCoord.xy, 1.0)).xy;
  // Nothing to tile off the photo (a surface's outline can run past it; its mask's edge would repeat out there).
  if (any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)))) discard;
  float mask = texture(u_mask, uv).r;
  if (mask <= 0.0) discard;
  vec3 colour = texture(u_tile, v_uv).rgb;
  colour = mix(colour, u_grout, groutAmount(v_local, v_size, v_joints, u_groutMm));
  float shade = 2.0 * texture(u_shade, uv).r;
  colour *= mix(1.0, shade, u_light);
  outColor = vec4(colour * mask, mask);
}
`;

/** AR: the same tile mesh (surface millimetres) placed in the room: surface → room → camera → screen. */
export const AR_TILE_VERTEX = `#version 300 es
uniform mat4 u_projection;
uniform mat4 u_view;
uniform mat4 u_model;
in vec2 a_position;
in vec2 a_local;
in vec2 a_uv;
in vec2 a_size;
in vec4 a_joints;
out vec2 v_local;
out vec2 v_uv;
flat out vec2 v_size;
flat out vec4 v_joints;
void main() {
  gl_Position = u_projection * u_view * u_model * vec4(a_position, 0.0, 1.0);
  v_local = a_local;
  v_uv = a_uv;
  v_size = a_size;
  v_joints = a_joints;
}
`;

/** AR: a tile's texture with grout, opaque over the camera picture. */
export const AR_TILE_FRAGMENT = `#version 300 es
precision highp float;
uniform sampler2D u_tile;
uniform vec3 u_grout;
uniform float u_groutMm;
in vec2 v_local;
in vec2 v_uv;
flat in vec2 v_size;
flat in vec4 v_joints;
out vec4 outColor;
${GROUT}
void main() {
  vec3 colour = texture(u_tile, v_uv).rgb;
  colour = mix(colour, u_grout, groutAmount(v_local, v_size, v_joints, u_groutMm));
  outColor = vec4(colour, 1.0);
}
`;

/** AR: the aiming ring, a square in the hit's plane (its x and z axes; y is the surface normal). */
export const RETICLE_VERTEX = `#version 300 es
uniform mat4 u_projection;
uniform mat4 u_view;
uniform mat4 u_model;
in vec2 a_corner;
out vec2 v_at;
void main() {
  gl_Position = u_projection * u_view * u_model * vec4(a_corner.x, 0.0, a_corner.y, 1.0);
  v_at = a_corner;
}
`;

/** AR: a rectangle being marked, a unit square in the model's x–y plane. */
export const RECT_VERTEX = `#version 300 es
uniform mat4 u_projection;
uniform mat4 u_view;
uniform mat4 u_model;
in vec2 a_corner;
out vec2 v_at;
void main() {
  gl_Position = u_projection * u_view * u_model * vec4(a_corner, 0.0, 1.0);
  v_at = a_corner;
}
`;

/** AR: the rectangle's outline (a few pixels wide however far) over a light fill, premultiplied. */
export const RECT_FRAGMENT = `#version 300 es
precision highp float;
uniform vec3 u_colour;
uniform vec2 u_size;
in vec2 v_at;
out vec4 outColor;
void main() {
  vec2 m = v_at * u_size;
  vec2 rest = u_size - m;
  float d = min(min(m.x, rest.x), min(m.y, rest.y));
  float px = max(fwidth(d), 1e-6);
  float line = 1.0 - smoothstep(2.0 * px, 3.0 * px, d);
  float alpha = max(line * 0.95, 0.2);
  outColor = vec4(u_colour * alpha, alpha);
}
`;

/** AR: a ring with a dot in the middle, in one colour, premultiplied. */
export const RETICLE_FRAGMENT = `#version 300 es
precision highp float;
uniform vec3 u_colour;
in vec2 v_at;
out vec4 outColor;
void main() {
  float r = length(v_at);
  float aa = fwidth(r);
  float ring = smoothstep(0.72 - aa, 0.72, r) * (1.0 - smoothstep(0.92, 0.92 + aa, r));
  float centre = 1.0 - smoothstep(0.12, 0.12 + aa, r);
  float alpha = max(ring, centre) * 0.95;
  outColor = vec4(u_colour * alpha, alpha);
}
`;
