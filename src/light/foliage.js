// Seeded branch structures for the near and mid foliage planes.
//
// A plant is grown as limbs (level 0), branches (1) and twigs (2) with leaves.
// Every segment and leaf records the chain of joints it hangs from: the pivot
// of each ancestor, where along that ancestor the chain attaches, the
// ancestor's lean against the wind, and its phase. The vertex shaders replay
// that chain every frame, so the wind bends whole structures and nothing
// detaches.

import { makeRng, subSeed } from './random.js';

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;

// Growth rules per level: limb, branch, twig.
const RULES = {
  segLen: [0.05, 0.035, 0.022],
  wander: [2.2 * DEG, 3.5 * DEG, 5 * DEG],
  droop: [0.012, 0.03, 0.05],
  taper: [0.72, 0.75, 0.7],
};

function lengthOf(pts) {
  let l = 0;
  for (let i = 1; i < pts.length; i++) l += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  return l;
}

function pointAt(pts, s) {
  const f = s * (pts.length - 1);
  const i = Math.min(pts.length - 2, Math.floor(f));
  const k = f - i;
  const a = pts[i];
  const b = pts[i + 1];
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, Math.atan2(b[1] - a[1], b[0] - a[0])];
}

export function growPlant(spec, seed) {
  // Each limb has its own random stream, so editing one never reshuffles the rest.
  let rng = makeRng(seed);
  const leaves = [];
  const segments = [];
  // Directions in plane coordinates: where branches droop, and where the wind
  // pushes them. On a plane parallel to the window wall, down is -u.
  const g = spec.gravity ?? -Math.PI / 2;
  const wind = spec.wind ?? [1, 0];

  function branch({ level, start, angle, length, radius, chain, leafy, zones, leafFrom: leafStart, taper: ownTaper }) {
    const step = RULES.segLen[level];
    const n = Math.max(2, Math.ceil(length / step));
    const pts = [start.slice()];
    let a = angle;
    let p = start.slice();
    for (let i = 1; i <= n; i++) {
      a += rng.gauss(0, RULES.wander[level]) - RULES.droop[level] * Math.sin(a - g) * spec.droop;
      p = [p[0] + Math.cos(a) * (length / n), p[1] + Math.sin(a) * (length / n)];
      pts.push(p);
    }

    // Lean: how the wind turns this branch about its base. A branch pointing
    // down swings one way, pointing up the other, lying along the wind barely.
    const end = pts[pts.length - 1];
    const len0 = Math.max(1e-6, Math.hypot(end[0] - start[0], end[1] - start[1]));
    const dx = (end[0] - start[0]) / len0;
    const dy = (end[1] - start[1]) / len0;
    let lean = (-dy * wind[0] + dx * wind[1]) * 0.85 + rng.range(-0.2, 0.2);
    if (Math.abs(lean) < 0.18) lean = lean < 0 ? -0.18 : 0.18;
    const self = { pivot: start, lean, phase: rng.next() * TAU };

    const own = [...chain, { ...self, s: -1 }];
    const taper = ownTaper ?? RULES.taper[level];
    for (let i = 0; i < n; i++) {
      const s0 = i / n;
      const s1 = (i + 1) / n;
      segments.push({
        a: pts[i],
        b: pts[i + 1],
        ra: radius * (1 - taper * s0),
        rb: radius * (1 - taper * s1),
        sa: s0,
        sb: s1,
        chain: own,
      });
    }

    const at = (s) => [...chain, { ...self, s }];

    if (level < 2) {
      const rule = spec.levels[level];
      let s = rule.start + rng.range(0, rule.spacing * 0.6);
      let side = rng.sign();
      const inZone = (t) => !zones || zones.some(([a, b]) => t >= a && t <= b);
      while (s < 0.97) {
        if (!inZone(s)) {
          s += (rule.spacing * 0.5) / Math.max(0.2, length);
          continue;
        }
        const [x, y, dir] = pointAt(pts, s);
        const spread = rng.range(rule.angle[0], rule.angle[1]) * DEG;
        const childAngle = dir + side * spread;
        const childLen = rule.length * (1 - rule.shorten * s) * rng.range(0.72, 1.18) * Math.min(1, length / rule.refLength);
        if (childLen > 0.03) {
          branch({
            level: level + 1,
            start: [x, y],
            angle: childAngle,
            length: childLen,
            radius: Math.max(0.0012, radius * (1 - taper * s) * rule.radius),
            chain: at(s),
            leafy: true,
          });
        }
        side = rng.next() < 0.78 ? -side : side;
        s += rule.spacing * rng.range(0.7, 1.3) / Math.max(0.2, length);
      }
    }

    // Leaves along twigs, and near the tips of branches.
    const leafRule = spec.leaf;
    const leafFrom = leafStart ?? (level === 2 ? 0.12 : level === 1 ? 0.55 : 2);
    if (leafy && leafFrom < 1) {
      let s = leafFrom + rng.range(0, 0.08);
      let side = rng.sign();
      const lengthNow = lengthOf(pts);
      while (s <= 1.0) {
        const [x, y, dir] = pointAt(pts, Math.min(s, 1));
        const len = leafRule.length * rng.range(0.74, 1.16) * (s > 0.93 ? 0.92 : 1);
        let ang = s > 0.97 ? dir + rng.gauss(0, 10 * DEG) : dir + side * rng.range(leafRule.angle[0], leafRule.angle[1]) * DEG;
        // Leaves hang a little toward the ground.
        ang += -Math.sin(ang - g) * leafRule.hang * rng.range(0.5, 1.2);
        if (rng.next() < spec.density) {
          leaves.push({
            attach: [x, y],
            angle: ang,
            length: len,
            width: len * rng.range(...(leafRule.width ?? [0.42, 0.56])),
            shape: rng.next(),
            flutter: rng.range(0.55, 1.3),
            rate: rng.range(1.7, 3.6),
            phase: rng.next() * TAU,
            chain: at(Math.min(s, 1)),
          });
        }
        side = -side;
        s += (leafRule.spacing * rng.range(0.75, 1.25)) / Math.max(0.05, lengthNow);
      }
    }
    return { pts, at };
  }

  spec.limbs.forEach((limb, i) => {
    rng = makeRng(subSeed(seed, `limb-${i}`));
    const { pts, at } = branch({
      level: 0,
      start: limb.start,
      angle: limb.angle * DEG,
      length: limb.length,
      radius: limb.radius,
      chain: [],
      leafy: false,
      zones: limb.zones,
    });
    // Level side shoots, bare but for a few leaves at the tip: where a small
    // bird would stand. Each has its own random stream.
    (limb.perches ?? []).forEach((p, j) => {
      rng = makeRng(subSeed(seed, `limb-${i}-perch-${j}`));
      const [x, y] = pointAt(pts, p.s);
      branch({
        level: 1,
        start: [x, y],
        angle: p.angle * DEG,
        length: p.length,
        // As thick as the stem where it forks, so a bird's weight is plausible
        // and its shadow shows as a line under the bird.
        radius: limb.radius * (1 - RULES.taper[0] * p.s),
        taper: 0.45,
        chain: at(p.s),
        leafy: true,
        zones: [[0.8, 1.0]],
        leafFrom: 0.82,
      });
    });
  });
  return { leaves, segments };
}

