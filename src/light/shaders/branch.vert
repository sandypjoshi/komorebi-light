// Branch segments as tapered capsules. Both ends go through the same
// hierarchy as the leaves, so segments stay joined while the branch bends.

in vec3 position; //  quad: x across (-1..1), y along (0..1)
in vec4 aSeg; //      rest endpoints A.xy, B.xy
in vec4 aSegW; //     radius at A, radius at B, arc position of A and B on the branch
in vec4 aL0;
in vec4 aL1;
in vec4 aL2;
in vec4 aPhase;

uniform vec4 uRect;

out vec2 vAlong; //   distance along the segment, distance across
out vec3 vSeg; //     segment length, radius at A, radius at B

void main() {
  float t = uTime;
  vec2 A = applyHierarchy(aSeg.xy, aL0, aL1, aL2, aPhase.xyz, aSegW.z, t);
  vec2 B = applyHierarchy(aSeg.zw, aL0, aL1, aL2, aPhase.xyz, aSegW.w, t);
  vec2 d = B - A;
  float len = max(length(d), 1e-5);
  vec2 dir = d / len;
  vec2 nrm = vec2(-dir.y, dir.x);
  float r = max(aSegW.x, aSegW.y) * 1.05 + 0.002;

  float along = mix(-r, len + r, position.y);
  float across = position.x * r;
  vec2 p = A + dir * along + nrm * across;

  vec2 clip = (p - uRect.xy) / uRect.zw * 2.0 - 1.0;
  gl_Position = vec4(clip, 0.0, 1.0);
  vAlong = vec2(along, across);
  vSeg = vec3(len, aSegW.x, aSegW.y);
}
