// A visitor as the light sees it, on a plane through its body: for each point
// of the plane, whether the line through it toward the light meets the
// visitor. It arrives already projected along the light (visit.js) as flat
// shapes: ellipses for bodies, heads and most wings, round cones for a bill or
// legs, rounded quads for a tail or a forewing. Here they are joined softly,
// the way feathers and fur join; a shape that lets light through (a bee's
// wing) dims what lies behind it instead. All of it is averaged over a few
// moments within the frame, so fast wings and a fast flight blur as they do
// to the eye.

in vec2 vUv;
out vec4 outColor;

uniform sampler2D uPrims; // three texels per shape; one row per moment; bounds last
uniform int uMoments;
uniform vec4 uRect; //      plane region drawn: u0, v0, du, dv (m)
uniform float uPlaneX;
uniform vec3 uOrigin; //    world point the 2D shapes are measured from
uniform vec3 uE1; //        2D basis across the sun's rays
uniform vec3 uE2;
uniform float uAA; //       edge softness, metres
uniform float uOpacity; //  thins the far ends of its flights

const int MAX_PRIMS = 16;
const int MAX_MOMENTS = 4;

float smin(float a, float b, float k) {
  float h = max(k - abs(a - b), 0.0) / k;
  return min(a, b) - h * h * k * 0.25;
}

// Distance to an ellipse, first-order estimate (good near the edge, which is
// all that matters here, even for a wing seen edge-on).
float sdEllipse(vec2 p, vec2 r) {
  float k0 = length(p / r);
  if (k0 < 1e-5) return -min(r.x, r.y);
  float k1 = length(p / (r * r));
  return k0 * (k0 - 1.0) / k1;
}

float sdCone(vec2 p, vec2 a, vec2 b, float ra, float rb) {
  vec2 pa = p - a;
  vec2 ba = b - a;
  float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-12), 0.0, 1.0);
  return length(pa - ba * h) - mix(ra, rb, h);
}

float sdQuad(vec2 p, vec2 v0, vec2 v1, vec2 v2, vec2 v3) {
  vec2 v[4] = vec2[4](v0, v1, v2, v3);
  float d = dot(p - v[0], p - v[0]);
  float s = 1.0;
  for (int i = 0, j = 3; i < 4; j = i, i++) {
    vec2 e = v[j] - v[i];
    vec2 w = p - v[i];
    vec2 b = w - e * clamp(dot(w, e) / max(dot(e, e), 1e-12), 0.0, 1.0);
    d = min(d, dot(b, b));
    bvec3 c = bvec3(p.y >= v[i].y, p.y < v[j].y, e.x * w.y > e.y * w.x);
    if (all(c) || all(not(c))) s = -s;
  }
  return s * sqrt(d);
}

void main() {
  vec2 q = uRect.xy + vUv * uRect.zw;
  vec3 W = vec3(uPlaneX, q.y, q.x) - uOrigin;
  vec2 p = vec2(dot(W, uE1), dot(W, uE2));
  float acc = 0.0;
  for (int m = 0; m < MAX_MOMENTS; m++) {
    if (m >= uMoments) break;
    vec4 bound = texelFetch(uPrims, ivec2(3 * MAX_PRIMS, m), 0);
    if (length(p - bound.xy) > bound.z) continue;
    int count = int(bound.w + 0.5);
    float d = 1e3;
    float clear = 1.0; // light let through by translucent shapes
    for (int i = 0; i < MAX_PRIMS; i++) {
      if (i >= count) break;
      vec4 a = texelFetch(uPrims, ivec2(3 * i, m), 0);
      vec4 b = texelFetch(uPrims, ivec2(3 * i + 1, m), 0);
      vec4 c = texelFetch(uPrims, ivec2(3 * i + 2, m), 0);
      float di;
      if (c.x < 0.5) {
        vec2 o = p - a.xy;
        di = sdEllipse(vec2(b.x * o.x + b.y * o.y, -b.y * o.x + b.x * o.y), a.zw);
      } else if (c.x < 1.5) {
        di = sdCone(p, a.xy, a.zw, b.x, b.y);
      } else {
        di = sdQuad(p, a.xy, a.zw, b.xy, b.zw) - c.w;
      }
      if (c.z > 0.0) {
        clear *= 1.0 - (1.0 - c.z) * (1.0 - smoothstep(-uAA, uAA, di));
        continue;
      }
      d = c.y > 0.0 ? smin(d, di, c.y) : min(d, di);
    }
    acc += 1.0 - smoothstep(-uAA, uAA, d) * clear;
  }
  outColor = vec4(acc / float(uMoments) * uOpacity);
}
