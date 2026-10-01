// Scene relationships shared by every pass: sun direction, framing, and where
// each foliage plane has to be drawn so that rays from the paper land on it.
//
// The paper lies flat: the plane z = 0, facing up (+z). The window is in the
// wall beside it, the plane x = window.x, with the room on the x < window.x
// side. On that wall and on every foliage plane outside it, plane coordinates
// are (u, v) = (height above the paper, position along the wall). The view turns
// this so the window is behind the reader (FRAMING).

const DEG = Math.PI / 180;

// Unit vector toward the sun. Elevation is above the paper; azimuth is measured
// from the window wall's outward normal (+x) toward +y along the wall.
export function sunVector(elevationDeg, azimuthDeg) {
  const e = elevationDeg * DEG;
  const a = azimuthDeg * DEG;
  return [Math.cos(e) * Math.cos(a), Math.cos(e) * Math.sin(a), Math.sin(e)];
}

export function isPortrait(cssWidth, cssHeight) {
  return cssWidth / cssHeight < 0.85;
}

// The rectangle of paper (metres) that fills the viewport, turned and
// possibly mirrored. `m` maps a screen offset to paper: P = centre + m * d,
// m = [m00, m01, m10, m11]. It is orthonormal, so paper to screen is its
// transpose.
export function viewRect(cssWidth, cssHeight, framing) {
  const f = isPortrait(cssWidth, cssHeight) ? framing.portrait : framing.landscape;
  const w = f.width;
  const h = (w * cssHeight) / cssWidth;
  const r = (f.rotation || 0) * DEG;
  const k = f.mirror ? -1 : 1;
  const c = Math.cos(r);
  const s = Math.sin(r);
  return { cx: f.centerX, cy: f.centerY, w, h, m: [c, -k * s, s, k * c] };
}

// Paper point for a screen offset (metres) from the view's centre, and back.
export function toPaper(view, x, y) {
  const m = view.m;
  return [view.cx + m[0] * x + m[1] * y, view.cy + m[2] * x + m[3] * y];
}

export function toView(view, P) {
  const m = view.m;
  const dx = P[0] - view.cx;
  const dy = P[1] - view.cy;
  return [m[0] * dx + m[2] * dy, m[1] * dx + m[3] * dy];
}

export function viewCorners(view) {
  return [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]].map(([sx, sy]) => toPaper(view, sx * view.w, sy * view.h));
}

export function planeX(win, distance) {
  return win.x + win.reveal + distance;
}

// The part of a foliage plane the paper can see: the paper's footprint along
// the sun, limited to what passes the window, with the sun's spread as margin.
export function layerRect(win, sun, px, view, sunRadius, extraMargin = 0.06) {
  const [lx, ly, lz] = sun;
  const safeLx = Math.max(lx, 0.05);
  let u0 = Infinity;
  let u1 = -Infinity;
  let v0 = Infinity;
  let v1 = -Infinity;
  let tMax = 0;
  for (const [x, y] of viewCorners(view)) {
    const t = Math.max(0, (px - x) / safeLx);
    tMax = Math.max(tMax, t);
    const u = t * lz;
    const v = y + t * ly;
    u0 = Math.min(u0, u);
    u1 = Math.max(u1, u);
    v0 = Math.min(v0, v);
    v1 = Math.max(v1, v);
  }
  const m = (tMax * sunRadius) / Math.max(0.05, Math.min(safeLx, 1)) * 1.2 + extraMargin;
  // Rays that reach this plane passed the outer opening, shifted by parallax.
  const along = (px - (win.x + win.reveal)) / safeLx;
  const ou0 = win.u0 + along * lz - m;
  const ou1 = win.u1 + along * lz + m;
  const ov0 = win.v0 + along * ly - m;
  const ov1 = win.v1 + along * ly + m;
  const a0 = Math.max(u0 - m, ou0);
  const a1 = Math.min(u1 + m, ou1);
  const b0 = Math.max(v0 - m, ov0);
  const b1 = Math.min(v1 + m, ov1);
  if (a1 <= a0 || b1 <= b0) return [0, 0, 0.01, 0.01];
  return [a0, b0, a1 - a0, b1 - b0];
}
