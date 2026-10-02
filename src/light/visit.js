// What every visitor shares: small vector and motion helpers, where the light
// and the view are, the shrub's twigs as perches, and casting a pose in 3D
// along the light into the flat shapes visitor.frag draws.
//
// World coordinates: x out from the window wall, y along it, z up. On a
// foliage plane, (u, v) = (z, y).

import { applyHierarchy } from './wind.js';
import { toPaper, toView } from './geometry.js';

export const DEG = Math.PI / 180;
export const TAU = Math.PI * 2;
export const MAX_PRIMS = 16;
export const MAX_MOMENTS = 4;
export const SHUTTER = 1 / 60; // seconds of motion blurred into one frame, as the eye sees it

// ---- small helpers -----------------------------------------------------------

export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const len = (a) => Math.hypot(a[0], a[1], a[2]);
export const norm = (a) => mul(a, 1 / (len(a) || 1));
export const mix3 = (a, b, k) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
export const lerp = (a, b, k) => a + (b - a) * k;
export const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
export const ease = (x) => 0.5 - 0.5 * Math.cos(Math.PI * clamp(x, 0, 1));
export const smooth = (x) => {
  const t = clamp(x, 0, 1);
  return t * t * (3 - 2 * t);
};
export const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
// From angle a toward angle b by k, the short way round.
export const turnToward = (a, b, k) => a + wrap(b - a) * k;
export const Z = [0, 0, 1];
export const X = [1, 0, 0];

// Critically damped approach to a new value: no jolt and no overshoot.
export const settle = (d, tau) => (d <= 0 ? 0 : 1 - (1 + d / tau) * Math.exp(-d / tau));
// A quick movement out and back, peaking at 1 after `tau`.
export const pulse = (d, tau) => (d <= 0 ? 0 : (d / tau) * Math.exp(1 - d / tau));

// A frame: an origin and three axes (forward, left, up), of length `size`.
export function frame(o, yaw, pitch, roll = 0, size = 1) {
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  const f0 = [cy, sy, 0];
  const l0 = [-sy, cy, 0];
  const f1 = add(mul(f0, Math.cos(pitch)), mul(Z, Math.sin(pitch)));
  const u1 = add(mul(f0, -Math.sin(pitch)), mul(Z, Math.cos(pitch)));
  const l2 = add(mul(l0, Math.cos(roll)), mul(u1, Math.sin(roll)));
  const u2 = add(mul(l0, -Math.sin(roll)), mul(u1, Math.cos(roll)));
  return { o, x: mul(f1, size), y: mul(l2, size), z: mul(u2, size) };
}
export const toWorld = (f, p) => add(add(add(f.o, mul(f.x, p[0])), mul(f.y, p[1])), mul(f.z, p[2]));
export const dirWorld = (f, d) => add(add(mul(f.x, d[0]), mul(f.y, d[1])), mul(f.z, d[2]));

// Rotations in a frame's own coordinates.
export const rotX = (v, a) => [v[0], v[1] * Math.cos(a) - v[2] * Math.sin(a), v[1] * Math.sin(a) + v[2] * Math.cos(a)];
export const rotY = (v, a) => [v[0] * Math.cos(a) + v[2] * Math.sin(a), v[1], -v[0] * Math.sin(a) + v[2] * Math.cos(a)];
export const rotZ = (v, a) => [v[0] * Math.cos(a) - v[1] * Math.sin(a), v[0] * Math.sin(a) + v[1] * Math.cos(a), v[2]];
// Rodrigues: v about the unit axis k.
export function rotAxis(v, k, a) {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return add(add(mul(v, c), mul(cross(k, v), s)), mul(k, dot(k, v) * (1 - c)));
}

// ---- motion over time ----------------------------------------------------------

// A value that moves to new targets at given moments, each move eased. Keys
// are added in time order.
export class Track {
  constructor(value) {
    this.v0 = value;
    this.last = value;
    this.keys = [];
  }
  to(t, value, tau) {
    this.keys.push({ t, dv: value - this.last, tau });
    this.last = value;
    return this;
  }
  by(t, dv, tau) {
    return this.to(t, this.last + dv, tau);
  }
  at(T) {
    let x = this.v0;
    for (const k of this.keys) {
      if (k.t >= T) break;
      x += k.dv * settle(T - k.t, k.tau);
    }
    return x;
  }
}

// Brief movements out and back (a tail flick, a bob), summed.
export class Pulses {
  constructor() {
    this.list = [];
  }
  add(t, amp, tau) {
    this.list.push([t, amp, tau]);
  }
  at(T) {
    let x = 0;
    for (const [t, a, tau] of this.list) if (T > t && T < t + 12 * tau) x += a * pulse(T - t, tau);
    return x;
  }
}

