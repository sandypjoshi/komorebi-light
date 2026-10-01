in vec2 vAlong;
in vec3 vSeg;
out vec4 outColor;

void main() {
  float len = vSeg.x;
  float h = clamp(vAlong.x / len, 0.0, 1.0);
  float r = mix(vSeg.y, vSeg.z, h);
  float d = length(vec2(vAlong.x - h * len, vAlong.y)) - r;
  float aa = fwidth(d) + 1e-5;
  float cov = 1.0 - smoothstep(-aa, aa, d);
  outColor = vec4(0.0, cov, 0.0, cov);
}
