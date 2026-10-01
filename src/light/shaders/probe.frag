// A coarse map of where direct light reaches the paper, read back once when
// the bird comes, so it can choose a twig where its shadow will be seen.

in vec2 vUv;
out vec4 outColor;

uniform sampler2D uLight;
uniform float uLod;

void main() {
  vec3 E = textureLod(uLight, vUv, uLod).rgb;
  outColor = vec4(vec3(clamp(dot(E, vec3(1.0 / 3.0)), 0.0, 1.0)), 1.0);
}
