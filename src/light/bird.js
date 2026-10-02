// The sparrow, one of the visitors (visitors.js): a small bird that comes to
// the shrub now and then. Only its shadow is ever seen.
//
// Each visit is planned once, from the light at that moment: a twig where the
// bird's shadow will fall in sunlight near the middle of the page, a flight in
// from the trees, what it does on the twig, and a flight away. Every moment is
// a pure function of the visit's seed and animation time, so any frame can be
// reproduced, stepped or scrubbed.
//
// The bird is a small 3D model with a house sparrow's proportions: body, head
// and bill, tail, two-part wings, legs. Each frame its pose is projected along
// the sun onto a plane through its body, so its shadow narrows when it turns
// toward the light, stretches when the sun is low, and its wings change shape
// through every beat. The light pass then softens that shadow by its distance
// from the paper, as it does every leaf's: a bird out over the garden is a
// faint blur, one on the shrub a soft but clear silhouette.
//
// Its weight bends the twig it stands on. The twig dips and bounces when the
// bird lands, gives at each hop, and springs back when it leaves. It never
// appears or vanishes: it arrives from beyond the light and leaves beyond it.
//
// World coordinates here: x out from the window wall, y along it, z up. On a
// foliage plane, (u, v) = (z, y).

import { makeRng } from './random.js';
import { applyHierarchy } from './wind.js';
import { toView } from './geometry.js';
import {
  DEG, TAU, MAX_PRIMS, MAX_MOMENTS, SHUTTER, add, sub, mul, len, norm, mix3, lerp, clamp, ease, smooth, Z, settle, frame, toWorld, dirWorld,
  rotX, rotY, rotZ, rotAxis, Track, Pulses, Spring, curve, along, viewFraction, shadowOf, litAt, clearOf, branchesOf, branchAt, cast,
} from './visit.js';

const SCALE = 1.0; //       a house sparrow, about 14.5 cm long
const STAND = 0.033 * SCALE; // body centre above the feet when perched (m)
const PERCH_PITCH = 24 * DEG; // body tilt when perched and at ease

// A twig a small bird would stand on: thin, close to level, toward its tip.
function perchable(b, s) {
  if (s < 0.3 || s > 0.92) return false;
  const at = branchAt(b, s);
  return at.r > 0.0008 && at.r < 0.0075 && Math.abs(at.d[0]) < 0.6;
}

// ---- the bird's body --------------------------------------------------------------

// Wing positions, in the body's frame: stroke (up), sweep (back), wrist fold,
// span (fraction of full), twist about the span.
const FOLDED = { alpha: -8 * DEG, beta: 88 * DEG, gamma: 0, span: 0.52, twist: -78 * DEG, tuck: 1 };
const PERCH_FLICK = { alpha: 32 * DEG, beta: 42 * DEG, gamma: 22 * DEG, span: 0.86, twist: -30 * DEG, tuck: 0.3 };

// One wingbeat. Small birds sweep the wing down fully spread and bring it up
// flexed, hand swept back; braking to land, the stroke is larger and forward.
function stroke(phase, amp, brake) {
  const up = 58 + 16 * brake;
  const dn = -42 - 18 * brake;
  let a;
  let flex = 0;
  if (phase < 0.55) a = lerp(up, dn, ease(phase / 0.55));
  else {
    const k = (phase - 0.55) / 0.45;
    a = lerp(dn, up, ease(k));
    flex = Math.sin(Math.PI * k);
  }
  a = 8 + (a - 8) * amp;
  return {
    alpha: a * DEG,
    beta: lerp(-8 - 12 * brake, 24, flex) * DEG,
    gamma: 38 * flex * DEG,
    span: 1 - 0.32 * flex,
    twist: 0,
    tuck: 0,
  };
}

function mixWing(a, b, k) {
  return {
    alpha: lerp(a.alpha, b.alpha, k),
    beta: lerp(a.beta, b.beta, k),
    gamma: lerp(a.gamma, b.gamma, k),
    span: lerp(a.span, b.span, k),
    twist: lerp(a.twist, b.twist, k),
    tuck: lerp(a.tuck ?? 0, b.tuck ?? 0, k),
  };
}

