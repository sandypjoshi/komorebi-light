// Insects that come to the light (visitors.js): a butterfly and a bumblebee
// by day, a moth by lamplight and moonlight. Only their shadows are seen.
//
// Like the sparrow (bird.js), each is a small model in 3D, posed every frame
// and cast along the light onto a plane through its body; the light pass then
// softens that shadow by the insect's distance from the paper, as it does
// every leaf's. They are small, so they come close: they fly about in the
// light between the shrub and the window, and now and then in at the open
// window, over the near edge of the desk, out of sight but for their shadows,
// which are sharpest there; they settle on the bar across the window or on
// the shrub's twigs, swaying with them. Each visit is planned
// once, from the light at that moment, and every frame is then a pure
// function of its seed and animation time. None appears or vanishes: each
// comes in from out over the garden along the light, a faint blur that
// gathers as it nears, and leaves the same way.
//
//   butterfly  flutters about the light in flaps and short glides, its body
//              bobbing with every beat; often settles to bask, its open wings
//              to the sun, closing and opening them now and then.
//   bee        a bumblebee: hovers in front of twigs and at the window, darts
//              between them, sometimes lands for a moment. Its wings
//              beat too fast to see, a translucent blur; its hind legs hang.
//   moth       dances in the light in quick jinks; often settles with its
//              wings swept back into a delta, keeps still, shivers its wings
//              warm, and flies on.

import { makeRng } from './random.js';
import {
  DEG, TAU, MAX_PRIMS, MAX_MOMENTS, SHUTTER, add, sub, mul, cross, len, norm, mix3, lerp, clamp, ease, smooth, turnToward, wrap,
  frame, toWorld, dirWorld, rotX, rotY, rotZ, Track, Route, wobble, viewFraction, paperAt, viewReach, shadowOf, lift, litAt,
  clearOf, branchesOf, branchAt, twigAt, cast,
} from './visit.js';

const frac = (x) => x - Math.floor(x);

// A flat wing about its root, in the body's frame: raised by `phi` about the
// body's long axis, swept back by `sweep` about its up axis, and its stroke
// plane tilted by `tilt` about its side axis. Points on it are (span, chord)
// from the root, chord toward the tail.
function wing(body, root, side, phi, sweep, tilt = 0) {
  const turn = (v) => rotY(rotZ(rotX(v, side * phi), side * sweep), tilt);
  const ds = dirWorld(body, turn([0, side, 0]));
  const dc = dirWorld(body, turn([-1, 0, 0]));
  const o = toWorld(body, root);
  const at = (s, c) => add(o, add(mul(ds, s), mul(dc, c)));
  return {
    at,
    // An oval on the wing, centred at (s, c): half-length `a` along a line
    // turned by `rot` from the span toward the tail, half-width `b` across.
    oval(s, c, a, b, rot, k, clear = 0) {
      const u = add(mul(ds, Math.cos(rot)), mul(dc, Math.sin(rot)));
      const w = add(mul(ds, -Math.sin(rot)), mul(dc, Math.cos(rot)));
      return { t: 'E', c: at(s, c), axes: [mul(u, a), mul(w, b), mul(norm(cross(ds, dc)), 0.0002)], k, clear };
    },
  };
}

// An ellipsoid in a body's frame.
const blob = (body, at, r, k) => ({ t: 'E', c: toWorld(body, at), axes: [mul(body.x, r[0]), mul(body.y, r[1]), mul(body.z, r[2])], k });

// An abdomen hanging back from the thorax at `joint`, lowered by `droop`.
function abdomen(body, joint, droop, length, r, k) {
  const back = dirWorld(body, [-Math.cos(droop), 0, -Math.sin(droop)]);
  const up = dirWorld(body, [-Math.sin(droop), 0, Math.cos(droop)]);
  const j = toWorld(body, joint);
  return { t: 'E', c: add(j, mul(back, length * 0.95)), axes: [mul(back, length), mul(body.y, r[0]), mul(up, r[1])], k };
}

// ---- what the insects share ----------------------------------------------------------

class Insect {
  constructor() {
    this.data = new Float32Array(MAX_MOMENTS * (3 * MAX_PRIMS + 1) * 4);
  }

  // How much light falls where a point in the air casts its shadow, and
  // where points `size` around it do.
  _lit(ctx, probe, B, size) {
    let sum = 0;
    for (const d of [[0, 0, 0], [0, size, 0], [0, -size, 0], [0, 0, size], [0, 0, -size]]) {
      sum += litAt(probe, viewFraction(ctx.view, shadowOf(add(B, d), ctx.sun)));
    }
    return sum / 5;
  }

  // A place on the page for the shadow, in the light and clear of the edges
  // (and of the page's words, if it can), for an insect at distance x from
  // the wall.
  _place(ctx, probe, r, size, x) {
    let best = null;
    for (let k = 0; k < 48; k++) {
      const f = [r.range(0.2, 0.8), r.range(0.22, 0.78)];
      const lit = this._lit(ctx, probe, lift(paperAt(ctx.view, f), ctx.sun, x), size) - (clearOf(ctx.avoid, f) ? 0 : 0.5);
      if (!best || lit > best.lit) best = { f, lit };
      if (lit > 0.9) break;
    }
    return best && best.lit > 0.45 ? best.f : null;
  }

  // The bar across the window: its top is somewhere to settle, close to the
  // paper, so a shadow cast from there is sharper than from the shrub.
  _rail(ctx) {
    const w = ctx.window;
    if (!(w.rail?.width > 0)) return null;
    return { x: w.x + w.glass, top: w.u0 + w.rail.at * (w.u1 - w.u0) + w.rail.width / 2, v0: w.v0 + w.frame + 0.04, v1: w.v1 - w.frame - 0.04 };
  }

  // The air just inside the open window: from beyond the paper in view to
  // the wall. Only shadows are seen of anything there.
  _room(ctx) {
    const x0 = viewReach(ctx.view) + 0.05;
    const x1 = ctx.window.x - 0.03;
    return x1 - x0 > 0.06 ? [x0, x1] : null;
  }