// The twig's bend under a bird: a damped spring, driven by the bird's
// weight (steps) and by the pushes of landing, hopping and leaving (kicks).
// In metres of sag at the perch.
export class Spring {
  constructor(freq, damping) {
    this.w = TAU * freq;
    this.z = damping;
    this.wd = this.w * Math.sqrt(1 - damping * damping);
    this.steps = [];
    this.kicks = [];
  }
  step(t, a) {
    this.steps.push([t, a]);
  }
  kick(t, v) {
    this.kicks.push([t, v]);
  }
  at(T) {
    const { w, z, wd } = this;
    let x = 0;
    for (const [t, a] of this.steps) {
      const d = T - t;
      if (d <= 0) continue;
      const e = Math.exp(-z * w * d);
      x += a * (1 - e * (Math.cos(wd * d) + ((z * w) / wd) * Math.sin(wd * d)));
    }
    for (const [t, v] of this.kicks) {
      const d = T - t;
      if (d <= 0) continue;
      x += (v / wd) * Math.exp(-z * w * d) * Math.sin(wd * d);
    }
    return x;
  }
}

// A flight path: a cubic curve, sampled by distance along it.
export function curve(p0, p1, p2, p3, n = 120) {
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const m = 1 - t;
    const a = m * m * m;
    const b = 3 * m * m * t;
    const c = 3 * m * t * t;
    const d = t * t * t;
    pts.push([0, 1, 2].map((k) => a * p0[k] + b * p1[k] + c * p2[k] + d * p3[k]));
  }
  const cum = [0];
  for (let i = 1; i <= n; i++) cum.push(cum[i - 1] + len(sub(pts[i], pts[i - 1])));
  return { pts, cum, length: cum[n] };
}

export function along(path, d) {
  const { pts, cum } = path;
  const n = pts.length - 1;
  if (d <= 0) return add(pts[0], mul(norm(sub(pts[1], pts[0])), d));
  if (d >= cum[n]) return add(pts[n], mul(norm(sub(pts[n], pts[n - 1])), d - cum[n]));
  let lo = 0;
  let hi = n;
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (cum[m] <= d) lo = m;
    else hi = m;
  }
  return mix3(pts[lo], pts[hi], (d - cum[lo]) / (cum[hi] - cum[lo] || 1));
}

// A way through the air by timed points, smooth in place and in speed (cubic
// Hermite). Points are added in time order. One given no velocity takes the
// way through its neighbours; the first and the last are at rest unless given
// one. Before the first point and after the last it holds still.
export class Route {
  constructor() {
    this.keys = [];
  }
  to(t, p, v = null) {
    this.keys.push({ t, p, v });
    return this;
  }
  get start() {
    return this.keys[0];
  }
  get end() {
    return this.keys[this.keys.length - 1];
  }
  done() {
    const k = this.keys;
    for (let i = 0; i < k.length; i++) {
      if (k[i].v) continue;
      if (i === 0 || i === k.length - 1) k[i].v = [0, 0, 0];
      else k[i].v = mul(sub(k[i + 1].p, k[i - 1].p), 1 / (k[i + 1].t - k[i - 1].t));
    }
    return this;
  }
  _span(T) {
    const k = this.keys;
    let lo = 0;
    let hi = k.length - 1;
    while (hi - lo > 1) {
      const m = (lo + hi) >> 1;
      if (k[m].t <= T) lo = m;
      else hi = m;
    }
    return [k[lo], k[hi]];
  }
  // Position (0), velocity (1) or acceleration (2) at time T.
  _eval(T, order) {
    const k = this.keys;
    if (T <= k[0].t) return order ? [0, 0, 0] : k[0].p.slice();
    if (T >= k[k.length - 1].t) return order ? [0, 0, 0] : k[k.length - 1].p.slice();
    const [a, b] = this._span(T);
    const h = b.t - a.t;
    const s = (T - a.t) / h;
    // Hermite basis and its derivatives, per unit of time.
    let w;
    if (order === 0) w = [2 * s ** 3 - 3 * s * s + 1, s ** 3 - 2 * s * s + s, -2 * s ** 3 + 3 * s * s, s ** 3 - s * s];
    else if (order === 1) w = [6 * s * s - 6 * s, 3 * s * s - 4 * s + 1, -6 * s * s + 6 * s, 3 * s * s - 2 * s].map((x) => x / h);
    else w = [12 * s - 6, 6 * s - 4, -12 * s + 6, 6 * s - 2].map((x) => x / (h * h));
    return [0, 1, 2].map((i) => w[0] * a.p[i] + w[1] * h * a.v[i] + w[2] * b.p[i] + w[3] * h * b.v[i]);
  }
  at(T) {
    return this._eval(T, 0);
  }
  vel(T) {
    return this._eval(T, 1);
  }
  acc(T) {
    return this._eval(T, 2);
  }
}

