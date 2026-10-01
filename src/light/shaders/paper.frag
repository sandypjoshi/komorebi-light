// The paper surface, rendered once per size and kept still: the light moves,
// the paper does not.
//
// Output: r = height in CSS px (stored as 0.5 + h / 4), g = fibre, b = fine
// grain, a = formation (cloudy density of the sheet). The composite pass
// lights the height with the scene's sun and sky, including the tooth's own
// small shadows, and turns fibre and formation into albedo.
//
// getRoughness() and getFiber() are copied from Paper Shaders' Paper Texture
// shader (@paper-design/shaders 0.0.81, Copyright 2026 Paper, Apache-2.0,
// https://shaders.paper.design). Change: here they feed a height field that is
// lit by the scene, instead of being mixed as flat colour.

in vec2 vUv;
out vec4 outColor;

uniform sampler2D u_noiseTexture;
uniform float u_roughnessSize;
uniform float u_roughnessRows;
uniform float u_fiberSize;

uniform vec2 uCss; //          canvas size in CSS px
uniform float uUnit; //        CSS px per Paper Shaders pattern unit
uniform float uToothSize; //   CSS px between pebbles
uniform float uToothDepth; //  height of the pebbles, CSS px
uniform float uElongation; //  length over width of a pebble
uniform float uGrainAngle; //  direction the felt ran, degrees on screen
uniform float uAlignment; //   how steadily the pebbles keep that direction
uniform float uSoftness; //    sharpness of the smooth maximum (higher = crisper valleys)
uniform float uWarp; //        irregularity
uniform float uDetail; //      smaller pebbles on the large ones
uniform float uGrit; //        fine unevenness, CSS px
uniform float uSeed;
uniform uint uSeedU;

// ---- Paper Shaders (Apache-2.0), unchanged ---------------------------------

float getRoughness(vec2 p, vec2 lightDir, vec2 seedShift, float basePixel) {
  vec2 u = p / vec2(2, 4);
  float w = 100. * basePixel;
  float eps = 4. * w;

  float size = mix(3.2, .8, u_roughnessSize);
  float logLac = log2(2.1);
  float level = -log2(w + 1e-8) / logLac;
  float baseLevel = floor(level) - 2.;
  float fade = fract(level);

  vec2 px = (u.x + vec2(eps, -eps)) * .1;
  float py = u.y * .1;

  vec2 sum = vec2(0.);
  float norm = 0., amp = .5;
  float freq = exp2(baseLevel * logLac);
  for (int i = 0; i < 4; i++) {
    float absIdx = baseLevel + float(i);
    vec2 qx = size * px * freq;
    float qy = size * py * freq;

    float wi = 1.;
    if (i == 0) wi = 1. - fade;
    if (i == 3) wi = fade;

    vec2 fx = fract(qx);
    float fy = fract(qy);
    vec2 shift = .5 + absIdx * .3 + seedShift;
    float uvY = floor(qy) / 50. + shift.y;
    vec2 s0a = textureLod(u_noiseTexture, fract(vec2(floor(qx.x) / 50. + shift.x, uvY)), 0.).rg;
    vec2 s1a = textureLod(u_noiseTexture, fract(vec2( ceil(qx.x) / 50. + shift.x, uvY)), 0.).rg;
    vec2 s0b = textureLod(u_noiseTexture, fract(vec2(floor(qx.y) / 50. + shift.x, uvY)), 0.).rg;
    vec2 s1b = textureLod(u_noiseTexture, fract(vec2( ceil(qx.y) / 50. + shift.x, uvY)), 0.).rg;
    vec2 ny0 = mix(vec2(s0a.r, s0b.r), vec2(s0a.g, s0b.g), fy);
    vec2 ny1 = mix(vec2(s1a.r, s1b.r), vec2(s1a.g, s1b.g), fy);
    vec2 n = mix(ny0, ny1, fx);

    sum += amp * wi * n;
    norm += amp * wi;
    amp *= .8;
    freq *= 2.1;
  }

  vec2 r = sum / norm;
  float dx = .5 + r.x - r.y;
  float grain = 3. * dx * dx - .7;

  float rowBand = fract(dot(p, lightDir) * .05 * size);
  return grain + .6 * u_roughnessRows * (rowBand - .5);
}

