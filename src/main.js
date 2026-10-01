// komorebi: sunlight through leaves on paper, as one page. The light, the
// leaves and the visiting bird are in src/light; this page adds the word, set
// like a dictionary entry in dissolving ink (and its moonlit counterpart at
// night), the time of day under it as the sky's own diagram, calm music, off
// until the visitor turns it on, and a screensaver.

import { PaperLightRenderer } from './light/renderer.js';
import { createState, DaylightController } from './light/state.js';
import { DEFAULT_PRESET, PRESETS, PRESET_ORDER } from './light/settings.js';
import { canvasToBlob, pixelsToCanvas, postCapture } from './light/capture.js';
import { applyLayout } from './layout.js';
import { drawCenterOverlay } from './overlay.js';
import { LEVEL, Music, trackExcerpt } from './music.js';
import { wav } from './wav.js';
import { GONE, settings as dissolveSettings, startDissolve } from './dissolve/dissolve.js';
import { SunPath } from './sunpath.js';
import { Icons } from './icons.js';

const canvas = document.getElementById('study');
const fallback = document.getElementById('fallback');
const controls = document.getElementById('controls');
const soundButton = controls.querySelector('.sound');
const restButton = controls.querySelector('.rest');
const root = document.documentElement;

// ---- the words: komorebi by day, its moonlit counterpart by night -----------------

const WORDS = {
  sun: {
    kanji: '木漏れ日',
    word: 'komorebi',
    say: '[ komoɾebi ]',
    label: 'noun',
    meaning: 'Sunlight filtering through leaves, and the dance of light and shadow where it falls, trembling with every breath of wind.',
  },
  // There is no dictionary word for moonlight through leaves; 木漏れ月 is a poetic
  // coinage on the same pattern (the classical phrase is 木の間より漏りくる月の影).
  moon: {
    kanji: '木漏れ月',
    word: 'komorezuki',
    say: '[ komoɾezɯki ]',
    label: 'noun, poetic',
    meaning: 'Moonlight filtering through leaves, and the faint lace of silver and shadow where it falls, slow as the hours before dawn.',
  },
};
const el = {
  kanji: document.querySelector('.kanji'),
  word: document.querySelector('.word'),
  say: document.querySelector('.say .ipa'),
  label: document.querySelector('.say .pos i'),
  meaning: document.querySelector('.meaning'),
};
// The moon's words while moonlight lights the page: from the evening, when the
// risen moon takes over from the lamp, until first light.
const moonlit = (clock) => {
  const c = ((clock % 24) + 24) % 24;
  return c >= 20 || c < 6;
};
let shownWords = null;
function setWords(kind) {
  const w = WORDS[kind];
  for (const key of Object.keys(el)) el[key].textContent = w[key];
  shownWords = kind;
}

function webgl2Available() {
  try {
    return !!document.createElement('canvas').getContext('webgl2');
  } catch {
    return false;
  }
}

// Without WebGL2: a still of the visitor's part of the day, and the words.
function showFallback() {
  canvas.hidden = true;
  const h = new Date().getHours() + new Date().getMinutes() / 60;
  if (h >= 19.5 || h < 5.25) {
    root.dataset.theme = 'dark';
    fallback.querySelector('source').srcset = '/fallback/night-portrait.jpg';
    const img = fallback.querySelector('img');
    img.src = '/fallback/night-landscape.jpg';
    img.alt = 'Moonlight through a window and leaves on textured paper';
  }
  fallback.hidden = false;
  controls.hidden = true;
  setWords(moonlit(h) ? 'moon' : 'sun');
}

// ---- state: the visitor's own time, or a time they chose ---------------------

const params = new URLSearchParams(location.hash.slice(1));
const state = createState(DEFAULT_PRESET);
const daylight = new DaylightController(state);

