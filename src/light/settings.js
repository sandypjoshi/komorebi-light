// Visual settings, kept apart from rendering code.
//
// Paper lies flat beside a large window, with a balcony plant and trees
// outside. World units are metres. The paper is the plane z = 0, seen from
// above, and fills the page. The window is in the wall x = window.x, to the
// right of the view; outside it, foliage stands in vertical planes parallel to
// that wall. Plane coordinates are (u, v) = (height above the paper, position
// along the wall).
//
// At this scale the window is only a hint: the paper sits inside its light,
// and what reaches it is the tree. The paper stays bright; shadows are soft,
// light and cool, the way they look on paper in real light.

export const SCENE = {
  window: {
    x: 0.62, //        the window wall, beyond the view's right edge
    u0: 0.012, //      sill height: the paper's surface runs up to the window
    u1: 1.66, //       head height
    v0: -0.7, //       opening along the wall
    v1: 1.1,
    reveal: 0.18, //   wall thickness: rays must pass both faces
    glass: 0.05, //    frame plane, measured from the inner face
    frame: 0.03, //    frame width inside the opening
    upright: { at: 0.533, width: 0.0 }, //  vertical bar, as a fraction along the wall (0 = none)
    rail: { at: 0.3, width: 0.03 }, //      slim horizontal bar, as a fraction of the height
  },
  // Distance of each foliage plane beyond the outer face of the window wall.
  layers: {
    near: { distance: 0.45 },
    mid: { distance: 3.0 },
    far: { distance: 9.0 },
  },
};

// How the viewport frames the paper. `width` is metres of paper across the
// viewport. The view is turned (and mirrored) so the window is behind the
// reader, below the page to the right: light falls over their shoulder and
// what stands upright outside, a plant or a bird, stands upright on the page.
// `tooth` scales the paper's tooth on screen: a phone is held closer than a
// desktop screen, so its tooth is drawn a little smaller to read the same.
export const FRAMING = {
  landscape: { centerX: 0.0, centerY: 0.0, width: 0.76, rotation: -63, mirror: true, tooth: 1.0 },
  portrait: { centerX: 0.04, centerY: -0.02, width: 0.28, rotation: -63, mirror: true, tooth: 0.8 },
};

// Paper: a cold-press watercolour sheet. Its tooth is the imprint of the felt
// it was pressed against: small rounded mounds, longer than wide, packed
// together and often lying the same way, with soft creases where they meet.
// Fine grain and fibre come from Paper Shaders' Paper Texture functions. All
// of it is height that the scene's light shades, never a pattern on top: the
// tooth rises in raking light, casts tiny shadows when the sun is low, and
// softens at noon and in the shade.
export const PAPER = {
  color: [0.915, 0.905, 0.88], // linear albedo: warm white cotton
  // Tooth matched to the owner's cold-press reference by power spectrum (feature
  // wavelength about 1.4 mm, contrast about 3% of luminance) in a lab light from
  // the top; the grain then turns to cross the window's light as it crosses the
  // reference's.
  toothSize: 3.7, //        CSS px between pebbles (about 2 mm at the desktop framing)
  toothDepth: 0.25, //      height of the pebbles, CSS px
  elongation: 1.65, //      length over width of a pebble
  grainAngle: 108, //       direction the felt ran, degrees on screen
  alignment: 1, //          how steadily the pebbles keep that direction
  softness: 7.5, //         sharpness of the joins between pebbles
  warp: 0.22, //            irregularity
  detail: 0.42, //          smaller grains on the pebbles
  grit: 0.015, //           fine unevenness, CSS px
  unit: 820, //             CSS px per Paper Shaders pattern unit
  roughness: 0.5, //        Paper Shaders roughness (fine grain)
  roughnessSize: 0.5,
  grainDepth: 0.02, //      its height, CSS px
  fiber: 0.4, //            Paper Shaders fibre
  fiberSize: 0.4,
  fiberDepth: 0.12, //      its height, CSS px
  relief: 1.9, //           slope multiplier at shading time
  translucency: 0.34, //    light spreading inside the paper into its own micro-shadows
  skyRelief: 0.85, //       how much the window's sky light models the tooth
  formation: 0.03, //       cloudy density variation in albedo
  fiberTone: 0.02, //       fibre albedo contrast
  ao: 0.1, //               cavity darkening in ambient light
  cockle: 0.014, //         gentle waviness of the sheet (slope)
  cockleScale: 0.16, //     metres per undulation
  seed: 4,
};