// 3D primitives of the bird in a pose: ellipsoids (E), round cones (C) and a
// rounded quad (Q, the tail), each with how softly it joins the rest (k).
function birdShape(pose) {
  const prims = [];
  // Body measurements are a house sparrow's, in metres; the frame scales them.
  const S = SCALE;
  const body = frame(pose.C, pose.yaw, pose.pitch, pose.roll, S);
  const fl = pose.fluff;
  const E = (c, f, r, k) => prims.push({ t: 'E', c, axes: [mul(f.x, r[0]), mul(f.y, r[1]), mul(f.z, r[2])], k: k * S });

  // A plump body: back, breast and belly as one rounded mass.
  E(toWorld(body, [0, 0, 0]), body, [0.033 * fl, 0.0205 * fl, 0.0225 * fl], 0);
  E(toWorld(body, [0.014, 0, -0.003]), body, [0.021 * fl, 0.019 * fl, 0.0215 * fl], 0.012);
  E(toWorld(body, [-0.02, 0, -0.004]), body, [0.017 * fl, 0.0145 * fl, 0.0135 * fl], 0.012);

  // Head and bill. The head keeps itself level and turns quickly; the neck
  // carries it a little toward where it looks.
  const neck = toWorld(body, [0.02, 0, 0.013]);
  const reach = rotY(rotZ([0.012 + 0.006 * pose.neck, 0, 0.011 + 0.007 * pose.neck], 0.45 * pose.headYaw), -0.4 * pose.headPitch);
  const headC = add(neck, dirWorld(body, reach));
  const head = frame(headC, pose.yaw + pose.headYaw, pose.headPitch, pose.headRoll, S);
  const hr = 0.0136 * (1 + 0.3 * (fl - 1));
  E(headC, head, [hr, hr * 0.96, hr], 0.006);
  prims.push({
    t: 'C',
    a: add(headC, add(mul(head.x, 0.0098), mul(head.z, -0.0016))),
    b: add(headC, add(mul(head.x, 0.0203), mul(head.z, -0.003))),
    ra: 0.0052 * S,
    rb: 0.0008 * S,
    k: 0.0025 * S,
  });

  // Tail: a narrow fan behind, cocked or spread.
  const tp = pose.tailPitch - 0.17;
  const base = toWorld(body, [-0.031, 0, 0.004]);
  const tip = add(base, dirWorld(body, [-Math.cos(tp) * 0.062, 0, Math.sin(tp) * 0.062]));
  const hw0 = 0.0055;
  const hw1 = 0.0085 + 0.017 * pose.tailSpread;
  prims.push({
    t: 'Q',
    p: [add(base, mul(body.y, hw0)), add(tip, mul(body.y, hw1)), add(tip, mul(body.y, -hw1)), add(base, mul(body.y, -hw0))],
    round: 0.0022 * S,
    k: 0.005 * S,
  });

  // Wings: arm and hand, each a thin oval, about the shoulder. Folded, the
  // feathers overlap: the wing narrows and lies along the upper flank.
  const w = pose.wing;
  const tuck = clamp(w.tuck ?? 0, 0, 1);
  const chord = 1 - 0.5 * tuck;
  for (const side of [1, -1]) {
    const sh = [0.006 - 0.004 * tuck, side * (0.012 + 0.004 * tuck), 0.011 + 0.004 * tuck];
    const turn = (v) => rotZ(rotX(v, side * w.alpha), side * w.beta);
    const s = turn([0, side, 0]);
    let c = turn([-1, 0, 0]);
    let n = turn([0, 0, 1]);
    // Twist about the span.
    c = rotAxis(c, s, side * w.twist);
    n = rotAxis(n, s, side * w.twist);
    const L = w.span;
    const toW = (p) => toWorld(body, p);
    const dW = (d) => dirWorld(body, d);
    const inner = add(sh, add(mul(s, 0.021 * L), mul(c, 0.011 * chord)));
    prims.push({ t: 'E', c: toW(inner), axes: [mul(dW(s), 0.023 * L), mul(dW(c), 0.026 * chord), mul(dW(n), 0.0018)], k: 0.004 * S });
    const wrist = add(sh, mul(s, 0.043 * L));
    const s2 = add(mul(s, Math.cos(w.gamma)), mul(c, Math.sin(w.gamma)));
    const c2 = sub(mul(c, Math.cos(w.gamma)), mul(s, Math.sin(w.gamma)));
    const outer = add(wrist, add(mul(s2, 0.034 * L), mul(c2, 0.004 * chord)));
    prims.push({ t: 'E', c: toW(outer), axes: [mul(dW(s2), 0.038 * L), mul(dW(c2), 0.02 * chord), mul(dW(n), 0.0016)], k: 0.004 * S });
  }

  // Legs, when they are down.
  if (pose.legs > 0.05) {
    for (const side of [1, -1]) {
      const hip = toWorld(body, [0.004, side * 0.0055, -0.015]);
      const gear = toWorld(body, [0.021, side * 0.0055, -0.036]);
      const foot = pose.feet ? mix3(gear, pose.feet[side > 0 ? 0 : 1], pose.grip) : gear;
      prims.push({ t: 'C', a: hip, b: mix3(hip, foot, pose.legs), ra: 0.0013 * S, rb: 0.001 * S, k: 0 });
    }
  }
  return prims;
}

// ---- visits -------------------------------------------------------------------------

export class Bird {
  constructor() {
    this.data = new Float32Array(MAX_MOMENTS * (3 * MAX_PRIMS + 1) * 4);
  }

  // ---- planning --------------------------------------------------------------