function localClock() {
  const d = new Date();
  return d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600;
}
const PREF = 'komorebi:time';
function loadPreference() {
  try {
    return JSON.parse(localStorage.getItem(PREF) ?? 'null');
  } catch {
    return null;
  }
}
let capturing = false;
function savePreference() {
  if (capturing) return;
  try {
    localStorage.setItem(PREF, JSON.stringify(state.live ? { mode: 'now' } : { mode: 'fixed', clock: +state.clock.toFixed(3) }));
  } catch {
    // Storage can be unavailable; the choice then lasts for this visit only.
  }
}
const pref = loadPreference();
if (params.has('clock')) {
  const c = parseFloat(params.get('clock'));
  if (Number.isFinite(c)) daylight.toClock(c, 0);
} else if (pref?.mode === 'fixed' && Number.isFinite(pref.clock)) {
  daylight.toClock(pref.clock, 0);
} else {
  state.live = true;
  daylight.toClock(localClock(), 0);
}

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
if (reducedMotion.matches) {
  state.playing = false;
  state.bird.enabled = false;
  state.time = PRESETS[DEFAULT_PRESET].stillTime;
}

function writeHash() {
  if (state.live) history.replaceState(null, '', location.pathname);
  else history.replaceState(null, '', `#clock=${state.clock.toFixed(2)}`);
}

// ---- renderer -----------------------------------------------------------------

let view;
if (!webgl2Available() || params.has('fallback')) showFallback();
else {
  try {
    view = new PaperLightRenderer(canvas);
  } catch (err) {
    console.error(err);
    showFallback();
  }
}

state.optics.dprCap = 2;
const dprCap = () => Math.min(window.devicePixelRatio || 1, state.optics.dprCap);
function fit() {
  applyLayout(root, window.innerWidth, window.innerHeight);
  if (view) view.resize(window.innerWidth, window.innerHeight, dprCap(), state.optics.lightScale);
}

// Keep motion smooth before keeping detail.
const QUALITY = [
  { lightScale: 0.5, taps: 40, farTaps: 128, shadowSteps: 8 },
  { lightScale: 0.42, taps: 32, farTaps: 96, shadowSteps: 6 },
  { lightScale: 0.34, taps: 26, farTaps: 64, shadowSteps: 5 },
  { lightScale: 0.28, taps: 20, farTaps: 48, shadowSteps: 4 },
];
const coarse = window.matchMedia('(pointer: coarse)').matches && Math.min(screen.width, screen.height) < 900;
const perf = { frames: 0, sum: 0, level: coarse ? 1 : 0 };
Object.assign(state.optics, QUALITY[perf.level]);
function watchPerformance(dt) {
  if (!state.playing || daylight.active || document.hidden || dt > 0.07) return;
  perf.frames++;
  perf.sum += dt;
  if (perf.frames < 120) return;
  const avg = perf.sum / perf.frames;
  perf.frames = 0;
  perf.sum = 0;
  if (avg > 0.024 && perf.level < QUALITY.length - 1) {
    perf.level++;
    Object.assign(state.optics, QUALITY[perf.level]);
    fit();
  }
}

// ---- sound ----------------------------------------------------------------------

const MUSIC = '/music/komorebi.mp3';
const music = new Music(MUSIC);
soundButton.hidden = true;
music.available().then((ok) => (soundButton.hidden = !ok));
soundButton.addEventListener('click', async () => {
  try {
    const on = await music.toggle();
    soundButton.setAttribute('aria-pressed', String(on));
  } catch (err) {
    console.error(err);
    soundButton.setAttribute('aria-pressed', 'false');
  }
});

// ---- the words, in dissolving ink --------------------------------------------------

// The page does not scroll, so the bands where text dissolves at the top and
// bottom of the view are kept to the very edges.
dissolveSettings.bands = [0.02, 0.02];
let dissolve = null;
// Once the paper is showing and the faces are in, the words write themselves
// in. If that takes longer than the page waits (see index.html), the page's own
// letters are already showing: the effect takes over without writing them in,
// as it draws the same letters.
async function startTitle() {
  if (reducedMotion.matches || !window.WebGL2RenderingContext || resting.held) return;
  try {
    await Promise.all([
      view.noiseReady,
      document.fonts.load('230 72px "Fraunces Voice"', 'komorebi'),
      document.fonts.load('italic 260 17px "Fraunces Voice"', 'noun, poetic'),
      document.fonts.load('260 17px "Noto Serif"', 'ɾɯ'),
      document.fonts.load('500 32px "Shippori Mincho"', '木漏れ日月'),
    ]);
    const writeIn = root.classList.contains('dissolve-pending');
    dissolve = startDissolve({ selector: '[data-dissolve]', write: writeIn });
    if (!dissolve) root.classList.remove('dissolve-pending');
    else if (resting.on) dissolve.writeOut(0.01);
  } catch (err) {
    console.error(err);
    root.classList.remove('dissolve-pending', 'dissolve-on');
  }
}

