// The study's live state: settings, the time of day, and animation time.
// The time of day (a clock, in hours) and animation time are independent, so a
// held time of day keeps its light while the leaves move, and pausing freezes
// one exact frame.

import { BIRD, DAY, DEFAULT_PRESET, FOLIAGE, FRAMING, OPTICS, PAPER, PRESETS, SCENE, TRANSITION_SECONDS, WIND } from './settings.js';
import { clampClock, clockDelta, daylightAt } from './daylight.js';

const clone = (o) => structuredClone(o);

function writeDaylight(state, d) {
  Object.assign(state.sun, d.sun);
  Object.assign(state.sky, d.sky);
  Object.assign(state.room, d.room);
  state.bounce = d.bounce;
  state.exposure = d.exposure;
  state.wind.strength = d.wind.strength;
  state.ui = d.ui;
}

const ease = (x) => x * x * x * (x * (x * 6 - 15) + 10);

export function createState(presetName = DEFAULT_PRESET) {
  const p = PRESETS[presetName];
  const d = daylightAt(p.clock);
  return {
    seed: 7,
    preset: presetName,
    clock: p.clock,
    live: false,
    ui: d.ui,
    dayPlaying: false,
    time: p.stillTime,
    playing: true,
    timeScale: 1,
    debug: 0,
    scene: clone(SCENE),
    framing: clone(FRAMING),
    paper: clone(PAPER),
    optics: clone(OPTICS),
    wind: { ...clone(WIND), strength: d.wind.strength },
    foliage: clone(FOLIAGE),
    bird: clone(BIRD),
    sun: d.sun,
    sky: d.sky,
    room: d.room,
    bounce: d.bounce,
    exposure: d.exposure,
  };
}

// Moves the time of day. Direction, colour, intensity, ambient light and wind
// all change together; this is never a colour filter over the same frame.
//
// Three ways to move: a glide to a named moment (eased, a few seconds), a
// scrub that follows a moving target such as the slider (the light trails it
// by a fraction of a second, so the sun glides instead of jumping), and play,
// which runs the day forward at a steady rate.
export class DaylightController {
  constructor(state) {
    this.state = state;
    this.target = state.clock;
    this.glide = null;
  }

  go(name, seconds = TRANSITION_SECONDS) {
    const p = PRESETS[name];
    if (!p) return;
    this.toClock(p.clock, seconds);
    this.state.preset = name;
  }

  toClock(clock, seconds = TRANSITION_SECONDS) {
    const s = this.state;
    const c = clampClock(clock);
    s.dayPlaying = false;
    s.preset = 'custom';
    this.target = c;
    if (seconds <= 0) {
      this.glide = null;
      s.clock = c;
      this._write();
      return;
    }
    this.glide = { from: s.clock, by: clockDelta(s.clock, c), t: 0, seconds };
  }

  // Follow a clock that moves by itself (the visitor's local time).
  follow(clock) {
    const s = this.state;
    const c = clampClock(clock);
    if (this.glide || s.dayPlaying || Math.abs(clockDelta(s.clock, c)) < 1e-4) return;
    s.clock = c;
    this.target = c;
    this._write();
  }

  scrub(clock, immediate = false) {
    const s = this.state;
    this.glide = null;
    s.dayPlaying = false;
    s.preset = 'custom';
    this.target = clampClock(clock);
    if (immediate) {
      s.clock = this.target;
      this._write();
    }
  }

  play(on = !this.state.dayPlaying) {
    const s = this.state;
    this.glide = null;
    if (on && !DAY.wrap && s.clock >= DAY.end - 1e-3) {
      // Start the day again. Both ends are without sun, so this is calm.
      s.clock = DAY.start;
      this._write();
    }
    s.dayPlaying = on;
    s.preset = 'custom';
    this.target = s.clock;
  }

  cancel() {
    this.glide = null;
    this.state.dayPlaying = false;
    this.target = this.state.clock;
  }

  get active() {
    return this.state.dayPlaying || this.glide !== null || Math.abs(clockDelta(this.state.clock, this.target)) > 1e-5;
  }

  // Advance in wall-clock seconds, independent of animation time.
  step(dt) {
    const s = this.state;
    if (s.dayPlaying) {
      const next = s.clock + ((DAY.end - DAY.start) / DAY.playSeconds) * dt;
      if (DAY.wrap) s.clock = clampClock(next);
      else {
        s.clock = Math.min(DAY.end, next);
        if (s.clock >= DAY.end) s.dayPlaying = false;
      }
      this.target = s.clock;
    } else if (this.glide) {
      const g = this.glide;
      g.t = Math.min(1, g.t + dt / g.seconds);
      s.clock = clampClock(g.from + g.by * ease(g.t));
      if (g.t >= 1) this.glide = null;
    } else if (Math.abs(clockDelta(s.clock, this.target)) > 1e-5) {
      const k = 1 - Math.exp(-dt / DAY.smoothing);
      s.clock = clampClock(s.clock + clockDelta(s.clock, this.target) * k);
      if (Math.abs(clockDelta(s.clock, this.target)) < 2e-4) s.clock = this.target;
    } else {
      return;
    }
    this._write();
  }

  _write() {
    writeDaylight(this.state, daylightAt(this.state.clock));
  }
}
