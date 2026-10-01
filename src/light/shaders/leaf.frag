// Leaf silhouette: an ovate blade with a pointed tip and a short stalk.

in vec2 vLocal;
in vec2 vShape;
out vec4 outColor;

void main() {
  float y = vLocal.y;
  float x = vLocal.x;

  // Half-width profile, widest a little below the middle.
  float a = 0.6 + 0.12 * vShape.x;
  float b = 0.95 + 0.55 * vShape.x;
  float yy = clamp(y, 0.0, 1.0);
  float prof = pow(yy, a) * pow(1.0 - yy, b);
  float peak = pow(a / (a + b), a) * pow(b / (a + b), b);
  float halfWidth = 0.5 * prof / peak;
  float blade = abs(x) - halfWidth;

  float stalk = y < 0.02 ? abs(x) - 0.028 : 1.0;
  float d = min(blade, stalk);
  float aa = fwidth(d) + 1e-4;
  float cov = 1.0 - smoothstep(-aa, aa, d);
  cov *= smoothstep(-0.165, -0.14, y) * (1.0 - smoothstep(0.995, 1.0, y));

  outColor = vec4(cov, 0.0, 0.0, cov);
}
