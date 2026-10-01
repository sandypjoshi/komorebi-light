// The small icons beside the switches under the time and the links below, each
// drawn in its own canvas so a clip can record them exactly: "now", a dot that
// breathes while the light follows the visitor's clock; "sound", three bars that
// move while the music plays, stand a little while it waits for the first touch,
// and lie low when it is off; "screensaver", four corners that open a little
// under the pointer; and the marks of X and GitHub for the links. Everything is
// drawn in a 12 px box, its left edge 1 px in, so the icons line up with the
// words above them.

import { Spring } from './sunpath.js';

const BOX = 12;

// The X and GitHub marks, as their own makers draw them (X's 24 px mark, the
// 16 px mark-github from GitHub's Octicons).
const X_MARK = new Path2D('M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z');
const GITHUB_MARK = new Path2D('M8 0c4.42 0 8 3.58 8 8a8.013 8.013 0 0 1-5.45 7.59c-.4.08-.55-.17-.55-.38 0-.27.01-1.13.01-2.2 0-.75-.25-1.23-.54-1.48 1.78-.2 3.65-.88 3.65-3.95 0-.88-.31-1.59-.82-2.15.08-.2.36-1.02-.08-2.12 0 0-.67-.22-2.2.82-.64-.18-1.32-.27-2-.27-.68 0-1.36.09-2 .27-1.53-1.03-2.2-.82-2.2-.82-.44 1.1-.16 1.92-.08 2.12-.51.56-.82 1.28-.82 2.15 0 3.06 1.86 3.75 3.64 3.95-.23.2-.44.55-.51 1.07-.46.21-1.61.55-2.33-.66-.15-.24-.6-.83-1.23-.82-.67.01-.27.38.01.53.34.19.73.9.82 1.13.16.45.68 1.31 2.69.94 0 .67.01 1.3.01 1.49 0 .21-.15.45-.55.38A7.995 7.995 0 0 1 0 8c0-4.42 3.58-8 8-8Z');

export class Icons {
  constructor(root = document) {
    this.reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    this.items = [...root.querySelectorAll('[data-icon]')].map((el) => ({
      el,
      kind: el.dataset.icon,
      canvas: el.querySelector('canvas.icon'),
      hover: new Spring(0, 300),
      on: new Spring(el.getAttribute('aria-pressed') === 'true' ? 1 : 0, 90),
    }));
    this.time = 0;
    this.manual = false; // a clip steps them on its own clock
    this.ink = null; //    a colour to draw in instead of the page's
    this.frame = 0;
    this.last = 0;
    for (const it of this.items) {
      it.el.addEventListener('pointerenter', () => {
        it.hover.target = 1;
        this.wake();
      });
      it.el.addEventListener('pointerleave', () => {
        it.hover.target = 0;
        this.wake();
      });
    }
    // Pressed or not, shown or hidden: redraw when a switch changes.
    new MutationObserver(() => this.wake()).observe(root === document ? document.body : root, {
      subtree: true,
      attributes: true,
      attributeFilter: ['aria-pressed', 'hidden', 'data-playing'],
    });
    this.wake();
  }

  // Breathing and playing go on by themselves; the rest settles.
  get alive() {
    if (this.reduced.matches) return false;
    return this.items.some((it) => !it.el.hidden && ((it.kind === 'now' && it.el.getAttribute('aria-pressed') === 'true') || (it.kind === 'sound' && it.el.dataset.playing === 'true')));
  }

  get moving() {
    return this.items.some((it) => !it.hover.resting || !it.on.resting);
  }

  // Every switch's icon as it is now, without the easing (for stills).
  settle() {
    for (const it of this.items) {
      const pressed = it.el.getAttribute('aria-pressed') === 'true';
      it.on.jump(it.kind === 'sound' ? (it.el.dataset.playing === 'true' ? 1 : pressed ? 0.3 : 0) : pressed ? 1 : 0);
      it.hover.jump(it.hover.target);
    }
  }

  step(dt) {
    dt = Math.min(dt, 0.05);
    this.time += dt;
    for (const it of this.items) {
      const pressed = it.el.getAttribute('aria-pressed') === 'true';
      // The sound is on only once it is heard; until then it waits, half raised.
      it.on.target = it.kind === 'sound' ? (it.el.dataset.playing === 'true' ? 1 : pressed ? 0.3 : 0) : pressed ? 1 : 0;
      it.hover.step(dt);
      it.on.step(dt);
    }
  }