  // Places to settle, where the insect's shadow would fall in the light: the
  // top of the window's bar, and thin twigs of the shrub. The body is
  // `stand` above it, `size` its reach.
  _perches(ctx, probe, size, stand) {
    const out = [];
    const test = (rest, extra) => {
      const P = add(rest, [0, 0, stand]);
      const f = viewFraction(ctx.view, shadowOf(P, ctx.sun));
      if (f[0] < 0.12 || f[0] > 0.88 || f[1] < 0.14 || f[1] > 0.86) return;
      const lit = this._lit(ctx, probe, P, size);
      if (lit > 0.62) out.push({ ...extra, rest, P, f, lit });
    };
    const rail = this._rail(ctx);
    if (rail) for (let v = rail.v0; v <= rail.v1; v += 0.015) test([rail.x, v, rail.top], { b: null, s: 0, at: { d: [0, 1] }, rail: true });
    for (const b of branchesOf(ctx.near.segments ?? [])) {
      if (b.length < 0.04) continue;
      const step = 0.015 / b.length;
      for (let s = 0.35; s <= 0.98; s += step) {
        const at = branchAt(b, s);
        if (at.r <= 0.0055) test([ctx.near.x, at.p[1], at.p[0] + at.r], { b, s, at, rail: false });
      }
    }
    return out;
  }

  // One of the places to settle: the closer to `centre` (a view fraction) and
  // the better lit the likelier, and the window's bar for a sharper shadow.
  _choose(r, ctx, perches, centre, railBonus) {
    const { view } = ctx;
    for (const p of perches) {
      p.score = p.lit - 1.2 * Math.hypot((p.f[0] - centre[0]) * view.w, (p.f[1] - centre[1]) * view.h) + (p.rail ? railBonus : 0) - (clearOf(ctx.avoid, p.f) ? 0 : 0.8) + r.range(0, 0.15);
    }
    perches.sort((a, b) => b.score - a.score);
    return perches.length ? perches[Math.floor(r.next() * Math.min(4, perches.length))] : null;
  }

  // The way in: down out of the garden along the light, so the shadow begins
  // as a faint blur, off to one side, and gathers as it nears; it reaches
  // `to` at t1 (with velocity `arrive`, or on through the next point).
  _in(route, r, ctx, to, t0, t1, far, speed, arrive = null) {
    const { sun, view } = ctx;
    const f = viewFraction(view, shadowOf(to, sun));
    const fFar = [f[0] + r.sign() * r.range(0.3, 0.6), f[1] + r.range(-0.25, 0.25)];
    const pFar = lift(paperAt(view, fFar), sun, far);
    const fMid = [lerp(fFar[0], f[0], 0.7) + r.range(-0.05, 0.05), lerp(fFar[1], f[1], 0.7) + r.range(-0.05, 0.05)];
    const pMid = lift(paperAt(view, fMid), sun, lerp(far, to[0], 0.75));
    route.to(t0, pFar, mul(norm(sub(pMid, pFar)), speed));
    route.to(lerp(t0, t1, 0.5), pMid);
    route.to(t1, to, arrive);
  }

  // The way out, the same way back: from the route's last point at t0, out
  // over the garden by t1.
  _out(route, r, ctx, t0, t1, far, speed) {
    const { sun, view } = ctx;
    const from = route.end.p;
    const f = viewFraction(view, shadowOf(from, sun));
    const fFar = [f[0] + r.sign() * r.range(0.3, 0.6), f[1] + r.range(-0.25, 0.25)];
    const pFar = lift(paperAt(view, fFar), sun, far);
    const fMid = [lerp(f[0], fFar[0], 0.3) + r.range(-0.05, 0.05), lerp(f[1], fFar[1], 0.3) + r.range(-0.05, 0.05)];
    const pMid = lift(paperAt(view, fMid), sun, lerp(from[0], far, 0.25));
    route.to(lerp(t0, t1, 0.5), pMid);
    route.to(t1, pFar, mul(norm(sub(pFar, pMid)), speed));
  }

  // Flying about a place: a wandering way through the air, each step turning
  // a little from the last and drawn back toward the place when it strays,
  // preferring air whose shadow falls in the light. `at` is where it is now
  // ({ f: shadow as a view fraction, x: distance from the wall, th: heading on
  // the page, t }); it goes on until t1 and returns where it ends.
  _about(route, r, ctx, probe, at, t1, o) {
    const { sun, view } = ctx;
    let { f, x, th, t } = at;
    for (;;) {
      const tn = t + r.range(o.dt[0], o.dt[1]);
      if (tn > t1) break;
      let best = null;
      for (let k = 0; k < 6; k++) {
        let a = th + r.range(-o.turn, o.turn);
        const toC = [(o.centre[0] - f[0]) * view.w, (o.centre[1] - f[1]) * view.h];
        const dC = Math.hypot(toC[0], toC[1]);
        if (dC > o.radius) a = turnToward(a, Math.atan2(toC[1], toC[0]), clamp((dC - o.radius) / o.radius, 0, 1) * 0.85);
        const s = r.range(o.step[0], o.step[1]);
        const fn = [f[0] + (Math.cos(a) * s) / view.w, f[1] + (Math.sin(a) * s) / view.h];
        const xn = clamp(x + r.range(-o.dx, o.dx), o.xs[0], o.xs[1]);
        const B = lift(paperAt(view, fn), sun, xn);
        const lit = this._lit(ctx, probe, B, o.size) - 0.03 * k - (clearOf(ctx.avoid, fn) ? 0 : 0.35);
        if (!best || lit > best.lit) best = { lit, fn, xn, a, B };
        if (lit > 0.75) break;
      }
      f = best.fn;
      x = best.xn;
      th = best.a;
      t = tn;
      route.to(t, best.B);
    }
    return { f, x, th, t };
  }

