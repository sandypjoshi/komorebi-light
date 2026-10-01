// The time of day as the sky itself: the sun's arc over the horizon by day and
// the moon's lower arc by night, and on them the sun or the moon, which is what
// the hand moves. Press anywhere and it springs there along its path; drag and
// it follows; let go fast and it glides on and slows. It holds a little at
// sunrise, at sunset and at the visitor's own time, the way a dial has detents,
// and names the moment. The time rides above it, its figures rolling as the
// minutes go by. At rest there are only the arcs, the horizon and the quarter
// hours; reaching for it brings out every hour, and a faint sun where the
// pointer is, with its time. The arcs are exact curves, drawn finely: the sun's
// travelled part a little stronger, the moon's in round dots. A native range
// input lies over the drawing, so keyboard, touch and assistive technology work
// as they do everywhere else.

import { describeClock, formatClock } from './light/daylight.js';

const INSET = 4.5; //  px: where 00:00 and 24:00 sit, half the range input's thumb (index.html)
const ROOM = 20; //    px: room above the sky for the time
const SKY = 36; //     px: the height the sun reaches above the horizon at noon
export const HORIZON = ROOM + SKY;
const TICK = 5; //     px: an hour tick at the quarters of the day
const UI_FONT = 'ui-sans-serif, system-ui, -apple-system, "Helvetica Neue", Arial, sans-serif';
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const smooth = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

// ---- the sky ------------------------------------------------------------------------

// When the sun and the moon are up in the study's light, as exact arcs: a sine
// from rising to setting, the moon's lower and across midnight.
const SUN = { rise: 6.0, set: 18.32, height: 0.92 };
const MOON = { rise: 19.2, set: 6.45, height: 0.56 };

// Height above the horizon, as a fraction of the sky, or null while below it.
export function sunHeight(c) {
  if (c <= SUN.rise || c >= SUN.set) return null;
  return SUN.height * Math.sin((Math.PI * (c - SUN.rise)) / (SUN.set - SUN.rise));
}
export function moonHeight(c) {
  const span = (MOON.set - MOON.rise + 24) % 24;
  const u = (c - MOON.rise + 24) % 24;
  if (u <= 0 || u >= span) return null;
  return MOON.height * Math.sin((Math.PI * u) / span);
}

// The light that leads at an hour, and where it is: the sun, else the moon,
// else (between sunset and moonrise) a point on the horizon.
export function bodyAt(c) {
  const s = sunHeight(c);
  if (s !== null) return { kind: 'sun', height: s };
  const m = moonHeight(c);
  if (m !== null) return { kind: 'moon', height: m };
  return { kind: 'dusk', height: 0 };
}

// Where the light sits in an instrument W px wide, in its own px.
export function pointAt(c, W) {
  const b = bodyAt(c);
  return { x: INSET + (c / 24) * (W - 2 * INSET), y: HORIZON - b.height * SKY, kind: b.kind };
}

// ---- motion ---------------------------------------------------------------------------

// A spring toward a target. Critically damped unless told otherwise, so it
// arrives without overshooting; fast enough to feel direct.
export class Spring {
  constructor(value, stiffness = 420, damping = 2 * Math.sqrt(stiffness)) {
    this.value = value;
    this.target = value;
    this.velocity = 0;
    this.stiffness = stiffness;
    this.damping = damping;
  }
  step(dt) {
    const n = Math.max(1, Math.ceil(dt * 240));
    const h = dt / n;
    for (let i = 0; i < n; i++) {
      const a = this.stiffness * (this.target - this.value) - this.damping * this.velocity;
      this.velocity += a * h;
      this.value += this.velocity * h;
    }
    if (this.resting) {
      this.value = this.target;
      this.velocity = 0;
    }
  }
  get resting() {
    return Math.abs(this.target - this.value) < 1e-4 && Math.abs(this.velocity) < 1e-3;
  }
  jump(v) {
    this.value = this.target = v;
    this.velocity = 0;
  }
}