// When the light passes from sun to moon or back, the words lift away and the
// other words write themselves in.
let swapping = false;
async function followWords() {
  const want = moonlit(state.clock) ? 'moon' : 'sun';
  if (want === shownWords || swapping) return;
  if (!dissolve || resting.on) {
    setWords(want);
    dissolve?.rebuild();
    return;
  }
  swapping = true;
  try {
    await dissolve.writeOut(1.2);
    if (!resting.on) {
      setWords(want);
      dissolve.rebuild();
      dissolve.write(GONE);
    }
  } finally {
    swapping = false;
  }
  followWords();
}

// For a still: the words for its hour, at once.
function settleWords() {
  const want = moonlit(state.clock) ? 'moon' : 'sun';
  if (want === shownWords) return;
  setWords(want);
  dissolve?.rebuild();
}

// ---- screensaver ----------------------------------------------------------------------

// The light alone: the words lift away and the controls fade, full screen, with
// the screen kept awake; any key, touch or movement brings the page back. With
// #screensaver in the address (for apps that show a web page as a screensaver
// or live wallpaper), the page opens as the light alone and stays so.
const resting = { on: false, held: params.has('screensaver'), since: 0, lock: null, origin: null };
async function keepAwake() {
  try {
    resting.lock = (await navigator.wakeLock?.request('screen')) ?? null;
  } catch {
    resting.lock = null;
  }
}
function rest(on) {
  if (on === resting.on) return;
  resting.on = on;
  root.classList.toggle('resting', on);
  restButton.setAttribute('aria-pressed', String(on));
  if (on) {
    resting.since = performance.now();
    resting.origin = null;
    if (!resting.held) {
      root.requestFullscreen?.().catch(() => {});
      keepAwake();
    }
    dissolve?.writeOut(1.6);
  } else {
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    resting.lock?.release?.().catch(() => {});
    resting.lock = null;
    dissolve?.write(GONE);
  }
}
function wake(e) {
  if (!resting.on || resting.held || performance.now() - resting.since < 900) return;
  if (e.type === 'pointermove') {
    // A hand on the mouse, not the desk shaking.
    if (!resting.origin) {
      resting.origin = [e.clientX, e.clientY];
      return;
    }
    if (Math.hypot(e.clientX - resting.origin[0], e.clientY - resting.origin[1]) < 12) return;
  }
  rest(false);
}
for (const type of ['pointermove', 'pointerdown', 'keydown', 'wheel']) window.addEventListener(type, wake, { passive: true });
document.addEventListener('fullscreenchange', () => {
  if (!document.fullscreenElement && resting.on && !resting.held && performance.now() - resting.since > 900) rest(false);
});
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && resting.on && !resting.held && !resting.lock) keepAwake();
});
restButton.addEventListener('click', () => rest(true));

// ---- loop -----------------------------------------------------------------------

let last = performance.now();
let raf = 0;
let dayWasActive = false;
let theme = null;
function applyTheme(ui) {
  const next = ui > 0.5 ? 'dark' : 'light';
  if (next === theme) return;
  theme = next;
  root.dataset.theme = next;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', next === 'dark' ? '#12151c' : '#f3f1ec');
  // The night ink is a little lighter in weight, which moves the letters.
  dissolve?.rebuild();
}

function frame(now) {
  raf = 0;
  const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
  last = now;
  if (state.playing) state.time += dt * state.timeScale;
  if (state.live) daylight.follow(localClock());
  daylight.step(dt);
  applyTheme(state.ui);
  view.render(state);
  watchPerformance(dt);
  slider?.sync(state.clock, state.dayPlaying, state.live, localClock());
  followWords();
  const dayActive = daylight.active;
  if (dayWasActive && !dayActive) {
    writeHash();
    savePreference();
  }
  dayWasActive = dayActive;
  if (state.playing || dayActive) schedule();
}

