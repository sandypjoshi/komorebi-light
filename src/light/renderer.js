// One rendering pipeline, all driven by the same scene state:
//
// 1. paper   the paper's relief and formation, rendered once per size
// 2. near    leaves and branches just outside the window  -> coverage texture
// 3. mid     a tree a few metres out                      -> coverage texture
// 4. far     the far crown, procedural                    -> coverage texture
//            then integrated over the sun's disc once       -> transmission
// 5. bird    the visiting bird, projected along the sun    -> coverage texture
//            (only while it is about)
// 6. light   sun through window, bird and foliage onto paper -> direct light
// 7. composite  sun, sky, room and bounce light on the paper -> screen

import * as THREE from 'three';
import { getShaderNoiseTexture } from '@paper-design/shaders';

import common from './shaders/common.glsl?raw';
import wind from './shaders/wind.glsl?raw';
import fullscreenVert from './shaders/fullscreen.vert?raw';
import leafVert from './shaders/leaf.vert?raw';
import leafFrag from './shaders/leaf.frag?raw';
import branchVert from './shaders/branch.vert?raw';
import branchFrag from './shaders/branch.frag?raw';
import canopyFrag from './shaders/canopy.frag?raw';
import sunblurFrag from './shaders/sunblur.frag?raw';
import lightFrag from './shaders/light.frag?raw';
import paperFrag from './shaders/paper.frag?raw';
import compositeFrag from './shaders/composite.frag?raw';
import birdFrag from './shaders/bird.frag?raw';
import probeFrag from './shaders/probe.frag?raw';

import { buildLayer } from './foliage.js';
import { Bird, MAX_MOMENTS, MAX_PRIMS } from './bird.js';
import { windParams } from './wind.js';
import { isPortrait, layerRect, planeX, sunVector, viewRect } from './geometry.js';

const HEADER = 'precision highp float;\nprecision highp int;\nprecision highp sampler2D;\n';

function program(vertex, fragment, uniforms, extra = {}) {
  return new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader: vertex,
    fragmentShader: fragment,
    uniforms,
    depthTest: false,
    depthWrite: false,
    ...extra,
  });
}

const BIRD_SIZE = 384;

const MAX_BLEND = {
  side: THREE.DoubleSide,
  blending: THREE.CustomBlending,
  blendEquation: THREE.MaxEquation,
  blendSrc: THREE.OneFactor,
  blendDst: THREE.OneFactor,
  transparent: true,
};

function fullscreenTriangle() {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
  return g;
}

function quad(x0, x1, y0, y1) {
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([x0, y0, 0, x1, y0, 0, x1, y1, 0, x0, y1, 0]), 3));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  return g;
}

function coverageTarget(size) {
  return new THREE.WebGLRenderTarget(size, size, {
    type: THREE.UnsignedByteType,
    format: THREE.RGBAFormat,
    minFilter: THREE.LinearMipmapLinearFilter,
    magFilter: THREE.LinearFilter,
    wrapS: THREE.ClampToEdgeWrapping,
    wrapT: THREE.ClampToEdgeWrapping,
    generateMipmaps: true,
    depthBuffer: false,
  });
}

