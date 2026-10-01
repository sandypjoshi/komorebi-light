// The small icons beside the switches under the time, each drawn in its own
// canvas so a clip can record them exactly: "now", a dot that breathes while
// the light follows the visitor's clock; "sound", three bars that move while
// the music plays and lie low when it is off; "screensaver", four corners that
// open a little under the pointer; and the code link's chevrons, which part.
// Everything is drawn in a 12 px box, its left edge 1 px in, so the icons line
// up with the words above them.

import { Spring } from './sunpath.js';

const BOX = 12;

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
      attributeFilter: ['aria-pressed', 'hidden'],
    });
    this.wake();
  }

  // Breathing and playing go on by themselves; the rest settles.
  get alive() {
    if (this.reduced.matches) return false;
    return this.items.some((it) => (it.kind === 'now' || it.kind === 'sound') && it.el.getAttribute('aria-pressed') === 'true' && !it.el.hidden);
  }

  get moving() {
    return this.items.some((it) => !it.hover.resting || !it.on.resting);
  }

  // Every switch's icon as it is now, without the easing (for stills).
  settle() {
    for (const it of this.items) {
      it.on.jump(it.el.getAttribute('aria-pressed') === 'true' ? 1 : 0);
      it.hover.jump(it.hover.target);
    }
  }

  step(dt) {
    dt = Math.min(dt, 0.05);
    this.time += dt;
    for (const it of this.items) {
      it.on.target = it.el.getAttribute('aria-pressed') === 'true' ? 1 : 0;
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

  // Code: two chevrons that part a little under the pointer.
  code(ctx, it) {
    const s = 0.8 * it.hover.value;
    ctx.beginPath();
    ctx.moveTo(4.4 - s, 2.8);
    ctx.lineTo(1.4 - s, 6);
    ctx.lineTo(4.4 - s, 9.2);
    ctx.moveTo(7.6 + s, 2.8);
    ctx.lineTo(10.6 + s, 6);
    ctx.lineTo(7.6 + s, 9.2);
    ctx.stroke();
  }
}