  // A visit's plan, from the light now (ctx: { sun, view, probe(), window,
  // wind, near: { x, rect, segments } }), or null when no twig suits.
  plan(e, ctx) {
    const r = makeRng(e.seed);
    const sun = ctx.sun;
    const view = ctx.view;
    const near = ctx.near;
    const W = ctx.wind;
    const probe = ctx.probe?.();
    const branches = branchesOf(near.segments ?? []);
    const xN = near.x;

    // A heading that shows the sun the bird's side: its profile is the shadow
    // anyone knows as a bird.
    const az = Math.atan2(sun[1], sun[0]);
    const facing = r.sign();
    const yaw0 = az + facing * (Math.PI / 2) + r.range(-0.15, 0.15);
    const F = [Math.cos(yaw0), Math.sin(yaw0), 0];

    // Perches: points along thin, level twigs whose bird-shaped shadow falls
    // in sunlight near the middle of the page.
    const scored = [];
    for (const b of branches) {
      if (b.length < 0.07) continue;
      const step = 0.025 / b.length;
      for (let s = 0.3; s <= 0.92; s += step) {
        if (!perchable(b, s)) continue;
        const at = branchAt(b, s);
        const feet = [xN, at.p[1], at.p[0] + at.r];
        const centre = viewFraction(view, shadowOf(add(feet, [0, 0, STAND]), sun));
        // In the lower middle of the page, so the flight away has room to be seen.
        if (centre[0] < 0.2 || centre[0] > 0.8 || centre[1] < 0.18 || centre[1] > 0.7) continue;
        // Its outline in sunlight: body and head clear of the window bar's
        // shadow and of leaves, where it would be lost; tail and feet may
        // touch them.
        let sum = 0;
        let n = 0;
        let coreSum = 0;
        let coreLow = 1;
        let coreN = 0;
        for (const [f, h, isCore] of [[0, 0.033, 1], [0.04, 0.05, 1], [-0.04, 0.03, 1], [0.02, 0.045, 1], [-0.085, 0.012, 0], [0.07, 0.06, 0], [0.02, 0.012, 0]]) {
          for (const sgn of [1, -1]) {
            const lit = litAt(probe, viewFraction(view, shadowOf(add(feet, [F[0] * f * sgn, F[1] * f * sgn, h]), sun)));
            sum += lit;
            n++;
            if (isCore) {
              coreSum += lit;
              coreLow = Math.min(coreLow, lit);
              coreN++;
            }
          }
        }
        const core = coreSum / coreN;
        // Clear of the page's own words where it can be.
        const score = sum / n + 0.5 * core - (clearOf(ctx.avoid, centre) ? 0 : 0.6);
        if (sum / n > 0.55 && core > 0.6 && coreLow > 0.2) scored.push({ score, b, s });
      }
    }
    if (!scored.length) return null;
    scored.sort((a, b) => b.score - a.score);
    const cut = scored[0].score * 0.9;
    const top = scored.filter((c) => c.score >= cut).slice(0, 14);
    const pick = top[Math.floor(r.next() * top.length)];
    const branch = pick.b;
    const s0 = pick.s;

    // The twig: how far it gives under the bird, and how it rings.
    const rest0 = branchAt(branch, s0);
    const lever = rest0.p[1] - branch.pivot[1];
    const sign = Math.sign(lever) || 1;
    const bendAt = (s) => Math.pow(clamp(s, 0, 1), W.bend);
    const radius = rest0.r;
    const sag = clamp(0.0105 * Math.pow(0.0022 / radius, 0.8), 0.006, 0.017) * r.range(0.85, 1.15);
    const perMetre = 1 / Math.max(0.02, Math.abs(lever) * bendAt(s0));
    const spring = new Spring(clamp(2.9 * Math.sqrt(radius / 0.0022), 2.2, 4.2), 0.1);

    const stay = e.stay;
    const t0 = e.start;

    const plan = {
      id: e.id,
      kind: 'sparrow',
      t0,
      branch,
      sign,
      perMetre: Math.min(perMetre, 0.32 / sag),
      spring,
      xN,
      W,
    };

    // Everything that moves while it is here, in time order.
    const tr = {
      yaw: new Track(yaw0),
      pitch: new Track(66 * DEG),
      crouch: new Track(-0.004),
      neck: new Track(0.6),
      headYaw: new Track(0),
      headPitch: new Track(0),
      headRoll: new Track(0),
      tailPitch: new Track(0.08),
      tailSpread: new Track(0),
      fold: new Track(0),
      legs: new Track(0),
      arc: new Track(s0),
      fluff: new Track(1),
      nibble: new Track(0),
      shake: new Track(0),
    };
    const flick = new Pulses();
    const bob = new Pulses();
    plan.tr = tr;
    plan.flick = flick;
    plan.bob = bob;

    // ---- the flight in ----
    // It comes down from the sunlit trees along the line of the light, so its
    // shadow starts as a faint blur and sharpens as it nears the shrub,
    // drifting in from one side; the last half metre it runs in along its
    // heading, a little below the twig, and swoops up to land.
    const win = ctx.window;
    const minX = win.x + win.reveal + 0.12;
    const Wl = norm([-sun[1], sun[0], 0]);
    const far = r.range(6.5, 8.5);
    const drift = r.sign() * r.range(0.12, 0.4);
    const IN_SPEED = r.range(3.0, 3.6);
    const BRAKE = r.range(0.85, 1.0);
    const makeIn = (landAt) => {
      const land = this._perchBody(plan, landAt, s0, 0, yaw0, -0.004, 0);
      const start = add(add(land, mul(sun, far)), mul(Wl, drift));
      const p1 = add(add(add(land, mul(sun, far * 0.45)), mul(Wl, drift * 0.75)), mul(Z, 0.15));
      const p2 = add(add(sub(land, mul(F, 0.9)), mul(sun, 0.2)), mul(Z, -0.05));
      for (const p of [p1, p2]) p[0] = Math.max(p[0], minX);
      return { path: curve(start, p1, p2, land), land };
    };
    // The time in depends on the path; settle both together.
    let inPath = makeIn(t0 + 2.5);
    const timeIn = (L) => (L > BRAKE ? (L - BRAKE) / IN_SPEED : 0) + (2 * Math.min(L, BRAKE)) / IN_SPEED;
    let tLand = t0 + timeIn(inPath.path.length);
    inPath = makeIn(tLand);
    tLand = t0 + timeIn(inPath.path.length);
    plan.in = { path: inPath.path, land: inPath.land, speed: IN_SPEED, brake: BRAKE, t0, t1: tLand };

    // Wingbeats on the way in: bursts and short glides with wings tucked,
    // then a long braking burst to land.
    const wingIn = this._bursts(r, t0, tLand - (2 * BRAKE) / IN_SPEED - 0.04, tLand + 0.2, tr.fold, 14.5);
    plan.bursts = wingIn;
    plan.brakeStart = tLand - (2 * BRAKE) / IN_SPEED;
    // Legs come down, tail spreads and dips as it brakes.
    tr.legs.to(tLand - 0.3, 1, 0.05);
    tr.tailSpread.to(plan.brakeStart, 1, 0.06);
    tr.tailPitch.to(plan.brakeStart, -0.55, 0.06);

    // ---- landing ----
    const tLeave = tLand + stay;
    plan.tLand = tLand;
    plan.tLeave = tLeave;
    spring.step(tLand, sag);
    spring.kick(tLand, r.range(0.15, 0.22));
    tr.pitch.to(tLand, PERCH_PITCH, 0.075);
    tr.crouch.to(tLand + 0.07, 0, 0.06);
    tr.fold.to(tLand + 0.07, 1, 0.055);
    tr.tailSpread.to(tLand + 0.12, 0, 0.09);
    tr.tailPitch.to(tLand + 0.04, 0.05, 0.06);
    flick.add(tLand + 0.18, 0.3, 0.06);
    bob.add(tLand, -0.004, 0.06);

    // ---- on the twig ----
    let t = tLand + r.range(0.4, 0.65);
    const end = tLeave - 1.25;
    let yaw = yaw0;
    let s = s0;
    // How far the heading has drifted from showing its side to the sun.
    const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
    const deviation = (y) => {
      const a = wrap(y - az - Math.PI / 2);
      const b = wrap(y - az + Math.PI / 2);
      return Math.abs(a) < Math.abs(b) ? a : b;
    };
    const look = (at, wide = true) => {
      const yawTo = wide ? r.range(-1.9, 1.9) : clamp(tr.headYaw.last + r.range(-0.6, 0.6), -1.9, 1.9);
      tr.headYaw.to(at, yawTo, 0.022);
      tr.headPitch.to(at, r.range(-0.3, 0.32), 0.028);
      tr.headRoll.to(at, r.next() < 0.25 ? r.sign() * r.range(0.2, 0.42) : 0, 0.03);
      if (r.next() < 0.3) tr.neck.to(at, r.range(0.4, 1), 0.06);
    };
    const hop = (at, push = 0.12) => {
      spring.kick(at, push);
      spring.step(at + 0.01, -sag * 0.8);
      spring.step(at + 0.12, sag * 0.8);
      spring.kick(at + 0.12, 0.1);
      bob.add(at, 0.011, 0.06);
    };
    if (r.next() < 0.35) t = this._rouse(tr, flick, r, t) + r.range(0.3, 0.7);
    while (t < end) {
      const x = r.next();
      if (x < 0.4) {
        look(t);
        // Often a quick scan: two or three looks in a row.
        if (r.next() < 0.45) {
          t += r.range(0.18, 0.4);
          look(t, false);
        }
      } else if (x < 0.53) {
        flick.add(t, r.range(0.35, 0.62), 0.045);
        bob.add(t, 0.0025, 0.05);
        if (r.next() < 0.4) {
          tr.fold.to(t, 0.82, 0.02);
          tr.fold.to(t + 0.08, 1, 0.03);
        }
      } else if (x < 0.6 && t < end - 0.6) {
        // Turns about on the twig with a little hop.
        yaw += r.sign() * Math.PI;
        tr.yaw.to(t, yaw, 0.04);
        tr.headYaw.to(t, r.range(-0.3, 0.3), 0.03);
        hop(t);
        t += 0.3;
      } else if (x < 0.67) {
        // Shuffles round a little, back toward showing its side.
        const dev = deviation(yaw);
        yaw += (Math.abs(dev) > 0.25 ? -Math.sign(dev) : r.sign()) * r.range(0.18, 0.42);
        tr.yaw.to(t, yaw, 0.07);
        bob.add(t, 0.003, 0.05);
      } else if (x < 0.75) {
        // A hop along the twig.
        const ds = (r.sign() * r.range(0.025, 0.05)) / branch.length;
        if (perchable(branch, s + ds) && perchable(branch, s + ds * 0.5)) {
          s += ds;
          tr.arc.to(t, s, 0.04);
          hop(t);
          t += 0.25;
        } else look(t);
      } else if (x < 0.84 && t < end - 2.8) {
        t = this._preen(tr, flick, r, t);
      } else if (x < 0.89) {
        t = this._rouse(tr, flick, r, t);
      } else if (x < 0.95 && t < end - 0.9) {
        t = this._wipe(tr, r, t);
      } else {
        tr.fold.to(t, 0.6, 0.025);
        tr.fold.to(t + 0.1, 1, 0.035);
      }
      const next = t + r.range(0.22, 1.25);
      if (next >= end) break;
      t = next;
    }
    plan.sEnd = s;

    // ---- turning to face across the page, the way it will fly ----
    // It leaves along its heading; if that points at the near edge of the
    // page, it turns about first, so its flight away is seen.
    const spot = viewFraction(view, shadowOf(this._perchBody(plan, tLeave - 1.6, s, 0, yaw, 0, 0), sun));
    const room = (y) => {
      const [dx, dy] = toView(view, [view.cx + Math.cos(y), view.cy + Math.sin(y)]);
      const d = [dx / view.w, dy / view.h];
      let k = Infinity;
      for (let i = 0; i < 2; i++) {
        if (d[i] > 1e-6) k = Math.min(k, (1 - spot[i]) / d[i]);
        else if (d[i] < -1e-6) k = Math.min(k, -spot[i] / d[i]);
      }
      return k;
    };
    if (room(yaw + Math.PI) > room(yaw) * 1.25 && t + 0.25 < tLeave - 1.5) {
      t += 0.25;
      yaw += r.sign() * Math.PI;
      tr.yaw.to(t, yaw, 0.04);
      tr.headYaw.to(t, r.range(-0.2, 0.2), 0.03);
      hop(t);
      t += 0.35;
    }

    // ---- getting ready to go: alert, a last look, a crouch ----
    const ta = Math.max(tLeave - 1.1, t + 0.45);
    tr.neck.to(ta, 1, 0.07);
    if (ta + 0.1 < tLeave - 0.45) {
      tr.headYaw.to(ta + 0.1, r.range(-1.2, 1.2), 0.022);
      tr.headPitch.to(ta + 0.1, r.range(-0.1, 0.25), 0.03);
    }
    if (ta + 0.55 < tLeave - 0.45) tr.headYaw.to(ta + 0.55, r.range(-1.2, 1.2), 0.022);
    tr.headYaw.to(tLeave - 0.32, 0, 0.026);
    tr.headPitch.to(tLeave - 0.32, 0.05, 0.03);
    tr.headRoll.to(tLeave - 0.32, 0, 0.03);
    flick.add(tLeave - 0.28, 0.4, 0.045);
    tr.pitch.to(tLeave - 0.2, 17 * DEG, 0.05);
    tr.crouch.to(tLeave - 0.17, -0.008, 0.035);

    // ---- the flight away ----
    spring.kick(tLeave - 0.03, 0.34);
    spring.step(tLeave, -sag);
    tr.fold.to(tLeave - 0.035, 0, 0.018);
    tr.crouch.to(tLeave, 0, 0.05);
    tr.legs.to(tLeave + 0.12, 0, 0.04);
    tr.tailSpread.to(tLeave - 0.02, 0.5, 0.03);
    tr.tailSpread.to(tLeave + 0.3, 0, 0.1);
    tr.tailPitch.to(tLeave + 0.05, 0.1, 0.06);
    // It springs off forward and up, its spread wings side-on to the light,
    // then banks away toward the trees along the line of the light: its shadow
    // flutters a little way across the page and dissolves rather than
    // vanishing. (Flying straight at the sun it would show the light only its
    // tail end, a few centimetres across, and be gone at once.)
    const yawOut = tr.yaw.last;
    const Fo = [Math.cos(yawOut), Math.sin(yawOut), 0];
    const from = this._perchBody(plan, tLeave, s, 0, yawOut, -0.008, 0);
    const far2 = r.range(7, 9);
    const drift2 = r.sign() * r.range(0.15, 0.45);
    const q1 = add(from, add(mul(Fo, 0.4), mul(Z, 0.03)));
    const q2 = add(add(add(from, mul(Fo, 0.62)), mul(sun, 0.9)), mul(Z, 0.03));
    const to = add(add(add(from, mul(Fo, 0.7)), mul(sun, far2)), mul(Wl, drift2));
    for (const p of [q1, q2]) p[0] = Math.max(p[0], minX);
    const outPath = curve(from, q1, q2, to);
    const OUT_SPEED = r.range(3.2, 3.7);
    plan.out = { path: outPath, t0: tLeave, v0: 0.5, speed: OUT_SPEED, tau: 0.5 };
    let tOut = 0;
    while (OUT_SPEED * tOut - (OUT_SPEED - 0.5) * 0.5 * (1 - Math.exp(-tOut / 0.5)) < outPath.length && tOut < 6) tOut += 0.02;
    // Hard beats to get away, then bursts and glides again.
    const tGone = tLeave + tOut;
    plan.burstsOut = this._bursts(r, tLeave + 0.42, tGone, tGone, tr.fold, 14.5, tLeave - 0.035, 17.5);
    plan.tGone = tGone;
    // Far out in the light its shadow is already a faint blur; it thins out
    // the rest of the way there and back.
    plan.fade = [t0, t0 + 0.6, tGone - 0.6, tGone];
    // The twig rings for a while after it has gone.
    plan.end = tGone + 3.5;
    return plan;
  }