// The time's digits roll as they change, up as time goes forward, down as it
// goes back. A figure that changed only a moment ago changes at once instead:
// rolling it again before it had settled would blur it (the minutes as the day
// plays fast), while the slower figures still roll.
class Roller {
  constructor() {
    this.cells = [];
    this.text = '';
    this.clock = 0;
  }
  set(text, dir, animate) {
    if (text === this.text) return;
    this.cells = [...text].map((ch, i) => {
      const old = this.cells[i];
      if (old && old.ch === ch) return old;
      const roll = animate && old && this.clock - old.at > 0.3;
      return { ch, from: roll ? old.ch : null, t: roll ? 0 : 1, dir, at: this.clock };
    });
    this.text = text;
  }
  step(dt) {
    this.clock += dt;
    for (const c of this.cells) if (c.t < 1) c.t = Math.min(1, c.t + dt / 0.22);
  }
  get moving() {
    return this.cells.some((c) => c.t < 1);
  }
}

// ---- the instrument ---------------------------------------------------------------------

export class SunPath {
  constructor(root, { onScrub, onCommit, onPlay, onNow }) {
    this.root = root;
    this.sky = root.querySelector('.sky');
    this.canvas = this.sky.querySelector('canvas');
    this.input = root.querySelector('.day-range');
    this.playButton = root.querySelector('.day-play');
    this.nowButton = root.querySelector('.day-now');
    this.handlers = { onScrub, onCommit };
    this.reduced = window.matchMedia('(prefers-reduced-motion: reduce)');

    this.clock = 0; //        the time the page shows
    this.value = 0; //        the time being set while the hand holds it
    this.now = null; //       the visitor's own time
    this.live = null;
    this.playing = null;
    this.head = new Spring(0, 420); //       where the playhead is drawn, in hours
    this.ghost = new Spring(0, 900); //      the time under the pointer
    this.ghostOn = new Spring(0, 260); //    and how much it shows
    this.detail = new Spring(0, 170); //     every hour, while reached for
    this.press = new Spring(0, 520, 26); //  the marker grows a little when held (and bounces at a detent)
    this.roller = new Roller();
    this.hovering = false;
    this.focused = false;
    this.dragging = false;
    this.touch = false;
    this.fling = null;
    this.samples = [];
    this.offset = 0;
    this.moment = null; //    the detent the playhead is at
    this.ink = null; //       a colour to draw in instead of the page's (a clip sets it)
    this.manual = false; //   a clip steps the motion on its own clock
    this.frame = 0;
    this.last = 0;
    this.inkSeen = '';
    this.fadeUntil = 0;

    const input = this.input;
    input.min = '0';
    input.max = '1440';
    input.step = '1';

    input.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      input.focus({ preventScroll: true });
      input.setPointerCapture?.(e.pointerId);
      this.touch = e.pointerType === 'touch';
      this.pressAt(e.clientX, e.timeStamp);
    });
    input.addEventListener('pointermove', (e) => {
      if (this.dragging) this.dragTo(e.clientX, e.timeStamp);
      else if (e.pointerType !== 'touch') this.hoverAt(e.clientX);
    });
    input.addEventListener('pointerup', (e) => this.release(e.timeStamp));
    input.addEventListener('pointercancel', () => this.release());
    input.addEventListener('pointerleave', () => this.leave());
    input.addEventListener('focus', () => {
      this.focused = true;
      this._wake();
    });
    input.addEventListener('blur', () => {
      this.focused = false;
      this._wake();
    });
    // Keys move in five-minute steps (Shift, or the Page keys: an hour); Home and
    // End go to the ends of the day. The playhead glides there.
    input.addEventListener('keydown', (e) => {
      const hour = e.shiftKey ? 60 : 5;
      const step = { ArrowLeft: -hour, ArrowDown: -hour, ArrowRight: hour, ArrowUp: hour, PageDown: -60, PageUp: 60 }[e.key];
      let minutes;
      if (step !== undefined) minutes = Math.round((Math.round(this.clock * 60) + step) / 5) * 5;
      else if (e.key === 'Home') minutes = 0;
      else if (e.key === 'End') minutes = 1439;
      else return;
      e.preventDefault();
      const v = (((minutes % 1440) + 1440) % 1440) / 60;
      this.fling = null;
      this.value = v;
      this.handlers.onScrub(v);
      this.handlers.onCommit?.(v);
    });
    this.playButton.addEventListener('click', () => onPlay());
    this.nowButton?.addEventListener('click', () => onNow?.());
    new ResizeObserver(() => this.draw()).observe(this.sky);
  }

  show() {
    this.root.hidden = false;
    this.draw();
  }

  // ---- what the page tells it --------------------------------------------------

  // The time shown, whether the day plays, whether the light follows the
  // visitor's clock, and that clock.
  sync(clock, playing, live = false, now = null) {
    if (this.nowButton && this.live !== live) {
      this.live = live;
      this.nowButton.setAttribute('aria-pressed', String(live));
    }
    if (this.playing !== playing) {
      this.playing = playing;
      this.playButton.setAttribute('aria-pressed', String(playing));
      this.playButton.setAttribute('aria-label', playing ? 'Pause the day' : 'Play the day');
    }
    this.now = now;
    this.clock = clock;
    if (!this.dragging && !this.fling) {
      this.head.target = clock;
      // Large moves (a new time chosen far away) glide; small ones keep pace.
      if (Math.abs(this.head.value - clock) > 6) this.head.stiffness = 170;
      else this.head.stiffness = 420;
      this.head.damping = 2 * Math.sqrt(this.head.stiffness);
      this.moment = this._momentAt(clock);
    }
    const v = String(Math.round(clock * 60) % 1440);
    if (this.input.value !== v) this.input.value = v;
    const said = describeClock(clock) + (this.live ? ', now' : '');
    if (said !== this.said) {
      this.said = said;
      this.input.setAttribute('aria-valuetext', said);
    }
    if (this.first === undefined) {
      // The first time: the playhead travels from midnight to the hour, unless
      // motion is unwelcome.
      this.first = false;
      if (this.reduced.matches) this.head.jump(clock);
    }
    this._wake();
  }

  // ---- the hand ----------------------------------------------------------------------

  hoverAt(clientX) {
    this.hovering = true;
    const c = this._clockAt(clientX);
    // Near the playhead, its marker swells a little: it can be taken.
    const r = this.sky.getBoundingClientRect();
    this.near = Math.abs(this._x(this.head.value, r.width) - (clientX - r.left)) < 12;
    if (this.ghostOn.value < 0.05) this.ghost.jump(c);
    this.ghost.target = c;
    this._wake();
  }

  leave() {
    this.hovering = false;
    this.near = false;
    this._wake();
  }

  pressAt(clientX, time = performance.now()) {
    const c = this._clockAt(clientX);
    this.dragging = true;
    this.fling = null;
    this.root.classList.add('is-dragging');
    // Held by the playhead itself: it stays where it was taken. Pressed
    // anywhere else: it springs to the hand.
    const r = this.sky.getBoundingClientRect();
    const onHead = Math.abs(this._x(this.head.value, r.width) - (clientX - r.left)) < 12;
    this.offset = onHead ? this.head.value - c : 0;
    this.head.stiffness = 700;
    this.head.damping = 2 * Math.sqrt(700);
    this.press.target = 1;
    this.samples = [[time, c]];
    this._set(c + this.offset);
  }

  dragTo(clientX, time = performance.now()) {
    if (!this.dragging) return;
    const c = this._clockAt(clientX);
    this.samples.push([time, c]);
    while (this.samples.length > 2 && time - this.samples[0][0] > 90) this.samples.shift();
    this._set(c + this.offset);
  }

  release(time = performance.now()) {
    if (!this.dragging) return;
    this.dragging = false;
    this.root.classList.remove('is-dragging');
    this.press.target = 0;
    this.near = false;
    // Let go while moving: the time glides on and slows.
    const s = this.samples;
    const span = s.length > 1 ? (s[s.length - 1][0] - s[0][0]) / 1000 : 0;
    const speed = span > 0.012 ? (s[s.length - 1][1] - s[0][1]) / span : 0;
    if (Math.abs(speed) > 4 && !this.moment && !this.reduced.matches && time - s[s.length - 1][0] < 60) this.fling = { speed };
    else this.handlers.onCommit?.(this.value);
    this._wake();
  }

  // ---- inside ------------------------------------------------------------------------

  _set(c) {
    const v = this._detent(clamp(c, 0, 24 - 1 / 60));
    this.value = v;
    this.head.target = v;
    this.handlers.onScrub(v);
    this._wake();
  }

  // Detents: near sunrise, sunset or the visitor's own time the playhead holds
  // on, then lets go, so those moments are easy to find and feel found.
  _marks() {
    // The sun's first and last minutes on the paper, not the horizon crossings,
    // so the sun itself is what the playhead holds.
    const marks = [
      { at: 6.1, name: 'sunrise' },
      { at: 18.25, name: 'sunset' },
    ];
    if (!this.live && this.now !== null) marks.push({ at: this.now, name: 'now' });
    return marks;
  }

  _detent(v) {
    const r = this.sky.getBoundingClientRect();
    const reach = 8 / ((r.width - 2 * INSET) / 24); // 8 px, in hours
    for (const m of this._marks()) {
      const d = v - m.at;
      if (Math.abs(d) < reach) {
        const held = Math.abs(d) < reach * 0.45;
        if (held && this.moment !== m.name) {
          this.press.velocity += 9; // a small bump, felt in the marker
          this.moment = m.name;
        }
        if (held) return m.at;
        this.moment = null;
        return m.at + d * smooth(reach * 0.45, reach, Math.abs(d));
      }
    }
    this.moment = null;
    return v;
  }

  _momentAt(c) {
    if (this.live) return 'now';
    for (const m of this._marks()) if (Math.abs(c - m.at) < 1 / 120) return m.name;
    return null;
  }

  _clockAt(clientX) {
    const r = this.sky.getBoundingClientRect();
    return clamp(((clientX - r.left - INSET) / (r.width - 2 * INSET)) * 24, 0, 24);
  }

  _x(clock, W) {
    return INSET + (clock / 24) * (W - 2 * INSET);
  }

  // Advance the motion by dt seconds.
  step(dt) {
    dt = Math.min(dt, 0.05);
    if (this.fling) {
      const f = this.fling;
      this.value = clamp(this.value + f.speed * dt, 0, 24 - 1 / 60);
      f.speed *= Math.exp(-dt / 0.28);
      this.head.target = this.value;
      this.handlers.onScrub(this.value);
      if (Math.abs(f.speed) < 0.2 || this.value <= 0 || this.value >= 24 - 1 / 60) {
        this.fling = null;
        this.handlers.onCommit?.(this.value);
      }
    }
    const reaching = this.hovering || this.focused || this.dragging;
    this.detail.target = reaching ? 1 : 0;
    if (!this.dragging) this.press.target = this.near && this.hovering ? 0.35 : 0;
    this.ghostOn.target = this.hovering && !this.dragging && !this.touch ? 1 : 0;
    for (const s of [this.head, this.ghost, this.ghostOn, this.detail, this.press]) s.step(dt);
    // The time shown is the playhead's own. Its digits roll for small steps (the
    // minutes going by as the day plays, a key pressed) and change at once in
    // a sweep.
    const shown = this.dragging || this.fling ? this.value : this.head.value;
    const step = shown - (this.shown ?? shown);
    this.shown = shown;
    this.roller.set(formatClock(shown), Math.sign(step) || 1, !this.dragging && !this.fling && Math.abs(step) < 3 / 60 && !this.reduced.matches);
    this.roller.step(dt);
  }

  get moving() {
    return Boolean(this.fling) || this.roller.moving || ![this.head, this.ghost, this.ghostOn, this.detail, this.press].every((s) => s.resting);
  }

  // Jump every motion to where it is going (for stills).
  settle() {
    for (const s of [this.head, this.ghost, this.ghostOn, this.detail, this.press]) s.jump(s.target);
    this.shown = this.dragging || this.fling ? this.value : this.head.value;
    this.roller.set(formatClock(this.shown), 1, false);
    this.roller.step(1);
  }

  _wake() {
    if (this.manual) return;
    if (this.frame) return;
    this.last = performance.now();
    this.frame = requestAnimationFrame(() => this._tick());
  }

  _tick() {
    this.frame = 0;
    const now = performance.now();
    this.step((now - this.last) / 1000);
    this.last = now;
    this.draw();
    if (this.moving || (performance.now() < this.fadeUntil && !this.ink)) {
      this.frame = requestAnimationFrame(() => this._tick());
    }
  }

  // ---- drawing ------------------------------------------------------------------------

  draw() {
    const r = this.sky.getBoundingClientRect();
    const W = r.width;
    const H = r.height;
    if (!W || !H) return;
    // Drawn at least twice over, so fine curves stay smooth on any screen.
    const dpr = clamp(window.devicePixelRatio || 1, 2, 3);
    const c = this.canvas;
    const cw = Math.round(W * dpr);
    const ch = Math.round(H * dpr);
    if (c.width !== cw || c.height !== ch) {
      c.width = cw;
      c.height = ch;
    }
    const ctx = c.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    // The ink follows the page's, through its change of theme.
    const ink = this.ink ?? getComputedStyle(this.root).color;
    if (ink !== this.inkSeen) {
      if (this.inkSeen) this.fadeUntil = performance.now() + 900;
      this.inkSeen = ink;
      if (!this.ink) this._wake();
    }
    ctx.fillStyle = ink;
    ctx.strokeStyle = ink;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    const snap = (v) => Math.round(v * dpr) / dpr;
    const x = (clock) => this._x(clock, W);
    const at = this.head.value;
    const detail = this.detail.value;
    const reach = Math.max(detail, clamp(this.press.value, 0, 1));
    const here = pointAt(at, W);

    // The sun's arc: one exact curve, the part already travelled today a little
    // stronger than the part to come.
    const sunArc = (from, to) => {
      const pts = [];
      const a = x(from);
      const b = x(to);
      for (let px = a; px < b; px += 0.75) {
        const cl = ((px - INSET) / (W - 2 * INSET)) * 24;
        pts.push([px, HORIZON - (sunHeight(cl) ?? 0) * SKY]);
      }
      pts.push([b, HORIZON - (sunHeight(to) ?? 0) * SKY]);
      return pts;
    };
    const stroke = (pts, alpha, width) => {
      if (pts.length < 2) return;
      ctx.beginPath();
      pts.forEach(([px, py], i) => (i ? ctx.lineTo(px, py) : ctx.moveTo(px, py)));
      ctx.globalAlpha = alpha;
      ctx.lineWidth = width;
      ctx.stroke();
    };
    const day = clamp(at, SUN.rise, SUN.set);
    stroke(sunArc(SUN.rise, day), 0.7, 1.3);
    stroke(sunArc(day, SUN.set), 0.32, 1.3);

    // The moon's arc, lower, across midnight, in round dots evenly spaced along
    // it; those it has passed tonight a little stronger.
    const moonSpan = (MOON.set - MOON.rise + 24) % 24;
    const tonight = (at - MOON.rise + 24) % 24; // hours since moonrise
    const dots = (from, to, alphaFor) => {
      let carry = 0;
      let prev = null;
      for (let px = x(from); px <= x(to) + 0.01; px += 0.5) {
        const cl = ((px - INSET) / (W - 2 * INSET)) * 24;
        const p = [px, HORIZON - (moonHeight(cl) ?? 0) * SKY];
        if (prev) carry += Math.hypot(p[0] - prev[0], p[1] - prev[1]);
        if (!prev || carry >= 3.4) {
          carry = 0;
          ctx.globalAlpha = alphaFor(cl);
          ctx.beginPath();
          ctx.arc(p[0], p[1], 0.72, 0, Math.PI * 2);
          ctx.fill();
        }
        prev = p;
      }
    };
    const passed = (cl) => {
      const since = (cl - MOON.rise + 24) % 24;
      return tonight < moonSpan && since <= tonight ? 0.62 : 0.3;
    };
    dots(MOON.rise, 24, passed);
    dots(0, MOON.set, passed);

    // The horizon, fading at its ends, and the hours along it: the quarters
    // always, every hour while reached for.
    const rgb = (ink.match(/[\d.]+/g) || [0, 0, 0]).slice(0, 3).join(', ');
    const hz = ctx.createLinearGradient(INSET, 0, W - INSET, 0);
    const base = 0.3 + 0.12 * detail;
    hz.addColorStop(0, `rgba(${rgb}, 0)`);
    hz.addColorStop(0.035, `rgba(${rgb}, ${base})`);
    hz.addColorStop(0.965, `rgba(${rgb}, ${base})`);
    hz.addColorStop(1, `rgba(${rgb}, 0)`);
    ctx.globalAlpha = 1;
    ctx.fillStyle = hz;
    ctx.fillRect(snap(INSET), snap(HORIZON), W - 2 * INSET, 1);
    ctx.fillStyle = ink;
    for (let h = 0; h <= 24; h++) {
      const quarter = h % 6 === 0;
      const alpha = quarter ? 0.34 + 0.14 * detail : 0.36 * detail;
      if (alpha < 0.01) continue;
      ctx.globalAlpha = alpha;
      ctx.fillRect(snap(x(h)) - 0.5, snap(HORIZON) + 2, 1, quarter ? TICK : 2.5);
    }
    ctx.font = `400 10px ${UI_FONT}`;
    ctx.textBaseline = 'alphabetic';
    if ('letterSpacing' in ctx) ctx.letterSpacing = '0.4px';
    ctx.globalAlpha = 0.32 + 0.22 * detail;
    for (const h of [0, 6, 12, 18, 24]) {
      // The ends sit inside the drawing, flush with their ticks.
      ctx.textAlign = h === 0 ? 'left' : h === 24 ? 'right' : 'center';
      ctx.fillText(String(h).padStart(2, '0'), h === 0 ? 0 : h === 24 ? W : x(h), HORIZON + TICK + 13);
    }

    // Now, while the time shown is not the visitor's own: a small notch.
    if (!this.live && this.now !== null && Math.abs(this.now - at) > 0.04) {
      ctx.globalAlpha = 0.6;
      ctx.fillRect(snap(x(this.now)) - 0.5, snap(HORIZON) - 3, 1, 6);
    }

    // Where the pointer is: a faint sun (or moon) on its path, and its time.
    const ghostAlpha = this.ghostOn.value * smooth(20, 44, Math.abs(x(this.ghost.value) - here.x));
    if (ghostAlpha > 0.01) {
      const g = pointAt(this.ghost.value, W);
      ctx.globalAlpha = 0.45 * ghostAlpha;
      ctx.lineWidth = 1.1;
      ctx.beginPath();
      ctx.arc(g.x, g.y, 3.4, 0, Math.PI * 2);
      ctx.stroke();
      this._label(ctx, W, formatClock(this.ghost.value), g.x, g.y - 11, 0.5 * ghostAlpha);
    }

    // The light itself, which the hand moves: a little clear paper around it,
    // so it sits on its path, and a fine ring while it is reached for.
    const grow = 1 + 0.24 * clamp(this.press.value, -0.5, 1.6);
    const R = (here.kind === 'moon' ? 4.4 : here.kind === 'sun' ? 4.2 : 2.8) * grow;
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'destination-out';
    ctx.beginPath();
    ctx.arc(here.x, here.y, R + 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
    if (reach > 0.01) {
      ctx.globalAlpha = 0.24 * reach;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(here.x, here.y, R + 4.5 + 1.5 * reach, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    if (here.kind === 'sun') {
      ctx.beginPath();
      ctx.arc(here.x, here.y, R, 0, Math.PI * 2);
      ctx.fill();
    } else if (here.kind === 'moon') {
      this._crescent(ctx, here.x, here.y, R, ink, dpr);
    } else {
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(here.x, here.y, R, 0, Math.PI * 2);
      ctx.stroke();
    }

    // The time, riding above it, and the moment it is at, if any.
    this._time(ctx, W, here.x, here.y - R - 7);
    if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
    ctx.globalAlpha = 1;
  }

  _label(ctx, W, text, cx, baseline, alpha) {
    ctx.font = `400 12px ${UI_FONT}`;
    if ('letterSpacing' in ctx) ctx.letterSpacing = '0.3px';
    const w = ctx.measureText(text).width;
    ctx.textAlign = 'center';
    ctx.globalAlpha = alpha;
    ctx.fillText(text, clamp(cx, w / 2 + 1, W - w / 2 - 1), Math.max(11, baseline));
  }

  _time(ctx, W, cx, baseline) {
    ctx.font = `500 13px ${UI_FONT}`;
    if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
    // Figures in even cells, so the time does not shift as it changes.
    let cell = 0;
    for (const d of '0123456789') cell = Math.max(cell, ctx.measureText(d).width);
    const colon = ctx.measureText(':').width + 1;
    const cells = this.roller.cells;
    const widths = cells.map((c) => (c.ch === ':' ? colon : cell + 0.6));
    const total = widths.reduce((a, b) => a + b, 0);
    const name = this.moment;
    let nameW = 0;
    if (name) {
      ctx.font = `400 11px ${UI_FONT}`;
      nameW = ctx.measureText(name).width + 6;
      ctx.font = `500 13px ${UI_FONT}`;
    }
    let left = clamp(cx - total / 2, 1, W - total - nameW - 1);
    const y = Math.max(12, baseline);
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, y - 12, W, 15);
    ctx.clip();
    ctx.textAlign = 'center';
    cells.forEach((c, i) => {
      const mid = left + widths[i] / 2;
      if (c.from !== null && c.t < 1) {
        const e = 1 - (1 - c.t) ** 3;
        const lift = 9 * c.dir;
        ctx.globalAlpha = 0.95 * (1 - e);
        ctx.fillText(c.from, mid, y - lift * e);
        ctx.globalAlpha = 0.95 * e;
        ctx.fillText(c.ch, mid, y + lift * (1 - e));
      } else {
        ctx.globalAlpha = 0.95;
        ctx.fillText(c.ch, mid, y);
      }
      left += widths[i];
    });
    ctx.restore();
    if (name) {
      ctx.font = `400 11px ${UI_FONT}`;
      ctx.textAlign = 'left';
      ctx.globalAlpha = 0.55;
      ctx.fillText(name, left + 6, y);
    }
  }

  // The moon as a crescent, cut from a disc on a scratch canvas.
  _crescent(ctx, cx, cy, r, ink, dpr) {
    const size = Math.ceil((r * 2 + 4) * dpr);
    if (!this.scratch || this.scratch.width !== size) {
      this.scratch = document.createElement('canvas');
      this.scratch.width = this.scratch.height = size;
    }
    const s = this.scratch.getContext('2d');
    s.setTransform(dpr, 0, 0, dpr, 0, 0);
    s.clearRect(0, 0, size, size);
    const m = size / dpr / 2;
    s.globalCompositeOperation = 'source-over';
    s.fillStyle = ink;
    s.beginPath();
    s.arc(m, m, r, 0, Math.PI * 2);
    s.fill();
    s.globalCompositeOperation = 'destination-out';
    s.beginPath();
    s.arc(m + r * 0.5, m - r * 0.28, r * 0.84, 0, Math.PI * 2);
    s.fill();
    ctx.globalAlpha = 1;
    ctx.drawImage(this.scratch, cx - m, cy - m, size / dpr, size / dpr);
  }
}