float getFiber(vec2 p, vec2 seedShift, float basePixel) {
  float size = mix(4., 1., u_fiberSize);
  float w = 50. * basePixel;
  float level = -log2(w + 1e-8);
  float baseLevel = floor(level) - 3.;
  float fade = fract(level);

  vec2 grad = vec2(0.);
  float scale = 1.;
  float amp = 1.;
  float freq = pow(1.7, baseLevel);
  for (int i = 0; i < 5; i++) {
    float absIdx = baseLevel + float(i);
    vec2 q = size * p * freq;

    float an = absIdx * .8;
    float rc = cos(an), rs = sin(an);
    q = vec2(rc * q.x - rs * q.y, rs * q.x + rc * q.y);

    float wi = 1.;
    if (i == 0) wi = 1. - fade;
    if (i == 4) wi = fade;

    vec2 iq = floor(q);
    vec2 fq = fract(q);
    float shift = absIdx * .3;
    vec4 uv = fract(vec4(iq, iq + 1.) / 50. + .5 + shift + seedShift.xyxy);
    float aF = textureLod(u_noiseTexture, uv.xy, 0.).b;
    float bF = textureLod(u_noiseTexture, uv.zy, 0.).b;
    float cF = textureLod(u_noiseTexture, uv.xw, 0.).b;
    float dF = textureLod(u_noiseTexture, uv.zw, 0.).b;
    vec2 u = fq * fq * (3. - 2. * fq);
    vec2 du = 8. * fq * (1. - fq);
    float dx = du.x * mix(bF - aF, dF - cF, u.y);
    float dy = du.y * mix(cF - aF, dF - bF, u.x);
    grad += wi * amp * scale * vec2(rc * dx + rs * dy, -rs * dx + rc * dy);
    scale *= 1.7;
    amp *= .5;
    freq *= 1.7;
  }

  return clamp(.333 * length(grad), 0., 1.);
}

// ---- This study ------------------------------------------------------------

// Cold-press tooth is the imprint of the felt the sheet was pressed against:
// small rounded pebbles, about a millimetre and a half apart, a little longer in
// the direction the felt ran. Each pebble is a rounded dome of its own height;
// a smooth maximum joins neighbours, so valleys are soft and there is no network
// of lines. Sizes and directions were matched to the owner's cold-press reference
// by comparing power spectra.
float pebbles(vec2 p, uint seed, float sharpness) {
  ivec2 ip = ivec2(floor(p));
  vec2 fp = p - floor(p);
  float acc = 0.0;
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      ivec2 c = ip + ivec2(i, j);
      vec4 r = hashF4(c, seed);
      vec2 d = vec2(i, j) + 0.5 + 0.92 * (r.xy - 0.5) - fp;
      float size = 0.72 + 0.36 * r.z;
      float dome = (0.62 + 0.38 * r.w) - dot(d, d) / (size * size);
      acc += exp(sharpness * dome);
    }
  }
  return log(acc) / sharpness;
}

float toothHeight(vec2 css) {
  // The felt's direction, with a slow drift across the sheet.
  float drift = (fbm(css / (uToothSize * 40.0), uSeedU + 71u, 2, 2.0, 0.5) - 0.5) * (1.0 - uAlignment) * 3.0;
  float th = radians(uGrainAngle) + drift;
  mat2 rot = mat2(cos(th), sin(th), -sin(th), cos(th));
  vec2 q = rot * (css / uToothSize);
  vec2 w = vec2(vnoise(q * 0.3, uSeedU + 61u), vnoise(q * 0.3 + 7.7, uSeedU + 62u)) - 0.5;
  q += uWarp * 2.0 * w;
  // Large pebbles lie along the felt; the small grains on them hardly do.
  float big = pebbles(vec2(q.x / uElongation, q.y), uSeedU + 3u, uSoftness);
  float small = pebbles(vec2(q.x / sqrt(uElongation), q.y) * 2.03 + 13.7, uSeedU + 17u, uSoftness * 0.8);
  // The depth of the tooth drifts across the sheet.
  float depth = 0.85 + 0.3 * fbm(css / (uToothSize * 13.0), uSeedU + 21u, 3, 2.0, 0.5);
  float grit = fbm(css / max(uToothSize * 0.3, 0.6), uSeedU + 9u, 2, 2.1, 0.5) - 0.5;
  return uToothDepth * depth * (big + uDetail * small) + 2.0 * uGrit * grit;
}

// Formation: how evenly the fibres settled, seen as faint clouds.
float formation(vec2 css) {
  float a = fbm(css / 150.0, uSeedU + 31u, 4, 2.03, 0.52);
  float b = fbm(css / 42.0, uSeedU + 47u, 3, 2.1, 0.5);
  return 0.7 * a + 0.3 * b;
}

void main() {
  vec2 css = vUv * uCss;
  vec2 patternUV = css / uUnit;
  float basePixel = max(length(dFdx(patternUV)), length(dFdy(patternUV)));
  vec2 seedShift = floor(fract(uSeed * vec2(.7548776662, .5698402909)) * 50.) / 50.;

  float grain = getRoughness(1000. * patternUV, vec2(0.0, -1.0), seedShift, basePixel);
  float fiber = getFiber(50. * patternUV, seedShift, basePixel);

  outColor = vec4(0.5 + 0.25 * toothHeight(css), fiber, grain, formation(css));
}
