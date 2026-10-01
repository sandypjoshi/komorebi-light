#version 300 es
// Ink that soaks into and lifts out of the paper.
//
// The block's text exists three times: sharp, slightly blurred and very
// blurred. For every pixel a dissolve amount is found from the reasons text
// can dissolve (near the top or bottom of the view, lifted where the pointer
// passed, being written in). Noise fixed to the text makes that amount patchy, so a
// word goes a piece at a time; the same noise pushes the letters a little out
// of place. The amount then picks between the three copies and erodes the
// thinnest ink first, so letters break up and soften rather than turning grey.
precision highp float;

uniform sampler2D uSharp;
uniform sampler2D uLow;
uniform sampler2D uHigh;

uniform vec2 uOrigin;
uniform vec2 uSize;
uniform vec2 uViewport;
uniform float uEm;            // font size, CSS px (this page: up to settings.grainEm)
uniform float uSeed;
uniform vec3 uInk;

uniform vec2 uBands;          // top and bottom dissolving bands, fractions of the view height
uniform float uWrite;         // 1 while being written in, 0 when settled
uniform sampler2D uLift;      // where the pointer lifted ink off, 0..1, over the view
uniform vec2 uLiftSpan;       // the lift map's extent, CSS px

uniform float uDrift;         // how far letters move, in em, when fully dissolved
uniform float uLowGain;
uniform float uHighGain;
uniform float uErode;
uniform float uGamma;         // matches the page's lighter antialiasing

in vec2 vLocal;
out vec4 outColor;

// Gradient noise, -1..1 roughly.
vec2 hash2(vec2 p) {
  p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
  return -1.0 + 2.0 * fract(sin(p) * 43758.5453123);
}

float gnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  float a = dot(hash2(i), f);
  float b = dot(hash2(i + vec2(1.0, 0.0)), f - vec2(1.0, 0.0));
  float c = dot(hash2(i + vec2(0.0, 1.0)), f - vec2(0.0, 1.0));
  float d = dot(hash2(i + vec2(1.0, 1.0)), f - vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

// Fractal noise, 0..1.
float fbm(vec2 p) {
  float sum = 0.0;
  float amp = 0.5;
  mat2 turn = mat2(0.8, 0.6, -0.6, 0.8);
  for (int i = 0; i < 4; i++) {
    sum += amp * gnoise(p);
    p = turn * p * 2.03 + 17.1;
    amp *= 0.5;
  }
  return clamp(0.5 + sum * 1.1, 0.0, 1.0);
}

float coverage(sampler2D tex, vec2 local) {
  return texture(tex, local / uSize).r;
}

void main() {
  vec2 screen = uOrigin + vLocal;
  float y = screen.y / uViewport.y;

  // Reasons to dissolve, before noise.
  float top = 1.0 - y / max(uBands.x, 1e-3);
  float bottom = (y - 1.0 + uBands.y) / max(uBands.y, 1e-3);
  float edge = max(top, bottom);
  float lifted = texture(uLift, screen / uLiftSpan).r;

  // Clear of every reason: the sharp text, exactly.
  if (edge < -0.35 && lifted <= 0.002 && uWrite <= 0.0) {
    float a = pow(coverage(uSharp, vLocal), uGamma);
    outColor = vec4(uInk * a, a);
    return;
  }

  // Noise fixed to the text, so it travels with it.
  vec2 q = vLocal / (uEm * 7.0) + uSeed;
  vec3 n = vec3(fbm(q), fbm(q + vec2(5.2, 1.3)), fbm(q + vec2(-3.7, 8.1)));
  float grain = fbm(vLocal / (uEm * 1.4) + uSeed * 3.1 + 40.0);

  edge = clamp(edge + (n.b - 0.5) * 0.7, 0.0, 1.0);
  edge *= edge;
  float lift = clamp(lifted * 1.2 + (n.g - 0.5) * 0.6 * smoothstep(0.0, 0.25, lifted), 0.0, 1.0);
  float write = clamp(uWrite * (0.45 + 1.1 * n.r), 0.0, 1.0);

  float amount = max(max(edge, lift), write);
  amount = clamp(amount * (0.7 + 0.6 * grain), 0.0, 1.0);

  // Drift: letters move apart as they dissolve.
  vec2 drift = (n.rg - 0.5) * 2.0 * uDrift * uEm * amount * amount;
  vec2 at = vLocal - drift;

  float sharp = pow(coverage(uSharp, at), uGamma);
  float low = min(coverage(uLow, at) * uLowGain, 1.0);
  float high = min(coverage(uHigh, at) * uHighGain, 1.0);

  float wSharp = smoothstep(0.5, 0.0, amount);
  float wLow = smoothstep(0.5, 0.0, abs(amount - 0.5));
  float wHigh = smoothstep(0.5, 1.0, amount);
  float a = min(sharp * wSharp + low * wLow + high * wHigh, 1.0);

  // The thinnest ink goes first.
  float cut = amount * uErode * (0.55 + 0.9 * grain);
  a = clamp((a - cut) / max(1.0 - cut, 1e-3), 0.0, 1.0);
  a *= 1.0 - smoothstep(0.75, 1.0, amount);
  // (This page: written out past 1, every last trace goes, so words that change
  // and the screensaver leave the paper clean.)
  a *= 1.0 - smoothstep(1.0, 2.6, uWrite);

  outColor = vec4(uInk * a, a);
}
