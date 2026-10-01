// Direct sunlight arriving on the paper.
//
// The sun is a disc, not a point. For each point on the paper we integrate
// over that disc: every direction toward the sun passes the window (inner
// face, frame, outer face), then the visiting bird's plane when it is about,
// then three foliage planes. The window is solved analytically; the other
// planes are sampled with the same set of sun directions, so overlapping
// layers multiply correctly. The blur on each then follows its distance from
// the paper, and gaps in far foliage become round images of the sun.

in vec2 vUv;
out vec4 outColor;

uniform vec4 uView; //        paper view: centre x, y, width, height (m)
uniform vec4 uViewM; //       screen offset to paper: m00, m01, m10, m11
uniform vec3 uSun; //         unit vector toward the sun
uniform float uSunRadius; //  angular radius (rad)
uniform float uHaze; //       share of light in the aureole
uniform float uAureole; //    aureole radius, multiple of the sun's
uniform float uLimb;

uniform float uWinX;
uniform float uReveal;
uniform float uGlass;
uniform float uFrame;
uniform vec4 uWinRect; //     u0, u1, v0, v1
uniform vec2 uMullion; //     centre u, half width (0 = none)
uniform vec2 uTransom; //     centre v, half width (0 = none)

uniform sampler2D uLayer0;
uniform sampler2D uLayer1;
uniform sampler2D uFarBlur; //  far plane, already integrated over the sun's disc
uniform vec4 uRect0;
uniform vec4 uRect1;
uniform vec4 uRect2;
uniform vec3 uLayerX; //      plane position of each layer
uniform vec3 uTexel; //       metres per texel, each layer
uniform vec3 uLayerOn; //     1 if the layer is enabled
uniform vec3 uTau; //         leaf translucency, each layer
uniform vec3 uLeafTint;
uniform int uTaps;

// The bird: a plane through its body, moved with it every frame.
uniform sampler2D uBird;
uniform vec4 uBirdRect;
uniform float uBirdX;
uniform float uBirdTexel;
uniform float uBirdOn;

const int MAX_TAPS = 64;
const float GOLDEN = 2.39996323;

// Share of a disc on the positive side of a line at signed distance s, for a
// disc whose extent across the line is h.
float halfPlane(float s, float h) {
  float u = clamp(s / max(h, 1e-7), -1.0, 1.0);
  return 0.5 + (u * sqrt(max(0.0, 1.0 - u * u)) + asin(u)) / PI;
}

// Extent of the sun's footprint on a window-wall plane, across a u edge and a
// v edge. The footprint is an ellipse stretched along the light's in-plane
// direction by 1 / Lx.
vec2 footprint(float R, vec2 ax, float lx) {
  float ra = R / lx;
  float rb = R;
  vec2 bx = vec2(-ax.y, ax.x);
  float hu = sqrt(ra * ra * ax.x * ax.x + rb * rb * bx.x * bx.x);
  float hv = sqrt(ra * ra * ax.y * ax.y + rb * rb * bx.y * bx.y);
  return vec2(hu, hv);
}

float opening(vec2 hit, vec2 h, float inset) {
  return halfPlane(hit.x - (uWinRect.x + inset), h.x) *
         halfPlane((uWinRect.y - inset) - hit.x, h.x) *
         halfPlane(hit.y - (uWinRect.z + inset), h.y) *
         halfPlane((uWinRect.w - inset) - hit.y, h.y);
}

float bar(float coord, float centre, float halfW, float h) {
  if (halfW <= 0.0) return 0.0;
  return halfPlane(coord - (centre - halfW), h) - halfPlane(coord - (centre + halfW), h);
}

// Visibility of the sun through the window, for a sun of angular radius R.
float windowLight(vec2 P, vec3 L, vec2 ax, float radius) {
  float tIn = (uWinX - P.x) / L.x;
  if (tIn <= 0.0) return 0.0;
  vec2 hitIn = vec2(tIn * L.z, P.y + tIn * L.y);
  float w = opening(hitIn, footprint(tIn * radius, ax, L.x), 0.0);

  float tG = (uWinX + uGlass - P.x) / L.x;
  vec2 hitG = vec2(tG * L.z, P.y + tG * L.y);
  vec2 hG = footprint(tG * radius, ax, L.x);
  w *= opening(hitG, hG, uFrame);
  w *= 1.0 - bar(hitG.x, uMullion.x, uMullion.y, hG.x);
  w *= 1.0 - bar(hitG.y, uTransom.x, uTransom.y, hG.y);

  float tO = (uWinX + uReveal - P.x) / L.x;
  vec2 hitO = vec2(tO * L.z, P.y + tO * L.y);
  w *= opening(hitO, footprint(tO * radius, ax, L.x), 0.0);
  return clamp(w, 0.0, 1.0);
}

