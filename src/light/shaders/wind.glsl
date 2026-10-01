// Wind shared by every foliage layer. Gust fronts travel across the trees, so
// different parts respond at different moments; slow lulls come and go.
// Everything is a pure function of time and seed, so any frame can be
// reproduced exactly.

uniform float uTime;
uniform float uWindStrength;
uniform float uWindGust;
uniform float uWindSpeed;
uniform float uWindLull;
uniform float uWindDir;
uniform vec2 uWindAxis; //    direction gust fronts travel, in plane coordinates
uniform uint uWindSeed;
uniform vec3 uSwayAmp; //  limb, branch, twig
uniform vec3 uSwayFreq;
uniform vec3 uSwayLag;
uniform float uBendPow;
uniform float uFlutter;
// A weight on one branch (a bird standing on it): rest pivot, level, and the
// extra angle it bends by. A level below zero means no weight on this plane.
uniform vec4 uLoad;

float windLull(float t) {
  float n = vnoise(vec2(t * 0.019, 0.5), uWindSeed + 11u);
  float m = vnoise(vec2(t * 0.057, 7.5), uWindSeed + 12u);
  float l = smoothstep(0.18, 0.82, 0.7 * n + 0.3 * m);
  return mix(1.0, 0.22 + 0.98 * l, uWindLull);
}

// Gust strength at a point on a plane (metres) and time (seconds).
float windGust(vec2 q, float t) {
  vec2 across = vec2(-uWindAxis.y, uWindAxis.x);
  vec2 g = vec2(dot(q, uWindAxis) - uWindDir * uWindSpeed * t, dot(q, across) * 0.85) * 0.34;
  float n = 0.62 * vnoise(g, uWindSeed) + 0.38 * vnoise(g * 2.13 + 4.1, uWindSeed + 3u);
  float gust = smoothstep(0.34, 0.84, n);
  return uWindStrength * windLull(t) * mix(0.62, 0.3 + 1.15 * gust, uWindGust);
}

// Rotation of a branch about its base. `lean` carries the branch's
// orientation relative to the wind; the oscillation is scaled by the gust so
// branches settle in a lull.
float swayAngle(int level, vec2 pivot, float phase, float lean, float t) {
  float amp = uSwayAmp[level];
  float f = uSwayFreq[level];
  float g = windGust(pivot, t - uSwayLag[level]);
  float o = 0.62 * sin(TAU * f * t + phase) + 0.38 * sin(TAU * f * 1.618 * t + phase * 1.93 + 1.3);
  return amp * g * (0.7 * lean + 0.6 * o);
}

float bendAt(float s) {
  return pow(clamp(s, 0.0, 1.0), uBendPow);
}

vec2 rotateAbout(vec2 p, vec2 c, float a) {
  return c + rotate2(p - c, a);
}

// The weight's extra bend, for the branch at this level of a chain.
float loadAngle(int level, vec4 l) {
  return abs(uLoad.z - float(level)) < 0.5 && l.x == uLoad.x && l.y == uLoad.y ? uLoad.w : 0.0;
}

// Apply a branch hierarchy to a point: twig, then branch, then limb, each about
// its rest pivot. level.xy = pivot, level.z = where the chain attaches along
// that branch (0..1, or < 0 to use `sOwn`), level.w = lean (0 if absent).
vec2 applyHierarchy(vec2 p, vec4 l0, vec4 l1, vec4 l2, vec3 phases, float sOwn, float t) {
  if (l2.w != 0.0) {
    float s = l2.z < 0.0 ? sOwn : l2.z;
    p = rotateAbout(p, l2.xy, (swayAngle(2, l2.xy, phases.z, l2.w, t) + loadAngle(2, l2)) * bendAt(s));
  }
  if (l1.w != 0.0) {
    float s = l1.z < 0.0 ? sOwn : l1.z;
    p = rotateAbout(p, l1.xy, (swayAngle(1, l1.xy, phases.y, l1.w, t) + loadAngle(1, l1)) * bendAt(s));
  }
  if (l0.w != 0.0) {
    float s = l0.z < 0.0 ? sOwn : l0.z;
    p = rotateAbout(p, l0.xy, (swayAngle(0, l0.xy, phases.x, l0.w, t) + loadAngle(0, l0)) * bendAt(s));
  }
  return p;
}