// Pack a chain into the three per-level vec4 attributes the shaders expect.
export function packChain(chain, out, o) {
  for (let k = 0; k < 3; k++) {
    const e = chain[k];
    if (e) {
      out.levels[k].set([e.pivot[0], e.pivot[1], e.s, e.lean], o);
      out.phase[o + k] = e.phase;
    } else {
      out.levels[k].set([0, 0, 0, 0], o);
      out.phase[o + k] = 0;
    }
  }
}

export function packLeaves(leaves) {
  const n = leaves.length;
  const levels = [new Float32Array(n * 4), new Float32Array(n * 4), new Float32Array(n * 4)];
  const phase = new Float32Array(n * 4);
  const leaf = new Float32Array(n * 4);
  const leaf2 = new Float32Array(n * 4);
  leaves.forEach((l, i) => {
    const o = i * 4;
    packChain(l.chain, { levels, phase }, o);
    phase[o + 3] = l.phase;
    leaf.set([l.attach[0], l.attach[1], l.angle, l.length], o);
    leaf2.set([l.width, l.shape, l.flutter, l.rate], o);
  });
  return { count: n, l0: levels[0], l1: levels[1], l2: levels[2], phase, leaf, leaf2 };
}

export function packSegments(segments) {
  const n = segments.length;
  const levels = [new Float32Array(n * 4), new Float32Array(n * 4), new Float32Array(n * 4)];
  const phase = new Float32Array(n * 4);
  const seg = new Float32Array(n * 4);
  const segW = new Float32Array(n * 4);
  segments.forEach((s, i) => {
    const o = i * 4;
    packChain(s.chain, { levels, phase }, o);
    seg.set([s.a[0], s.a[1], s.b[0], s.b[1]], o);
    segW.set([s.ra, s.rb, s.sa, s.sb], o);
  });
  return { count: n, l0: levels[0], l1: levels[1], l2: levels[2], phase, seg, segW };
}

