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
out float v_depth;
void main() {
  vec4 seen = u_view * u_model * vec4(a_position, 0.0, 1.0);
  gl_Position = u_projection * seen;
  v_local = a_local;
  v_uv = a_uv;
  v_size = a_size;
  v_joints = a_joints;
  // Depth along the view, as the phone's depth sensor measures it.
  v_depth = -seen.z;
}
`;

/**
 * AR: a tile's texture with grout, over the camera picture, except where the phone's depth
 * sensor sees something real in front of it (a foot, a basin): there the tile isn't drawn.
 * u_depth holds the depth picture in metres (0 where there's no reading); u_depthMode is 0 without one.
 */
export const AR_TILE_FRAGMENT = `#version 300 es
precision highp float;
uniform sampler2D u_tile;
uniform vec3 u_grout;
uniform float u_groutMm;
uniform sampler2D u_depth;
uniform mat4 u_depthUv;
uniform vec4 u_viewport;
uniform int u_depthMode;
uniform vec3 u_light;
in vec2 v_local;
in vec2 v_uv;
flat in vec2 v_size;
flat in vec4 v_joints;
in float v_depth;
out vec4 outColor;
${GROUT}
/**
 * The real world's depth (metres) at this pixel, or 0 where the sensor has no reading: blended
 * from the four nearest readings (leaving out missing ones), so edges are smooth, not blocky.
 */
float realDepth() {
  // Normalised view coordinates run from the view's top-left; the framebuffer's rows from its bottom.
  vec2 view = vec2((gl_FragCoord.x - u_viewport.x) / u_viewport.z, 1.0 - (gl_FragCoord.y - u_viewport.y) / u_viewport.w);
  vec2 uv = (u_depthUv * vec4(view, 0.0, 1.0)).xy;
  ivec2 size = textureSize(u_depth, 0);
  vec2 at = uv * vec2(size) - 0.5;
  ivec2 base = ivec2(floor(at));
  vec2 f = at - floor(at);
  float sum = 0.0;
  float weight = 0.0;
  for (int dy = 0; dy <= 1; dy++) {
    for (int dx = 0; dx <= 1; dx++) {
      float d = texelFetch(u_depth, clamp(base + ivec2(dx, dy), ivec2(0), size - 1), 0).r;
      float w = (dx == 1 ? f.x : 1.0 - f.x) * (dy == 1 ? f.y : 1.0 - f.y);
      if (d > 0.0) {
        sum += d * w;
        weight += w;
      }
    }
  }
  return weight > 0.0 ? sum / weight : 0.0;
}
void main() {
  float shown = 1.0;
  if (u_depthMode > 0) {
    float real = realDepth();
    // Up to 4 cm in front is the surface itself (the sensor's noise); 9 cm or more is a thing in front.
    if (real > 0.0) shown = smoothstep(-0.09, -0.04, real - v_depth);
  }
  if (shown <= 0.0) discard;
  vec3 colour = texture(u_tile, v_uv).rgb;
  colour = mix(colour, u_grout, groutAmount(v_local, v_size, v_joints, u_groutMm));
  // The room's light on this surface (1 where there's no estimate).
  colour *= u_light;
  outColor = vec4(colour * shown, shown);
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

/**
 * AR: a ring with a crosshair and a dot in the middle, in one colour over a dark edge so it shows
 * on white walls, premultiplied. The crosshair's lines are a pixel or two wide however far.
 */
export const RETICLE_FRAGMENT = `#version 300 es
precision highp float;
uniform vec3 u_colour;
in vec2 v_at;
out vec4 outColor;
float line(float across, float along) {
  float px = max(fwidth(across), 1e-6);
  return (1.0 - smoothstep(px, 2.0 * px, abs(across))) * step(0.22, abs(along)) * step(abs(along), 0.75);
}
void main() {
  float r = length(v_at);
  float aa = fwidth(r);
  float ring = smoothstep(0.86 - aa, 0.86, r) * (1.0 - smoothstep(0.97, 0.97 + aa, r));
  float halo = smoothstep(0.80 - aa, 0.80, r) * (1.0 - smoothstep(1.0 - aa, 1.0, r));
  float crosshair = max(line(v_at.y, v_at.x), line(v_at.x, v_at.y));
  float centre = 1.0 - smoothstep(0.06, 0.06 + aa, r);
  float mark = max(max(ring, crosshair), centre);
  // A thin dark edge outside the ring keeps it visible on light surfaces.
  float edge = max(halo - ring, 0.0) * 0.5;
  float alpha = max(mark * 0.95, edge);
  outColor = vec4(u_colour * mark * 0.95, alpha);
}
`;

/** AR pictures: the camera's picture as the background, filling the view. */
export const CAMERA_VERTEX = `#version 300 es
in vec2 a_corner;
out vec2 v_uv;
void main() {
  gl_Position = vec4(a_corner * 2.0 - 1.0, 0.0, 1.0);
  v_uv = a_corner;
}
`;

export const CAMERA_FRAGMENT = `#version 300 es
precision highp float;
uniform sampler2D u_camera;
in vec2 v_uv;
out vec4 outColor;
void main() {
  outColor = vec4(texture(u_camera, v_uv).rgb, 1.0);
}
`;
