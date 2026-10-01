// Convolves the far canopy with the sun's disc, once per frame, in the far
// plane's own coordinates. Every opening becomes a small image of the sun;
// overlapping openings add up into pools of overlapping discs.
//
// The far plane is distant enough that the sun's footprint barely changes
// across the paper, so one representative size is used. Near planes vary much
// more and are integrated per pixel in the light pass instead.

in vec2 vUv;
out vec4 outColor;

uniform sampler2D uSrc;
uniform vec4 uRect; //     far plane rect, metres
uniform vec2 uAxis; //     light's in-plane direction (u, v)
uniform float uRa; //      footprint semi-axis along uAxis (m)
uniform float uRb; //      footprint semi-axis across (m)
uniform float uTexel; //   metres per texel
uniform float uTau;
uniform vec3 uLeafTint;
uniform float uLimb;
uniform int uTaps;

const int MAX_TAPS = 192;
const float GOLDEN = 2.39996323;

void main() {
  vec2 ax = uAxis;
  vec2 bx = vec2(-ax.y, ax.x);
  float spacing = sqrt(PI / float(uTaps));
  float lod = max(0.0, log2(max(1.0, uRa * spacing / uTexel)) - 0.25);
  vec3 acc = vec3(0.0);
  float wsum = 0.0;
  for (int k = 0; k < MAX_TAPS; k++) {
    if (k >= uTaps) break;
    float r = sqrt((float(k) + 0.5) / float(uTaps));
    float th = float(k) * GOLDEN;
    vec2 d = r * vec2(cos(th), sin(th));
    float w = 1.0 - uLimb * (1.0 - sqrt(max(0.0, 1.0 - r * r)));
    vec2 off = (d.x * uRa * ax + d.y * uRb * bx) / uRect.zw;
    vec2 c = textureLod(uSrc, vUv + off, lod).rg;
    acc += w * (1.0 - c.g) * (1.0 - c.r + c.r * uTau * uLeafTint);
    wsum += w;
  }
  outColor = vec4(acc / wsum, 1.0);
}
