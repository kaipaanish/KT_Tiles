/** GLSL ES 3.00 shaders for the tiles on the photo. */

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
void main() {
  vec2 uv = (u_fragToUv * vec3(gl_FragCoord.xy, 1.0)).xy;
  float mask = texture(u_mask, uv).r;
  if (mask <= 0.0) discard;
  vec3 colour = texture(u_tile, v_uv).rgb;

  // Distance (mm) to the nearest joint edge of this tile; grout is centred on the joint.
  vec2 mm = v_local * v_size;
  vec2 rest = v_size - mm;
  float d = 1e6;
  if (v_joints.x > 0.5) d = min(d, mm.x);
  if (v_joints.y > 0.5) d = min(d, rest.x);
  if (v_joints.z > 0.5) d = min(d, mm.y);
  if (v_joints.w > 0.5) d = min(d, rest.y);
  float pixel = max(fwidth(d), 1e-4);
  // At least a pixel wide, as in the designer; thinner grout shows as a fainter line.
  float width = max(u_groutMm, pixel);
  float grout = 1.0 - smoothstep(0.5 * width - 0.5 * pixel, 0.5 * width + 0.5 * pixel, d);
  grout *= min(1.0, u_groutMm / pixel);
  colour = mix(colour, u_grout, grout);

  float shade = 2.0 * texture(u_shade, uv).r;
  colour *= mix(1.0, shade, u_light);
  outColor = vec4(colour * mask, mask);
}
`;