  // Wing bursts between `from` and `to`, with short glides between them, then
  // continuous beating until `until`. Writes the tucks into the fold track.
  _bursts(r, from, to, until, fold, freq, leadIn = null, leadFreq = freq) {
    const list = [];
    let t = from;
    if (leadIn !== null) {
      list.push({ t0: leadIn, t1: from, f: leadFreq, amp: 1.05, brake: 0 });
    }
    while (t < to - 0.3) {
      const beats = 3 + Math.floor(r.next() * 3);
      const t1 = Math.min(to, t + beats / freq);
      list.push({ t0: t, t1, f: freq, amp: 1, brake: 0 });
      if (t1 >= to - 0.15) {
        t = t1;
        break;
      }
      const glide = r.range(0.07, 0.12);
      fold.to(t1, 1, 0.016);
      fold.to(t1 + glide, 0, 0.014);
      t = t1 + glide;
    }
    if (until > t) list.push({ t0: t, t1: until, f: freq * 1.12, amp: 1.25, brake: 1 });
    return list;
  }

  // A shake of the feathers: fluffed out, a fast shiver, smoothed down.
  _rouse(tr, flick, r, t) {
    tr.fluff.to(t, 1.15, 0.035);
    tr.shake.to(t + 0.03, 1, 0.02);
    tr.shake.to(t + 0.3, 0, 0.04);
    tr.fluff.to(t + 0.34, 1, 0.12);
    tr.fold.to(t + 0.05, 0.86, 0.03);
    tr.fold.to(t + 0.3, 1, 0.05);
    flick.add(t + 0.36, 0.35, 0.045);
    return t + 0.55;
  }

