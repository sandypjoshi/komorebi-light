// A copy of studies/type-voice/src/dissolve (1 Oct 2026, 16:28), kept here so
// this shared page does not change while that study is worked on. Changed for
// this page: each run of text is drawn in its own style (an italic word, a
// tracked title); vertical text, and a word broken across lines at its hyphen,
// are drawn a character at a time; display type
// dissolves with the grain, blur and drift of reading-size type, so a large word
// lifts finely instead of smearing (`settings.grainEm`); the pointer's reach is
// measured in the page's reading text (the block with the most words); and the
// words can be written out and written in again from nothing (`writeOut`,
// `write(GONE)`), for words that change and for the screensaver.
//
// Dissolving text: the voice drawn as ink that soaks into and lifts out of the
// page. Every `.voice[data-dissolve]` block is redrawn by WebGL over its own,
// transparent, DOM text, which stays for selection, search and screen readers.
//
// Text dissolves near the top and bottom of the view (so it follows scroll and
// reverses with it), lifts off where the pointer passes and settles back on
// behind it, and is written in on arrival.

import fullscreenVert from './fullscreen.vert?raw';
import blurFrag from './blur.frag?raw';
import downsampleFrag from './downsample.frag?raw';
import inkVert from './ink.vert?raw';
import inkFrag from './ink.frag?raw';
import liftFrag from './lift.frag?raw';

export const settings = {
  bands: [0.2, 0.22],     // top, bottom: fractions of the view height where text dissolves
  drift: 0.7,             // em, how far letters move when fully dissolved
  lowBlur: 0.09,          // em, sigma of the slightly blurred copy
  highBlur: 0.24,         // em, sigma of the very blurred copy
  lowGain: 1.15,          // blurred ink is spread thin; gather it back a little
  highGain: 1.7,
  erode: 0.28,
  gamma: 1.65,            // coverage curve: the ink weighs what the page's own text weighs (measured, within 1%)
  liftRadius: 1.8,        // em, the reach of the pointer
  liftGain: 0.5,          // lift per em of pointer travel
  liftReturn: 1.2,        // seconds for fully lifted ink to settle back on
  pointerDamping: 12,     // how closely the lift follows the pointer
  writeSeconds: 2,
  maxDpr: 2,
  grainEm: 30,            // px: larger type dissolves with the grain, blur and drift of type this size
};

// A write amount at which every part of the ink has lifted away (the noise lets
// some of it hold on until well past 1).
export const GONE = 3.2;

const PAD_EM = 1.2;       // room around a block for drift and blur
const SUPERSAMPLE = 6;    // device pixels per CSS pixel the text is drawn at, before averaging down
const MAX_TEXTURE = 4096;
const LIFT_CELL = 6;      // CSS px per texel of the lift map
const LIFT_STEP = 1 / 60; // the lift map advances at a fixed rate, so its fade does not depend on the display