// Smooth, deterministic unsteadiness: a few sines on each axis at unrelated
// frequencies. `amp` is the size on each axis (metres or radians).
export function wobble(r, amp, f0, f1) {
  const terms = [];
  for (let axis = 0; axis < amp.length; axis++) {
    for (let i = 0; i < 3; i++) terms.push([axis, r.range(f0, f1), r.next() * TAU, (amp[axis] / 1.7) * r.range(0.7, 1.2)]);
  }
  return (T) => {
    const o = amp.map(() => 0);
    for (const [a, f, ph, A] of terms) o[a] += A * Math.sin(TAU * f * T + ph);
    return o;
  };
}

// ---- where the light and the view are -------------------------------------------

export function viewFraction(view, P) {
  const [x, y] = toView(view, P);
  return [x / view.w + 0.5, y / view.h + 0.5];
}

// The paper point at a fraction of the view.
export const paperAt = (view, f) => toPaper(view, (f[0] - 0.5) * view.w, (f[1] - 0.5) * view.h);

// How far toward the window the paper in view reaches: anything flying
// nearer the window than this is out of sight, and only its shadow is seen.
export function viewReach(view) {
  let x = -Infinity;
  for (const [sx, sy] of [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]]) x = Math.max(x, toPaper(view, sx * view.w, sy * view.h)[0]);
  return x;
}

// Where a point in the air casts its shadow on the paper.
export const shadowOf = (B, sun) => [B[0] - (B[2] * sun[0]) / sun[2], B[1] - (B[2] * sun[1]) / sun[2]];

// The point at distance x from the wall whose shadow falls on paper point S.
export function lift(S, sun, x) {
  const t = (x - S[0]) / Math.max(sun[0], 0.05);
  return [x, S[1] + t * sun[1], t * sun[2]];
}

// Whether a place in the view (a fraction) is clear of the parts a page keeps
// for its words.
export function clearOf(avoid, f, margin = 0.03) {
  return !avoid?.some(([x0, y0, x1, y1]) => f[0] > x0 - margin && f[0] < x1 + margin && f[1] > y0 - margin && f[1] < y1 + margin);
}

export function litAt(probe, f) {
  if (f[0] < 0.03 || f[0] > 0.97 || f[1] < 0.03 || f[1] > 0.97) return 0;
  if (!probe) return 1;
  const x = Math.min(probe.w - 1, Math.round(f[0] * (probe.w - 1)));
  const y = Math.min(probe.h - 1, Math.round(f[1] * (probe.h - 1)));
  return probe.lit[y * probe.w + x];
}

// ---- the shrub's branches as perches -----------------------------------------------

export function branchesOf(segments) {
  const map = new Map();
  for (const s of segments) {
    if (!map.has(s.chain)) map.set(s.chain, []);
    map.get(s.chain).push(s);
  }
  const out = [];
  for (const [chain, segs] of map) {
    segs.sort((a, b) => a.sa - b.sa);
    let length = 0;
    for (const g of segs) length += Math.hypot(g.b[0] - g.a[0], g.b[1] - g.a[1]);
    const own = chain[chain.length - 1];
    out.push({ chain, segs, length, level: chain.length - 1, pivot: own.pivot });
  }
  return out;
}

// Rest position, direction and radius of a branch at arc fraction s.
export function branchAt(b, s) {
  const segs = b.segs;
  let i = segs.findIndex((g) => s <= g.sb);
  if (i < 0) i = segs.length - 1;
  const g = segs[i];
  const k = clamp((s - g.sa) / (g.sb - g.sa || 1), 0, 1);
  const du = g.b[0] - g.a[0];
  const dv = g.b[1] - g.a[1];
  const l = Math.hypot(du, dv) || 1;
  return { p: [lerp(g.a[0], g.b[0], k), lerp(g.a[1], g.b[1], k)], d: [du / l, dv / l], r: lerp(g.ra, g.rb, k) };
}

// The top of a twig at arc s where the wind has it at time T (world point on
// the shrub's plane x), with an optional load bending it.
export function twigAt(W, b, s, T, x, load = null) {
  const at = branchAt(b, s);
  const [u, v] = applyHierarchy(W, at.p, b.chain, s, T, load);
  return [x, v, u + at.r];
}

// ---- casting along the light ----------------------------------------------------------

