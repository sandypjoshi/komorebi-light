// Lights the paper. Direct sun and ambient light are separate contributions:
// sun through the window and leaves, sky light through the window opening,
// light from the room, and sunlight bounced off the lit patch. The paper's
// relief is shaded by each, so its tooth rises where sunlight grazes it, casts
// its own tiny shadows when the sun is low, and settles in the shade.

in vec2 vUv;
out vec4 outColor;

uniform sampler2D uLight;
uniform sampler2D uPaper;
uniform vec2 uPaperTexel;
uniform vec2 uCssSize; //    canvas in CSS px
uniform float uCssPerPx; //  CSS px per paper texel
uniform vec4 uView; //      centre x, y, width, height
uniform vec4 uViewM; //     screen offset to paper (m00, m01, m10, m11); paper to screen is its transpose

uniform vec3 uSun;
uniform vec3 uSunColor;
uniform float uSunIntensity;
uniform vec3 uSkyColor;
uniform float uSkyIntensity;
uniform float uSkyOcclusion;
uniform vec3 uRoomColor;
uniform float uRoomIntensity;
uniform float uBounce;
uniform float uScatter;

uniform vec3 uPaperColor;
uniform float uGrainDepth; //  CSS px
uniform float uFiberDepth; //  CSS px
uniform float uToothDepth; //  CSS px
uniform float uToothSize; //   CSS px
uniform float uRelief;
uniform float uTranslucency;
uniform float uSkyRelief;
uniform int uShadowSteps;
uniform float uFormation;
uniform float uFiberTone;
uniform float uAO;
uniform float uCockle; //    gentle waviness of the sheet, catching grazing light
uniform float uCockleScale;

uniform float uExposure;
uniform float uShoulder; //  where highlights begin to roll off
uniform float uShoulderWidth; // how gradually: about equal steps for equal ratios of light
uniform float uFill; //      scale on the light that fills the shade (sky, room, bounce)
uniform float uWinX;
uniform vec4 uWinRect;
uniform int uDebug;
uniform sampler2D uDebugTex;
uniform vec3 uLabLight; //   paper lab (debug 12): one light in screen space

// Height of the paper in CSS px: tooth, plus Paper Shaders' grain and fibre.
float heightAt(vec4 p) {
  return 4.0 * (p.r - 0.5) + uGrainDepth * clamp(p.b, -0.7, 1.6) + uFiberDepth * p.g;
}

float heightAt(vec2 uv) {
  return heightAt(textureLod(uPaper, uv, 0.0));
}

// The tooth's own shadows. Walk from the point toward the sun across the
// height field: where the paper ahead rises above the sun's elevation, the
// point is shaded. Returns 0 (lit) to 1 (in the tooth's shadow).
float toothShadow(vec2 uv, float h0, vec3 L) {
  float lxy = length(L.xy);
  if (uShadowSteps <= 0 || lxy < 1e-4) return 0.0;
  vec2 w = L.xy / lxy;
  // Paper (world) direction to screen.
  vec2 dir = vec2(uViewM.x * w.x + uViewM.z * w.y, uViewM.y * w.x + uViewM.w * w.y);
  vec2 duv = dir / uCssSize;
  float tanE = L.z / lxy;
  // The walk reaches a little under one pillow, whatever the step count.
  float stepCss = 0.9 * uToothSize / float(uShadowSteps);
  float rise = -1e3;
  for (int k = 1; k <= 8; k++) {
    if (k > uShadowSteps) break;
    float d = float(k) * stepCss;
    rise = max(rise, (heightAt(uv + duv * d) - h0) / d);
  }
  return smoothstep(tanE - 0.04, tanE + 0.24, rise * uRelief);
}

// A sheet of paper is never perfectly flat. Its slope is computed in world
// units so broad undulations stay smooth.
float cockle(vec2 P) {
  vec2 q = P / uCockleScale;
  return fbm(q, 881u, 3, 2.1, 0.45);
}

vec2 cockleSlope(vec2 P) {
  float e = 0.004;
  float c = cockle(P);
  return vec2(cockle(P + vec2(e, 0.0)) - c, cockle(P + vec2(0.0, e)) - c) / e;
}

// Irradiance from the window opening as a uniformly bright sky, by the exact
// formula for a polygonal source (Lambert), for a point on the paper.
float edgeTerm(vec3 a, vec3 b) {
  vec3 c = cross(a, b);
  float l = length(c);
  if (l < 1e-6) return 0.0;
  return acos(clamp(dot(a, b), -1.0, 1.0)) * c.z / l;
}

