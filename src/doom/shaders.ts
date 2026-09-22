export const CRT_CURVE_RATE = 0.035;
export const CRT_CURVE_LIMIT = 24;

export const VERTEX_SHADER_SOURCE = `
attribute vec2 a_position;
varying vec2 v_uv;

void main() {
  v_uv = a_position * 0.5 + 0.5;
  gl_Position = vec4(a_position, 0.0, 1.0);
}
`;

export const FRAGMENT_SHADER_SOURCE = `
precision mediump float;

uniform sampler2D u_frame;
uniform vec2 u_textureSize;
uniform vec2 u_curve;
uniform vec2 u_screenSize;
uniform vec2 u_effects;
varying vec2 v_uv;

vec3 highlights(vec3 color) {
  return max(color * 1.5 - 0.35, 0.0);
}

void main() {
  vec2 centered = v_uv * 2.0 - 1.0;
  vec2 curved = centered;
  curved.x += u_curve.x * centered.x *
    (0.7 * centered.y * centered.y + 0.3 * centered.x * centered.x);
  curved.y += u_curve.y * centered.y *
    (0.7 * centered.x * centered.x + 0.3 * centered.y * centered.y);
  vec2 uv = curved * 0.5 + 0.5;

  if (any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)))) {
    discard;
  }

  vec2 texel = 1.0 / u_textureSize;
  vec3 color = texture2D(u_frame, uv).bgr;
  vec3 bloom =
    highlights(texture2D(u_frame, uv + vec2(texel.x, 0.0)).bgr) +
    highlights(texture2D(u_frame, uv - vec2(texel.x, 0.0)).bgr) +
    highlights(texture2D(u_frame, uv + vec2(0.0, texel.y)).bgr) +
    highlights(texture2D(u_frame, uv - vec2(0.0, texel.y)).bgr);

  color += bloom * 0.075;

  if (u_effects.x > 0.5) {
    vec2 pixel = vec2(uv.x, 1.0 - uv.y) * u_screenSize;
    float scanline = max(0.0, 1.0 - abs(mod(pixel.y, 4.0) - 3.0));
    color *= 1.0 - scanline * 0.28;
    float triad = mod(pixel.x, 3.0);
    if (triad < 1.0) color = mix(color, vec3(0.396, 0.729, 1.0), 0.008);
    else if (triad < 2.0) color = mix(color, vec3(0.439, 0.859, 0.675), 0.008);
    float radius = length((uv - 0.5) * 1.41421356);
    color *= 1.0 - smoothstep(0.48, 1.0, radius) * 0.34;
    vec2 edge = min(uv, 1.0 - uv) * u_screenSize;
    color *= 1.0 - (1.0 - smoothstep(0.0, 38.0, min(edge.x, edge.y))) * 0.24;
    float bandHeight = ceil(u_screenSize.y * 0.14 / 12.0) * 12.0;
    float bandY = (pixel.y - u_effects.y) / bandHeight;
    float band = 0.0;
    if (bandY >= 0.0 && bandY < 0.45) band = mix(0.0, 0.008, bandY / 0.45);
    else if (bandY < 0.85 && bandY >= 0.45) band = mix(0.008, 0.025, (bandY - 0.45) / 0.4);
    else if (bandY <= 1.0 && bandY >= 0.85) band = mix(0.025, 0.0, (bandY - 0.85) / 0.15);
    band *= mod(pixel.y, 4.0) < 2.0 ? 1.0 : 0.4;
    color = mix(color, vec3(0.824, 0.922, 1.0), band);
  }

  gl_FragColor = vec4(color, 1.0);
}
`;