  // The perch as a plan keeps it: its twig (none for the window's bar), where
  // its top rests, where the body is held, and when the feet take hold and
  // let go.
  _perch(p, yaw, pitch, tLand, tOff, reach) {
    return { b: p.b, s: p.s, rest: p.rest, P: p.P, yaw, pitch, tLand, tOff, reach };
  }

  // How firmly it holds on: 0 in the air, 1 settled.
  _attach(plan, T) {
    const pr = plan.perch;
    if (!pr) return 0;
    if (T < pr.tLand) return smooth((T - (pr.tLand - pr.reach)) / pr.reach);
    if (T <= pr.tOff) return 1;
    return 1 - smooth((T - pr.tOff) / 0.3);
  }

  // Where it is at T: along its route, carried by its twig in the wind while
  // it holds on to one.
  _at(plan, T) {
    let p = plan.route.at(T);
    const k = this._attach(plan, T);
    const pr = plan.perch;
    if (k > 0 && pr.b) p = add(p, mul(sub(twigAt(plan.W, pr.b, pr.s, T, plan.xN), pr.rest), k));
    p[0] = Math.max(p[0], plan.xMin);
    return p;
  }

  // Heading, speed and bank in flight, from the route.
  _flight(plan, T) {
    const v = plan.route.vel(T);
    const a = plan.route.acc(T);
    const sp = Math.hypot(v[0], v[1]);
    const ac = sp > 0.05 ? (v[0] * a[1] - v[1] * a[0]) / sp : 0;
    return {
      speed: len(v),
      sp,
      heading: Math.atan2(v[1], v[0]),
      climb: Math.atan2(v[2], Math.max(sp, 1e-3)),
      roll: clamp(-Math.atan2(ac, 9.81), -0.6, 0.6),
    };
  }

  // Its facing when it slows almost to a stop: the way it was going at each
  // point of its route (and any facings given, as [t, yaw, tau]).
  _headings(route, extra = []) {
    const list = [...extra];
    for (const key of route.keys) {
      if (Math.hypot(key.v[0], key.v[1]) > 0.05) list.push([key.t, Math.atan2(key.v[1], key.v[0]), 0.08]);
    }
    list.sort((a, b) => a[0] - b[0]);
    let yaw = list.length ? list[0][1] : 0;
    const track = new Track(yaw);
    for (const [t, y, tau] of list) {
      yaw += wrap(y - yaw);
      track.to(t, yaw, tau);
    }
    return track;
  }

  // Its facing in flight: along the way it goes, or as it last looked when
  // it slows to a hover.
  _yaw(plan, T, fl, k, slow) {
    const fly = turnToward(plan.yaw.at(T), fl.heading, smooth((fl.sp - slow) / (2.5 * slow)));
    return plan.perch ? turnToward(fly, plan.perch.yaw, k) : fly;
  }

  // The next moment at or after t when the wings are at the top of a beat.
  _top(plan, t) {
    return t + (1 - frac(plan.phase0 + plan.freq * (t - plan.t0))) / plan.freq;
  }

  frame(plan, time, ctx) {
    // Twigs move with this frame's wind, as the shrub does on screen.
    plan.W = ctx.wind;
    const still = this._still(plan, time);
    const moments = still ? 2 : MAX_MOMENTS;
    const shutter = still ? SHUTTER * 0.6 : SHUTTER;
    const poses = [];
    for (let m = 0; m < moments; m++) poses.push(this._pose(plan, time + shutter * ((m + 0.5) / moments - 0.5), m, moments));
    const O = poses[moments >> 1].C;
    const [a0, a1, b0, b1] = plan.fade;
    const opacity = smooth((time - a0) / (a1 - a0)) * (1 - smooth((time - b0) / (b1 - b0)));
    const f = cast(this.data, poses.map((p) => this._shape(p)), O, ctx.sun, ctx.view, opacity);
    f.load = null;
    f.phase = this._phase(plan, time);
    return f;
  }

  _still(plan, T) {
    const pr = plan.perch;
    return !!pr && T > pr.tLand + plan.settleTime && T < pr.tOff - plan.wakeTime;
  }

  _phase(plan, T) {
    const pr = plan.perch;
    if (T < plan.tAbout) return 'arriving';
    if (pr && T >= pr.tLand && T < pr.tOff) return 'perched';
    if (T < plan.tLeave) return 'about';
    return T < plan.tGone ? 'leaving' : 'gone';
  }
}

// ---- a butterfly ------------------------------------------------------------------------

// A butterfly a little larger than a painted lady, about 6.3 cm across. Its
// measurements are in metres at SIZE 1.
const BUTTERFLY = 1.15;
const FOREWING = [
  [0.0008, -0.0008],
  [0.0262, -0.0042], // apex
  [0.0212, 0.0102], //  outer corner
  [0.0022, 0.008],
];

