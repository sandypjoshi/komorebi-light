// The wind of wind.glsl, in JavaScript: the same hash, noise, gusts and branch
// hierarchy, so the page knows where any point of the shrub is at any moment.
// A bird standing on a twig is placed with it, and its weight bends the twig
// the same way on both sides (the `load`).

const TAU = Math.PI * 2;
const U = (x) => x >>> 0;

function pcgHash(v) {
  const state = U(Math.imul(U(v), 747796405) + 2891336453);
  const word = U(Math.imul(U((state >>> ((state >>> 28) + 4)) ^ state), 277803737));
  return U((word >>> 22) ^ word);
}

function hashF(x, y, s) {
  return pcgHash(U(x) ^ pcgHash(U(y) ^ pcgHash(s))) / 4294967296;
}

function vnoise(px, py, s) {
  const ix = Math.floor(px);
  const iy = Math.floor(py);
  const fx = px - ix;
  const fy = py - iy;
  const ux = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
  const uy = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
  const a = hashF(ix, iy, s);
  const b = hashF(ix + 1, iy, s);
  const d = hashF(ix, iy + 1, s);
  const e = hashF(ix + 1, iy + 1, s);
  return a + (b - a) * ux + (d - a + (a - b - d + e) * ux) * uy;
}

const smoothstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

// The wind's uniforms as plain numbers, from the state.
export function windParams(state) {
  const w = state.wind;
  return {
    strength: w.strength,
    gust: w.gust,
    speed: w.speed,
    lull: w.lull,
    dir: w.direction,
    axis: w.axis,
    seed: U(state.seed * 7919 + 13),
    amp: w.sway.amp,
    freq: w.sway.freq,
    lag: w.sway.lag,
    bend: w.bend,
  };
}

function windLull(W, t) {
  const n = vnoise(t * 0.019, 0.5, U(W.seed + 11));
  const m = vnoise(t * 0.057, 7.5, U(W.seed + 12));
  const l = smoothstep(0.18, 0.82, 0.7 * n + 0.3 * m);
  return 1 + (0.22 + 0.98 * l - 1) * W.lull;
}

function windGust(W, q, t) {
  const [ax, ay] = W.axis;
  const gx = (q[0] * ax + q[1] * ay - W.dir * W.speed * t) * 0.34;
  const gy = (q[0] * -ay + q[1] * ax) * 0.85 * 0.34;
  const n = 0.62 * vnoise(gx, gy, W.seed) + 0.38 * vnoise(gx * 2.13 + 4.1, gy * 2.13 + 4.1, U(W.seed + 3));
  const gust = smoothstep(0.34, 0.84, n);
  return W.strength * windLull(W, t) * (0.62 + (0.3 + 1.15 * gust - 0.62) * W.gust);
}

function swayAngle(W, level, pivot, phase, lean, t) {
  const f = W.freq[level];
  const g = windGust(W, pivot, t - W.lag[level]);
  const o = 0.62 * Math.sin(TAU * f * t + phase) + 0.38 * Math.sin(TAU * f * 1.618 * t + phase * 1.93 + 1.3);
  return W.amp[level] * g * (0.7 * lean + 0.6 * o);
}

const bendAt = (W, s) => Math.pow(Math.min(1, Math.max(0, s)), W.bend);

// Where a rest point of a branch is at time t: twig, then branch, then limb,
// each turning about its rest pivot. `chain` is the point's chain of joints
// (foliage.js), `sOwn` its position along its own branch. `load` adds the
// bending of one branch under a weight: { pivot, level, angle }.
export function applyHierarchy(W, p, chain, sOwn, t, load = null) {
  let x = p[0];
  let y = p[1];
  for (let k = chain.length - 1; k >= 0; k--) {
    const e = chain[k];
    const s = e.s < 0 ? sOwn : e.s;
    let a = swayAngle(W, k, e.pivot, e.phase, e.lean, t);
    if (load && load.level === k && load.pivot[0] === e.pivot[0] && load.pivot[1] === e.pivot[1]) a += load.angle;
    a *= bendAt(W, s);
    const c = Math.cos(a);
    const sn = Math.sin(a);
    const dx = x - e.pivot[0];
    const dy = y - e.pivot[1];
    x = e.pivot[0] + c * dx - sn * dy;
    y = e.pivot[1] + sn * dx + c * dy;
  }
  return [x, y];
}

export { bendAt, windGust };