// Project 3D primitives along the sun onto 2D, in a basis (e1, e2) across the
// sun's rays: an ellipsoid's shadow is an ellipse, a round cone's a 2D round
// cone of the same radii, a flat quad's a quad. `clear` is how much light a
// shape lets through (a bee's wing), 0 for none.
export function project(prims, O, e1, e2, out, row) {
  const P = (p) => {
    const d = sub(p, O);
    return [dot(d, e1), dot(d, e2)];
  };
  let o = row * (3 * MAX_PRIMS + 1) * 4;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const grow = (x, y, r) => {
    minX = Math.min(minX, x - r);
    maxX = Math.max(maxX, x + r);
    minY = Math.min(minY, y - r);
    maxY = Math.max(maxY, y + r);
  };
  const n = Math.min(prims.length, MAX_PRIMS);
  for (let i = 0; i < n; i++) {
    const q = prims[i];
    const clear = q.clear ?? 0;
    if (q.t === 'E') {
      const [cx, cy] = P(q.c);
      let m11 = 0;
      let m12 = 0;
      let m22 = 0;
      for (const a of q.axes) {
        const p = dot(a, e1);
        const r = dot(a, e2);
        m11 += p * p;
        m12 += p * r;
        m22 += r * r;
      }
      const tr = (m11 + m22) / 2;
      const df = (m11 - m22) / 2;
      const rt = Math.sqrt(df * df + m12 * m12);
      const a = Math.sqrt(tr + rt);
      const b = Math.sqrt(Math.max(tr - rt, 1e-12));
      const th = 0.5 * Math.atan2(2 * m12, m11 - m22);
      out.set([cx, cy, a, b, Math.cos(th), Math.sin(th), 0, 0, 0, q.k, clear, 0], o);
      grow(cx, cy, a);
    } else if (q.t === 'C') {
      const a = P(q.a);
      const b = P(q.b);
      out.set([a[0], a[1], b[0], b[1], q.ra, q.rb, 0, 0, 1, q.k, clear, 0], o);
      grow(a[0], a[1], q.ra);
      grow(b[0], b[1], q.rb);
    } else {
      const c = q.p.map(P);
      out.set([c[0][0], c[0][1], c[1][0], c[1][1], c[2][0], c[2][1], c[3][0], c[3][1], 2, q.k, clear, q.round], o);
      for (const p of c) grow(p[0], p[1], q.round);
    }
    o += 12;
  }
  // Bounds of this moment, in the last column, with the primitive count.
  const bx = (minX + maxX) / 2;
  const by = (minY + maxY) / 2;
  const br = Math.hypot(maxX - minX, maxY - minY) / 2 + 0.006;
  out.set([bx, by, br, n], row * (3 * MAX_PRIMS + 1) * 4 + 3 * MAX_PRIMS * 4);
  return { bx, by, br };
}

// A bounding sphere for each primitive, for sizing the plane region drawn.
export function spheres(prims) {
  return prims.map((q) => {
    if (q.t === 'E') return [q.c, Math.max(...q.axes.map(len))];
    if (q.t === 'C') return [mix3(q.a, q.b, 0.5), len(sub(q.a, q.b)) / 2 + Math.max(q.ra, q.rb)];
    const c = mul(q.p.reduce(add), 0.25);
    return [c, Math.max(...q.p.map((p) => len(sub(p, c)))) + q.round];
  });
}

// One frame for visitor.frag: each moment's shapes cast along the light onto
// a plane through the visitor (at O), the part of that plane they cover, and
// where the shadow falls in the view.
export function cast(data, moments, O, sun, view, opacity) {
  let e1 = cross(sun, Z);
  if (len(e1) < 1e-4) e1 = cross(sun, X);
  e1 = norm(e1);
  const e2 = norm(cross(sun, e1));
  const lx = Math.max(sun[0], 0.05);
  const kz = sun[2] / lx;
  const ky = sun[1] / lx;
  const fu = Math.sqrt(1 + kz * kz);
  const fv = Math.sqrt(1 + ky * ky);
  let u0 = Infinity;
  let u1 = -Infinity;
  let v0 = Infinity;
  let v1 = -Infinity;
  moments.forEach((prims, m) => {
    project(prims, O, e1, e2, data, m);
    for (const [c, rad] of spheres(prims)) {
      const s = O[0] - c[0];
      const u = c[2] + s * kz;
      const v = c[1] + s * ky;
      u0 = Math.min(u0, u - rad * fu);
      u1 = Math.max(u1, u + rad * fu);
      v0 = Math.min(v0, v - rad * fv);
      v1 = Math.max(v1, v + rad * fv);
    }
  });
  const pad = 0.004;
  return {
    opacity,
    moments: moments.length,
    data,
    origin: O,
    planeX: O[0],
    rect: [u0 - pad, v0 - pad, u1 - u0 + 2 * pad, v1 - v0 + 2 * pad],
    e1,
    e2,
    spot: viewFraction(view, shadowOf(O, sun)),
  };
}