  wake() {
    if (this.manual || this.frame) return;
    this.last = performance.now();
    this.frame = requestAnimationFrame(() => this._tick());
  }

  _tick() {
    this.frame = 0;
    const now = performance.now();
    this.step((now - this.last) / 1000);
    this.last = now;
    this.draw();
    if (this.moving || this.alive) this.frame = requestAnimationFrame(() => this._tick());
  }

  draw() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    for (const it of this.items) {
      const c = it.canvas;
      if (!c || it.el.hidden) continue;
      const size = Math.round(BOX * dpr);
      if (c.width !== size) c.width = c.height = size;
      const ctx = c.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, BOX, BOX);
      const ink = this.ink ?? getComputedStyle(it.el).color;
      ctx.fillStyle = ink;
      ctx.strokeStyle = ink;
      ctx.lineWidth = 1.2;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      this[it.kind]?.(ctx, it);
    }
  }

  // A dot, filled while the light follows the visitor's clock, breathing out a
  // faint ring every two and a half seconds.
  now(ctx, it) {
    const on = it.on.value;
    const cx = 4.4;
    const cy = 6;
    if (on > 0.01 && !this.reduced.matches) {
      const p = (this.time % 2.6) / 2.6;
      const e = 1 - (1 - p) ** 3;
      ctx.globalAlpha = 0.42 * (1 - p) * on;
      ctx.beginPath();
      ctx.arc(cx, cy, 2.7 + 3 * e, 0, Math.PI * 2);
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.lineWidth = 1.2;
    }
    ctx.globalAlpha = 1;
    ctx.beginPath();
    ctx.arc(cx, cy, 2.7, 0, Math.PI * 2);
    ctx.stroke();
    if (on > 0.01) {
      ctx.globalAlpha = on;
      ctx.beginPath();
      ctx.arc(cx, cy, 2.7, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  // Three bars: short and still when the sound is off, moving with it when on.
  sound(ctx, it) {
    const on = it.on.value;
    const periods = [1.15, 1.55, 0.95];
    const phases = [0, 1.9, 3.7];
    const still = [0.55, 1, 0.7];
    ctx.lineCap = 'butt';
    for (let i = 0; i < 3; i++) {
      const wave = this.reduced.matches ? still[i] : 0.5 + 0.5 * Math.sin((2 * Math.PI * this.time) / periods[i] + phases[i]);
      const h = 3.2 + on * (1.4 + 4 * wave);
      const x = 1.8 + i * 3.4;
      ctx.beginPath();
      ctx.moveTo(x, 10);
      ctx.lineTo(x, 10 - h);
      ctx.stroke();
    }
    ctx.lineCap = 'round';
  }

  // Four corners of a screen, opening a little under the pointer.
  rest(ctx, it) {
    const o = 1.6 - 0.9 * it.hover.value;
    const a = 2.8;
    const lo = o;
    const hi = BOX - o;
    ctx.beginPath();
    ctx.moveTo(lo, lo + a);
    ctx.lineTo(lo, lo);
    ctx.lineTo(lo + a, lo);
    ctx.moveTo(hi - a, lo);
    ctx.lineTo(hi, lo);
    ctx.lineTo(hi, lo + a);
    ctx.moveTo(hi, hi - a);
    ctx.lineTo(hi, hi);
    ctx.lineTo(hi - a, hi);
    ctx.moveTo(lo + a, hi);
    ctx.lineTo(lo, hi);
    ctx.lineTo(lo, hi - a);
    ctx.stroke();
  }

  // X's mark, a little smaller than its box so it weighs as the round mark beside it.
  x(ctx) {
    const k = 0.44;
    ctx.save();
    ctx.translate(1 + (10.4 - 21.5 * k) / 2 - 1.25 * k, 6 - 12 * k);
    ctx.scale(k, k);
    ctx.fill(X_MARK);
    ctx.restore();
  }

  // GitHub's mark, filling the box.
  github(ctx) {
    const k = 10.6 / 16;
    ctx.save();
    ctx.translate(1, 6 - 8 * k);
    ctx.scale(k, k);
    ctx.fill(GITHUB_MARK);
    ctx.restore();
  }
}