export class Butterfly extends Insect {
  plan(e, ctx) {
    const r = makeRng(e.seed);
    const { sun, view } = ctx;
    const probe = ctx.probe?.();
    const xN = ctx.near.x;
    // The air it flutters in: from the window's depth out to the shrub, or
    // now and then in at the window, where its shadow is sharpest.
    const room = this._room(ctx);
    const inside = !!room && r.next() < 0.3;
    const xs = inside ? room : [ctx.window.x + 0.08, xN - 0.08];
    const t0 = e.start;
    const total = clamp(e.stay, 10, 26);
    const centre = this._place(ctx, probe, r, 0.025, lerp(xs[0], xs[1], 0.5));
    if (!centre) return null;

    const route = new Route();
    const plan = {
      kind: 'butterfly',
      id: e.id,
      t0,
      route,
      xN,
      xMin: inside ? room[0] - 0.01 : ctx.window.x + 0.04,
      W: ctx.wind,
      freq: r.range(7.5, 9.5), // wingbeats a second
      phase0: r.next(),
      yaw: new Track(0),
      flap: new Track(1), // 1 beating, 0 held still, settled
      open: new Track(72 * DEG), // how far up the wings are held when settled
      glides: [],
      perch: null,
      settleTime: 0.5,
      wakeTime: 0.4,
    };

    // ---- in ----
    const tIn = r.range(2.2, 2.8);
    const x1 = r.range(xs[0], lerp(xs[0], xs[1], 0.5));
    this._in(route, r, ctx, lift(paperAt(view, centre), sun, x1), t0, t0 + tIn, r.range(2.6, 3.4), 1.6);
    plan.tAbout = t0 + tIn;
    const wander = { centre, radius: 0.09, dt: [0.3, 0.55], step: [0.05, 0.13], turn: 1.2, xs, dx: 0.05, size: 0.028 };
    let at = { f: centre, x: x1, th: r.next() * TAU, t: t0 + tIn };
    const tOut = r.range(2.2, 2.8);

    // ---- about the light, and often down to bask ----
    const seats = this._perches(ctx, probe, 0.028, 0.0045).filter((p) => !inside || p.rail);
    const pick = r.next() < 0.85 ? this._choose(r, ctx, seats, centre, 0.4) : null;
    if (pick) {
      const flyA = r.range(2.2, 4.0);
      const flyB = r.range(1.0, 2.4);
      const bask = clamp(total - tIn - flyA - flyB - tOut - 1, 3.5, 12);
      at = this._about(route, r, ctx, probe, at, at.t + flyA, wander);
      // The last approach: from a little before and below the perch, slowing,
      // wings beating until the feet take hold at the top of a beat.
      const az = Math.atan2(sun[1], sun[0]);
      const el = Math.asin(clamp(sun[2], -1, 1));
      // (from outside for the window's bar, from the window side for a twig)
      const near = add(pick.P, [(pick.rail ? 1 : -1) * r.range(0.025, 0.04), r.sign() * r.range(0.01, 0.025), -r.range(0.005, 0.015)]);
      const tNear = at.t + r.range(0.4, 0.6);
      route.to(tNear, near);
      const tLand = this._top(plan, tNear + 0.4);
      route.to(tLand, pick.P, [0, 0, 0]);
      const tOff = this._top(plan, tLand + bask);
      route.to(tOff, pick.P, [0, 0, 0]);
      // It faces away from the sun, tilted up, so its open wings take the
      // light full on.
      const yaw = az + Math.PI + r.range(-0.45, 0.45);
      const pitch = clamp(Math.PI / 2 - el, 15 * DEG, 55 * DEG) * r.range(0.75, 1);
      plan.perch = this._perch(pick, yaw, pitch, tLand, tOff, tLand - tNear);

      // Wings: held up as it lands, opened to bask, closed and opened now and
      // then, raised again to go.
      const flat = r.range(4, 16) * DEG;
      plan.flap.to(tLand - 0.02, 0, 0.04);
      plan.open.to(tLand + 0.3, flat, 0.25);
      let t = tLand + r.range(1.2, 2.2);
      while (t < tOff - 1.4) {
        const x = r.next();
        if (x < 0.35) {
          plan.open.to(t, r.range(76, 84) * DEG, 0.12);
          t += r.range(0.6, 2.0);
          plan.open.to(t, flat, 0.2);
        } else if (x < 0.65) {
          plan.open.to(t, r.range(30, 45) * DEG, 0.06);
          plan.open.to(t + 0.22, flat, 0.12);
        } else {
          plan.open.to(t, flat + r.range(-4, 10) * DEG, 0.4);
        }
        t += r.range(1.3, 3.4);
      }
      plan.open.to(tOff - 0.25, 74 * DEG, 0.06);
      plan.flap.to(tOff - 0.01, 1, 0.025);
      at = { f: pick.f, x: pick.P[0], th: r.next() * TAU, t: tOff };
      at = this._about(route, r, ctx, probe, at, tOff + flyB, wander);
    } else {
      at = this._about(route, r, ctx, probe, at, t0 + total - tOut, wander);
    }

    // ---- away ----
    plan.tLeave = at.t;
    const tGone = at.t + tOut;
    this._out(route, r, ctx, at.t, tGone, r.range(2.6, 3.4), 1.8);
    route.done();
    plan.yaw = this._headings(route, plan.perch ? [[plan.perch.tLand - 0.3, plan.perch.yaw, 0.12]] : []);

    // Short glides between runs of beats, not while settling.
    const pr = plan.perch;
    for (let t = t0 + r.range(0.6, 1.4); t < tGone - 0.4; t += r.range(0.7, 1.8)) {
      if (pr && t > pr.tLand - 0.9 && t < pr.tOff + 0.5) continue;
      plan.glides.push([t, t + r.range(0.12, 0.32)]);
    }
    plan.tGone = tGone;
    plan.end = tGone;
    plan.fade = [t0, t0 + 0.6, tGone - 0.6, tGone];
    return plan;
  }

  _glide(plan, T) {
    let g = 0;
    for (const [a, b] of plan.glides) {
      if (T > a - 0.1 && T < b + 0.2) g = Math.max(g, smooth((T - a) / 0.06) * (1 - smooth((T - b) / 0.08)));
    }
    return g;
  }

  _pose(plan, T) {
    const k = this._attach(plan, T);
    const fl = this._flight(plan, T);
    const flap = clamp(plan.flap.at(T), 0, 1);
    const glide = this._glide(plan, T);
    const ph = frac(plan.phase0 + plan.freq * (T - plan.t0));
    const beat = flap * (1 - glide);
    // Each downstroke lifts it, each upstroke lets it fall.
    const C = this._at(plan, T);
    C[2] += 0.0055 * Math.sin(TAU * ph - Math.PI / 2) * beat * (1 - k);
    const yaw = this._yaw(plan, T, fl, k, 0.05);
    const pitchFly = 26 * DEG + 0.4 * fl.climb + 12 * DEG * Math.sin(TAU * ph) * beat;
    const pitch = plan.perch ? lerp(pitchFly, plan.perch.pitch, k) : pitchFly;
    // Downstroke a little quicker than the upstroke; the wings meet above.
    const stroke = (p) => (p < 0.46 ? lerp(82, -32, ease(p / 0.46)) : lerp(-32, 82, ease((p - 0.46) / 0.54))) * DEG;
    const held = plan.open.at(T);
    const phi = lerp(held, lerp(stroke(ph), 14 * DEG, glide), flap);
    const phiH = lerp(held, lerp(stroke(frac(ph - 0.04)), 14 * DEG, glide), flap);
    return {
      C,
      yaw,
      pitch,
      roll: fl.roll * (1 - k),
      phi,
      phiH,
      // The forewings slide back into the hindwings as the wings close.
      sweep: lerp(-6 * DEG, 8 * DEG, smooth((phi - 45 * DEG) / (40 * DEG))),
      droop: lerp(14 * DEG + 9 * DEG * Math.sin(TAU * ph + 2.2) * beat, 4 * DEG, k),
    };
  }

