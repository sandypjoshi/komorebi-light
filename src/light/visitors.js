// Now and then a visitor comes to the light, one at a time: by day a sparrow
// to the shrub (bird.js), a butterfly or a bumblebee (insects.js); by
// lamplight and moonlight a moth. Only their shadows are seen.
//
// The schedule is a pure function of the seed and animation time: when each
// visit begins and how long it may last. By day the three take turns, in an
// order shuffled afresh each round so that no kind comes twice running. A
// visit is planned once, when it begins, from the light at that moment; in
// the wrong light, or none strong enough to cast a shadow, it simply does not
// happen.

import { makeRng, subSeed } from './random.js';
import { lerp } from './visit.js';
import { Bird } from './bird.js';
import { Bee, Butterfly, Moth } from './insects.js';

export const KINDS = ['sparrow', 'butterfly', 'bee', 'moth'];
const DAY = ['sparrow', 'butterfly', 'bee'];
// The first round, for whoever opens the page: a butterfly first.
const FIRST = ['butterfly', 'sparrow', 'bee'];
// Seconds a visit may run past its stay: flights in and out, the twig ringing.
const SPARE = 14;

export class Visitors {
  constructor(settings) {
    this.settings = settings;
    this.kinds = { sparrow: new Bird(), butterfly: new Butterfly(), bee: new Bee(), moth: new Moth() };
    this.seed = null;
    this.events = [];
    this.rounds = [];
    this.plans = new Map();
    this.manual = null;
  }

  // Bring a visitor now (development panel and capture API): `kind` one of
  // KINDS, or the one the light suits (the sparrow by day, the moth by night).
  visit(time, seed, kind = null) {
    const r = makeRng(seed ?? (Math.random() * 4294967296) >>> 0);
    const s = this.settings;
    this.manual = {
      id: `m${time.toFixed(3)}`,
      start: time,
      stay: lerp(s.stay[0], s.stay[1], r.next()),
      seed: (r.next() * 4294967296) >>> 0,
      kind,
      manual: true,
    };
  }

  // Forget the plans made so far, so the next frame plans afresh.
  reset() {
    this.plans.clear();
  }

  _schedule(seed, time) {
    const s = this.settings;
    if (seed !== this.seed) {
      this.seed = seed;
      this.events = [];
      this.rounds = [];
      this.plans.clear();
      this.rng = makeRng(subSeed(seed, 'visitors'));
      this.next = s.first + this.rng.range(0, s.firstJitter);
    }
    while (this.next < time + 240) {
      const r = this.rng;
      const stay = lerp(s.stay[0], s.stay[1], r.next());
      const i = this.events.length;
      this.events.push({ id: i, start: this.next, stay, seed: (r.next() * 4294967296) >>> 0, day: this._dayKind(i) });
      this.next += stay + 4 + r.range(s.gap[0], s.gap[1]);
    }
  }

  // Which of the day's visitors comes on the i-th visit.
  _dayKind(i) {
    const round = Math.floor(i / DAY.length);
    while (this.rounds.length <= round) {
      const n = this.rounds.length;
      if (n === 0) {
        this.rounds.push(FIRST);
        continue;
      }
      const r = makeRng(subSeed(this.seed, `visitors-round-${n}`));
      const last = this.rounds[n - 1][DAY.length - 1];
      let order;
      do {
        order = DAY.slice();
        for (let j = order.length - 1; j > 0; j--) {
          const k = Math.floor(r.next() * (j + 1));
          [order[j], order[k]] = [order[k], order[j]];
        }
      } while (order[0] === last);
      this.rounds.push(order);
    }
    return this.rounds[round][i % DAY.length];
  }

  // The visit under way at this time, if any.
  _active(time) {
    const m = this.manual;
    if (m && time >= m.start && time < m.start + m.stay + SPARE) return m;
    for (const e of this.events) {
      if (time < e.start) break;
      if (time < e.start + e.stay + SPARE && !(m && e.start + e.stay + SPARE > m.start - 1 && e.start < m.start + m.stay + SPARE)) return e;
    }
    return null;
  }

  // What to draw this frame. ctx: { seed, sun, elevation, daylight, night,
  // ready, view, probe(), window, wind, near: { x, rect, segments }, avoid }. Returns
  // null when no visitor is about, { gone, load } while the sparrow's twig
  // still rings after it, else the projected moments, the plane region, the
  // load on the shrub (or null), where the shadow is and what it is doing.
  update(time, ctx) {
    if (!this.settings.enabled) return null;
    this._schedule(ctx.seed, time);
    const e = this._active(time);
    if (!e) return null;
    let plan = this.plans.get(e.id);
    if (plan === undefined) {
      // Planning reads the light of the last frame; wait for one.
      if (!ctx.ready) return null;
      plan = this._plan(e, ctx);
      this.plans.set(e.id, plan);
    }
    if (!plan || time >= plan.end) return null;
    const v = this.kinds[plan.kind];
    if (time >= plan.tGone) return { gone: true, load: v.load ? v.load(plan, time) : null };
    const f = v.frame(plan, time, ctx);
    f.kind = plan.kind;
    return f;
  }

  _plan(e, ctx) {
    const s = this.settings;
    const kind = e.kind ?? (ctx.daylight ? e.day ?? 'sparrow' : ctx.night ? 'moth' : null);
    if (!kind || !this.kinds[kind]) return null;
    if (e.manual) {
      // Asked for: any light that casts a shadow will do.
      if (!ctx.daylight && !ctx.night) return null;
    } else {
      // In good sunlight for the day's visitors, lamplight or moonlight for
      // the moth, and high enough that the shadow is not stretched past
      // reading.
      if (kind === 'moth' ? !ctx.night : !ctx.daylight) return null;
      const lowest = kind === 'sparrow' ? s.minElevation : kind === 'moth' ? s.nightElevation : s.insectElevation;
      if (ctx.elevation < lowest) return null;
    }
    return this.kinds[kind].plan(e, ctx);
  }
}
