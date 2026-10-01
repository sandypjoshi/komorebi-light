#version 300 es
// The text is drawn several times larger than it is shown, then averaged down
// exactly, box by box. macOS fattens canvas glyphs by a fixed fraction of a
// pixel; at the larger size that fattening all but disappears, so the ink
// matches the page's own text.
precision highp float;

uniform sampler2D uSource;
uniform int uFactor;

out vec4 outColor;

void main() {
  ivec2 base = ivec2(gl_FragCoord.xy) * uFactor;
  float sum = 0.0;
  for (int y = 0; y < 8; y++) {
    if (y >= uFactor) break;
    for (int x = 0; x < 8; x++) {
      if (x >= uFactor) break;
      sum += texelFetch(uSource, base + ivec2(x, y), 0).a;
    }
  }
  outColor = vec4(sum / float(uFactor * uFactor), 0.0, 0.0, 1.0);
}