// Plant designs for each plane, in that plane's (u, v) coordinates: u is
// height above the paper, v is position along the window wall. Each is placed
// where rays from the paper meet it across the daylight presets.
export const PLANTS = {
  // A leafy shrub in a pot on the balcony, just outside the window. Its
  // stems carry leaves only in certain bands, so the paper gets clusters with
  // clear light between them. `zones` are ranges along a stem (0..1).
  // `perches` are level side shoots where the visiting bird stands, placed
  // along the line where the page's light crosses the shrub through the day.
  near: {
    gravity: Math.PI,
    wind: [0, 1],
    droop: 0.7,
    density: 0.9,
    limbs: [
      {
        start: [0.0, 0.8],
        angle: 2,
        length: 1.3,
        radius: 0.0065,
        zones: [[0.46, 0.6], [0.76, 0.96]],
        perches: [{ s: 0.42, angle: 92, length: 0.24 }, { s: 0.48, angle: -90, length: 0.24 }, { s: 0.59, angle: -90, length: 0.26 }, { s: 0.74, angle: -91, length: 0.3 }],
      },
      {
        start: [0.0, 0.34],
        angle: 1,
        length: 2.3,
        radius: 0.0075,
        zones: [[0.66, 0.98]],
        perches: [{ s: 0.67, angle: 90, length: 0.28 }, { s: 0.76, angle: 88, length: 0.26 }],
      },
      { start: [0.0, 1.22], angle: -6, length: 0.75, radius: 0.005, zones: [[0.5, 0.62], [0.78, 0.98]] },
      { start: [0.0, 1.0], angle: 3, length: 0.52, radius: 0.0045, zones: [[0.46, 1.0]] },
      // Low growth at the base of the pot. Sunrise and sunset rays cross the
      // shrub here, so grazing light finds leaves rather than bare stems.
      { start: [0.02, 1.06], angle: 52, length: 0.5, radius: 0.0038, zones: [[0.12, 1.0]] },
      // Upper growth crossed by late-morning and early-afternoon light, so the
      // page is never left with the window bar alone.
      {
        start: [0.0, 0.58],
        angle: 6,
        length: 1.85,
        radius: 0.0055,
        zones: [[0.68, 0.98]],
        perches: [{ s: 0.38, angle: 88, length: 0.22 }, { s: 0.49, angle: -92, length: 0.22 }, { s: 0.59, angle: -90, length: 0.26 }, { s: 0.65, angle: -89, length: 0.3 }],
      },
      { start: [0.0, 0.12], angle: 4, length: 1.75, radius: 0.005, zones: [[0.72, 1.0]], perches: [{ s: 0.86, angle: 91, length: 0.26 }] },
      { start: [0.0, 0.4], angle: 3, length: 1.68, radius: 0.0052, zones: [[0.62, 0.86]], perches: [{ s: 0.76, angle: 92, length: 0.27 }] },
    ],
    levels: [
      { start: 0.08, spacing: 0.07, angle: [30, 64], length: 0.22, shorten: 0.3, refLength: 0.8, radius: 0.55 },
      { start: 0.1, spacing: 0.05, angle: [30, 62], length: 0.1, shorten: 0.3, refLength: 0.2, radius: 0.5 },
    ],
    leaf: { length: 0.064, spacing: 0.022, angle: [32, 60], hang: 0.22, width: [0.46, 0.6] },
  },
  // A garden tree a few metres out. One branch reaches over the page's top
  // left in the morning; another crosses its light at midday.
  mid: {
    gravity: Math.PI,
    wind: [0, 1],
    droop: 0.55,
    density: 0.85,
    limbs: [
      { start: [3.7, 3.45], angle: -138, length: 1.55, radius: 0.022, zones: [[0.45, 1.0]] },
      { start: [6.6, 0.05], angle: 138, length: 1.35, radius: 0.02, zones: [[0.35, 1.0]] },
      { start: [2.1, 4.1], angle: -118, length: 1.5, radius: 0.018, zones: [[0.5, 1.0]] },
      // Branches through the mid-morning, late-morning and afternoon light.
      { start: [5.6, 2.3], angle: -155, length: 2.5, radius: 0.017, zones: [[0.3, 1.0]] },
      { start: [4.7, 3.0], angle: -140, length: 1.5, radius: 0.014, zones: [[0.3, 1.0]] },
      { start: [4.25, 2.45], angle: -150, length: 1.35, radius: 0.012, zones: [[0.25, 1.0]] },
    ],
    levels: [
      { start: 0.1, spacing: 0.16, angle: [28, 58], length: 0.42, shorten: 0.45, refLength: 1.2, radius: 0.5 },
      { start: 0.08, spacing: 0.09, angle: [30, 62], length: 0.18, shorten: 0.35, refLength: 0.5, radius: 0.5 },
    ],
    leaf: { length: 0.075, spacing: 0.034, angle: [36, 64], hang: 0.3 },
  },
};

export function buildLayer(name, seed, overrides = {}) {
  const base = PLANTS[name];
  const spec = {
    ...base,
    density: overrides.density ?? base.density,
    leaf: { ...base.leaf, length: overrides.leafLength ?? base.leaf.length },
  };
  const plant = growPlant(spec, subSeed(seed, name));
  return { leaves: packLeaves(plant.leaves), segments: packSegments(plant.segments), raw: plant };
}
