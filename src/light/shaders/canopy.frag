// The far tree, drawn procedurally as the openings in a dense crown.
//
// At this distance the sun's disc is wider than most openings, so each
// opening projects its own small image of the sun onto the paper: dapples are
// round, and their brightness follows the opening's area. What matters here is
// the structure of openings: compact holes of varied size, gathered into
// brighter pools where the crown thins, with big limbs across. Gusts move
// groups of holes together; leaves turning in the wind widen and close them.

in vec2 vUv;
out vec4 outColor;

uniform vec4 uRect;
uniform vec4 uCrown; //      centre u, v, radius u, v
uniform vec4 uCrown2; //     a second, lower tree
uniform float uLeafSize; //  mean opening radius (m)
uniform float uCluster; //   spacing of openings (m)
uniform float uDensity; //   share of cells with an opening
uniform float uGaps; //      how strongly the crown thins into pools
uniform float uFarSway;
uniform float uFarLag;
uniform uint uSeed;

// Distance-like measure inside a lobed crown: > 1 outside, 0 at the centre.
float crownRadius(vec2 q, vec4 crown, uint salt) {
  vec2 d = (q - crown.xy) / max(crown.zw, vec2(1e-3));
  float lobes = 0.2 * (fbm(q * 0.85, uSeed + salt, 3, 2.1, 0.5) - 0.5) +
                0.1 * (vnoise(q * 3.1, uSeed + salt + 7u) - 0.5);
  return length(d) - lobes;
}

float crownR(vec2 q) {
  return min(crownRadius(q, uCrown, 41u), crownRadius(q, uCrown2, 43u));
}

// Where the crown is thin, openings are more common and larger; the crown
// thins toward its edge, so the edge is made of openings, not a fade.
float thinness(vec2 q, float r) {
  float a = fbm(q / 0.9, uSeed + 5u, 3, 2.07, 0.5);
  float b = vnoise(q / 2.6, uSeed + 9u);
  float edge = smoothstep(0.62, 1.0, r);
  return clamp(0.62 * a + 0.38 * b + 0.75 * edge, 0.0, 1.0);
}

float openings(vec2 q, float t, float thin, float px) {
  vec2 p = q / uCluster;
  ivec2 ip = ivec2(floor(p));
  float open = 0.0;
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      ivec2 c = ip + ivec2(i, j);
      vec4 h = hashF4(c, uSeed + 17u);
      float chance = uDensity * mix(1.0 - uGaps, 1.0, smoothstep(0.2, 0.75, thin));
      if (h.w > chance) continue;
      vec2 centre = (vec2(c) + 0.2 + 0.6 * h.xy) * uCluster;

      // Leaves at the rim turn in the wind; an opening breathes with them.
      float g = windGust(centre, t);
      float rate = 1.6 + 2.2 * fract(h.z * 5.31);
      float turn = uFlutter * g * sin(TAU * rate * t + h.z * TAU);
      float breathe = 0.72 + 0.42 * (1.0 - abs(cos(turn)));

      float size = uLeafSize * mix(0.5, 1.3, h.x) * mix(0.8, 1.25, thin) * breathe;
      // Two overlapping lobes keep large openings irregular.
      vec4 k = hashF4(c, uSeed + 29u);
      vec2 lobe = (k.xy - 0.5) * size * 1.1;
      float d1 = length(q - centre) - size;
      float d2 = length(q - centre - lobe) - size * mix(0.45, 0.85, k.z);
      float d = min(d1, d2);
      open = max(open, 1.0 - smoothstep(-px, px, d));
    }
  }
  return open;
}

// A few big limbs, so the canopy has structure as well as openings.
float limbs(vec2 q) {
  float cov = 0.0;
  for (int i = 0; i < 4; i++) {
    vec4 h = hashF4(ivec2(i, 3), uSeed + 71u);
    vec4 cr = i < 3 ? uCrown : uCrown2;
    vec2 a = cr.xy + (h.xy - 0.5) * cr.zw * 0.9;
    float ang = h.z * TAU;
    vec2 b = a + vec2(cos(ang), sin(ang)) * (1.6 + 1.8 * h.w);
    vec2 pa = q - a;
    vec2 ba = b - a;
    float s = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
    float r = mix(0.07, 0.025, s);
    float d = length(pa - ba * s) - r;
    float aa = fwidth(d) + 1e-4;
    cov = max(cov, 1.0 - smoothstep(-aa, aa, d));
  }
  return cov;
}

void main() {
  vec2 q = uRect.xy + vUv * uRect.zw;
  float t = uTime - uFarLag;

  // Groups of openings sway together.
  float gs = windGust(q, t);
  vec2 ph = vec2(vnoise(q * 0.45, uSeed + 1u), vnoise(q * 0.45 + 3.1, uSeed + 2u)) * TAU;
  vec2 across = vec2(-uWindAxis.y, uWindAxis.x);
  vec2 sway = uFarSway * gs * (uWindAxis * sin(TAU * 0.19 * t + ph.x) + across * 0.55 * sin(TAU * 0.23 * t + ph.y));
  vec2 qs = q - sway;

  // Anti-aliasing width from the texel size, not from derivatives, which
  // jump where neighbouring pixels read different cells.
  float px = 0.75 * length(fwidth(q));
  float r = crownR(qs);
  float crown = 1.0 - smoothstep(1.0 - px * 4.0, 1.0 + px * 4.0, r);
  float thin = thinness(qs, r);
  float open = crown > 0.001 ? openings(qs, t, thin, px) : 1.0;
  float leaf = crown * (1.0 - open);
  float limb = limbs(qs) * step(r, 1.05);

  outColor = vec4(leaf, limb, 0.0, 1.0);
}