float windowSky(vec3 p) {
  vec3 q0 = normalize(vec3(uWinX, uWinRect.z, uWinRect.x) - p);
  vec3 q1 = normalize(vec3(uWinX, uWinRect.z, uWinRect.y) - p);
  vec3 q2 = normalize(vec3(uWinX, uWinRect.w, uWinRect.y) - p);
  vec3 q3 = normalize(vec3(uWinX, uWinRect.w, uWinRect.x) - p);
  float e = edgeTerm(q0, q1) + edgeTerm(q1, q2) + edgeTerm(q2, q3) + edgeTerm(q3, q0);
  return abs(e) / TAU;
}

// Highlights roll off on the brightest channel and every channel is scaled
// together, so sunlit paper keeps the hue of its light instead of bleaching to
// white. The roll-off is measured on the light alone, without the tooth, the
// way the eye adapts to the light and still sees the paper's grain in it. The
// tooth's own contrast then survives in the brightest sun.
// Above the shoulder the curve is logarithmic, as the eye is: a twig that
// takes half the sun, or the soft outer edge of a leaf's shadow, keeps a fair
// share of the range between sunlit paper and full shade instead of being
// pressed flat against the white.
float toneScale(vec3 c) {
  float m = max(c.r, max(c.g, c.b));
  float k = uShoulder;
  if (m <= k) return 1.0;
  float f = k + uShoulderWidth * log(1.0 + (m - k) / uShoulderWidth);
  return f / m;
}

// Texture highlights that still pass 1 roll off softly, hue kept.
vec3 softClip(vec3 c) {
  float m = max(c.r, max(c.g, c.b));
  const float k = 0.96;
  if (m <= k) return c;
  float f = k + (1.0 - k) * (1.0 - exp(-(m - k) / (1.0 - k)));
  return c * (f / m);
}

vec3 toSRGB(vec3 c) {
  c = clamp(c, 0.0, 1.0);
  vec3 lo = c * 12.92;
  vec3 hi = 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055;
  return mix(lo, hi, step(vec3(0.0031308), c));
}

vec2 paperPoint(vec2 uv) {
  vec2 d = (uv - 0.5) * uView.zw;
  return uView.xy + vec2(uViewM.x * d.x + uViewM.y * d.y, uViewM.z * d.x + uViewM.w * d.y);
}