  _shape(p) {
    const body = frame(p.C, p.yaw, p.pitch, p.roll, BUTTERFLY);
    const prims = [
      blob(body, [0, 0, 0], [0.0036, 0.0022, 0.0022], 0), // thorax
      blob(body, [0.0046, 0, 0.0002], [0.0015, 0.0017, 0.0016], 0.001), // head
      abdomen(body, [-0.003, 0, 0], p.droop, 0.0082, [0.0016, 0.0016], 0.0012),
    ];
    for (const side of [1, -1]) {
      const fw = wing(body, [0.0016, side * 0.0017, 0.0012], side, p.phi, p.sweep);
      prims.push({ t: 'Q', p: FOREWING.map(([s, c]) => fw.at(s, c)), round: 0.0012, k: 0.0016 });
      const hw = wing(body, [-0.001, side * 0.0015, 0.001], side, p.phiH, p.sweep * 0.5);
      prims.push(hw.oval(0.0095, 0.0098, 0.0104, 0.0088, 0.6, 0.0016));
    }
    return prims;
  }
}

// ---- a bumblebee ----------------------------------------------------------------------------

// Its wings' opacity: smoky membranes that pass most of the light.
const BEE_WING = 0.55;

export class Bee extends Insect {
  plan(e, ctx) {
    const r = makeRng(e.seed);
    const { sun, view } = ctx;
    const probe = ctx.probe?.();
    const xN = ctx.near.x;
    const t0 = e.start;
    const total = clamp(0.75 * e.stay, 8, 18);
    // Most often it comes in at the open window and looks about inside, where
    // its shadow is sharp; otherwise it keeps to the window, and now and then
    // the shrub, outside.
    const room = this._room(ctx);
    const inside = !!room && r.next() < 0.7;
    const zones = inside ? ['room', 'window'] : ['window', 'shrub'];
    const places = this._stations(ctx, probe, room).filter((p) => zones.includes(p.zone));
    if (places.length < 3) return null;

    const route = new Route();
    const plan = {
      kind: 'bee',
      id: e.id,
      t0,
      route,
      xN,
      xMin: inside ? room[0] - 0.01 : ctx.window.x + 0.04,
      W: ctx.wind,
      yaw: new Track(0),
      fold: new Track(0), // 0 beating, 1 folded flat over its back
      perch: null,
      settleTime: 0.3,
      wakeTime: 0.25,
      wobble: wobble(r, [0.0035, 0.0045, 0.004], 1.1, 4.6), // a hover is never quite still
      sway: wobble(r, [0.07, 0.09], 0.7, 3.2), // pitch and roll
    };

    // A few places to look at, each a short dart from the last, and now and
    // then across from the shrub to the window or back.
    // (longer when it comes all the way in at the window)
    const tIn = r.range(1.5, 2.0) + (inside ? 0.5 : 0);
    const tOut = r.range(1.0, 1.5) + (inside ? 0.4 : 0);
    places.sort((a, b) => b.lit - a.lit);
    const starts = places.filter((p) => p.zone !== 'shrub');
    const first = starts.length ? starts : places;
    let cur = first[Math.floor(r.next() * Math.min(6, first.length))];
    const visits = [cur];
    const count = 3 + Math.floor(r.next() * 4);
    // The next place: a short dart within the shrub or the window, or across
    // between them; never only nearer or farther along the light, where its
    // shadow would not move.
    const nextFrom = (from, cross) =>
      places
        .filter((p) => !visits.includes(p) && (p.zone === from.zone) !== cross)
        .map((p) => ({ p, d: len(sub(p.B, from.B)), s: Math.hypot((p.f[0] - from.f[0]) * view.w, (p.f[1] - from.f[1]) * view.h) }))
        .filter((c) => c.d > 0.05 && c.d < (cross ? 0.75 : 0.24) && c.s > 0.04)
        .map((c) => ({ p: c.p, w: c.p.lit + r.range(0, 0.5) - (cross ? 0.5 * c.d : 0) }))
        .sort((a, b) => b.w - a.w)[0];
    for (let i = 1; i < count; i++) {
      const next = (r.next() < (inside ? 0.45 : 0.25) && nextFrom(cur, true)) || nextFrom(cur, false) || nextFrom(cur, true);
      if (!next) break;
      visits.push(next.p);
      cur = next.p;
    }
    // Sometimes it lands on the window's bar for a moment (on the shrub, it
    // would be lost in the leaves' shadows).
    const seats = visits.map((v, i) => (v.seat?.rail && i > 0 ? i : -1)).filter((i) => i >= 0);
    const landAt = seats.length && r.next() < 0.5 ? seats[Math.floor(r.next() * seats.length)] : -1;
    const hoverTime = clamp((total - tIn - tOut - (landAt >= 0 ? 3 : 0) - 0.4 * (visits.length - 1)) / visits.length, 0.5, 2.4);

    this._in(route, r, ctx, visits[0].B, t0, t0 + tIn, r.range(2.8, 3.5), 2.2, [0, 0, 0]);
    plan.tAbout = t0 + tIn;
    let t = t0 + tIn;
    let face = 0;
    const headingTo = (a, b) => Math.atan2(b[1] - a[1], b[0] - a[0]);
    // The heading it keeps as it slows into each hover: the dart's own.
    let yaw = headingTo(route.keys[route.keys.length - 2].p, visits[0].B);
    const turn = (at, to, tau) => {
      yaw += wrap(to - yaw);
      plan.yaw.to(at, yaw, tau);
    };
    plan.yaw = new Track(yaw);
    // Hovering, it mostly shows the light its side: the long body and the
    // blur of its wings either side (head-on it would cast only a dot).
    const across = Math.atan2(sun[1], sun[0]) + Math.PI / 2;
    visits.forEach((v, i) => {
      face = across + (r.next() < 0.5 ? 0 : Math.PI) + r.range(-0.45, 0.45);
      const hold = hoverTime * r.range(0.7, 1.3);
      turn(t + 0.05, face, 0.12);
      for (let s = t + r.range(0.35, 0.6); s < t + hold - 0.3; s += r.range(0.35, 0.8)) turn(s, face + r.range(-0.6, 0.6), 0.1);
      if (i === landAt) {
        // Down onto it, a moment's rest with its wings folded, and up.
        const seat = v.seat;
        const d = seat.at.d;
        // Along the bar either way, or along the twig toward its tip.
        const level = Math.abs(d[1]) > 0.3;
        const along = level ? Math.atan2(seat.rail ? r.sign() : d[1] > 0 ? 1 : -1, 0) : 0;
        const tilt = level && !seat.rail ? clamp(Math.atan2(d[0], Math.abs(d[1])), -0.5, 0.8) : level ? 0 : 55 * DEG;
        const rest = seat.rest;
        const P = add(rest, [0, 0, 0.0034]);
        const tLand = t + hold * 0.5 + 0.35;
        route.to(t + hold * 0.5, v.B, [0, 0, 0]);
        route.to(tLand, P, [0, 0, 0]);
        const tOff = tLand + r.range(1.6, 3.6);
        route.to(tOff, P, [0, 0, 0]);
        plan.perch = this._perch({ b: seat.b, s: seat.s, rest, P }, along, tilt, tLand, tOff, 0.3);
        plan.fold.to(tLand + 0.06, 1, 0.05);
        plan.fold.to(tOff - 0.12, 0, 0.03);
        t = tOff + 0.3;
        route.to(t, add(P, [-0.02, 0, 0.012]), [0, 0, 0]);
        t += hold * 0.5;
      } else {
        t += hold;
      }
      route.to(t, route.end.p, [0, 0, 0]);
      if (i < visits.length - 1) {
        const n = visits[i + 1];
        const d = len(sub(n.B, route.end.p));
        const go = headingTo(route.end.p, n.B);
        turn(t - 0.12, go, 0.05);
        t += clamp(d / r.range(0.35, 0.55), 0.22, 0.9);
        route.to(t, n.B, [0, 0, 0]);
      }
    });

    plan.tLeave = t;
    const tGone = t + tOut;
    this._out(route, r, ctx, t, tGone, r.range(2.8, 3.5), 2.6);
    turn(t - 0.1, headingTo(route.keys[route.keys.length - 3].p, route.keys[route.keys.length - 2].p), 0.06);
    route.done();
    plan.tGone = tGone;
    plan.end = tGone;
    plan.fade = [t0, t0 + 0.5, tGone - 0.5, tGone];
    return plan;
  }

