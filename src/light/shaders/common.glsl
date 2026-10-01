// Shared helpers: constants, integer hashing and value noise.

#define PI 3.14159265358979
#define TAU 6.28318530717959

uint pcgHash(uint v) {
  uint state = v * 747796405u + 2891336453u;
  uint word = ((state >> ((state >> 28u) + 4u)) ^ state) * 277803737u;
  return (word >> 22u) ^ word;
}

uint hashCell(ivec2 p, uint s) {
  return pcgHash(uint(p.x) ^ pcgHash(uint(p.y) ^ pcgHash(s)));
}

float hashF(ivec2 p, uint s) {
  return float(hashCell(p, s)) * (1.0 / 4294967296.0);
}

vec2 hashF2(ivec2 p, uint s) {
  uint h = hashCell(p, s);
  return vec2(float(h), float(pcgHash(h))) * (1.0 / 4294967296.0);
}

vec4 hashF4(ivec2 p, uint s) {
  uint a = hashCell(p, s);
  uint b = pcgHash(a);
  uint c = pcgHash(b);
  uint d = pcgHash(c);
  return vec4(float(a), float(b), float(c), float(d)) * (1.0 / 4294967296.0);
}

// Value noise with quintic interpolation, range 0..1.
float vnoise(vec2 p, uint s) {
  vec2 i = floor(p);
  vec2 f = p - i;
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  ivec2 c = ivec2(i);
  float a = hashF(c, s);
  float b = hashF(c + ivec2(1, 0), s);
  float d = hashF(c + ivec2(0, 1), s);
  float e = hashF(c + ivec2(1, 1), s);
  return mix(mix(a, b, u.x), mix(d, e, u.x), u.y);
}

float fbm(vec2 p, uint s, int octaves, float lacunarity, float gain) {
  float sum = 0.0;
  float amp = 0.5;
  float norm = 0.0;
  for (int i = 0; i < 8; i++) {
    if (i >= octaves) break;
    sum += amp * vnoise(p, s + uint(i) * 101u);
    norm += amp;
    p = mat2(0.8, 0.6, -0.6, 0.8) * p * lacunarity + 17.13;
    amp *= gain;
  }
  return sum / norm;
}

vec2 rotate2(vec2 p, float a) {
  float c = cos(a);
  float s = sin(a);
  return vec2(c * p.x - s * p.y, s * p.x + c * p.y);
}
