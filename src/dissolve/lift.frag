#version 300 es
// Where the pointer has lifted ink off the page, kept as a small map of the view
// (one texel per few CSS pixels). Each step the map moves with the scrolled text,
// fades a little, so lifted words settle back on, and takes in the stretch the
// pointer travelled since the last step.
precision highp float;

uniform sampler2D uPrevious;
uniform vec2 uSpan;        // the map's extent, CSS px
uniform float uCell;       // CSS px per texel
uniform vec2 uShift;       // CSS px the text moved since the last step
uniform vec2 uFrom;        // the pointer's travel this step, viewport CSS px
uniform vec2 uTo;
uniform float uRadius;     // CSS px
uniform float uDeposit;    // lift added at the centre of the stroke
uniform float uFade;       // lift lost per step

out vec4 outColor;

void main() {
  vec2 css = gl_FragCoord.xy * uCell;
  vec2 was = (css + uShift) / uSpan;
  float lift = 0.0;
  if (all(greaterThanEqual(was, vec2(0.0))) && all(lessThanEqual(was, vec2(1.0)))) {
    lift = texture(uPrevious, was).r;
  }

  vec2 stroke = uTo - uFrom;
  float t = clamp(dot(css - uFrom, stroke) / max(dot(stroke, stroke), 1e-4), 0.0, 1.0);
  float d = length(css - (uFrom + stroke * t)) / uRadius;
  float brush = 1.0 - smoothstep(0.3, 1.0, d);

  outColor = vec4(clamp(lift - uFade + brush * uDeposit, 0.0, 1.0), 0.0, 0.0, 1.0);
}