void main() {
  vec2 P = paperPoint(vUv);

  vec4 pf = textureLod(uPaper, vUv, 0.0);
  float h = heightAt(pf);
  // Slopes per CSS px, so relief means the same at every pixel ratio.
  float hx = (heightAt(vUv + vec2(uPaperTexel.x, 0.0)) - heightAt(vUv - vec2(uPaperTexel.x, 0.0))) / (2.0 * uCssPerPx);
  float hy = (heightAt(vUv + vec2(0.0, uPaperTexel.y)) - heightAt(vUv - vec2(0.0, uPaperTexel.y))) / (2.0 * uCssPerPx);
  // Relief is measured on screen; turn it into paper (world) directions.
  vec2 rs = -vec2(hx, hy) * uRelief;
  vec2 rw = vec2(uViewM.x * rs.x + uViewM.y * rs.y, uViewM.z * rs.x + uViewM.w * rs.y);
  vec2 cs = uCockle > 0.0 ? cockleSlope(P) * uCockle * uCockleScale : vec2(0.0);
  vec3 N = normalize(vec3(rw - cs, 1.0));
  vec3 Nsheet = normalize(vec3(-cs, 1.0));

  float hBlur = heightAt(textureLod(uPaper, vUv, 3.0));
  float ao = 1.0 - uAO * clamp((hBlur - h) / max(uToothDepth, 0.05), 0.0, 1.0);

  vec3 albedo = uPaperColor;
  albedo *= 1.0 + uFormation * (pf.a - 0.5) * 2.0;
  albedo *= 1.0 + uFiberTone * (pf.g - 0.25);
  albedo *= 1.0 - 0.6 * uGrainDepth * clamp(pf.b, 0.0, 1.0);

  // Direct sun, with a little lateral spread inside the paper at a lit edge.
  vec3 E = texture(uLight, vUv).rgb;
  vec3 Es = textureLod(uLight, vUv, 1.8).rgb;
  vec3 Ed = mix(E, Es, uScatter);
  // The tooth lit by the sun, with its own small shadows when the sun is low.
  // Light that enters a lit pillow spreads inside the paper and fills a little
  // of the shade beside it, so the tooth never turns harsh.
  // At grazing sun more of the light that reaches the paper enters it and
  // leaves from neighbouring facets, so the tooth softens as the sun drops.
  float shadow = toothShadow(vUv, h, uSun);
  float ndl = max(dot(N, uSun), 0.0) * (1.0 - shadow);
  float spread = mix(uTranslucency, 0.68, smoothstep(0.45, 0.1, uSun.z));
  ndl = mix(ndl, max(dot(Nsheet, uSun), 0.0), spread);
  vec3 direct = uSunColor * uSunIntensity * Ed * ndl;

  // Sky through the window: soft, cool, strongest near the opening, and it
  // lights the relief from the window's side.
  vec3 p3 = vec3(P, 0.0);
  float F = windowSky(p3);
  vec3 toWin = normalize(vec3(uWinX, 0.5 * (uWinRect.z + uWinRect.w), 0.5 * (uWinRect.x + uWinRect.y)) - p3);
  float skyShade = mix(1.0, min(2.0, max(dot(N, toWin), 0.0) / max(dot(Nsheet, toWin), 0.2)), uSkyRelief);
  vec3 sky = uFill * uSkyColor * uSkyIntensity * (1.0 - uSkyOcclusion) * F * skyShade * ao;

  vec3 room = uFill * uRoomColor * uRoomIntensity * (0.9 + 0.1 * N.z) * ao;

  // Sunlight reflected from the lit patch and the room fills the shade warmly.
  vec3 Eb = 0.5 * textureLod(uLight, vUv, 6.0).rgb + 0.5 * textureLod(uLight, vUv, 7.5).rgb;
  vec3 bounce = uFill * uSunColor * uSunIntensity * uSun.z * Eb * uBounce * ao;

  vec3 col = albedo * (direct + sky + room + bounce);

  // The same light on a sheet without tooth: what the eye adapts to.
  vec3 base = uPaperColor * (uSunColor * uSunIntensity * Ed * max(dot(Nsheet, uSun), 0.0) +
                             uFill * (uSkyColor * uSkyIntensity * (1.0 - uSkyOcclusion) * F +
                                      uRoomColor * uRoomIntensity * (0.9 + 0.1 * Nsheet.z) +
                                      uSunColor * uSunIntensity * uSun.z * Eb * uBounce));

  if (uDebug == 14) {
    // Light levels for tuning the tone curve: direct, ambient, flat-sheet base.
    float d = dot(direct, vec3(1.0 / 3.0)) * uExposure;
    float a = dot(sky + room + bounce, vec3(1.0 / 3.0)) * uExposure;
    float b = max(base.r, max(base.g, base.b)) * uExposure;
    outColor = vec4(d / 4.0, a / 4.0, b / 4.0, 1.0);
    return;
  }
  if (uDebug == 1) col = vec3(texture(uLight, vUv).a);
  if (uDebug == 2) col = E;
  if (uDebug == 3) col = vec3(0.5 + 0.5 * N.xy, N.z);
  if (uDebug == 4) col = vec3(0.5 + 0.6 * (h - hBlur));
  if (uDebug == 13) {
    // Foliage transmission alone (window light divided out), for measuring how
    // much of the page carries leaf shadow at each hour.
    vec4 Lt = texture(uLight, vUv);
    float f = Lt.a > 0.3 ? dot(Lt.rgb, vec3(1.0 / 3.0)) / Lt.a : 1.0;
    outColor = vec4(vec3(clamp(f, 0.0, 1.0)), 1.0);
    return;
  }
  if (uDebug == 12) {
    // The paper alone under one soft directional light plus ambient, for
    // matching the tooth against reference photographs.
    vec3 Ls = normalize(uLabLight);
    vec3 Lw = vec3(uViewM.x * Ls.x + uViewM.y * Ls.y, uViewM.z * Ls.x + uViewM.w * Ls.y, Ls.z);
    float sh = toothShadow(vUv, h, Lw);
    float d = max(dot(N, Lw), 0.0) * (1.0 - sh);
    d = mix(d, max(dot(Nsheet, Lw), 0.0), uTranslucency);
    float lab = 0.62 * d / max(Lw.z, 0.05) + 0.38 * mix(1.0, ao, 0.5);
    outColor = vec4(toSRGB(vec3(0.88) * lab), 1.0);
    return;
  }
  if (uDebug == 11) col = vec3(1.0 - shadow);
  if (uDebug == 8) col = vec3(pf.g);
  if (uDebug == 9) col = vec3(clamp(pf.b, 0.0, 1.0));
  if (uDebug == 10) {
    outColor = vec4(texture(uDebugTex, vUv).rgb, 1.0);
    return;
  }
  if (uDebug >= 5 && uDebug <= 7) {
    vec2 c = texture(uDebugTex, vUv).rg;
    outColor = vec4(c.r, c.g, 0.0, 1.0);
    return;
  }

  col = softClip(col * uExposure * toneScale(base * uExposure));
  col = toSRGB(col);

  // Static dither so soft gradients never band.
  float n = hashF(ivec2(gl_FragCoord.xy), 913u) + hashF(ivec2(gl_FragCoord.xy), 377u) - 1.0;
  col += n / 255.0;

  outColor = vec4(col, 1.0);
}