export function startDissolve({ selector = '.voice[data-dissolve]', write = true } = {}) {
  const root = document.documentElement;
  const elements = [...document.querySelectorAll(selector)];
  if (!elements.length) return null;

  const canvas = document.createElement('canvas');
  canvas.className = 'dissolve-canvas';
  canvas.setAttribute('aria-hidden', 'true');
  const gl = canvas.getContext('webgl2', { premultipliedAlpha: true, antialias: false, alpha: true });
  if (!gl) return null;
  document.body.prepend(canvas);

  const blurProgram = program(gl, fullscreenVert, blurFrag);
  const downsampleProgram = program(gl, fullscreenVert, downsampleFrag);
  const downsampleU = uniforms(gl, downsampleProgram);
  const inkProgram = program(gl, inkVert, inkFrag);
  const liftProgram = program(gl, fullscreenVert, liftFrag);
  const blurU = uniforms(gl, blurProgram);
  const inkU = uniforms(gl, inkProgram);
  const liftU = uniforms(gl, liftProgram);

  const quad = gl.createVertexArray();
  gl.bindVertexArray(quad);
  const corners = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, corners);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
  const aCorner = gl.getAttribLocation(inkProgram, 'aCorner');
  gl.enableVertexAttribArray(aCorner);
  gl.vertexAttribPointer(aCorner, 2, gl.FLOAT, false, 0, 0);
  const empty = gl.createVertexArray();

  // The ink colour follows --ink through its CSS transition.
  const probe = document.createElement('span');
  probe.className = 'dissolve-ink-probe';
  probe.setAttribute('aria-hidden', 'true');
  document.body.append(probe);
  let inkChanging = false;
  probe.addEventListener('transitionrun', () => (inkChanging = true));
  probe.addEventListener('transitionend', () => {
    inkChanging = false;
    dirty = true;
  });

  const state = {
    dpr: 1,
    width: 0,
    height: 0,
    pointer: { x: -1e4, y: -1e4, sx: -1e4, sy: -1e4, seen: false },
    scrollY: -1,
  };
  // Two copies of the lift map, read from one and written to the other.
  const lift = { maps: [], read: 0, cells: [1, 1], left: 0, since: 0, scrollY: 0, fromX: 0, fromY: 0 };
  let dirty = true;
  let paused = false;
  let rebuildTimer = 0;
  let last = performance.now();
  let clock = 0;

  const blocks = elements.map((el, i) => ({
    el,
    seed: 11.3 + i * 7.77,
    write: write ? 1 : 0,
    writing: write,
    writeFrom: 1,
    writeStart: -1,
    out: null,
    textures: null,
  }));
  // The page's reading text, whose size measures the pointer's reach.
  const reading = blocks.reduce((a, b) => (b.el.textContent.length > a.el.textContent.length ? b : a));
  const readingEm = () => Math.min(reading.em || 30, settings.grainEm);

  function resize() {
    state.dpr = Math.min(window.devicePixelRatio || 1, settings.maxDpr);
    state.width = document.documentElement.clientWidth;
    state.height = document.documentElement.clientHeight;
    canvas.width = Math.round(state.width * state.dpr);
    canvas.height = Math.round(state.height * state.dpr);
    for (const m of lift.maps) {
      gl.deleteFramebuffer(m.fbo);
      gl.deleteTexture(m.texture);
    }
    lift.cells = [Math.ceil(state.width / LIFT_CELL), Math.ceil(state.height / LIFT_CELL)];
    lift.maps = [target(gl, ...lift.cells), target(gl, ...lift.cells)];
    lift.left = 0;
    lift.scrollY = window.scrollY;
    dirty = true;
  }

  // One step of the lift map: move with the scroll, fade, take in the pointer's travel.
  function stepLift(deposit) {
    const from = lift.maps[lift.read];
    const to = lift.maps[1 - lift.read];
    const p = state.pointer;
    const em = readingEm();
    gl.useProgram(liftProgram);
    gl.bindVertexArray(empty);
    gl.disable(gl.BLEND);
    gl.bindFramebuffer(gl.FRAMEBUFFER, to.fbo);
    gl.viewport(0, 0, lift.cells[0], lift.cells[1]);
    bindTexture(gl, 0, from.texture);
    gl.uniform1i(liftU.uPrevious, 0);
    gl.uniform2f(liftU.uSpan, lift.cells[0] * LIFT_CELL, lift.cells[1] * LIFT_CELL);
    gl.uniform1f(liftU.uCell, LIFT_CELL);
    gl.uniform2f(liftU.uShift, 0, window.scrollY - lift.scrollY);
    gl.uniform2f(liftU.uFrom, lift.fromX, lift.fromY);
    gl.uniform2f(liftU.uTo, p.sx, p.sy);
    gl.uniform1f(liftU.uRadius, settings.liftRadius * em);
    gl.uniform1f(liftU.uDeposit, deposit);
    gl.uniform1f(liftU.uFade, LIFT_STEP / settings.liftReturn);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    lift.read = 1 - lift.read;
    lift.scrollY = window.scrollY;
    lift.fromX = p.sx;
    lift.fromY = p.sy;
  }

  function build(block) {
    const el = block.el;
    const style = getComputedStyle(el);
    const em = parseFloat(style.fontSize);
    const pad = Math.ceil(em * PAD_EM);
    const box = el.getBoundingClientRect();
    const width = Math.ceil(box.width) + pad * 2;
    const height = Math.ceil(box.height) + pad * 2;
    const scale = Math.min(state.dpr, MAX_TEXTURE / Math.max(width, height));

    const tw = Math.round(width * scale);
    const th = Math.round(height * scale);
    const factor = Math.max(1, Math.min(8, Math.ceil(SUPERSAMPLE / scale), Math.floor(MAX_TEXTURE / Math.max(tw, th))));

    // Draw every word where the page set it, in the ink's own colour: canvas
    // weighs light and dark text differently, as the page does.
    const text = document.createElement('canvas');
    text.width = tw * factor;
    text.height = th * factor;
    const ctx = text.getContext('2d');
    ctx.scale(scale * factor, scale * factor);
    ctx.fillStyle = getComputedStyle(probe).getPropertyValue('--ink').trim() || '#000';
    const canSpace = 'letterSpacing' in ctx;
    const range = document.createRange();
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      // Each run in its own style: an italic word, a tracked title.
      const run = getComputedStyle(node.parentElement);
      ctx.font = `${run.fontStyle} ${run.fontWeight} ${run.fontSize} ${run.fontFamily}`;
      const spacing = parseFloat(run.letterSpacing) || 0;
      if (canSpace) ctx.letterSpacing = `${spacing}px`;
      const vertical = run.writingMode.startsWith('vertical');
      if (vertical || (spacing && !canSpace)) {
        // A character at a time, where the page set each one: down a column,
        // centred in it, or across a line without canvas letter spacing.
        if (canSpace) ctx.letterSpacing = '0px';
        ctx.textAlign = vertical ? 'center' : 'left';
        ctx.textBaseline = vertical ? 'middle' : 'alphabetic';
        const ascent = ctx.measureText('Hg').fontBoundingBoxAscent;
        const size = parseFloat(run.fontSize);
        for (let i = 0; i < node.data.length; i++) {
          if (/\s/.test(node.data[i])) continue;
          range.setStart(node, i);
          range.setEnd(node, i + 1);
          const r = range.getClientRects()[0];
          if (!r) continue;
          if (vertical) ctx.fillText(node.data[i], r.left + r.width / 2 - box.left + pad, r.top + size / 2 - box.top + pad);
          else ctx.fillText(node.data[i], r.left - box.left + pad, r.top - box.top + pad + ascent);
        }
        continue;
      }
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
      const ascent = ctx.measureText('Hg').fontBoundingBoxAscent;
      for (const word of node.data.matchAll(/\S+/g)) {
        range.setStart(node, word.index);
        range.setEnd(node, word.index + word[0].length);
        const rects = range.getClientRects();
        if (!rects.length) continue;
        if (rects.length === 1) {
          const r = rects[0];
          ctx.fillText(word[0], r.left - box.left + pad, r.top - box.top + pad + ascent);
          continue;
        }
        // A word the line breaks at its hyphen: each character where it fell.
        for (let i = 0; i < word[0].length; i++) {
          range.setStart(node, word.index + i);
          range.setEnd(node, word.index + i + 1);
          const r = range.getClientRects()[0];
          if (r) ctx.fillText(word[0][i], r.left - box.left + pad, r.top - box.top + pad + ascent);
        }
      }
    }

    const drawn = texture(gl, text.width, text.height, gl.RGBA8, gl.RGBA, text);
    const sharp = target(gl, tw, th);
    gl.useProgram(downsampleProgram);
    gl.bindVertexArray(empty);
    gl.disable(gl.BLEND);
    gl.bindFramebuffer(gl.FRAMEBUFFER, sharp.fbo);
    gl.viewport(0, 0, tw, th);
    bindTexture(gl, 0, drawn);
    gl.uniform1i(downsampleU.uSource, 0);
    gl.uniform1i(downsampleU.uFactor, factor);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.deleteFramebuffer(sharp.fbo);
    gl.deleteTexture(drawn);

    const grain = Math.min(em, settings.grainEm);
    const low = blurred(sharp.texture, tw, th, 2, settings.lowBlur * grain * scale);
    const high = blurred(sharp.texture, tw, th, 4, settings.highBlur * grain * scale);

    disposeTextures(block);
    block.textures = { sharp: sharp.texture, low, high };
    block.em = em;
    block.grain = grain;
    block.pad = pad;
    block.width = width;
    block.height = height;
    block.docLeft = box.left + window.scrollX - pad;
    block.docTop = box.top + window.scrollY - pad;
  }

  // A blurred copy at a fraction of the resolution, which the blur hides.
  function blurred(source, w, h, divide, sigmaPx) {
    const tw = Math.max(1, Math.round(w / divide));
    const th = Math.max(1, Math.round(h / divide));
    const sigma = Math.max(0.6, sigmaPx / divide);
    const across = target(gl, tw, th);
    const result = target(gl, tw, th);
    gl.useProgram(blurProgram);
    gl.bindVertexArray(empty);
    gl.disable(gl.BLEND);
    gl.uniform1f(blurU.uSigma, sigma);
    gl.uniform1i(blurU.uSource, 0);
    gl.activeTexture(gl.TEXTURE0);

    gl.bindFramebuffer(gl.FRAMEBUFFER, across.fbo);
    gl.viewport(0, 0, tw, th);
    gl.bindTexture(gl.TEXTURE_2D, source);
    gl.uniform2f(blurU.uStep, 1 / tw, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    gl.bindFramebuffer(gl.FRAMEBUFFER, result.fbo);
    gl.bindTexture(gl.TEXTURE_2D, across.texture);
    gl.uniform2f(blurU.uStep, 0, 1 / th);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.deleteFramebuffer(across.fbo);
    gl.deleteTexture(across.texture);
    gl.deleteFramebuffer(result.fbo);
    return result.texture;
  }

  function disposeTextures(block) {
    if (!block.textures) return;
    for (const t of Object.values(block.textures)) gl.deleteTexture(t);
    block.textures = null;
  }

  function rebuild() {
    resize();
    for (const block of blocks) build(block);
    dirty = true;
  }

  function scheduleRebuild() {
    clearTimeout(rebuildTimer);
    rebuildTimer = setTimeout(rebuild, 120);
  }

  function inkColour() {
    const m = getComputedStyle(probe).color.match(/[\d.]+/g) || [0, 0, 0];
    return [m[0] / 255, m[1] / 255, m[2] / 255];
  }

  // Advance the effect's own clock by dt seconds.
  function tick(dt) {
    dt = Math.min(dt, 0.05);
    clock += dt;
    const p = state.pointer;

    // The pointer lifts ink off as it travels; the map then lets it settle back on.
    if (p.seen) {
      const k = 1 - Math.exp(-settings.pointerDamping * dt);
      p.sx += (p.x - p.sx) * k;
      p.sy += (p.y - p.sy) * k;
    }
    const travel = p.seen ? Math.hypot(p.sx - lift.fromX, p.sy - lift.fromY) : 0;
    if (travel > 0.05) lift.left = settings.liftReturn + 0.2;
    if (lift.left > 0) {
      lift.since += dt;
      let first = true;
      while (lift.since >= LIFT_STEP) {
        const moved = first ? Math.hypot(p.sx - lift.fromX, p.sy - lift.fromY) : 0;
        stepLift((moved / readingEm()) * settings.liftGain);
        lift.since -= LIFT_STEP;
        lift.left -= LIFT_STEP;
        first = false;
      }
      dirty = true;
    } else {
      lift.since = 0;
      lift.fromX = p.sx;
      lift.fromY = p.sy;
      lift.scrollY = window.scrollY;
    }

    for (const block of blocks) {
      if (block.out) {
        // Written out: the ink lifts away, slowly at first.
        const out = block.out;
        if (out.start < 0) out.start = clock;
        const t = Math.min((clock - out.start) / out.seconds, 1);
        block.write = out.from + (out.to - out.from) * t * t * t;
        dirty = true;
        if (t >= 1) {
          block.out = null;
          out.done();
        }
      } else if (block.writing) {
        if (block.writeStart < 0) block.writeStart = clock;
        const t = Math.min((clock - block.writeStart) / settings.writeSeconds, 1);
        block.write = block.writeFrom * (1 - easeOutCubic(t));
        dirty = true;
        if (t >= 1) block.writing = false;
      }
    }

    if (window.scrollY !== state.scrollY) {
      state.scrollY = window.scrollY;
      dirty = true;
    }
    if (inkChanging) dirty = true;

    if (dirty) {
      draw();
      dirty = false;
    }
  }

  function frame(now) {
    const dt = (now - last) / 1000;
    last = now;
    if (!paused) tick(dt);
    requestAnimationFrame(frame);
  }

  function draw() {
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(inkProgram);
    gl.bindVertexArray(quad);

    const ink = inkColour();
    const scrollX = window.scrollX;
    const scrollY = window.scrollY;
    const snap = (v) => Math.round(v * state.dpr) / state.dpr;

    gl.uniform2f(inkU.uViewport, state.width, state.height);
    gl.uniform3f(inkU.uInk, ink[0], ink[1], ink[2]);
    gl.uniform2f(inkU.uBands, settings.bands[0], settings.bands[1]);
    gl.uniform2f(inkU.uLiftSpan, lift.cells[0] * LIFT_CELL, lift.cells[1] * LIFT_CELL);
    gl.uniform1f(inkU.uDrift, settings.drift);
    gl.uniform1f(inkU.uLowGain, settings.lowGain);
    gl.uniform1f(inkU.uHighGain, settings.highGain);
    gl.uniform1f(inkU.uErode, settings.erode);
    gl.uniform1f(inkU.uGamma, settings.gamma);
    gl.uniform1i(inkU.uSharp, 0);
    gl.uniform1i(inkU.uLow, 1);
    gl.uniform1i(inkU.uHigh, 2);
    gl.uniform1i(inkU.uLift, 3);
    bindTexture(gl, 3, lift.maps[lift.read].texture);

    for (const block of blocks) {
      if (!block.textures) continue;
      const x = snap(block.docLeft - scrollX);
      const y = snap(block.docTop - scrollY);
      if (y > state.height || y + block.height < 0) continue;
      gl.uniform2f(inkU.uOrigin, x, y);
      gl.uniform2f(inkU.uSize, block.width, block.height);
      gl.uniform1f(inkU.uEm, block.grain);
      gl.uniform1f(inkU.uSeed, block.seed);
      gl.uniform1f(inkU.uWrite, block.write);
      bindTexture(gl, 0, block.textures.sharp);
      bindTexture(gl, 1, block.textures.low);
      bindTexture(gl, 2, block.textures.high);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }
  }

  function onPointerMove(e) {
    const p = state.pointer;
    p.x = e.clientX;
    p.y = e.clientY;
    if (!p.seen) {
      // Arriving is not a stroke: start from here.
      p.sx = lift.fromX = p.x;
      p.sy = lift.fromY = p.y;
      p.seen = true;
    }
  }

  function onPointerLeave() {
    state.pointer.seen = false;
  }

  rebuild();
  const observer = new ResizeObserver(scheduleRebuild);
  for (const block of blocks) observer.observe(block.el);
  window.addEventListener('resize', scheduleRebuild);
  window.addEventListener('pointermove', onPointerMove, { passive: true });
  document.addEventListener('pointerleave', onPointerLeave);
  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    root.classList.remove('dissolve-on');
  });

  root.classList.add('dissolve-on');
  root.classList.remove('dissolve-pending');
  requestAnimationFrame((t) => {
    last = t;
    frame(t);
  });

  return {
    settings,
    blocks,
    state,
    rebuild,
    redraw: () => (dirty = true),
    // Hold time, and advance it by hand in sixtieths of a second, for stills and checks.
    pause(on = true) {
      paused = on;
    },
    step(seconds = 1 / 60) {
      for (let t = 0; t < seconds - 1e-6; t += 1 / 60) tick(1 / 60);
      dirty = true;
      tick(0);
    },
    // Write the words in, from `from` (1, a faint blur, as on arrival; GONE,
    // from nothing).
    write: (from = 1) => {
      for (const block of blocks) {
        // A write-out under way is over: whoever waits on it carries on.
        const out = block.out;
        block.out = null;
        out?.done();
        block.write = from;
        block.writing = true;
        block.writeFrom = from;
        block.writeStart = -1;
      }
      dirty = true;
    },
    // Lift the words away over `seconds`; resolves once they have gone.
    writeOut: (seconds = 1.1) =>
      Promise.all(
        blocks.map(
          (block) =>
            new Promise((done) => {
              block.writing = false;
              block.out = { start: -1, seconds, from: block.write, to: GONE, done };
            }),
        ),
      ),
    // Settle every lifted word at once (this page's clips start from rest).
    settle() {
      for (const m of lift.maps) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, m.fbo);
        gl.clearColor(0, 0, 0, 1);
        gl.clear(gl.COLOR_BUFFER_BIT);
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      lift.left = 0;
      dirty = true;
    },
  };
}

function easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3);
}

function program(gl, vs, fs) {
  const p = gl.createProgram();
  for (const [type, src] of [
    [gl.VERTEX_SHADER, vs],
    [gl.FRAGMENT_SHADER, fs],
  ]) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    gl.attachShader(p, s);
  }
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  return p;
}

function uniforms(gl, p) {
  const out = {};
  const count = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < count; i++) {
    const name = gl.getActiveUniform(p, i).name;
    out[name] = gl.getUniformLocation(p, name);
  }
  return out;
}

function texture(gl, w, h, internal, format, source) {
  const t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  if (source) gl.texImage2D(gl.TEXTURE_2D, 0, internal, format, gl.UNSIGNED_BYTE, source);
  else gl.texImage2D(gl.TEXTURE_2D, 0, internal, w, h, 0, format, gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return t;
}

function target(gl, w, h) {
  const t = texture(gl, w, h, gl.R8, gl.RED, null);
  const fbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
  return { texture: t, fbo };
}

function bindTexture(gl, unit, t) {
  gl.activeTexture(gl.TEXTURE0 + unit);
  gl.bindTexture(gl.TEXTURE_2D, t);
}