  // Preening: head turned back into the wing, small nibbling movements.
  _preen(tr, flick, r, t) {
    const D = r.range(1.3, 2.6);
    const sideA = r.sign();
    tr.headYaw.to(t, sideA * r.range(2.2, 2.75), 0.06);
    tr.headPitch.to(t, -r.range(0.35, 0.6), 0.07);
    tr.neck.to(t, 0, 0.1);
    tr.fluff.to(t, 1.06, 0.15);
    tr.nibble.to(t + 0.12, 1, 0.08);
    if (D > 1.8 && r.next() < 0.5) {
      tr.headYaw.to(t + D / 2, -sideA * r.range(2.0, 2.6), 0.07);
      flick.add(t + D / 2, 0.25, 0.05);
    }
    tr.nibble.to(t + D, 0, 0.05);
    tr.headYaw.to(t + D, r.range(-0.5, 0.5), 0.04);
    tr.headPitch.to(t + D, 0, 0.05);
    tr.neck.to(t + D, 0.6, 0.1);
    tr.fluff.to(t + D + 0.2, 1, 0.25);
    return t + D + 0.3;
  }

  // Wiping the bill on the twig, side to side.
  _wipe(tr, r, t) {
    tr.pitch.to(t, -6 * DEG, 0.06);
    tr.headPitch.to(t, -0.95, 0.04);
    tr.neck.to(t, 0.8, 0.05);
    const a = r.range(0.35, 0.55);
    tr.headYaw.to(t + 0.08, a, 0.025);
    tr.headYaw.to(t + 0.22, -a, 0.025);
    tr.headYaw.to(t + 0.36, a * 0.8, 0.025);
    tr.headYaw.to(t + 0.5, -a * 0.7, 0.025);
    tr.headYaw.to(t + 0.62, 0.1, 0.035);
    tr.headPitch.to(t + 0.64, 0.05, 0.05);
    tr.neck.to(t + 0.64, 0.6, 0.08);
    tr.pitch.to(t + 0.64, PERCH_PITCH, 0.08);
    return t + 0.8;
  }

