#version 300 es
// A block's quad, placed in CSS pixels over the page.
in vec2 aCorner;           // 0..1, top left origin

uniform vec2 uOrigin;      // the quad's top left in the viewport, CSS px
uniform vec2 uSize;        // the quad's size, CSS px
uniform vec2 uViewport;    // CSS px

out vec2 vLocal;           // CSS px from the quad's top left

void main() {
  vLocal = aCorner * uSize;
  vec2 css = uOrigin + vLocal;
  vec2 clip = css / uViewport * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
}
