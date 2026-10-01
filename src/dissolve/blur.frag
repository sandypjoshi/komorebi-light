#version 300 es
// One direction of a separable Gaussian. Run twice (across, then down) to blur
// the text's coverage into a softer copy.
precision highp float;

uniform sampler2D uSource;
uniform vec2 uStep;        // one target texel along the blur direction, in uv
uniform float uSigma;      // in target texels

in vec2 vUv;
out vec4 outColor;

void main() {
  int radius = int(ceil(uSigma * 3.0));
  float sum = 0.0;
  float weight = 0.0;
  for (int i = -48; i <= 48; i++) {
    if (i < -radius || i > radius) continue;
    float x = float(i);
    float w = exp(-0.5 * x * x / (uSigma * uSigma));
    sum += texture(uSource, vUv + uStep * x).r * w;
    weight += w;
  }
  outColor = vec4(sum / weight, 0.0, 0.0, 1.0);
}