// Light that does not change with the time of day.
export const OPTICS = {
  sunRadius: 0.00465, //   angular radius of the sun, radians
  limb: 0.22, //           limb darkening of the sun disc
  aureole: 3.2, //         aureole radius, as a multiple of the sun's
  leafTint: [0.7, 0.82, 0.4], // colour of light transmitted through leaves
  scatter: 0.1, //         light spread inside the paper at a lit edge
  taps: 40, //             sun-disc samples per pixel for near foliage
  farTaps: 128, //         sun-disc samples for the far canopy (once per texel)
  lightScale: 0.5, //      light pass resolution relative to the canvas
  shadowSteps: 8, //       samples along the sun for the tooth's own shadows
  shoulder: 0.55, //       where highlights begin to roll off; hue is kept above it
  shoulderWidth: 0.22, //  how gradually they roll off (logarithmic above the shoulder)
  fill: 1.15, //           scale on the light that fills the shade: sky, room, bounce
};

export const WIND = {
  strength: 1.0,
  gust: 0.7, //            how much gusts stand out from the breeze
  speed: 1.4, //           m/s, how fast gust fronts travel across the trees
  lull: 0.65, //           depth of the slow lulls
  direction: 1,
  axis: [0, 1], //         gusts travel along the wall
  sway: {
    amp: [0.016, 0.045, 0.1], //    limb, branch, twig (radians at full gust)
    freq: [0.17, 0.39, 0.83], //    Hz
    lag: [0.0, 0.28, 0.5], //       seconds behind the gust at the pivot
  },
  bend: 1.6, //            how much a branch bends toward its tip
  flutter: 1.0, //         leaf turning
  farSway: 0.04, //        metres of cluster sway in the far canopy
};

// Now and then one small bird visits the shrub (bird.js). It flies in from
// the trees, lands on a twig, stays a while and flies off; only its shadow is
// seen, softened by its distance like any leaf's.
export const BIRD = {
  enabled: true,
  first: 45, //          animation time of the first visit (s); the study opens at 37
  firstJitter: 4,
  gap: [26, 58], //      seconds between one visit and the next
  stay: [12, 24], //     seconds on the twig
  minElevation: 19, //   degrees; a lower sun stretches its shadow too far to read
};

export const FOLIAGE = {
  seed: 11,
  near: { enabled: true, leafLength: 0.064, density: 1.0 },
  mid: { enabled: true, leafLength: 0.075, density: 1.0 },
  far: {
    enabled: true,
    crown: [7.35, 6.55, 0.95, 1.1], // centre u, v and radii of the tree crown
    crown2: [4.5, 9.15, 0.75, 0.85], // a second, lower tree that catches the low sun
    leafSize: 0.03, //       mean radius of an opening in the crown (m)
    cluster: 0.13, //        spacing of openings (m)
    density: 0.88, //        share of places with an opening
    gaps: 0.55, //           how much the crown thins into brighter pools
  },
  // Leaves pass a little sunlight, tinted by the leaf.
  translucency: [0.06, 0.06, 0.05],
};

// The day and night. A few art-directed moments on a 24-hour clock; between
// them every value follows one smooth curve (daylight.js), so the light's path,
// its colour, the sky, the room, the wind and the page's theme move together.
// Not a solar or lunar model: the paths suit the plants.
//
// Colours are linear RGB, seen by a daylight-balanced eye: low sun is warm,
// noon is near white, the sky that fills the shade is cool. The owner's own
// morning photos calibrate the morning: warm cream light (red about a quarter
// above green, blue about a fifth below) on a neutral, cool-leaning shade.
// At night the moon takes over the same light path: a cool, dim disc the same
// size as the sun, so its shadows soften in the same way. `ui` is the page's
// theme: 0 light, 1 dark.
const NIGHT = {
  sky: { intensity: 0.075, color: [0.26, 0.34, 0.76], occlusion: 0.5 },
  room: { intensity: 0.011, color: [0.52, 0.58, 0.84] },
  bounce: 0.04,
  exposure: 0.86,
  wind: { strength: 0.3 },
  ui: 1,
};