vec3 farLight(vec2 q, float lod) {
  vec2 uv = (q - uRect2.xy) / uRect2.zw;
  if (uLayerOn.z < 0.5 || uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return vec3(1.0);
  return textureLod(uFarBlur, uv, lod).rgb;
}

vec3 transmit(sampler2D tex, vec4 rect, vec2 q, float lod, float tau, float on) {
  vec2 uv = (q - rect.xy) / rect.zw;
  vec2 c = textureLod(tex, uv, lod).rg;
  float inside = step(0.0, uv.x) * step(uv.x, 1.0) * step(0.0, uv.y) * step(uv.y, 1.0);
  c *= inside * on;
  return (1.0 - c.g) * (1.0 - c.r + c.r * tau * uLeafTint);
}

float bird(vec2 q, float lod) {
  vec2 uv = (q - uBirdRect.xy) / uBirdRect.zw;
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return 1.0;
  return 1.0 - textureLod(uBird, uv, lod).r;
}

vec2 paperPoint(vec2 uv) {
  vec2 d = (uv - 0.5) * uView.zw;
  return uView.xy + vec2(uViewM.x * d.x + uViewM.y * d.y, uViewM.z * d.x + uViewM.w * d.y);
}

void main() {
  vec2 P = paperPoint(vUv);
  vec3 L = uSun;
  if (L.x <= 0.01 || L.z <= 0.0) {
    outColor = vec4(0.0);
    return;
  }
  vec2 ax = normalize(vec2(L.z, L.y));
  vec2 bx = vec2(-ax.y, ax.x);

  float W = windowLight(P, L, ax, uSunRadius);
  float Wh = uHaze > 0.0 ? windowLight(P, L, ax, uSunRadius * uAureole) : 0.0;
  if (max(W, Wh) < 1e-4) {
    outColor = vec4(0.0);
    return;
  }

  // Where the central ray meets each foliage plane, and how wide the sun's
  // footprint is there.
  vec3 t = (uLayerX - vec3(P.x)) / L.x;
  vec2 c0 = vec2(t.x * L.z, P.y + t.x * L.y);
  vec2 c1 = vec2(t.y * L.z, P.y + t.y * L.y);
  vec2 c2 = vec2(t.z * L.z, P.y + t.z * L.y);
  vec3 R = t * uSunRadius;
  float tB = (uBirdX - P.x) / L.x;
  vec2 c3 = vec2(tB * L.z, P.y + tB * L.y);
  float R3 = tB * uSunRadius;
  bool withBird = uBirdOn > 0.5;

  // Each tap reads a prefiltered texel footprint matched to the tap spacing,
  // so large discs stay smooth without per-pixel noise.
  float spacing = sqrt(PI / float(uTaps));
  vec3 lod = log2(max(vec3(1.0), (R / L.x) * spacing / uTexel)) + 0.35;
  float lod3 = log2(max(1.0, (R3 / L.x) * spacing / uBirdTexel)) + 0.35;

  vec3 acc = vec3(0.0);
  float wsum = 0.0;
  for (int k = 0; k < MAX_TAPS; k++) {
    if (k >= uTaps) break;
    float r = sqrt((float(k) + 0.5) / float(uTaps));
    float th = float(k) * GOLDEN;
    vec2 d = r * vec2(cos(th), sin(th));
    float w = 1.0 - uLimb * (1.0 - sqrt(max(0.0, 1.0 - r * r)));
    vec2 off = d.x * ax / L.x + d.y * bx;
    vec3 T = transmit(uLayer0, uRect0, c0 + off * R.x, lod.x, uTau.x, uLayerOn.x);
    T *= transmit(uLayer1, uRect1, c1 + off * R.y, lod.y, uTau.y, uLayerOn.y);
    if (withBird) T *= bird(c3 + off * R3, lod3);
    acc += w * T;
    wsum += w;
  }
  vec3 F = acc / wsum * farLight(c2, 0.0);

  // The aureole: a wider, fainter source around the sun, stronger in haze.
  vec3 lodH = log2(max(vec3(1.0), (R * uAureole / L.x) / uTexel)) + 0.5;
  vec3 Fh = transmit(uLayer0, uRect0, c0, lodH.x, uTau.x, uLayerOn.x) *
            transmit(uLayer1, uRect1, c1, lodH.y, uTau.y, uLayerOn.y) *
            (withBird ? bird(c3, lod3 + 1.5) : 1.0) *
            farLight(c2, 2.5);

  vec3 direct = (1.0 - uHaze) * W * F + uHaze * Wh * Fh;
  outColor = vec4(direct, W);
}
