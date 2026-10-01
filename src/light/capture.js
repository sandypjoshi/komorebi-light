// Reproducible captures. A frame is fully described by daylight, seed and
// animation time, so stills and motion can be rendered at any size, frame by
// frame, independent of how fast the machine runs.

export function pixelsToCanvas({ w, h, px }) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(w, h);
  const row = w * 4;
  for (let y = 0; y < h; y++) {
    img.data.set(px.subarray((h - 1 - y) * row, (h - y) * row), y * row);
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

export function canvasToBlob(canvas, type = 'image/png', quality = 0.95) {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

// Dev server only: writes into captures/.
export async function postCapture(blob, name, dir = '') {
  const q = new URLSearchParams({ name, dir });
  const res = await fetch(`/__capture?${q}`, { method: 'POST', body: blob });
  if (!res.ok) throw new Error(`capture failed: ${res.status}`);
  return name;
}

export function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

// Draw the time-of-day instrument onto a captured frame, so a recording shows
// the slider as it sits on the page. Mirrors the .day styles in index.html.
export function drawDayOverlay(canvas, { clock, label, start, end, cssW, cssH, dpr, playing = false, opacity = 0.62, dark = false }) {
  const ctx = canvas.getContext('2d');
  const mobile = cssW <= 640;
  const left = mobile ? 18 : 26;
  const bottom = mobile ? 12 : 18;
  const rowH = mobile ? 40 : 32;
  const cy = cssH - bottom - rowH / 2;
  ctx.save();
  ctx.scale(dpr, dpr);
  // Ink printed on the paper by day, light on dark paper at night.
  ctx.globalCompositeOperation = dark ? 'screen' : 'multiply';
  ctx.globalAlpha = opacity;
  ctx.fillStyle = dark ? 'rgb(226, 231, 240)' : 'rgb(34, 32, 29)';
  ctx.font = '500 11px ui-sans-serif, system-ui, -apple-system, "Helvetica Neue", Arial, sans-serif';
  if ('letterSpacing' in ctx) ctx.letterSpacing = '0.55px';
  ctx.textBaseline = 'middle';

  // Play or pause glyph, 9 px, centred in a 26 px button that starts 8 px early.
  const bx = left - 8 + 13;
  const g = 9 / 10;
  if (playing) {
    ctx.fillRect(bx - 4.5 + 1.8 * g, cy - 4.5 + 1.4 * g, 2.1 * g, 7.2 * g);
    ctx.fillRect(bx - 4.5 + 6.1 * g, cy - 4.5 + 1.4 * g, 2.1 * g, 7.2 * g);
  } else {
    ctx.beginPath();
    ctx.moveTo(bx - 4.5 + 2 * g, cy - 4.5 + 1.2 * g);
    ctx.lineTo(bx - 4.5 + 8.6 * g, cy);
    ctx.lineTo(bx - 4.5 + 2 * g, cy - 4.5 + 8.8 * g);
    ctx.closePath();
    ctx.fill();
  }

  const textW = Math.max(ctx.measureText('00:00').width, 4 * 6.4);
  const x0 = left - 8 + 26 - 4 + 10;
  const x1 = mobile ? cssW - 18 - textW - 10 : x0 + 184;
  const thumb = 9;
  const a = x0 + thumb / 2;
  const b = x1 - thumb / 2;

  // Hairline and hour ticks at half strength.
  ctx.globalAlpha = opacity * 0.5;
  ctx.fillRect(a, cy - 0.5, b - a, 1);
  for (let h = Math.ceil(start); h <= Math.floor(end); h++) {
    const x = a + ((h - start) / (end - start)) * (b - a);
    const t = h % 6 === 0 ? 6 : 3;
    ctx.fillRect(x - 0.5, cy - t, 1, t);
  }
  ctx.globalAlpha = opacity;
  const tx = a + ((clock - start) / (end - start)) * (b - a);
  ctx.fillRect(tx - 0.75, cy - 7.5, 1.5, 15);
  ctx.fillText(label, x1 + 10, cy + 0.5);
  ctx.restore();
}
