// The instrument and the credit drawn into a recorded frame where the page set
// them (clips are recorded at the page's own size, with the instrument synced
// to the frame), so a clip shows the page as it is. The sky's diagram is its
// own canvas, laid in as drawn. The words are the dissolve effect's own canvas,
// laid over first by the caller; they are drawn here only when that effect is
// not running.

const PLAY = new Path2D('M2 1.2 8.6 5 2 8.8z');

export function drawCenterOverlay(canvas, { dpr, ink, titles = false, instrument = 0.74, cursor = null }) {
  const ctx = canvas.getContext('2d');
  ctx.save();
  ctx.scale(dpr, dpr);
  ctx.fillStyle = ink;
  ctx.strokeStyle = ink;

  if (titles) for (const el of document.querySelectorAll('[data-dissolve]')) words(ctx, el, 0.84);

  // The instrument: play, scale, time.
  const play = document.querySelector('.day-play');
  const g = play.querySelector('svg').getBoundingClientRect();
  ctx.globalAlpha = instrument;
  ctx.save();
  ctx.translate(g.left, g.top);
  ctx.scale(g.width / 10, g.height / 10);
  if (play.getAttribute('aria-pressed') === 'true') {
    ctx.fillRect(1.8, 1.4, 2.1, 7.2);
    ctx.fillRect(6.1, 1.4, 2.1, 7.2);
  } else ctx.fill(PLAY);
  ctx.restore();

  // The sky: the sun's and moon's paths, the hours, the playhead.
  const sky = document.querySelector('.sky canvas');
  if (sky?.width) {
    const r = sky.getBoundingClientRect();
    ctx.globalAlpha = instrument;
    ctx.drawImage(sky, r.left, r.top, r.width, r.height);
  }

  // The switches: now, sound and screensaver, each its icon (as drawn) and word.
  for (const button of document.querySelectorAll('.toggles button')) {
    if (!button.getBoundingClientRect().width) continue;
    const on = button.getAttribute('aria-pressed') === 'true';
    labelled(ctx, button, instrument * (on ? 1 : 0.6));
  }

  // The author and the code.
  labelled(ctx, document.querySelector('.credit'), 0.55);
  labelled(ctx, document.querySelector('.code'), 0.55);
  ctx.restore();

  if (cursor) drawCursor(canvas.getContext('2d'), cursor, dpr);
}

// An element's icon canvas, if it has one, laid in where it sits, then its words.
function labelled(ctx, el, alpha) {
  if (!el?.getClientRects().length) return;
  const icon = el.querySelector('canvas.icon');
  if (icon?.width) {
    const r = icon.getBoundingClientRect();
    ctx.globalAlpha = alpha;
    ctx.drawImage(icon, r.left, r.top, r.width, r.height);
  }
  words(ctx, el, alpha);
}

function fontOf(ctx, style) {
  ctx.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  return ctx.measureText('Hg').fontBoundingBoxAscent;
}

// Every word of an element, where the page set it, each run in its own font;
// vertical text a character at a time, centred in its column.
function words(ctx, el, alpha) {
  if (!el?.getClientRects().length) return;
  ctx.globalAlpha = alpha;
  const range = document.createRange();
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const style = getComputedStyle(node.parentElement);
    const ascent = fontOf(ctx, style);
    if (style.writingMode.startsWith('vertical')) {
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const size = parseFloat(style.fontSize);
      for (let i = 0; i < node.data.length; i++) {
        range.setStart(node, i);
        range.setEnd(node, i + 1);
        const r = range.getClientRects()[0];
        if (r) ctx.fillText(node.data[i], r.left + r.width / 2, r.top + size / 2);
      }
      continue;
    }
    ctx.letterSpacing = style.letterSpacing === 'normal' ? '0px' : style.letterSpacing;
    for (const word of node.data.matchAll(/\S+/g)) {
      range.setStart(node, word.index);
      range.setEnd(node, word.index + word[0].length);
      const rects = range.getClientRects();
      if (rects.length === 1) {
        ctx.fillText(word[0], rects[0].left, rects[0].top + ascent);
        continue;
      }
      // A word broken across lines at its hyphen: each character where it fell.
      for (let i = 0; i < word[0].length; i++) {
        range.setStart(node, word.index + i);
        range.setEnd(node, word.index + i + 1);
        const r = range.getClientRects()[0];
        if (r) ctx.fillText(word[0][i], r.left, r.top + ascent);
      }
    }
    ctx.letterSpacing = '0px';
  }
}

// The system's arrow, for clips that show a hand at work.
const ARROW = new Path2D('M0 0 L0 16.2 L3.9 12.5 L6.6 18.6 L9.2 17.5 L6.6 11.6 L12 11.6 Z');
function drawCursor(ctx, { x, y }, dpr) {
  ctx.save();
  ctx.scale(dpr, dpr);
  ctx.translate(x, y);
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
  ctx.shadowColor = 'rgba(0, 0, 0, 0.28)';
  ctx.shadowBlur = 3;
  ctx.shadowOffsetY = 1;
  ctx.lineJoin = 'round';
  ctx.lineWidth = 1.6;
  ctx.strokeStyle = '#fff';
  ctx.stroke(ARROW);
  ctx.shadowColor = 'transparent';
  ctx.fillStyle = '#111';
  ctx.fill(ARROW);
  ctx.restore();
}