// The one direct light: the sun by day, a street lamp across the way through
// the evening's blue hour, the moon at night and on until first light, sinking
// low and fading as the dawn sky brightens. `radius` is the source's angular
// radius; the lamp is a little larger than the sun or moon, so its shadows are
// softer.
const sun = (elevation, azimuth, intensity, color, haze) => ({ elevation, azimuth, intensity, color, haze, radius: 0.00465 });
const MOON = [0.58, 0.71, 1.0];
const moon = (elevation, azimuth, intensity, haze = 0.14) => ({ elevation, azimuth, intensity, color: MOON, haze, radius: 0.0045 });
const LAMP = [1.0, 0.63, 0.27];
const lamp = (intensity) => ({ elevation: 23, azimuth: 38, intensity, color: LAMP, haze: 0.1, radius: 0.006 });

export const DAY = {
  start: 0,
  end: 24,
  wrap: true, //        midnight joins midnight
  playSeconds: 72, //   the whole day and night, when it plays
  smoothing: 0.22, //   seconds the light trails the slider, so the light glides
  keys: [
    { clock: 0.0, sun: moon(36, 26, 0.26), ...NIGHT },
    { clock: 2.5, sun: moon(30, 31, 0.25), ...NIGHT },
    {
      clock: 4.5, //    the moon low, before dawn
      sun: moon(15, 39, 0.2, 0.16),
      sky: { intensity: 0.09, color: [0.3, 0.38, 0.8], occlusion: 0.5 },
      room: { intensity: 0.011, color: [0.52, 0.58, 0.84] },
      bounce: 0.04,
      exposure: 0.88,
      wind: { strength: 0.3 },
      ui: 1,
    },
    {
      clock: 5.2, //    the moon sinking toward the trees
      sun: moon(11, 42, 0.18, 0.16),
      sky: { intensity: 0.2, color: [0.32, 0.42, 0.94], occlusion: 0.45 },
      room: { intensity: 0.022, color: [0.56, 0.58, 0.84] },
      bounce: 0.05,
      exposure: 0.95,
      wind: { strength: 0.3 },
      ui: 0.95,
    },
    {
      clock: 5.75, //   the sky begins to lighten; the low moon's shadows thin
      sun: moon(8, 44, 0.12, 0.18),
      sky: { intensity: 0.55, color: [0.48, 0.55, 0.94], occlusion: 0.42 },
      room: { intensity: 0.06, color: [0.66, 0.66, 0.86] },
      bounce: 0.05,
      exposure: 1.12,
      wind: { strength: 0.32 },
      ui: 0.75,
    },
    {
      clock: 6.0, //    first light: the moon is lost in the brightening sky
      sun: moon(6.5, 45, 0.0, 0.2),
      sky: { intensity: 0.9, color: [0.62, 0.66, 0.95], occlusion: 0.4 },
      room: { intensity: 0.16, color: [0.82, 0.8, 0.88] },
      bounce: 0.06,
      exposure: 1.45,
      wind: { strength: 0.35 },
      ui: 0.35,
    },
    {
      clock: 6.02,
      sun: sun(3.5, 45.5, 0.0, [1.0, 0.5, 0.3], 0.25),
      sky: { intensity: 0.92, color: [0.63, 0.67, 0.95], occlusion: 0.4 },
      room: { intensity: 0.17, color: [0.83, 0.8, 0.88] },
      bounce: 0.06,
      exposure: 1.44,
      wind: { strength: 0.35 },
      ui: 0.3,
    },
    {
      clock: 6.25, //   the sun is up
      sun: sun(5.5, 44.8, 2.2, [1.0, 0.53, 0.29], 0.22),
      sky: { intensity: 1.0, color: [0.65, 0.7, 0.97], occlusion: 0.4 },
      room: { intensity: 0.33, color: [0.9, 0.85, 0.86] },
      bounce: 0.09,
      exposure: 1.15,
      wind: { strength: 0.4 },
      ui: 0,
    },
    {
      clock: 6.6, //    sunrise light
      sun: sun(8, 44, 3.6, [1.0, 0.56, 0.3], 0.2),
      sky: { intensity: 1.05, color: [0.66, 0.72, 0.98], occlusion: 0.4 },
      room: { intensity: 0.4, color: [0.92, 0.86, 0.86] },
      bounce: 0.1,
      exposure: 1.08,
      wind: { strength: 0.42 },
      ui: 0,
    },
    {
      clock: 7.4, //    early morning
      sun: sun(18, 37, 2.4, [1.0, 0.66, 0.4], 0.12),
      sky: { intensity: 1.5, color: [0.76, 0.82, 1.0], occlusion: 0.35 },
      room: { intensity: 0.47, color: [0.95, 0.92, 0.92] },
      bounce: 0.1,
      exposure: 1.0,
      wind: { strength: 0.55 },
      ui: 0,
    },
    {
      clock: 8.5, //    morning
      sun: sun(31, 30, 1.75, [1.0, 0.74, 0.5], 0.06),
      sky: { intensity: 1.9, color: [0.8, 0.87, 1.0], occlusion: 0.3 },
      room: { intensity: 0.52, color: [0.95, 0.95, 0.98] },
      bounce: 0.08,
      exposure: 1.0,
      wind: { strength: 0.65 },
      ui: 0,
    },
    {
      clock: 10.5, //   late morning
      sun: sun(46, 21, 1.6, [1.0, 0.84, 0.66], 0.05),
      sky: { intensity: 1.95, color: [0.82, 0.88, 1.0], occlusion: 0.3 },
      room: { intensity: 0.55, color: [0.96, 0.96, 0.98] },
      bounce: 0.08,
      exposure: 0.97,
      wind: { strength: 0.72 },
      ui: 0,
    },
    {
      clock: 12.5, //   midday
      sun: sun(55, 15, 1.45, [1.0, 0.92, 0.81], 0.04),
      sky: { intensity: 2.0, color: [0.82, 0.88, 1.0], occlusion: 0.3 },
      room: { intensity: 0.56, color: [0.96, 0.96, 0.98] },
      bounce: 0.08,
      exposure: 0.96,
      wind: { strength: 0.75 },
      ui: 0,
    },
    {
      clock: 14.5, //   afternoon
      sun: sun(40, 24, 1.65, [1.0, 0.8, 0.59], 0.06),
      sky: { intensity: 1.75, color: [0.78, 0.84, 1.0], occlusion: 0.33 },
      room: { intensity: 0.54, color: [0.96, 0.95, 0.97] },
      bounce: 0.09,
      exposure: 0.98,
      wind: { strength: 0.72 },
      ui: 0,
    },
    {
      clock: 15.5, //   mid afternoon: the sun keeps to the far tree's edge
      sun: sun(28, 29, 1.9, [1.0, 0.74, 0.47], 0.08),
      sky: { intensity: 1.5, color: [0.72, 0.78, 0.99], occlusion: 0.36 },
      room: { intensity: 0.52, color: [0.95, 0.93, 0.92] },
      bounce: 0.09,
      exposure: 0.98,
      wind: { strength: 0.68 },
      ui: 0,
    },
    {
      clock: 16.5, //   late afternoon
      sun: sun(17, 40, 2.5, [1.0, 0.67, 0.31], 0.12),
      sky: { intensity: 1.2, color: [0.66, 0.72, 0.98], occlusion: 0.4 },
      room: { intensity: 0.5, color: [0.95, 0.9, 0.88] },
      bounce: 0.1,
      exposure: 0.98,
      wind: { strength: 0.58 },
      ui: 0,
    },
    {
      clock: 17.5, //   sunset
      sun: sun(7, 44, 3.6, [1.0, 0.55, 0.23], 0.2),
      sky: { intensity: 0.85, color: [0.6, 0.62, 0.95], occlusion: 0.42 },
      room: { intensity: 0.42, color: [0.92, 0.82, 0.82] },
      bounce: 0.12,
      exposure: 1.04,
      wind: { strength: 0.48 },
      ui: 0,
    },
    {
      clock: 18.08, //  the last of the sun
      sun: sun(3, 45.4, 1.0, [1.0, 0.48, 0.24], 0.24),
      sky: { intensity: 0.8, color: [0.58, 0.6, 0.94], occlusion: 0.42 },
      room: { intensity: 0.3, color: [0.86, 0.78, 0.84] },
      bounce: 0.1,
      exposure: 1.2,
      wind: { strength: 0.42 },
      ui: 0,
    },
    {
      clock: 18.18,
      sun: sun(2, 45.7, 0.6, [1.0, 0.46, 0.25], 0.25),
      sky: { intensity: 0.75, color: [0.55, 0.6, 0.95], occlusion: 0.41 },
      room: { intensity: 0.22, color: [0.8, 0.76, 0.86] },
      bounce: 0.08,
      exposure: 1.3,
      wind: { strength: 0.4 },
      ui: 0.12,
    },
    {
      clock: 18.26, //  the sun has set
      sun: sun(1.2, 46, 0.0, [1.0, 0.44, 0.26], 0.25),
      sky: { intensity: 0.7, color: [0.52, 0.6, 0.95], occlusion: 0.4 },
      room: { intensity: 0.16, color: [0.76, 0.76, 0.88] },
      bounce: 0.06,
      exposure: 1.4,
      wind: { strength: 0.38 },
      ui: 0.3,
    },
    {
      clock: 18.27, //  the street lamp comes on
      sun: lamp(0.0),
      sky: { intensity: 0.69, color: [0.52, 0.6, 0.95], occlusion: 0.4 },
      room: { intensity: 0.16, color: [0.76, 0.76, 0.88] },
      bounce: 0.06,
      exposure: 1.4,
      wind: { strength: 0.38 },
      ui: 0.32,
    },
    {
      clock: 18.45, //  blue hour, lamplight on the leaves; dim, as the night it opens
      sun: lamp(1.25),
      sky: { intensity: 0.5, color: [0.36, 0.47, 0.98], occlusion: 0.42 },
      room: { intensity: 0.04, color: [0.58, 0.62, 0.9] },
      bounce: 0.06,
      exposure: 0.29, // (was 1.02: the lamplit paper stayed mid-tone in dark mode, and pale ink could not be read on it)
      wind: { strength: 0.34 },
      ui: 0.75,
    },
    {
      clock: 19.4, //   evening
      sun: lamp(1.1),
      sky: { intensity: 0.3, color: [0.3, 0.41, 0.95], occlusion: 0.45 },
      room: { intensity: 0.025, color: [0.54, 0.58, 0.88] },
      bounce: 0.05,
      exposure: 0.33, // (was 0.93)
      wind: { strength: 0.32 },
      ui: 0.95,
    },
    // Through the evening the warm lamplight gives way to the risen moon.
    { clock: 20.4, sun: moon(16, 37, 0.23, 0.16), ...NIGHT },
    { clock: 22.0, sun: moon(27, 31, 0.26), ...NIGHT },
    { clock: 24.0, sun: moon(36, 26, 0.26), ...NIGHT },
  ],
};

// Named moments of the day (keys 1, 2, 3). `stillTime` is the animation time
// held for reduced motion.
export const PRESETS = {
  morning: { label: 'Morning', clock: 8.5, stillTime: 37.2 },
  midday: { label: 'Midday', clock: 12.5, stillTime: 37.2 },
  dusk: { label: 'Late afternoon', clock: 16.5, stillTime: 37.2 },
  night: { label: 'Night', clock: 22.0, stillTime: 37.2 },
};

export const PRESET_ORDER = ['morning', 'midday', 'dusk', 'night'];
export const DEFAULT_PRESET = 'morning';
export const TRANSITION_SECONDS = 3.2;
