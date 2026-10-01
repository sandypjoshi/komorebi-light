// Leaves of a foliage plane, drawn as coverage into that plane's texture.
// Each leaf hangs from a twig, which hangs from a branch and a limb, so wind
// moves it through the whole chain and nothing comes apart.

in vec3 position; //  quad: x across the blade (-0.5..0.5), y along it (-0.16..1)
in vec4 aL0;
in vec4 aL1;
in vec4 aL2;
in vec4 aPhase; //    limb, branch, twig, leaf
in vec4 aLeaf; //     attach.xy, rest angle, length
in vec4 aLeaf2; //    width, shape, flutter amount, flutter rate

uniform vec4 uRect; // plane region drawn: min.xy, size.xy

out vec2 vLocal;
out vec2 vShape;

void main() {
  float t = uTime;
  vec2 attach = aLeaf.xy;

  // A leaf turning on its stalk shows the sun its edge: the silhouette narrows
  // and the gap beside it opens.
  float g = windGust(attach, t - uSwayLag.z - 0.12);
  float rate = aLeaf2.w;
  float turn = uFlutter * aLeaf2.z * g *
    (0.7 * sin(TAU * rate * t + aPhase.w) + 0.3 * sin(TAU * rate * 2.37 * t + aPhase.w * 1.7 + 0.4));
  float foreshorten = max(0.16, abs(cos(turn)));
  float angle = aLeaf.z + 0.2 * turn;

  vec2 local = vec2(position.x * aLeaf2.x * foreshorten, position.y * aLeaf.w);
  vec2 axis = vec2(cos(angle), sin(angle));
  vec2 side = vec2(-axis.y, axis.x);
  vec2 p = attach + axis * local.y + side * local.x;

  p = applyHierarchy(p, aL0, aL1, aL2, aPhase.xyz, 0.0, t);

  vec2 clip = (p - uRect.xy) / uRect.zw * 2.0 - 1.0;
  gl_Position = vec4(clip, 0.0, 1.0);
  vLocal = position.xy;
  vShape = vec2(aLeaf2.y, foreshorten);
}