  // ---- posing ---------------------------------------------------------------

  // Feet on the twig at time T: rest point at arc s, moved by the wind and by
  // the bird's own weight. Returns the plane point and the world feet.
  _feet(plan, T, s, time) {
    const b = plan.branch;
    const at = branchAt(b, s);
    const load = { pivot: b.pivot, level: b.level, angle: plan.sign * plan.perMetre * plan.spring.at(T) };
    const [u, v] = applyHierarchy(plan.W, at.p, b.chain, s, time ?? T, load);
    return [plan.xN, v, u + at.r];
  }

  // Body centre when perched.
  _perchBody(plan, T, s, bob, yaw, crouch, time) {
    const f = this._feet(plan, T, s, time || T);
    return [f[0] - Math.cos(yaw) * 0.002, f[1] - Math.sin(yaw) * 0.002, f[2] + STAND + crouch + bob];
  }

  // The load on the shrub's plane this frame.
  load(plan, T) {
    return { pivot: plan.branch.pivot, level: plan.branch.level, angle: plan.sign * plan.perMetre * plan.spring.at(T) };
  }

  _wingAt(bursts, T) {
    for (const b of bursts) {
      if (T >= b.t0 && T < b.t1) return { phase: ((T - b.t0) * b.f) % 1, amp: b.amp, brake: b.brake };
    }
    return null;
  }

