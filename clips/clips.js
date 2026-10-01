// The clips posted with the page: 1920 × 1080 at 30 fps, recorded through the
// page's capture API on the development server, with the browser's view set to
// 960 × 540 at a device pixel ratio of 2. In the page's console:
//   const { record } = await import('/clips/clips.js');
//   await record('day');
// writes captures/clip-day/frame-*.jpg and captures/clip-day/track.wav, an
// excerpt of the music that starts at a phrase; then encode them (see the README).

import { pointAt } from '../src/sunpath.js';

const page = () => window.__komorebi;

// A smooth path through (t, value) keys that never turns back (Fritsch–Carlson).
function monotone(keys) {
  const n = keys.length;
  const xs = keys.map((k) => k[0]);
  const ys = keys.map((k) => k[1]);
  const d = [];
  for (let i = 0; i < n - 1; i++) d.push((ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]));
  const m = [d[0]];
  for (let i = 1; i < n - 1; i++) m.push(d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2);
  m.push(d[n - 2]);
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) {
      m[i] = m[i + 1] = 0;
      continue;
    }
    const a = m[i] / d[i];
    const b = m[i + 1] / d[i];
    const h = a * a + b * b;
    if (h > 9) {
      const s = 3 / Math.sqrt(h);
      m[i] = s * a * d[i];
      m[i + 1] = s * b * d[i];
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
    return (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h * m[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h * m[i + 1];
  };
}

const smooth = (x) => x * x * (3 - 2 * x);
const clamp01 = (x) => Math.min(1, Math.max(0, x));

// A hand's path between resting points: each move eases out of one point and
// into the next, bowing a little to one side, as a wrist does.
function hand(stops) {
  return (t) => {
    let i = 0;
    while (i < stops.length - 1 && t >= stops[i + 1].t) i++;
    const a = stops[i];
    const b = stops[i + 1];
    if (!b || t <= a.t + (a.hold ?? 0)) return { x: a.x, y: a.y };
    const k = smooth(clamp01((t - a.t - (a.hold ?? 0)) / (b.t - a.t - (a.hold ?? 0))));
    const bow = (b.bow ?? 0.06) * Math.sin(Math.PI * k);
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    return { x: a.x + dx * k - dy * bow, y: a.y + dy * k + dx * bow };
  };
}

// Where the sun sits on the instrument at a clock, in the page's px.
function sunAt(clock) {
  const s = document.querySelector('.sky').getBoundingClientRect();
  const p = pointAt(clock, s.width);
  return { x: s.left + p.x, y: s.top + p.y };
}

function inside(el, p, pad = 0) {
  const r = el.getBoundingClientRect();
  return p.x >= r.left - pad && p.x <= r.right + pad && p.y >= r.top - pad && p.y <= r.bottom + pad;
}

export const CLIPS = {
  // The whole day in 26.5 seconds, moonlight to moonlight, so it loops: dawn,
  // where komorezuki gives way to komorebi, morning, noon, the long afternoon
  // and sunset, then through the lamplit blue hour into the night and back to
  // komorezuki. The instrument plays.
  day: {
    seconds: 26.5,
    write: false,
    music: { from: 1.95, fadeIn: 0.05 }, // the opening chords
    setup() {
      const clock = monotone([[0, 4.6], [2.5, 5.75], [4.5, 6.6], [7.5, 8.5], [11, 12.5], [14.5, 16.2], [18.5, 17.9], [20.5, 18.35], [22.3, 20.3], [26.5, 21.4]]);
      const bird = page().state.bird.enabled;
      return {
        clock: clock(0),
        prepare: () => (page().state.bird.enabled = false),
        each: (t) => {
          page().daylight.toClock(clock(t), 0);
          return { playing: true };
        },
        done: () => (page().state.bird.enabled = bird),
      };
    },
  },

  // A morning, as it is: a sparrow comes to a twig, looks about, preens and
  // goes, and the twig rings after it.
  bird: {
    seconds: 30,
    write: false,
    music: { from: 11.85, fadeIn: 0.6 }, // the melody comes in
    clock: 10.5,
    seed: 2, // lands to the right of the words at 16:9
    setup() {
      const { renderer } = page();
      renderer.bird.plans.clear();
      let called = false;
      return {
        clock: this.clock,
        each: (t) => {
          if (!called && t >= 2) {
            called = true;
            page().visit(this.seed);
          }
          return {};
        },
      };
    },
  },

  // A hand takes the sun in the early morning and carries it along its arc to
  // the end of the afternoon, then rises through the words and across
  // "komorebi", lifting them off the page as it passes; they settle back on
  // behind it.
  drag: {
    seconds: 19,
    write: true,
    music: { from: 100.7, fadeIn: 0.6 }, // the melody, the second time
    from: 7.2,
    to: 17.75,
    setup() {
      const word = document.querySelector('.word');
      const controls = document.getElementById('controls');
      const tr = word.getBoundingClientRect();
      const a = sunAt(this.from);
      const b = sunAt(this.to);
      const sky = document.querySelector('.sky');
      const W = innerWidth;
      const H = innerHeight;
      const path = hand([
        { t: 0, x: W * 0.62, y: H * 1.06 },
        { t: 1.6, x: W * 0.62, y: H * 1.06 },
        { t: 3.3, x: a.x + 1, y: a.y + 2, bow: 0.1, hold: 0.35 },
        { t: 10.6, x: b.x + 1, y: b.y + 2, bow: 0.015, hold: 0.5 },
        { t: 12.6, x: tr.left + tr.width * 0.06, y: tr.top + tr.height * 0.62, bow: -0.1 },
        { t: 14.8, x: tr.left + tr.width * 0.94, y: tr.top + tr.height * 0.5, bow: 0.05 },
        { t: 16.6, x: W * 0.7, y: H * 0.42, bow: -0.08 },
      ]);
      // Along the scale the hand starts slowly, finds its pace and slows to
      // let go, so the light swings and settles.
      const dragFrom = 3.3 + 0.35;
      const dragTo = 10.6 + 0.25;
      let strength = 0.74;
      let active = 0;
      let last = null;
      let held = false;
      let over = false;
      return {
        clock: this.from,
        each: (t) => {
          const p = path(t);
          const slider = page().slider;
          const ms = t * 1000;
          // While it holds the sun, the hand rides with it along its arc.
          if (held) p.y = sunAt(slider.head.value).y + 2;
          // The hand on the instrument, through its own pointer methods: over
          // it, it shows the time beneath; pressed on the sun, it carries it.
          const onSky = inside(sky, p);
          if (onSky && !held) slider.hoverAt(p.x);
          if (!onSky && over && !held) slider.leave();
          over = onSky;
          if (!held && t >= dragFrom && t < dragTo) {
            held = true;
            slider.pressAt(p.x, ms);
          } else if (held && t < dragTo) slider.dragTo(p.x, ms);
          else if (held && t >= dragTo) {
            held = false;
            slider.release(ms);
          }
          if (held || onSky) active = t + 1.6;
          // The instrument brightens under the hand (CSS: 0.5 s) and while in use.
          const on = inside(controls, p) || t < active;
          strength += ((on ? 0.95 : 0.74) - strength) * (1 - Math.exp(-(1 / 30) / 0.16));
          if (last === null || Math.hypot(p.x - last.x, p.y - last.y) > 0.01) {
            window.dispatchEvent(new PointerEvent('pointermove', { clientX: p.x, clientY: p.y }));
            last = p;
          }
          const shown = p.y < H + 2 && p.x < W + 2;
          return { cursor: shown ? p : null, instrument: strength };
        },
      };
    },
  },
};

// Record a clip's frames and its music.
export async function record(name, { dir = `clip-${name}`, fps = 30, music = CLIPS[name].music } = {}) {
  const clip = CLIPS[name];
  const plan = clip.setup();
  try {
    const frames = await page().captureSequence({
      dir,
      fps,
      seconds: clip.seconds,
      clock: plan.clock,
      write: clip.write,
      prepare: plan.prepare,
      each: plan.each,
    });
    let track = null;
    if (music) track = await page().recordTrack({ name: 'track.wav', dir, seconds: clip.seconds, ...music });
    return { name, dir, frames, track };
  } finally {
    plan.done?.();
  }
}