export class PaperLightRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      alpha: false,
      depth: false,
      stencil: false,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: false,
    });
    this.renderer.autoClear = false;
    this.renderer.setClearColor(0x000000, 0);
    const gl = this.renderer.getContext();
    this.floatType = this.renderer.extensions.has('EXT_color_buffer_float') || this.renderer.extensions.has('EXT_color_buffer_half_float')
      ? THREE.HalfFloatType
      : THREE.UnsignedByteType;
    this.maxTexture = gl.getParameter(gl.MAX_TEXTURE_SIZE);

    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.tri = fullscreenTriangle();
    this.layerSize = 1024;
    this.farSize = 1024;

    this.windUniforms = {
      uTime: { value: 0 },
      uWindStrength: { value: 1 },
      uWindGust: { value: 0.7 },
      uWindSpeed: { value: 1.6 },
      uWindLull: { value: 0.6 },
      uWindDir: { value: 1 },
      uWindAxis: { value: new THREE.Vector2(0, 1) },
      uWindSeed: { value: 1 },
      uSwayAmp: { value: new THREE.Vector3() },
      uSwayFreq: { value: new THREE.Vector3() },
      uSwayLag: { value: new THREE.Vector3() },
      uBendPow: { value: 1.6 },
      uFlutter: { value: 1 },
    };

    this.targets = {
      near: coverageTarget(this.layerSize),
      mid: coverageTarget(this.layerSize),
      bird: coverageTarget(BIRD_SIZE),
      far: coverageTarget(this.farSize),
      farBlur: new THREE.WebGLRenderTarget(this.farSize, this.farSize, {
        type: this.floatType,
        format: THREE.RGBAFormat,
        minFilter: THREE.LinearMipmapLinearFilter,
        magFilter: THREE.LinearFilter,
        wrapS: THREE.ClampToEdgeWrapping,
        wrapT: THREE.ClampToEdgeWrapping,
        generateMipmaps: true,
        depthBuffer: false,
      }),
      light: null,
      paper: null,
    };

    this._makeFoliagePasses();
    this._makeCanopyPass();
    this._makeLightPass();
    this._makePaperPass();
    this._makeCompositePass();
    this._makeProbe();
    this._makeBirdPass();

    this.bird = null;
    this.raw = {};
    this.noiseReady = this._loadNoise();
    this.size = { cssW: 0, cssH: 0, dpr: 1 };
    this.paperDirty = true;
    this.foliageSeed = null;
  }

  // ---- setup ---------------------------------------------------------------

  async _loadNoise() {
    const img = getShaderNoiseTexture();
    // Wait for the image to load rather than to decode: a tab that has never
    // been shown holds decode() back, and the paper would never appear.
    if (!img.complete) {
      await new Promise((resolve, reject) => {
        img.addEventListener('load', resolve, { once: true });
        img.addEventListener('error', reject, { once: true });
      });
    }
    const tex = new THREE.Texture(img);
    tex.flipY = false;
    tex.colorSpace = THREE.NoColorSpace;
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.generateMipmaps = false;
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.needsUpdate = true;
    this.paperUniforms.u_noiseTexture.value = tex;
    this.paperDirty = true;
  }

  _makeFoliagePasses() {
    this.layerScenes = {};
    this.layerMeshes = {};
    this.rectUniforms = {};
    this.loadUniforms = {};
    for (const name of ['near', 'mid']) {
      const rect = { value: new THREE.Vector4(0, 0, 1, 1) };
      // A bird's weight on one branch of this plane (none: level -1).
      const load = { value: new THREE.Vector4(0, 0, -1, 0) };
      this.rectUniforms[name] = rect;
      this.loadUniforms[name] = load;
      const leafMat = program(HEADER + common + wind + leafVert, HEADER + leafFrag, { ...this.windUniforms, uRect: rect, uLoad: load }, MAX_BLEND);
      const branchMat = program(HEADER + common + wind + branchVert, HEADER + branchFrag, { ...this.windUniforms, uRect: rect, uLoad: load }, MAX_BLEND);
      const scene = new THREE.Scene();
      this.layerScenes[name] = scene;
      this.layerMeshes[name] = { leafMat, branchMat, leaves: null, branches: null };
    }
  }

  setFoliage(seed, foliage) {
    const key = JSON.stringify([seed, foliage.near, foliage.mid]);
    if (key === this.foliageSeed) return;
    this.foliageSeed = key;
    for (const name of ['near', 'mid']) {
      const m = this.layerMeshes[name];
      const scene = this.layerScenes[name];
      if (m.leaves) {
        scene.remove(m.leaves, m.branches);
        m.leaves.geometry.dispose();
        m.branches.geometry.dispose();
      }
      const data = buildLayer(name, seed, foliage[name]);
      this.raw[name] = data.raw;

      const lg = quad(-0.5, 0.5, -0.16, 1.0);
      const L = data.leaves;
      lg.setAttribute('aL0', new THREE.InstancedBufferAttribute(L.l0, 4));
      lg.setAttribute('aL1', new THREE.InstancedBufferAttribute(L.l1, 4));
      lg.setAttribute('aL2', new THREE.InstancedBufferAttribute(L.l2, 4));
      lg.setAttribute('aPhase', new THREE.InstancedBufferAttribute(L.phase, 4));
      lg.setAttribute('aLeaf', new THREE.InstancedBufferAttribute(L.leaf, 4));
      lg.setAttribute('aLeaf2', new THREE.InstancedBufferAttribute(L.leaf2, 4));
      lg.instanceCount = L.count;

      const bg = quad(-1, 1, 0, 1);
      const S = data.segments;
      bg.setAttribute('aSeg', new THREE.InstancedBufferAttribute(S.seg, 4));
      bg.setAttribute('aSegW', new THREE.InstancedBufferAttribute(S.segW, 4));
      bg.setAttribute('aL0', new THREE.InstancedBufferAttribute(S.l0, 4));
      bg.setAttribute('aL1', new THREE.InstancedBufferAttribute(S.l1, 4));
      bg.setAttribute('aL2', new THREE.InstancedBufferAttribute(S.l2, 4));
      bg.setAttribute('aPhase', new THREE.InstancedBufferAttribute(S.phase, 4));
      bg.instanceCount = S.count;

      m.leaves = new THREE.Mesh(lg, m.leafMat);
      m.branches = new THREE.Mesh(bg, m.branchMat);
      m.leaves.frustumCulled = false;
      m.branches.frustumCulled = false;
      scene.add(m.branches, m.leaves);
      m.counts = { leaves: L.count, segments: S.count };
    }
  }

  _makeCanopyPass() {
    this.canopyUniforms = {
      ...this.windUniforms,
      uLoad: { value: new THREE.Vector4(0, 0, -1, 0) },
      uRect: { value: new THREE.Vector4() },
      uCrown: { value: new THREE.Vector4() },
      uCrown2: { value: new THREE.Vector4() },
      uLeafSize: { value: 0.045 },
      uCluster: { value: 0.46 },
      uDensity: { value: 0.82 },
      uGaps: { value: 0.55 },
      uFarSway: { value: 0.05 },
      uFarLag: { value: -0.6 },
      uSeed: { value: 3 },
    };
    const mat = program(HEADER + fullscreenVert, HEADER + common + wind + canopyFrag, this.canopyUniforms);
    this.canopyScene = new THREE.Scene();
    const mesh = new THREE.Mesh(this.tri, mat);
    mesh.frustumCulled = false;
    this.canopyScene.add(mesh);

    this.sunblurUniforms = {
      uSrc: { value: this.targets.far.texture },
      uRect: this.canopyUniforms.uRect,
      uAxis: { value: new THREE.Vector2(1, 0) },
      uRa: { value: 0.05 },
      uRb: { value: 0.05 },
      uTexel: { value: 0.002 },
      uTau: { value: 0.06 },
      uLeafTint: { value: new THREE.Vector3() },
      uLimb: { value: 0.3 },
      uTaps: { value: 128 },
    };
    const blur = program(HEADER + fullscreenVert, HEADER + common + sunblurFrag, this.sunblurUniforms);
    this.sunblurScene = new THREE.Scene();
    const bm = new THREE.Mesh(this.tri, blur);
    bm.frustumCulled = false;
    this.sunblurScene.add(bm);
  }

  _makeLightPass() {
    this.lightUniforms = {
      uView: { value: new THREE.Vector4() },
      uViewM: { value: new THREE.Vector4(1, 0, 0, 1) },
      uSun: { value: new THREE.Vector3() },
      uSunRadius: { value: 0.00465 },
      uHaze: { value: 0.1 },
      uAureole: { value: 3.2 },
      uLimb: { value: 0.35 },
      uWinX: { value: 0 },
      uReveal: { value: 0.24 },
      uGlass: { value: 0.07 },
      uFrame: { value: 0.045 },
      uWinRect: { value: new THREE.Vector4() },
      uMullion: { value: new THREE.Vector2() },
      uTransom: { value: new THREE.Vector2() },
      uLayer0: { value: this.targets.near.texture },
      uLayer1: { value: this.targets.mid.texture },
      uFarBlur: { value: this.targets.farBlur.texture },
      uRect0: { value: new THREE.Vector4() },
      uRect1: { value: new THREE.Vector4() },
      uRect2: { value: new THREE.Vector4() },
      uLayerX: { value: new THREE.Vector3() },
      uTexel: { value: new THREE.Vector3() },
      uLayerOn: { value: new THREE.Vector3(1, 1, 1) },
      uBird: { value: this.targets.bird.texture },
      uBirdRect: { value: new THREE.Vector4(0, 0, 1, 1) },
      uBirdX: { value: 1 },
      uBirdTexel: { value: 0.001 },
      uBirdOn: { value: 0 },
      uTau: { value: new THREE.Vector3() },
      uLeafTint: { value: new THREE.Vector3() },
      uTaps: { value: 40 },
    };
    const mat = program(HEADER + fullscreenVert, HEADER + common + lightFrag, this.lightUniforms);
    this.lightScene = new THREE.Scene();
    const mesh = new THREE.Mesh(this.tri, mat);
    mesh.frustumCulled = false;
    this.lightScene.add(mesh);
  }

  _makePaperPass() {
    this.paperUniforms = {
      u_noiseTexture: { value: null },
      u_roughnessSize: { value: 0.5 },
      u_roughnessRows: { value: 0 },
      u_fiberSize: { value: 0.5 },
      uCss: { value: new THREE.Vector2(1, 1) },
      uUnit: { value: 820 },
      uToothSize: { value: 4.2 },
      uToothDepth: { value: 0.55 },
      uElongation: { value: 1.4 },
      uGrainAngle: { value: 90 },
      uAlignment: { value: 0.8 },
      uSoftness: { value: 0.2 },
      uWarp: { value: 0.3 },
      uDetail: { value: 0.55 },
      uGrit: { value: 0.06 },
      uSeed: { value: 4 },
      uSeedU: { value: 4 },
    };
    const mat = program(HEADER + fullscreenVert, HEADER + common + paperFrag, this.paperUniforms);
    this.paperScene = new THREE.Scene();
    const mesh = new THREE.Mesh(this.tri, mat);
    mesh.frustumCulled = false;
    this.paperScene.add(mesh);
  }

  _makeCompositePass() {
    this.compositeUniforms = {
      uLight: { value: null },
      uPaper: { value: null },
      uPaperTexel: { value: new THREE.Vector2() },
      uCssSize: { value: new THREE.Vector2(1, 1) },
      uCssPerPx: { value: 0.5 },
      uView: this.lightUniforms.uView,
      uViewM: this.lightUniforms.uViewM,
      uSun: this.lightUniforms.uSun,
      uSunColor: { value: new THREE.Vector3() },
      uSunIntensity: { value: 3 },
      uSkyColor: { value: new THREE.Vector3() },
      uSkyIntensity: { value: 2 },
      uSkyOcclusion: { value: 0.4 },
      uRoomColor: { value: new THREE.Vector3() },
      uRoomIntensity: { value: 0.2 },
      uBounce: { value: 0.1 },
      uScatter: { value: 0.16 },
      uPaperColor: { value: new THREE.Vector3() },
      uGrainDepth: { value: 0.035 },
      uFiberDepth: { value: 0.12 },
      uToothDepth: { value: 0.6 },
      uToothSize: { value: 6.5 },
      uRelief: { value: 1 },
      uTranslucency: { value: 0.3 },
      uSkyRelief: { value: 0.6 },
      uShadowSteps: { value: 8 },
      uFormation: { value: 0.04 },
      uFiberTone: { value: 0.03 },
      uAO: { value: 0.3 },
      uCockle: { value: 0.02 },
      uCockleScale: { value: 0.22 },
      uExposure: { value: 1 },
      uShoulder: { value: 0.72 },
      uShoulderWidth: { value: 0.22 },
      uFill: { value: 1 },
      uWinX: this.lightUniforms.uWinX,
      uWinRect: this.lightUniforms.uWinRect,
      uDebug: { value: 0 },
      uDebugTex: { value: null },
      uLabLight: { value: new THREE.Vector3(0, 0.88, 0.47) },
    };
    const mat = program(HEADER + fullscreenVert, HEADER + common + compositeFrag, this.compositeUniforms);
    this.compositeScene = new THREE.Scene();
    const mesh = new THREE.Mesh(this.tri, mat);
    mesh.frustumCulled = false;
    this.compositeScene.add(mesh);
  }

  _makeProbe() {
    this.probeSize = [64, 40];
    this.probeTarget = new THREE.WebGLRenderTarget(this.probeSize[0], this.probeSize[1], { depthBuffer: false });
    this.probeUniforms = { uLight: { value: null }, uLod: { value: 4 } };
    const mat = program(HEADER + fullscreenVert, HEADER + probeFrag, this.probeUniforms);
    this.probeScene = new THREE.Scene();
    const mesh = new THREE.Mesh(this.tri, mat);
    mesh.frustumCulled = false;
    this.probeScene.add(mesh);
    this.probeData = null;
  }

  _makeBirdPass() {
    const width = 3 * MAX_PRIMS + 1;
    this.birdPrims = new THREE.DataTexture(new Float32Array(width * MAX_MOMENTS * 4), width, MAX_MOMENTS, THREE.RGBAFormat, THREE.FloatType);
    this.birdPrims.minFilter = THREE.NearestFilter;
    this.birdPrims.magFilter = THREE.NearestFilter;
    this.birdPrims.generateMipmaps = false;
    this.birdUniforms = {
      uPrims: { value: this.birdPrims },
      uMoments: { value: 1 },
      uRect: { value: new THREE.Vector4(0, 0, 1, 1) },
      uPlaneX: { value: 1 },
      uOrigin: { value: new THREE.Vector3() },
      uE1: { value: new THREE.Vector3(1, 0, 0) },
      uE2: { value: new THREE.Vector3(0, 1, 0) },
      uAA: { value: 0.001 },
      uOpacity: { value: 1 },
    };
    const mat = program(HEADER + fullscreenVert, HEADER + birdFrag, this.birdUniforms);
    this.birdScene = new THREE.Scene();
    const mesh = new THREE.Mesh(this.tri, mat);
    mesh.frustumCulled = false;
    this.birdScene.add(mesh);
    this.birdFrame = null;
  }

  // Where direct light reaches the paper, coarsely, from the last frame.
  probeLight() {
    if (!this.targets.light) return null;
    const [w, h] = this.probeSize;
    this.probeUniforms.uLight.value = this.targets.light.texture;
    this.probeUniforms.uLod.value = Math.max(0, Math.log2(this.targets.light.width / w));
    const px = new Uint8Array(w * h * 4);
    this.renderer.setRenderTarget(this.probeTarget);
    this.renderer.render(this.probeScene, this.camera);
    this.renderer.readRenderTargetPixels(this.probeTarget, 0, 0, w, h, px);
    this.renderer.setRenderTarget(null);
    const lit = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) lit[i] = px[i * 4] / 255;
    return { w, h, lit };
  }

  // ---- size ----------------------------------------------------------------

  resize(cssW, cssH, dpr, lightScale) {
    const s = this.size;
    const w = Math.max(1, Math.round(cssW * dpr));
    const h = Math.max(1, Math.round(cssH * dpr));
    const lw = Math.max(8, Math.round(w * lightScale));
    const lh = Math.max(8, Math.round(h * lightScale));
    if (s.cssW === cssW && s.cssH === cssH && s.dpr === dpr && s.lightScale === lightScale) return;
    this.size = { cssW, cssH, dpr, w, h, lightScale };
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(w, h, false);

    this.targets.light?.dispose();
    this.targets.light = new THREE.WebGLRenderTarget(lw, lh, {
      type: this.floatType,
      format: THREE.RGBAFormat,
      minFilter: THREE.LinearMipmapLinearFilter,
      magFilter: THREE.LinearFilter,
      generateMipmaps: true,
      depthBuffer: false,
    });
    this.targets.paper?.dispose();
    this.targets.paper = new THREE.WebGLRenderTarget(w, h, {
      type: this.floatType,
      format: THREE.RGBAFormat,
      minFilter: THREE.LinearMipmapLinearFilter,
      magFilter: THREE.LinearFilter,
      generateMipmaps: true,
      depthBuffer: false,
    });
    this.compositeUniforms.uLight.value = this.targets.light.texture;
    this.compositeUniforms.uPaper.value = this.targets.paper.texture;
    this.compositeUniforms.uPaperTexel.value.set(1 / w, 1 / h);
    this.compositeUniforms.uCssSize.value.set(cssW, cssH);
    this.compositeUniforms.uCssPerPx.value = cssW / w;
    this.paperDirty = true;
    this.lightReady = false;
  }

  // ---- frame ---------------------------------------------------------------

  apply(state) {
    const win = state.scene.window;
    const sun = sunVector(state.sun.elevation, state.sun.azimuth);
    const view = viewRect(this.size.cssW, this.size.cssH, state.framing);
    this.view = view;
    this.sun = sun;

    // Wind and time, shared by every foliage pass.
    const W = this.windUniforms;
    W.uTime.value = state.time;
    W.uWindStrength.value = state.wind.strength;
    W.uWindGust.value = state.wind.gust;
    W.uWindSpeed.value = state.wind.speed;
    W.uWindLull.value = state.wind.lull;
    W.uWindDir.value = state.wind.direction;
    W.uWindAxis.value.fromArray(state.wind.axis);
    W.uWindSeed.value = (state.seed * 7919 + 13) >>> 0;
    W.uSwayAmp.value.fromArray(state.wind.sway.amp);
    W.uSwayFreq.value.fromArray(state.wind.sway.freq);
    W.uSwayLag.value.fromArray(state.wind.sway.lag);
    W.uBendPow.value = state.wind.bend;
    W.uFlutter.value = state.wind.flutter;

    // Layer planes and the regions they need.
    const names = ['near', 'mid', 'far'];
    const xs = names.map((n) => planeX(win, state.scene.layers[n].distance));
    this.xs = xs;
    // The light's angular size: the sun's, the moon's or the lamp's.
    const radius = state.sun.radius ?? state.optics.sunRadius;
    const rects = xs.map((x) => layerRect(win, sun, x, view, radius));
    this.rects = rects;
    this.rectUniforms.near.value.fromArray(rects[0]);
    this.rectUniforms.mid.value.fromArray(rects[1]);
    this.canopyUniforms.uRect.value.fromArray(rects[2]);

    const f = state.foliage.far;
    const C = this.canopyUniforms;
    C.uCrown.value.fromArray(f.crown);
    C.uCrown2.value.fromArray(f.crown2);
    C.uLeafSize.value = f.leafSize;
    C.uCluster.value = f.cluster;
    C.uDensity.value = f.density;
    C.uGaps.value = f.gaps;
    C.uFarSway.value = state.wind.farSway;
    C.uSeed.value = ((state.foliage.seed * 2654435761) >>> 0) % 100000;

    const Lu = this.lightUniforms;
    Lu.uView.value.set(view.cx, view.cy, view.w, view.h);
    Lu.uViewM.value.fromArray(view.m);
    Lu.uSun.value.fromArray(sun);
    Lu.uSunRadius.value = radius;
    Lu.uHaze.value = state.sun.haze;
    Lu.uAureole.value = state.optics.aureole;
    Lu.uLimb.value = state.optics.limb;
    Lu.uWinX.value = win.x;
    Lu.uReveal.value = win.reveal;
    Lu.uGlass.value = win.glass;
    Lu.uFrame.value = win.frame;
    Lu.uWinRect.value.set(win.u0, win.u1, win.v0, win.v1);
    // Bars in the window: a rail at fixed height, an upright at fixed position
    // along the wall. The rail's shadow crosses the paper and moves with the sun.
    Lu.uMullion.value.set(win.u0 + win.rail.at * (win.u1 - win.u0), win.rail.width / 2);
    Lu.uTransom.value.set(win.v0 + win.upright.at * (win.v1 - win.v0), win.upright.width / 2);
    Lu.uRect0.value.fromArray(rects[0]);
    Lu.uRect1.value.fromArray(rects[1]);
    Lu.uRect2.value.fromArray(rects[2]);
    Lu.uLayerX.value.fromArray(xs);
    Lu.uTexel.value.set(
      Math.max(rects[0][2], rects[0][3]) / this.layerSize,
      Math.max(rects[1][2], rects[1][3]) / this.layerSize,
      Math.max(rects[2][2], rects[2][3]) / this.farSize,
    );
    Lu.uLayerOn.value.set(state.foliage.near.enabled ? 1 : 0, state.foliage.mid.enabled ? 1 : 0, state.foliage.far.enabled ? 1 : 0);
    Lu.uTau.value.fromArray(state.foliage.translucency);
    Lu.uLeafTint.value.fromArray(state.optics.leafTint);
    Lu.uTaps.value = Math.round(state.optics.taps);

    // The far plane's sun footprint, at a representative point in the view.
    const B = this.sunblurUniforms;
    const lx = Math.max(sun[0], 0.05);
    const tFar = (xs[2] - view.cx) / lx;
    const rFar = tFar * radius;
    const axLen = Math.hypot(sun[2], sun[1]) || 1;
    B.uAxis.value.set(sun[2] / axLen, sun[1] / axLen);
    B.uRa.value = rFar / lx;
    B.uRb.value = rFar;
    B.uTexel.value = Math.max(rects[2][2], rects[2][3]) / this.farSize;
    B.uTau.value = state.foliage.translucency[2];
    B.uLeafTint.value.fromArray(state.optics.leafTint);
    B.uLimb.value = state.optics.limb;
    B.uTaps.value = Math.round(state.optics.farTaps ?? 128);

    const P = this.paperUniforms;
    const p = state.paper;
    const frame = isPortrait(this.size.cssW, this.size.cssH) ? state.framing.portrait : state.framing.landscape;
    const toothSize = p.toothSize * (frame.tooth ?? 1);
    const paperKey = JSON.stringify([
      p.unit, p.roughnessSize, p.fiberSize, toothSize, p.toothDepth, p.elongation,
      p.grainAngle, p.alignment, p.softness, p.warp, p.detail, p.grit, p.seed,
    ]);
    if (paperKey !== this.paperKey) {
      this.paperKey = paperKey;
      this.paperDirty = true;
    }
    P.u_roughnessSize.value = p.roughnessSize;
    P.u_fiberSize.value = p.fiberSize;
    P.uUnit.value = p.unit;
    P.uToothSize.value = toothSize;
    P.uToothDepth.value = p.toothDepth;
    P.uElongation.value = p.elongation;
    P.uGrainAngle.value = p.grainAngle ?? 90;
    P.uAlignment.value = p.alignment;
    P.uSoftness.value = p.softness;
    P.uWarp.value = p.warp;
    P.uDetail.value = p.detail;
    P.uGrit.value = p.grit;
    P.uSeed.value = p.seed;
    P.uSeedU.value = (p.seed * 977 + 5) >>> 0;
    P.uCss.value.set(this.size.cssW, this.size.cssH);

    const K = this.compositeUniforms;
    K.uSunColor.value.fromArray(state.sun.color);
    K.uSunIntensity.value = state.sun.intensity;
    K.uSkyColor.value.fromArray(state.sky.color);
    K.uSkyIntensity.value = state.sky.intensity;
    K.uSkyOcclusion.value = state.sky.occlusion;
    K.uRoomColor.value.fromArray(state.room.color);
    K.uRoomIntensity.value = state.room.intensity;
    K.uBounce.value = state.bounce;
    K.uScatter.value = state.optics.scatter;
    K.uPaperColor.value.fromArray(p.color);
    K.uGrainDepth.value = p.grainDepth * p.roughness;
    K.uFiberDepth.value = p.fiberDepth * p.fiber;
    K.uToothDepth.value = p.toothDepth;
    K.uToothSize.value = toothSize;
    K.uRelief.value = p.relief;
    K.uTranslucency.value = p.translucency;
    K.uSkyRelief.value = p.skyRelief;
    K.uShadowSteps.value = Math.round(state.optics.shadowSteps ?? 8);
    K.uShoulder.value = state.optics.shoulder ?? 0.72;
    K.uShoulderWidth.value = state.optics.shoulderWidth ?? 0.22;
    K.uFill.value = state.optics.fill ?? 1;
    K.uFormation.value = p.formation;
    K.uFiberTone.value = p.fiberTone;
    K.uAO.value = p.ao;
    K.uCockle.value = p.cockle;
    K.uCockleScale.value = p.cockleScale;
    K.uExposure.value = state.exposure;
    K.uDebug.value = state.debug ?? 0;
    if (state.lab) K.uLabLight.value.fromArray(state.lab);
    const dbg = { 5: 'near', 6: 'mid', 7: 'far', 10: 'farBlur' }[state.debug];
    K.uDebugTex.value = dbg ? this.targets[dbg].texture : this.targets.near.texture;
  }

  render(state) {
    this.setFoliage(state.foliage.seed, state.foliage);
    this.apply(state);
    this._updateBird(state);
    const r = this.renderer;

    if (this.paperDirty && this.paperUniforms.u_noiseTexture.value) {
      r.setRenderTarget(this.targets.paper);
      r.clear();
      r.render(this.paperScene, this.camera);
      this.paperDirty = false;
    }

    for (const name of ['near', 'mid']) {
      r.setRenderTarget(this.targets[name]);
      r.clear();
      if (state.foliage[name].enabled) r.render(this.layerScenes[name], this.camera);
    }
    // The bird's plane, only while it is about.
    this.lightUniforms.uBirdOn.value = this.birdFrame ? 1 : 0;
    if (this.birdFrame) {
      r.setRenderTarget(this.targets.bird);
      r.clear();
      r.render(this.birdScene, this.camera);
    }
    r.setRenderTarget(this.targets.far);
    r.clear();
    if (state.foliage.far.enabled) {
      r.render(this.canopyScene, this.camera);
      r.setRenderTarget(this.targets.farBlur);
      r.clear();
      r.render(this.sunblurScene, this.camera);
    }

    r.setRenderTarget(this.targets.light);
    r.clear();
    r.render(this.lightScene, this.camera);
    this.lightReady = true;

    r.setRenderTarget(null);
    r.clear();
    r.render(this.compositeScene, this.camera);
  }

  // The visiting bird: its pose this frame, projected along the sun, and its
  // weight on the twig it stands on.
  _updateBird(state) {
    if (!this.bird) this.bird = new Bird(state.bird);
    this.bird.settings = state.bird;
    const sun = this.sun;
    let probe;
    const f = state.foliage.near.enabled
      ? this.bird.update(state.time, {
          seed: state.seed,
          sun,
          elevation: state.sun.elevation,
          // Sunlight, not the lamp or the moon, strong enough to cast a shadow,
          // and holding still: no visit begins while the day is playing past.
          daylight: (state.ui ?? 0) < 0.2 && (state.sun.radius ?? 0.00465) < 0.0052 && state.sun.intensity > 0.8 && !state.dayPlaying,
          ready: this.lightReady,
          view: this.view,
          probe: () => (probe ??= this.probeLight()),
          window: state.scene.window,
          wind: windParams(state),
          near: { x: this.xs[0], rect: this.rects[0], segments: this.raw.near?.segments ?? [] },
        })
      : null;
    this.birdFrame = f && !f.gone ? f : null;
    const load = this.loadUniforms.near.value;
    if (!f) {
      load.set(0, 0, -1, 0);
      return;
    }
    load.set(f.load.pivot[0], f.load.pivot[1], f.load.level, f.load.angle);
    if (f.gone) return;
    this.birdPrims.image.data.set(f.data);
    this.birdPrims.needsUpdate = true;
    const B = this.birdUniforms;
    B.uMoments.value = f.moments;
    B.uOpacity.value = f.opacity;
    B.uRect.value.fromArray(f.rect);
    B.uPlaneX.value = f.planeX;
    B.uOrigin.value.fromArray(f.origin);
    B.uE1.value.fromArray(f.e1);
    B.uE2.value.fromArray(f.e2);
    const texel = Math.max(f.rect[2], f.rect[3]) / BIRD_SIZE;
    B.uAA.value = 0.6 * texel;
    const Lu = this.lightUniforms;
    Lu.uBirdRect.value.fromArray(f.rect);
    Lu.uBirdX.value = f.planeX;
    Lu.uBirdTexel.value = texel;
  }

  // Bring the bird now.
  visitBird(state, seed) {
    if (!this.bird) this.bird = new Bird(state.bird);
    this.bird.visit(state.time, seed);
  }

  // Where the bird's shadow falls in the view, as fractions, and what it is
  // doing (for captures and checks).
  birdSpot() {
    const f = this.birdFrame;
    return f ? { x: f.spot[0], y: f.spot[1], phase: f.phase } : null;
  }

  // Read the frame just rendered, before the browser clears it.
  readPixels() {
    const gl = this.renderer.getContext();
    const { w, h } = this.size;
    const px = new Uint8Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
    return { w, h, px };
  }

  info() {
    return {
      size: this.size,
      floatType: this.floatType === THREE.HalfFloatType ? 'half-float' : 'uint8',
      counts: { near: this.layerMeshes.near.counts, mid: this.layerMeshes.mid.counts },
      rects: this.rects,
      view: this.view,
      sun: this.sun,
    };
  }

  dispose() {
    for (const t of Object.values(this.targets)) t?.dispose();
    this.renderer.dispose();
  }
}