  _pose(plan, T) {
    const tr = plan.tr;
    const pose = {
      yaw: tr.yaw.at(T),
      pitch: tr.pitch.at(T),
      roll: 0,
      fluff: tr.fluff.at(T) * (1 + 0.012 * Math.sin(TAU * 1.6 * T)),
      neck: tr.neck.at(T),
      headYaw: tr.headYaw.at(T),
      headPitch: tr.headPitch.at(T),
      headRoll: tr.headRoll.at(T),
      tailPitch: tr.tailPitch.at(T) + plan.flick.at(T),
      tailSpread: tr.tailSpread.at(T),
      legs: tr.legs.at(T),
      grip: 1,
      feet: null,
    };
    const fold = clamp(tr.fold.at(T), 0, 1);

    // The twig's movement shows in the tail: it balances.
    const dv = (plan.spring.at(T + 0.01) - plan.spring.at(T - 0.01)) / 0.02;

    // Shivers and nibbling.
    const shake = tr.shake.at(T);
    if (shake > 0.001) {
      pose.roll += 0.2 * shake * Math.sin(TAU * 13 * T);
      pose.headYaw += 0.35 * shake * Math.sin(TAU * 15 * T + 1);
    }
    const nib = tr.nibble.at(T);
    if (nib > 0.001) {
      pose.headPitch += 0.09 * nib * Math.sin(TAU * 6.5 * T) * Math.sin(TAU * 1.3 * T + 0.5);
      pose.headYaw += 0.07 * nib * Math.sin(TAU * 4.1 * T + 2);
    }

    let wing;
    if (T < plan.tLand) {
      // Flying in.
      const p = plan.in;
      const L = p.path.length;
      const cruise = L > p.brake ? (L - p.brake) / p.speed : 0;
      const dt = T - p.t0;
      let d;
      let speed;
      if (dt < cruise) {
        d = dt * p.speed;
        speed = p.speed;
      } else {
        const bt = dt - cruise;
        const b0 = Math.min(L, p.brake);
        const sq = Math.max(0, Math.sqrt(b0) - (bt * p.speed) / (2 * Math.sqrt(p.brake)));
        d = L - sq * sq;
        speed = (p.speed * sq) / Math.sqrt(p.brake);
      }
      const C = along(p.path, d);
      const ahead = sub(along(p.path, d + 0.03), along(p.path, d - 0.03));
      // Homing onto the twig as it moves in the wind.
      const home = smooth((d - (L - 0.7)) / 0.7);
      const there = this._perchBody(plan, T, plan.tr.arc.at(T), 0, pose.yaw, -0.004, T);
      const Cw = add(C, mul(sub(there, p.land), home));
      // Bounding: a slight rise in each burst, a fall in each glide.
      Cw[2] += 0.009 * Math.sin(TAU * 3.2 * dt) * (1 - smooth((T - plan.brakeStart + 0.2) / 0.2));
      pose.C = Cw;
      pose.yaw = Math.atan2(ahead[1], ahead[0]);
      // Ease the final heading into the yaw it will keep on the twig.
      const yawLand = plan.tr.yaw.v0;
      const dy = Math.atan2(Math.sin(yawLand - pose.yaw), Math.cos(yawLand - pose.yaw));
      pose.yaw += dy * smooth((d - (L - 0.5)) / 0.5);
      const climb = Math.atan2(ahead[2], Math.hypot(ahead[0], ahead[1]));
      const flare = smooth((T - plan.brakeStart) / (plan.tLand - plan.brakeStart));
      pose.pitch = lerp(0.5 * climb + 4 * DEG, 66 * DEG, flare);
      pose.roll = clamp(-0.08 * speed * this._turn(p.path, d), -0.5, 0.5);
      pose.headPitch = -0.3 * climb;
      if (pose.legs > 0.05) {
        const feet = this._feet(plan, T, plan.tr.arc.at(T), T);
        const lat = [-Math.sin(pose.yaw) * 0.0055 * SCALE, Math.cos(pose.yaw) * 0.0055 * SCALE, 0];
        pose.feet = [add(feet, lat), sub(feet, lat)];
        // The feet reach for the twig only in the last few centimetres.
        pose.grip = smooth(1 - (len(sub(Cw, there)) - 0.003) / 0.015);
      }
      const wb = this._wingAt(plan.bursts, T);
      wing = wb ? stroke(wb.phase, wb.amp, wb.brake) : FOLDED;
      wing = mixWing(wing, FOLDED, fold);
      pose.wing = wing;
      return pose;
    }

    if (T < plan.tLeave) {
      // On the twig.
      const s = tr.arc.at(T);
      const feet = this._feet(plan, T, s, T);
      const yaw = pose.yaw;
      const lat = [-Math.sin(yaw) * 0.0055 * SCALE, Math.cos(yaw) * 0.0055 * SCALE, 0];
      pose.feet = [add(feet, lat), sub(feet, lat)];
      pose.C = this._perchBody(plan, T, s, plan.bob.at(T), yaw, tr.crouch.at(T), T);
      pose.tailPitch += clamp(-0.9 * dv, -0.35, 0.35);
      pose.pitch += clamp(0.4 * dv, -0.12, 0.12);
      // Balancing beats just after landing, then wings away.
      const wb = this._wingAt(plan.bursts, T) ?? this._wingAt(plan.burstsOut, T);
      const flickPose = wb ? stroke(wb.phase, wb.amp * (1 - settle(T - plan.tLand, 0.08)), 1) : PERCH_FLICK;
      pose.wing = mixWing(flickPose, FOLDED, fold);
      return pose;
    }

    // Flying away.
    const o = plan.out;
    const dt = T - o.t0;
    const d = o.speed * dt - (o.speed - o.v0) * o.tau * (1 - Math.exp(-dt / o.tau));
    const speed = o.speed - (o.speed - o.v0) * Math.exp(-dt / o.tau);
    pose.C = along(o.path, d);
    const ahead = sub(along(o.path, d + 0.03), along(o.path, d - 0.03));
    const climb = Math.atan2(ahead[2], Math.hypot(ahead[0], ahead[1]));
    const k = settle(dt, 0.05);
    const heading = Math.atan2(ahead[1], ahead[0]);
    pose.yaw += Math.atan2(Math.sin(heading - pose.yaw), Math.cos(heading - pose.yaw)) * k;
    pose.pitch = lerp(pose.pitch, 0.6 * climb + 10 * DEG * (1 - k), k);
    pose.roll = clamp(-0.08 * speed * this._turn(o.path, d), -0.5, 0.5);
    pose.headPitch = lerp(pose.headPitch, -0.3 * climb, k);
    pose.C[2] += 0.009 * Math.sin(TAU * 3.2 * Math.max(0, dt - 0.4)) * smooth((dt - 0.4) / 0.3);
    const lift = this._feet(plan, T, plan.sEnd, T);
    const lat = [-Math.sin(pose.yaw) * 0.0055 * SCALE, Math.cos(pose.yaw) * 0.0055 * SCALE, 0];
    pose.feet = [add(lift, lat), sub(lift, lat)];
    pose.grip = 1 - settle(dt, 0.03);
    const wb = this._wingAt(plan.burstsOut, T);
    wing = wb ? stroke(wb.phase, wb.amp, 0) : FOLDED;
    pose.wing = mixWing(wing, FOLDED, fold);
    return pose;
  }