  // Places a bee hovers, where its shadow falls in the light: just in front
  // of the shrub's thin twigs; at the window, in its depth, a hand's breadth
  // outside and over its bar; and inside it, in the `room`. Some are over
  // something to land on.
  _stations(ctx, probe, room) {
    const { sun, view } = ctx;
    const out = [];
    const add_ = (B, zone, seat) => {
      const f = viewFraction(view, shadowOf(B, sun));
      if (f[0] < 0.1 || f[0] > 0.9 || f[1] < 0.12 || f[1] > 0.88) return;
      const lit = this._lit(ctx, probe, B, 0.012) - (clearOf(ctx.avoid, f) ? 0 : 0.5);
      if (lit > 0.6) out.push({ B, f, lit, zone, seat });
    };
    for (const b of branchesOf(ctx.near.segments ?? [])) {
      const step = 0.04 / Math.max(b.length, 0.04);
      for (let s = 0.4; s <= 1; s += step) {
        const at = branchAt(b, s);
        if (at.r > 0.005) continue;
        add_([ctx.near.x - 0.035, at.p[1], at.p[0] + 0.012], 'shrub', { b, s, at, rest: [ctx.near.x, at.p[1], at.p[0] + at.r], rail: false });
      }
    }
    const w = ctx.window;
    const grid = (x, zone) => {
      for (let i = 0; i < 6; i++) {
        for (let j = 0; j < 5; j++) add_(lift(paperAt(view, [0.14 + (0.72 * (i + 0.5)) / 6, 0.16 + (0.68 * (j + 0.5)) / 5]), sun, x), zone, null);
      }
    };
    for (const x of [w.x + w.glass + 0.06, w.x + w.reveal + 0.07]) grid(x, 'window');
    if (room) for (const x of [room[0] + 0.02, lerp(room[0], room[1], 0.6)]) grid(x, 'room');
    const rail = this._rail(ctx);
    if (rail) {
      for (let v = rail.v0; v <= rail.v1; v += 0.04) {
        add_([rail.x + 0.035, v, rail.top + 0.012], 'window', { b: null, s: 0, at: { d: [0, 1] }, rest: [rail.x, v, rail.top], rail: true });
      }
    }
    return out;
  }

  _still(plan, T) {
    return super._still(plan, T) && plan.fold.at(T) > 0.98;
  }