function schedule() {
  if (!raf && !document.hidden && view) raf = requestAnimationFrame(frame);
}
function invalidate() {
  schedule();
}

document.addEventListener('visibilitychange', () => {
  last = performance.now();
  if (!document.hidden) invalidate();
});
window.addEventListener('resize', () => {
  fit();
  invalidate();
});

// ---- controls ---------------------------------------------------------------------

let slider = null;
const icons = new Icons(document);
let activeTimer = 0;
function markActive() {
  controls.classList.add('is-active');
  clearTimeout(activeTimer);
  activeTimer = setTimeout(() => controls.classList.remove('is-active'), 1600);
}

function setClock(clock, seconds = 1.2) {
  state.live = false;
  daylight.toClock(clock, reducedMotion.matches ? 0 : seconds);
  writeHash();
  invalidate();
}
function playDay(force) {
  state.live = false;
  daylight.play(typeof force === 'boolean' ? force : !state.dayPlaying);
  last = performance.now();
  invalidate();
}
function goLive() {
  daylight.toClock(localClock(), reducedMotion.matches ? 0 : 1.6);
  state.live = true;
  writeHash();
  savePreference();
  invalidate();
}

window.addEventListener('keydown', (e) => {
  if (e.target.closest?.('.controls') && (e.code === 'Space' || e.key.startsWith('Arrow') || e.key === 'Enter')) return;
  if (e.key === '[' || e.key === ']') {
    setClock(daylight.target + (e.key === ']' ? 0.25 : -0.25), 0.6);
    markActive();
  } else if (PRESET_ORDER[Number(e.key) - 1]) {
    state.live = false;
    daylight.go(PRESET_ORDER[Number(e.key) - 1], reducedMotion.matches ? 0 : undefined);
    writeHash();
    invalidate();
  } else if (e.key === 'n' || e.key === 'N') {
    goLive();
  }
});

// ---- recording clips (development server only) -------------------------------------

async function renderAt(opts, fn) {
  capturing = true;
  const saved = { size: { ...view.size }, time: state.time, playing: state.playing, live: state.live, clock: state.clock };
  if (opts.clock !== undefined) state.live = false;
  if (typeof opts.clock === 'number') daylight.toClock(opts.clock, 0);
  if (typeof opts.time === 'number') state.time = opts.time;
  state.playing = false;
  view.resize(opts.cssW, opts.cssH, opts.dpr ?? 1, state.optics.lightScale);
  try {
    return await fn();
  } finally {
    view.resize(saved.size.cssW, saved.size.cssH, saved.size.dpr, state.optics.lightScale);
    daylight.toClock(saved.clock, 0);
    state.time = saved.time;
    state.playing = saved.playing;
    state.live = saved.live;
    capturing = false;
    invalidate();
  }
}

// The words as the dissolve effect draws them, laid over a frame (the effect's
// canvas is the page's own size).
function dissolveOver(frameCanvas) {
  const c = document.querySelector('.dissolve-canvas');
  if (!dissolve || !c) return false;
  frameCanvas.getContext('2d').drawImage(c, 0, 0, frameCanvas.width, frameCanvas.height);
  return true;
}

const INK = { light: [65, 58, 57], dark: [221, 214, 202] }; // --ink in index.html
const rgb = (c) => `rgb(${c.map((v) => Math.round(v)).join(', ')})`;

// The ink through a change of theme, as the page's 0.8 s "ease" transition
// gives it, on a clip's own clock.
function inkFollower() {
  const ease = cubicBezier(0.25, 0.1, 0.25, 1);
  let to = null;
  let from = null;
  let since = 0;
  let current = null;
  return (t, dark) => {
    const target = dark ? INK.dark : INK.light;
    if (!to) current = to = target;
    if (target !== to) {
      from = current;
      to = target;
      since = t;
    }
    if (from) {
      const k = ease(Math.min(1, (t - since) / 0.8));
      current = from.map((v, i) => v + (to[i] - v) * k);
      if (k >= 1) from = null;
    } else current = to;
    return rgb(current);
  };
}

