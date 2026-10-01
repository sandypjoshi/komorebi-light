// The sizes of the page's type and its margins, set on the page as CSS custom
// properties from the size of the view.

const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

export function layout(cssW, cssH) {
  const margin = Math.round(clamp(cssW * 0.075, 24, 120));
  const word = Math.round(clamp(Math.min(cssW * 0.052, cssH * 0.092), 40, 80));
  const text = Math.round(clamp(word * 0.25, 15, 20));
  return {
    word, //                                    "komorebi", px
    kanji: Math.round(word * 0.6), //           木漏れ日, down the top right
    text, //                                    the definition
    leading: Math.round(text * 1.55),
    say: Math.round(text * 0.92), //            how it is said
    width: Math.min(Math.round(text * 30), cssW - 2 * margin), // the entry, and the instrument with it
    margin,
    bottom: Math.round(Math.max(64, cssH * 0.13)), // the entry sits a little up from the bottom
    top: Math.round(Math.max(28, cssH * 0.08)),
    row: 44, //                                 height of the scale
  };
}

export function applyLayout(el, cssW, cssH) {
  const L = layout(cssW, cssH);
  for (const [name, value] of Object.entries({
    word: L.word,
    kanji: L.kanji,
    text: L.text,
    leading: L.leading,
    say: L.say,
    w: L.width,
    margin: L.margin,
    bottom: L.bottom,
    top: L.top,
    row: L.row,
  })) {
    el.style.setProperty(`--${name}`, `${value}px`);
  }
  return L;
}