  _pose(plan, T, m, M) {
    const k = this._attach(plan, T);
    const fl = this._flight(plan, T);
    const fold = clamp(plan.fold.at(T), 0, 1);
    const hover = (1 - k) * lerp(1, 0.35, smooth(fl.speed / 0.6));
    const C = add(this._at(plan, T), mul(plan.wobble(T), hover));
    const yaw = this._yaw(plan, T, fl, k, 0.08);
    const [wp, wr] = plan.sway(T);
    // Hovering it hangs steeply, body tilted up; darting it levels out.
    const pitchFly = lerp(40 * DEG, 16 * DEG, smooth(fl.speed / 0.9)) + 0.3 * fl.climb + wp * hover;
    const pitch = plan.perch ? lerp(pitchFly, plan.perch.pitch, k) : pitchFly;
    // The wingbeat is far quicker than a frame: the stroke's blur, spread
    // evenly over the frame's moments, two positions at a time.
    const sweeps = [];
    for (let j = 0; j < 2; j++) sweeps.push(lerp(lerp(-48, 72, (m * 2 + j + 0.5) / (M * 2)), 76, fold) * DEG);
    // Folded, the two lie on one another and should read as one wing.
    const alpha = lerp(BEE_WING, 1 - Math.sqrt(1 - BEE_WING), fold);
    const pr = plan.perch;
    return {
      C,
      yaw,
      pitch,
      roll: (fl.roll + wr) * (1 - k),
      droop: lerp(16 * DEG, 6 * DEG, k),
      grip: k,
      twig: pr && k > 0 ? sub(C, sub(pr.P, pr.rest)) : null,
      sweeps,
      phi: lerp(10, -4, fold) * DEG,
      tilt: lerp(pitch * 0.75, 0, fold),
      clear: 1 - alpha,
    };
  }

  _shape(p) {
    const body = frame(p.C, p.yaw, p.pitch, p.roll);
    const prims = [
      blob(body, [0, 0, 0], [0.0035, 0.0034, 0.0033], 0), // thorax, round and furred
      blob(body, [0.0049, 0, -0.0008], [0.0018, 0.0024, 0.0022], 0.0012), // head
      abdomen(body, [-0.0028, 0, -0.0004], p.droop, 0.0062, [0.0046, 0.0041], 0.0014),
    ];
    // Legs: in flight the hind legs hang, the pollen baskets on them; on a
    // twig all of them reach down to it.
    for (const side of [1, -1]) {
      const hip = toWorld(body, [-0.001, side * 0.0022, -0.0026]);
      let foot = toWorld(body, [-0.006, side * 0.0038, -0.009]);
      if (p.twig) foot = mix3(foot, add(p.twig, mul(body.y, side * 0.0016)), p.grip);
      prims.push({ t: 'C', a: hip, b: foot, ra: 0.00055, rb: 0.0009, k: 0.0006 });
      const hip2 = toWorld(body, [0.0006, side * 0.0026, -0.0028]);
      let foot2 = toWorld(body, [0.0014, side * 0.0044, -0.0068]);
      if (p.twig) foot2 = mix3(foot2, add(p.twig, add(mul(body.y, side * 0.002), mul(body.x, 0.003))), p.grip);
      prims.push({ t: 'C', a: hip2, b: foot2, ra: 0.0004, rb: 0.0003, k: 0.0004 });
    }
    for (const side of [1, -1]) {
      for (const sweep of p.sweeps) {
        const w = wing(body, [0.001, side * 0.0024, 0.0026], side, p.phi, sweep, p.tilt);
        prims.push(w.oval(0.0058, 0.0008, 0.006, 0.0019, 0.08, 0, p.clear));
      }
    }
    return prims;
  }
}

// ---- a moth -----------------------------------------------------------------------------------

// A medium moth (an underwing's size, about 5 cm across), in metres.
const MOTH_FOREWING = [
  [0.0006, -0.0009],
  [0.0236, -0.003], // apex
  [0.0196, 0.0098],
  [0.0016, 0.0074],
];