function cubicBezier(x1, y1, x2, y2) {
  const at = (a, b, t) => 3 * a * t * (1 - t) ** 2 + 3 * b * t * t * (1 - t) + t ** 3;
  return (x) => {
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 30; i++) {
      const mid = (lo + hi) / 2;
      if (at(x1, x2, mid) < x) lo = mid;
      else hi = mid;
    }
    return at(y1, y2, (lo + hi) / 2);
  };
}

function overlay(frameCanvas, { dpr, ink, titles, instrument, cursor }) {
  drawCenterOverlay(frameCanvas, {
    titles: titles ?? !dissolveOver(frameCanvas),
    dpr,
    ink: ink ?? rgb(state.ui > 0.5 ? INK.dark : INK.light),
    instrument,
    cursor,
  });
}

// For a clip: the page as recorded, the instrument showing the frame's clock
// and the sound on (when there is music to hear in it).
function stageForRecording({ sound }) {
  root.classList.add('is-recording');
  const shown = { hidden: soundButton.hidden, pressed: soundButton.getAttribute('aria-pressed') };
  if (sound) {
    soundButton.hidden = false;
    soundButton.setAttribute('aria-pressed', 'true');
  }
  const away = () => {
    if (!dissolve) return;
    Object.assign(dissolve.state.pointer, { x: -1e4, y: -1e4, sx: -1e4, sy: -1e4, seen: false });
    dissolve.settle();
  };
  away();
  return () => {
    away();
    root.classList.remove('is-recording');
    soundButton.hidden = shown.hidden;
    soundButton.setAttribute('aria-pressed', shown.pressed);
    const probe = document.querySelector('.dissolve-ink-probe');
    if (probe) probe.style.color = '';
    dissolve?.redraw();
  };
}

