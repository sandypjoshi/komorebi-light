// The day as one continuous function of clock time.
//
// settings.js art-directs a handful of moments (DAY.keys). Between them every
// number follows a monotone cubic curve through the keyframes: smooth at each
// keyframe, so scrubbing never kinks, and never overshooting, so an intensity
// cannot dip below zero or a colour swing past its neighbours.

import { DAY } from './settings.js';

const KEYS = [...DAY.keys].sort((a, b) => a.clock - b.clock);

// Every numeric leaf of a keyframe, as a path: ['sun', 'color', 0], ...
function numericPaths(obj, prefix = [], out = []) {
  for (const [k, v] of Object.entries(obj)) {
    if (k === 'clock') continue;
    const key = Array.isArray(obj) ? Number(k) : k;
    if (typeof v === 'number') out.push([...prefix, key]);
    else if (v && typeof v === 'object') numericPaths(v, [...prefix, key], out);
  }
  return out;
}

const get = (obj, path) => path.reduce((o, k) => o[k], obj);
function set(obj, path, value) {
  let o = obj;
  for (let i = 0; i < path.length - 1; i++) o = o[path[i]];
  o[path[path.length - 1]] = value;
}

// Fritsch–Carlson monotone cubic Hermite interpolation.
function monotone(xs, ys) {
  const n = xs.length;
  const d = [];
  for (let i = 0; i < n - 1; i++) d.push((ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]));
  const m = new Array(n);
  m[0] = d[0];
  m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) {
      m[i] = 0;
      m[i + 1] = 0;
      continue;
    }
    const a = m[i] / d[i];
    const b = m[i + 1] / d[i];
    const s = a * a + b * b;
    if (s > 9) {
      const t = 3 / Math.sqrt(s);
      m[i] = t * a * d[i];
      m[i + 1] = t * b * d[i];
    }
  }
  return (x) => {
    if (x <= xs[0]) return ys[0];
    if (x >= xs[n - 1]) return ys[n - 1];
    let i = 0;
    while (x > xs[i + 1]) i++;
    const h = xs[i + 1] - xs[i];
    const t = (x - xs[i]) / h;
    const t2 = t * t;
    const t3 = t2 * t;
    return (
      (2 * t3 - 3 * t2 + 1) * ys[i] +
      (t3 - 2 * t2 + t) * h * m[i] +
      (-2 * t3 + 3 * t2) * ys[i + 1] +
      (t3 - t2) * h * m[i + 1]
    );
  };
}

const PATHS = numericPaths(KEYS[0]);
const XS = KEYS.map((k) => k.clock);
const CURVES = PATHS.map((path) => monotone(XS, KEYS.map((k) => get(k, path))));
const TEMPLATE = (() => {
  const t = structuredClone(KEYS[0]);
  delete t.clock;
  return t;
})();

// Clock times wrap at midnight when the day is a full 24 hours.
export function clampClock(clock) {
  if (DAY.wrap) {
    const span = DAY.end - DAY.start;
    return DAY.start + ((((clock - DAY.start) % span) + span) % span);
  }
  return Math.min(DAY.end, Math.max(DAY.start, clock));
}

// The shortest way from one clock time to another (across midnight if shorter).
export function clockDelta(from, to) {
  let d = to - from;
  if (DAY.wrap) {
    const span = DAY.end - DAY.start;
    if (d > span / 2) d -= span;
    if (d < -span / 2) d += span;
  }
  return d;
}

// The light at a clock time: { sun, sky, room, bounce, exposure, wind, ui }.
// At night `sun` is the moon.
export function daylightAt(clock) {
  const c = clampClock(clock);
  const out = structuredClone(TEMPLATE);
  PATHS.forEach((path, i) => set(out, path, CURVES[i](c)));
  return out;
}

export function formatClock(clock) {
  const minutes = Math.round(clampClock(clock) * 60) % 1440;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

// Words for the time, for assistive technology.
export function describeClock(clock) {
  const c = clampClock(clock);
  const period =
    c < 5.25 ? 'night, moonlight' :
    c < 6.45 ? 'first light' :
    c < 7.0 ? 'sunrise' :
    c < 8.0 ? 'early morning' :
    c < 11.0 ? 'morning' :
    c < 13.5 ? 'midday' :
    c < 15.75 ? 'afternoon' :
    c < 17.1 ? 'late afternoon' :
    c < 17.9 ? 'sunset' :
    c < 19.6 ? 'dusk' : 'night, moonlight';
  return `${formatClock(c)}, ${period}`;
}