export class Moth extends Insect {
  plan(e, ctx) {
    const r = makeRng(e.seed);
    const { sun, view } = ctx;
    const probe = ctx.probe?.();
    const xGlass = ctx.window.x + ctx.window.reveal;
    const xN = ctx.near.x;
    // It keeps close to the window, where the light seems to come from, and
    // now and then comes in.
    const room = this._room(ctx);
    const inside = !!room && r.next() < 0.35;
    const xs = inside ? room : [ctx.window.x + 0.06, xGlass + 0.3];
    const t0 = e.start;
    let total = clamp(e.stay + 2, 12, 28);
    const centre = this._place(ctx, probe, r, 0.02, lerp(xs[0], xs[1], 0.4));
    if (!centre) return null;

    const route = new Route();
    const plan = {
      kind: 'moth',
      id: e.id,
      t0,
      route,
      xN,
      xMin: inside ? room[0] - 0.01 : ctx.window.x + 0.04,
      W: ctx.wind,
      freq: r.range(15, 18),
      phase0: r.next(),
      yaw: new Track(0),
      flap: new Track(1),
      sweep: new Track(8 * DEG), // forewings swept back: 8° in flight, a delta at rest
      shiver: new Track(0),
      perch: null,
      settleTime: 0.9,
      wakeTime: 2.4,
      jink: wobble(r, [0.004, 0.005, 0.004], 4, 11),
    };

    const tIn = r.range(2.2, 3.0);
    const x1 = r.range(xs[0], xs[1]);
    this._in(route, r, ctx, lift(paperAt(view, centre), sun, x1), t0, t0 + tIn, r.range(2.4, 3.2), 1.4);
    plan.tAbout = t0 + tIn;
    const dance = { centre, radius: 0.1, dt: [0.1, 0.26], step: [0.03, 0.11], turn: 1.9, xs, dx: 0.04, size: 0.02 };
    let at = { f: centre, x: x1, th: r.next() * TAU, t: t0 + tIn };
    const tOut = r.range(2.2, 3.0);

    // It settles only on the window's bar, where its shadow can be seen (on
    // the shrub it would be lost in the leaves' shadows).
    const seats = this._perches(ctx, probe, 0.018, 0.0028).filter((p) => p.rail);
    const pick = r.next() < 0.8 ? this._choose(r, ctx, seats, centre, 0) : null;
    if (!pick) total = Math.min(total, 15);
    if (pick) {
      const flyA = r.range(3.0, 5.5);
      const flyB = r.range(1.2, 2.8);
      const shiver = r.range(1.3, 2.0);
      const rest = clamp(total - tIn - flyA - flyB - tOut - shiver - 1, 4, 12);
      at = this._about(route, r, ctx, probe, at, at.t + flyA, dance);
      const near = add(pick.P, [(pick.rail ? 1 : -1) * r.range(0.02, 0.035), r.sign() * r.range(0.008, 0.02), r.range(-0.01, 0.01)]);
      const tNear = at.t + r.range(0.3, 0.45);
      route.to(tNear, near);
      const tLand = this._top(plan, tNear + 0.35);
      route.to(tLand, pick.P, [0, 0, 0]);
      const tOff = this._top(plan, tLand + 0.5 + rest + shiver);
      route.to(tOff, pick.P, [0, 0, 0]);
      // It rests along the bar or the twig, head up.
      const d = pick.at.d;
      const level = Math.abs(d[1]) > 0.3;
      const way = pick.rail ? r.sign() : Math.sign(d[1]) * (d[0] >= 0 ? 1 : -1);
      const yaw = level ? Math.atan2(way, 0) : Math.atan2(sun[1], sun[0]) + Math.PI;
      const pitch = level ? clamp(Math.abs(Math.atan2(d[0], Math.abs(d[1]))), 0, 0.7) : 50 * DEG;
      plan.perch = this._perch(pick, yaw, pitch, tLand, tOff, tLand - tNear);
      // A few beats on landing, then the wings swept back and still; before
      // it goes, a shiver to warm them.
      plan.flap.to(tLand + 0.22, 0, 0.05);
      plan.sweep.to(tLand + 0.3, r.range(60, 68) * DEG, 0.12);
      if (r.next() < 0.6) {
        const ta = tLand + r.range(1.5, Math.max(1.6, rest - 1));
        plan.sweep.by(ta, r.range(-10, -5) * DEG, 0.1);
        plan.sweep.by(ta + 0.25, r.range(5, 10) * DEG, 0.15);
      }
      plan.shiver.to(tOff - shiver, 1, 0.12);
      plan.sweep.to(tOff - shiver, 36 * DEG, 0.15);
      plan.shiver.to(tOff - 0.02, 0, 0.03);
      plan.flap.to(tOff - 0.02, 1, 0.03);
      plan.sweep.to(tOff, 8 * DEG, 0.05);
      at = { f: pick.f, x: pick.P[0], th: r.next() * TAU, t: tOff };
      at = this._about(route, r, ctx, probe, at, tOff + flyB, dance);
    } else {
      at = this._about(route, r, ctx, probe, at, t0 + total - tOut, dance);
    }

    plan.tLeave = at.t;
    const tGone = at.t + tOut;
    this._out(route, r, ctx, at.t, tGone, r.range(2.4, 3.2), 1.6);
    route.done();
    plan.yaw = this._headings(route, plan.perch ? [[plan.perch.tLand - 0.25, plan.perch.yaw, 0.1]] : []);
    plan.tGone = tGone;
    plan.end = tGone;
    plan.fade = [t0, t0 + 0.6, tGone - 0.6, tGone];
    return plan;
  }

  _pose(plan, T) {
    const k = this._attach(plan, T);
    const fl = this._flight(plan, T);
    const flap = clamp(plan.flap.at(T), 0, 1);
    const shiver = clamp(plan.shiver.at(T), 0, 1);
    const ph = frac(plan.phase0 + plan.freq * (T - plan.t0));
    // Quick jinks on its way, never quite straight.
    const C = add(this._at(plan, T), mul(plan.jink(T), 1 - k));
    const yaw = this._yaw(plan, T, fl, k, 0.05);
    const pitchFly = 22 * DEG + 0.3 * fl.climb + 8 * DEG * Math.sin(TAU * ph) * flap;
    const pitch = plan.perch ? lerp(pitchFly, plan.perch.pitch, k) : pitchFly;
    const stroke = (p) => (p < 0.5 ? lerp(56, -42, ease(p / 0.5)) : lerp(-42, 56, ease((p - 0.5) / 0.5))) * DEG;
    const quiver = (4 + 9 * Math.sin(TAU * 31 * T)) * DEG;
    const held = lerp(-3 * DEG, quiver, shiver);
    const sweep = plan.sweep.at(T);
    return {
      C,
      yaw,
      pitch,
      roll: fl.roll * (1 - k),
      phi: lerp(held, stroke(ph), flap),
      phiH: lerp(held, stroke(frac(ph - 0.03)), flap),
      sweep,
      sweepH: sweep * 0.9,
      droop: lerp(10 * DEG + 6 * DEG * Math.sin(TAU * ph + 2) * flap, 2 * DEG, k),
    };
  }

  _shape(p) {
    const body = frame(p.C, p.yaw, p.pitch, p.roll);
    const prims = [
      blob(body, [0, 0, 0], [0.0033, 0.0027, 0.0026], 0), // thorax, stout and furred
      blob(body, [0.0042, 0, -0.0004], [0.0015, 0.0018, 0.0016], 0.001), // head
      abdomen(body, [-0.0028, 0, -0.0003], p.droop, 0.0072, [0.0024, 0.0022], 0.0012),
    ];
    for (const side of [1, -1]) {
      const fw = wing(body, [0.0014, side * 0.0021, 0.0017], side, p.phi, p.sweep);
      prims.push({ t: 'Q', p: MOTH_FOREWING.map(([s, c]) => fw.at(s, c)), round: 0.001, k: 0.0016 });
      const hw = wing(body, [-0.0008, side * 0.0019, 0.0013], side, p.phiH, p.sweepH);
      prims.push(hw.oval(0.0085, 0.0082, 0.0092, 0.0072, 0.5, 0.0016));
    }
    return prims;
  }
}