window.__komorebi = {
  state,
  get renderer() {
    return view;
  },
  get dissolve() {
    return dissolve;
  },
  get slider() {
    return slider;
  },
  icons,
  music,
  daylight,
  setClock,
  playDay,
  goLive,
  visit: (seed) => view?.visitBird(state, seed),
  // One frame at the page's own size, with or without the title and instrument.
  async capture({ name, dir = '', clock, time, ui = true, sound = true, live = false, type = 'image/png', quality = 0.95 }) {
    const dpr = dprCap();
    const restore = stageForRecording({ sound: ui && sound });
    try {
      return await renderAt({ cssW: window.innerWidth, cssH: window.innerHeight, dpr, clock, time }, async () => {
        applyTheme(state.ui);
        view.render(state);
        view.render(state);
        slider.sync(state.clock, false, live, live ? state.clock : null);
        slider.settle();
        slider.draw();
        icons.settle();
        icons.draw();
        settleWords();
        // A still shows the words settled: any writing in is let finish.
        dissolve?.pause(true);
        dissolve?.step(dissolveSettings.writeSeconds + 0.1);
        const frame = pixelsToCanvas(view.readPixels());
        if (ui) overlay(frame, { dpr });
        const blob = await canvasToBlob(frame, type, quality);
        await postCapture(blob, name, dir);
        return { name, bytes: blob.size, width: frame.width, height: frame.height };
      });
    } finally {
      dissolve?.pause(false);
      restore();
    }
  },
  // A sequence of frames at a fixed rate, at the page's own size so the title
  // is the dissolve effect's own (written in at the start unless `write` is
  // false). `day: { from, to }` sweeps the clock across the clip; otherwise the
  // clock moves as the page moves it (a scrub or a played day, set up in
  // `prepare` or `each`). `each(t)` runs before every frame and may return
  // { cursor: {x, y}, instrument, playing }: a pointer to draw, the
  // instrument's strength, and whether it shows the day playing. A hand on the
  // instrument goes through its own pointer methods (see clips/clips.js).
  async captureSequence({ dir, fps = 30, seconds = 8, start = 600, clock, day, ui = true, sound = true, write = true, quality = 0.92, prepare, each }) {
    const dpr = dprCap();
    const cssW = window.innerWidth;
    const cssH = window.innerHeight;
    const n = Math.round(fps * seconds);
    const restore = stageForRecording({ sound: ui && sound });
    const probe = document.querySelector('.dissolve-ink-probe');
    const ink = inkFollower();
    // The instrument and the icons move on the clip's clock.
    slider.manual = true;
    icons.manual = true;
    dissolve?.pause(true);
    if (write) dissolve?.write();
    try {
      return await renderAt({ cssW, cssH, dpr, clock: day ? day.from : clock, time: start }, async () => {
        prepare?.();
        // A clip opens on the words of its first hour; later changes it shows.
        settleWords();
        for (let i = 0; i < n; i++) {
          // A clip is the page at one size; stop if the view changes under it.
          if (window.innerWidth !== cssW || window.innerHeight !== cssH) throw new Error(`the view changed size while recording, at frame ${i}`);
          const t = i / fps;
          state.time = start + t;
          if (day) {
            const k = n > 1 ? i / (n - 1) : 0;
            const e = day.ease ? k * k * (3 - 2 * k) : k;
            daylight.toClock(day.from + (day.to - day.from) * e, 0);
          }
          const extra = each?.(t) ?? {};
          if (!day && i) daylight.step(1 / fps);
          applyTheme(state.ui);
          followWords();
          const colour = ink(t, state.ui > 0.5);
          if (probe) probe.style.color = colour;
          view.render(state);
          slider.ink = colour;
          icons.ink = colour;
          slider.sync(state.clock, extra.playing ?? (Boolean(day) || state.dayPlaying), false);
          if (i) {
            slider.step(1 / fps);
            icons.step(1 / fps);
          } else {
            slider.settle();
            icons.settle();
          }
          slider.draw();
          icons.draw();
          dissolve?.step(i ? 1 / fps : 0);
          const frame = pixelsToCanvas(view.readPixels());
          if (ui) overlay(frame, { dpr, ink: colour, instrument: extra.instrument, cursor: extra.cursor });
          await postCapture(await canvasToBlob(frame, 'image/jpeg', quality), `frame-${String(i).padStart(4, '0')}.jpg`, dir);
        }
        return { frames: n, fps, width: Math.round(window.innerWidth * dpr), height: Math.round(window.innerHeight * dpr) };
      });
    } finally {
      slider.ink = null;
      icons.ink = null;
      slider.manual = false;
      icons.manual = false;
      slider.sync(state.clock, state.dayPlaying, state.live, localClock());
      icons.wake();
      dissolve?.pause(false);
      restore();
    }
  },
  // The music for a clip: an excerpt of the recording at the page's level,
  // faded in and out.
  async recordTrack({ name = 'track.wav', dir = '', from = 0, seconds, level = LEVEL, fadeIn, fadeOut }) {
    const buffer = await trackExcerpt(MUSIC, { from, seconds, level, fadeIn, fadeOut });
    let peak = 0;
    let sum = 0;
    const L = buffer.getChannelData(0);
    const R = buffer.getChannelData(1);
    for (let i = 0; i < buffer.length; i++) {
      peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
      sum += L[i] * L[i] + R[i] * R[i];
    }
    const rms = Math.sqrt(sum / (2 * buffer.length));
    await postCapture(wav(buffer), name, dir);
    return { name, seconds, peakDb: +(20 * Math.log10(peak)).toFixed(1), rmsDb: +(20 * Math.log10(rms)).toFixed(1) };
  },
};

// ---- start --------------------------------------------------------------------------

setWords(moonlit(state.clock) ? 'moon' : 'sun');
if (resting.held) rest(true);

if (view) {
  fit();
  view.noiseReady.then(invalidate);
  slider = new SunPath(controls, {
    onScrub: (clock) => {
      state.live = false;
      daylight.scrub(clock, reducedMotion.matches);
      markActive();
      invalidate();
    },
    onCommit: () => {
      writeHash();
      savePreference();
    },
    onPlay: () => {
      playDay();
      markActive();
    },
    onNow: () => {
      if (state.live) {
        state.live = false;
        writeHash();
        savePreference();
      } else goLive();
      markActive();
    },
  });
  slider.sync(state.clock, state.dayPlaying, state.live, localClock());
  applyTheme(state.ui);
  setInterval(() => {
    if (state.live) invalidate();
  }, 30000);
  slider.show();
  startTitle();
  invalidate();
} else {
  applyLayout(root, window.innerWidth, window.innerHeight);
}