  // Rate of turn along a path (radians per metre), for banking.
  _turn(path, d) {
    const a = sub(along(path, d), along(path, d - 0.05));
    const b = sub(along(path, d + 0.05), along(path, d));
    const ha = Math.atan2(a[1], a[0]);
    const hb = Math.atan2(b[1], b[0]);
    return Math.atan2(Math.sin(hb - ha), Math.cos(hb - ha)) / 0.05;
  }

  // What to draw at this time: the projected moments, the plane region and
  // the twig's bend.
  frame(plan, time, ctx) {
    // The twig moves with this frame's wind, as the shrub does on screen.
    plan.W = ctx.wind;
    const flying = time < plan.tLand + 0.3 || time > plan.tLeave - 0.1;
    const moments = flying ? MAX_MOMENTS : 2;
    const shutter = flying ? SHUTTER : SHUTTER * 0.6;
    const poses = [];
    for (let m = 0; m < moments; m++) poses.push(this._pose(plan, time + shutter * ((m + 0.5) / moments - 0.5)));
    const O = poses[moments >> 1].C;
    const [a0, a1, b0, b1] = plan.fade;
    const opacity = smooth((time - a0) / (a1 - a0)) * (1 - smooth((time - b0) / (b1 - b0)));
    const f = cast(this.data, poses.map(birdShape), O, ctx.sun, ctx.view, opacity);
    f.load = this.load(plan, time);
    f.phase = time < plan.tLand ? 'arriving' : time < plan.tLeave ? 'perched' : time < plan.tGone ? 'leaving' : 'gone';
    return f;
  }
}
