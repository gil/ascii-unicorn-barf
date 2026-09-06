// AstraStarField - stars streaming along a shape, morphing between three of
// them. No dependencies, no build step.
//
//   import { AstraStarField } from './astra-star-field.js';
//   const hero = new AstraStarField();                       // full-viewport
//   const hero = new AstraStarField({ container: '#hero' });
//
// Shapes: 'six' (a galaxy spiral that reads as the numeral 6), 'cursor', and
// 'knot'. Drag or use the arrow keys to rotate. Wheel or 1/2/3 changes shape.
//
// Every shape is a set of paths, and every star holds a position along one of
// them. The stars flow; the shape itself stays put. That is the motion in the
// original: on the cursor you can watch clumps travel around the outline, and
// the galaxy arms turn because their stars are running along them.
//
// Two renderers. 'glow' draws soft additive star sprites; 'ascii' draws the same
// field as text glyphs. Set with the `mode` option.

const TAU = Math.PI * 2;
const SVG_NS = 'http://www.w3.org/2000/svg';

// Traced from the vector artwork on the source page. Widths are in viewBox
// units and set how far stars scatter either side of the line.
const VECTOR_SHAPES = {
  cursor: {
    viewBox: [0, 0, 19, 19],
    width: 0.5,
    depth: 0.16,
    closed: true,
    flowScale: 1.8,
    paths: [
      'M9.60978 17.0223C9.24308 17.739 8.76808 18.189 8.18478 18.3723C7.60148 18.564 7.03478 18.4931 6.48478 18.1598C5.93478 17.8348 5.53061 17.314 5.27228 16.5973L0.672282 3.68478C0.497282 3.19312 0.455612 2.72645 0.547282 2.28478C0.638952 1.83478 0.838952 1.45561 1.14728 1.14728C1.45561 0.838948 1.83478 0.638949 2.28478 0.547279C2.73478 0.455619 3.20561 0.497279 3.69728 0.672279L16.6098 5.27228C17.3265 5.53062 17.8473 5.93478 18.1723 6.48478C18.5056 7.02648 18.5765 7.58898 18.3848 8.17228C18.2015 8.75558 17.7515 9.23058 17.0348 9.59728L12.1098 12.1098L9.60978 17.0223Z',
    ],
  },
  knot: {
    viewBox: [0, 0, 1726, 1538],
    width: 40,
    depth: 14,
    closed: false,
    flowScale: 1.5,
    paths: [
      'M1025.52 167.475C960.586 89.5754 862.821 40 753.477 40C557.968 40 399.477 198.491 399.477 394V737.278C399.477 757.119 409.975 775.478 427.074 785.541L851.477 1035.3',
      'M1465.07 608.95C1500.07 513.764 1494.12 404.309 1439.45 309.614C1341.69 140.298 1125.19 82.2866 955.872 180.041L658.585 351.68C641.402 361.6 630.752 379.872 630.587 399.712L626.49 892.135',
      'M1302.52 1210.35C1402.45 1193.06 1494.27 1133.18 1548.94 1038.49C1646.69 869.17 1588.68 652.667 1419.36 554.912L1122.08 383.273C1104.89 373.353 1083.75 373.265 1066.48 383.042L637.982 625.706',
      'M700.415 1370.27C765.351 1448.17 863.116 1497.74 972.461 1497.74C1167.97 1497.74 1326.46 1339.25 1326.46 1143.74V800.466C1326.46 780.625 1315.96 762.266 1298.86 752.203L874.461 502.444',
      'M260.866 928.794C225.871 1023.98 231.82 1133.44 286.492 1228.13C384.247 1397.45 600.75 1455.46 770.065 1357.7L1067.35 1186.06C1084.54 1176.14 1095.19 1157.87 1095.35 1138.03L1099.45 645.61',
      'M423.42 327.396C323.488 344.682 231.672 404.562 177 499.257C79.2456 668.573 137.257 885.076 306.573 982.83L603.861 1154.47C621.043 1164.39 642.192 1164.48 659.456 1154.7L1087.96 912.037',
    ],
  },
};

export const SHAPE_NAMES = ['six', 'cursor', 'knot'];
export const MODES = ['glow', 'ascii'];

// Star tints, warmest first. The reference field is mostly cool white with a
// scattering of amber, so the warm entries are drawn less often.
const TINTS = [
  [255, 186, 122],
  [255, 220, 178],
  [255, 246, 236],
  [226, 238, 255],
  [186, 212, 255],
];

const RAMPS = {
  standard: ' .:-=+*#%@',
  sparse: '  ..::;+*#',
  dense: ' .`\'",:;!ilI><~+?][}{1)(|/trxnuvczXYUJCQ0OZmwqpdbkhao*#MW&8%B@',
  blocks: ' ░▒▓█',
};

const SAMPLES = 512; // points each path is resampled to, evenly by arc length

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

const smooth = (t) => t * t * (3 - 2 * t);

// Deterministic RNG so a given particle count always builds the same field.
function makeRng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gauss(rng) {
  let u = 0;
  let v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * v);
}

// ---- paths --------------------------------------------------------------

// Resample a polyline to evenly spaced points, so a star's distance along it
// is just an array index. Everything downstream assumes constant arc spacing.
function makePath(raw, { closed = false, width = 0, widthEnd = null, depth = 0, bounds = true, flowScale = 1 }) {
  const n = raw.length / 2;
  const segs = closed ? n : n - 1;
  const cum = new Float64Array(segs + 1);
  for (let i = 1; i <= segs; i++) {
    const a = ((i - 1) % n) * 2;
    const b = (i % n) * 2;
    cum[i] = cum[i - 1] + Math.hypot(raw[b] - raw[a], raw[b + 1] - raw[a + 1]);
  }
  const total = cum[segs] || 1;
  const xy = new Float32Array(SAMPLES * 2);
  let seg = 0;
  for (let i = 0; i < SAMPLES; i++) {
    const target = (i / SAMPLES) * total;
    while (seg < segs - 1 && cum[seg + 1] < target) seg++;
    const span = cum[seg + 1] - cum[seg] || 1;
    const f = clamp((target - cum[seg]) / span, 0, 1);
    const a = (seg % n) * 2;
    const b = ((seg + 1) % n) * 2;
    xy[i * 2] = raw[a] + (raw[b] - raw[a]) * f;
    xy[i * 2 + 1] = raw[a + 1] + (raw[b + 1] - raw[a + 1]) * f;
  }
  return {
    xy,
    len: total,
    closed,
    width,
    widthEnd: widthEnd == null ? width : widthEnd,
    depth,
    bounds,
    flowScale,
  };
}

// Sample an SVG path with getPointAtLength, which walks curves by true arc
// length rather than by however the `d` string happens to be split up.
function sampleSvgPath(d, steps) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;';
  const el = document.createElementNS(SVG_NS, 'path');
  el.setAttribute('d', d);
  svg.appendChild(el);
  document.body.appendChild(svg);
  const total = el.getTotalLength();
  const out = new Float32Array(steps * 2);
  for (let i = 0; i < steps; i++) {
    const p = el.getPointAtLength((i / steps) * total);
    out[i * 2] = p.x;
    out[i * 2 + 1] = p.y;
  }
  svg.remove();
  return out;
}

function circlePath(radius, steps = 160) {
  const out = new Float32Array(steps * 2);
  for (let i = 0; i < steps; i++) {
    const a = (i / steps) * TAU;
    out[i * 2] = Math.cos(a) * radius;
    out[i * 2 + 1] = Math.sin(a) * radius;
  }
  return out;
}

// Galaxy spiral whose long outer arm sweeps up and right, so the silhouette
// reads as a 6. Winding is negative (angle falls as radius grows) to match the
// reference: tail at the top right, then over the top, down the left, around
// the bottom, and into the core from the right.
const SIX = {
  turns: 4.2,
  // Radius grows about 1.6x per turn, measured off the reference. Tighter than
  // this and the windings crowd the core with a huge gap at the rim; looser and
  // it reads as evenly spaced rings instead of a spiral.
  tightness: 0.076,
  tailAngle: 1.06,
  // The last stretch of the long arm swings wide of the coil instead of just
  // winding on. That flare is what opens the counter of the 6 and leaves the
  // black gap on the upper right; a plain spiral closes it up.
  tailStart: 0.9,
  tailFlare: 0.5,
  armReach: [1, 0.62], // how far out each arm runs, as a fraction of the winding
  armWeight: [0.44, 0.32],
  coreWeight: 0.12,
  haloWeight: 0.025,
};

function buildSix() {
  const span = SIX.turns * TAU;
  const phi = SIX.tailAngle + span;
  const r0 = Math.exp(-SIX.tightness * span);
  const paths = [];
  const weights = [];

  for (let arm = 0; arm < 2; arm++) {
    const reach = SIX.armReach[arm];
    const steps = 1200;
    const raw = new Float32Array(steps * 2);
    for (let i = 0; i < steps; i++) {
      const t = (i / (steps - 1)) * reach;
      const theta = t * span;
      const flare =
        1 + SIX.tailFlare * smooth(clamp((t - SIX.tailStart) / (1 - SIX.tailStart), 0, 1));
      const r = r0 * Math.exp(SIX.tightness * theta) * flare;
      const angle = phi - theta - (arm ? Math.PI : 0);
      raw[i * 2] = Math.cos(angle) * r;
      raw[i * 2 + 1] = Math.sin(angle) * r;
    }
    // Constant absolute width, deliberately. Winding spacing grows with radius,
    // so one fixed width blurs the crowded inner turns into a mottled disc while
    // leaving the outer arm and tail reading as single clean strokes.
    paths.push(makePath(raw, { closed: false, width: 0.021, depth: 0.022 }));
    weights.push(SIX.armWeight[arm]);
  }

  // Core and halo are rings, so their stars orbit rather than stream out and
  // have to be recycled.
  // The reference's middle is a dense mottled disc, not bare rings, so these
  // reach well out past the bulge to fill the space the arms wind through.
  const coreRings = 5;
  for (let i = 0; i < coreRings; i++) {
    const r = 0.008 + Math.pow(i / (coreRings - 1), 1.3) * 0.05;
    paths.push(makePath(circlePath(r), { closed: true, width: 0.014, depth: 0.014 }));
    weights.push(SIX.coreWeight / coreRings);
  }
  const haloRings = 4;
  for (let i = 0; i < haloRings; i++) {
    const r = 0.3 + (i / (haloRings - 1)) * 0.5;
    paths.push(makePath(circlePath(r), { closed: true, width: 0.13, depth: 0.06, bounds: false }));
    weights.push(SIX.haloWeight / haloRings);
  }

  return { paths, weights };
}

function buildVector(name) {
  const def = VECTOR_SHAPES[name];
  const paths = def.paths.map((d) =>
    makePath(sampleSvgPath(d, 1400), {
      closed: def.closed,
      width: def.width,
      depth: def.depth,
      flowScale: def.flowScale,
    })
  );
  // Longer strands get proportionally more stars, so density stays even.
  const total = paths.reduce((s, p) => s + p.len, 0);
  return { paths, weights: paths.map((p) => p.len / total) };
}

function percentile(values, p) {
  const s = Float64Array.from(values).sort();
  return s[Math.min(s.length - 1, Math.max(0, Math.round((s.length - 1) * p)))];
}

// Centre and scale every shape the same way, so morphs stay put and no shape
// arrives noticeably bigger than the others.
function normalizeShape(shape) {
  const xs = [];
  const ys = [];
  for (const p of shape.paths) {
    if (!p.bounds) continue;
    for (let i = 0; i < SAMPLES; i++) {
      xs.push(p.xy[i * 2]);
      ys.push(p.xy[i * 2 + 1]);
    }
  }
  const x0 = percentile(xs, 0.005);
  const x1 = percentile(xs, 0.995);
  const y0 = percentile(ys, 0.005);
  const y1 = percentile(ys, 0.995);
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const k = 1 / (Math.max((x1 - x0) / 2, (y1 - y0) / 2) || 1);
  for (const p of shape.paths) {
    for (let i = 0; i < SAMPLES; i++) {
      p.xy[i * 2] = (p.xy[i * 2] - cx) * k;
      p.xy[i * 2 + 1] = (p.xy[i * 2 + 1] - cy) * k;
    }
    p.len *= k;
    p.width *= k;
    p.widthEnd *= k;
    p.depth *= k;
  }
  return shape;
}

function buildShape(name) {
  const shape = name === 'six' ? buildSix() : buildVector(name);
  if (name !== 'six') {
    // SVG y runs down, ours runs up.
    for (const p of shape.paths) {
      for (let i = 0; i < SAMPLES; i++) p.xy[i * 2 + 1] = -p.xy[i * 2 + 1];
    }
  }
  return normalizeShape(shape);
}

// ---- star sprites -------------------------------------------------------

// One sprite per tint: a hot white pinpoint inside a wide, soft halo. Baked
// once at high resolution and scaled down per star, which is far cheaper than
// building a gradient per particle per frame.
const SPRITE_SIZE = 128;

function bakeStar([r, g, b]) {
  const canvas = document.createElement('canvas');
  canvas.width = SPRITE_SIZE;
  canvas.height = SPRITE_SIZE;
  const ctx = canvas.getContext('2d');
  const mid = SPRITE_SIZE / 2;
  const grad = ctx.createRadialGradient(mid, mid, 0, mid, mid, mid);
  // Kept deliberately faint past the core: these stack additively, and dozens
  // of overlapping halos blow out to white if the mid stops carry any weight.
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.04, 'rgba(255,255,255,0.8)');
  grad.addColorStop(0.09, `rgba(${r},${g},${b},0.3)`);
  grad.addColorStop(0.2, `rgba(${r},${g},${b},0.09)`);
  grad.addColorStop(0.45, `rgba(${r},${g},${b},0.03)`);
  grad.addColorStop(1, `rgba(${r},${g},${b},0)`);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, SPRITE_SIZE, SPRITE_SIZE);
  return canvas;
}

// Four-point diffraction spikes, drawn on top of the brightest stars only.
function bakeFlare([r, g, b]) {
  const canvas = document.createElement('canvas');
  canvas.width = SPRITE_SIZE;
  canvas.height = SPRITE_SIZE;
  const ctx = canvas.getContext('2d');
  const mid = SPRITE_SIZE / 2;
  for (const vertical of [false, true]) {
    const grad = vertical
      ? ctx.createLinearGradient(0, 0, 0, SPRITE_SIZE)
      : ctx.createLinearGradient(0, 0, SPRITE_SIZE, 0);
    grad.addColorStop(0, `rgba(${r},${g},${b},0)`);
    grad.addColorStop(0.44, `rgba(${r},${g},${b},0.22)`);
    grad.addColorStop(0.5, 'rgba(255,255,255,0.7)');
    grad.addColorStop(0.56, `rgba(${r},${g},${b},0.22)`);
    grad.addColorStop(1, `rgba(${r},${g},${b},0)`);
    ctx.fillStyle = grad;
    if (vertical) ctx.fillRect(mid - 0.9, 0, 1.8, SPRITE_SIZE);
    else ctx.fillRect(0, mid - 0.9, SPRITE_SIZE, 1.8);
  }
  return canvas;
}

export class AstraStarField {
  static DEFAULTS = {
    container: null,
    background: '#000000',
    mode: 'glow',
    shape: 'six',
    particles: 4400,
    zoom: 1,
    starScale: 1,
    exposure: 1,
    flowSpeed: 1,
    spinSpeed: 0,
    shimmer: 0.3,
    morphSpeed: 1,
    timeScale: 1,
    trail: 0.12,
    haze: 1,
    nebula: 0.35,
    bgStars: 120,
    warmth: 0.24,
    autoCycle: false,
    cycleSeconds: 9,
    labelLeft: '',
    labelRight: '',
    // ascii mode only
    glyphSize: 11,
    ramp: 'standard',
    glow: 0.22,
    reducedMotion: null,
    interactive: true,
    autoStart: true,
  };

  static OPTIONS = [
    { key: 'mode', label: 'mode', type: 'select', values: MODES },
    { key: 'shape', label: 'shape', type: 'select', values: SHAPE_NAMES },
    { key: 'particles', label: 'particles', type: 'range', min: 400, max: 12000, step: 100 },
    { key: 'flowSpeed', label: 'flow', type: 'range', min: 0, max: 4, step: 0.05 },
    { key: 'starScale', label: 'star size', type: 'range', min: 0.3, max: 2.5, step: 0.05 },
    { key: 'exposure', label: 'exposure', type: 'range', min: 0.3, max: 2.5, step: 0.05 },
    { key: 'zoom', label: 'zoom', type: 'range', min: 0.4, max: 2.4, step: 0.05 },
    { key: 'spinSpeed', label: 'idle tumble', type: 'range', min: 0, max: 0.8, step: 0.01 },
    { key: 'shimmer', label: 'shimmer', type: 'range', min: 0, max: 1, step: 0.01 },
    { key: 'trail', label: 'trail', type: 'range', min: 0, max: 0.95, step: 0.01 },
    { key: 'haze', label: 'arm haze', type: 'range', min: 0, max: 2, step: 0.05 },
    { key: 'nebula', label: 'nebula', type: 'range', min: 0, max: 1.5, step: 0.05 },
    { key: 'bgStars', label: 'field stars', type: 'range', min: 0, max: 900, step: 20 },
    { key: 'warmth', label: 'warm stars', type: 'range', min: 0, max: 1, step: 0.01 },
    { key: 'morphSpeed', label: 'morph speed', type: 'range', min: 0.2, max: 3, step: 0.05 },
    { key: 'autoCycle', label: 'auto cycle', type: 'boolean' },
    { key: 'glyphSize', label: 'glyph size (ascii)', type: 'range', min: 6, max: 26, step: 1 },
    { key: 'ramp', label: 'ramp (ascii)', type: 'select', values: Object.keys(RAMPS) },
    { key: 'background', label: 'background', type: 'color' },
  ];

  constructor(userOptions = {}) {
    this.opts = { ...AstraStarField.DEFAULTS, ...userOptions };

    this.canvas = document.createElement('canvas');
    this.canvas.style.cssText = 'display:block;width:100%;height:100%;';
    this.canvas.setAttribute('role', 'img');
    this.canvas.setAttribute(
      'aria-label',
      'A field of stars flowing along a shape. Drag or use the arrow keys to rotate it; scroll or press 1, 2, 3 to change the shape.'
    );
    this.ctx = this.canvas.getContext('2d', { alpha: false });
    this.motionQuery = matchMedia('(prefers-reduced-motion: reduce)');

    // Stars are drawn onto their own transparent layer so the trail can fade
    // without also fading the background behind it.
    this.field = document.createElement('canvas');
    this.fieldCtx = this.field.getContext('2d');

    this.sprites = TINTS.map(bakeStar);
    this.flares = TINTS.map(bakeFlare);

    const target = this.opts.container;
    const host =
      typeof target === 'string' ? document.querySelector(target) : target || null;
    if (host) {
      this.host = host;
      if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
    } else {
      this.host = document.createElement('div');
      this.host.style.cssText = 'position:fixed;inset:0;overflow:hidden;';
      document.body.appendChild(this.host);
    }
    this.host.style.background = this.opts.background;
    this.host.appendChild(this.canvas);

    // Rotation. Idle sits face-on; dragging tumbles it and the throw decays.
    this.yaw = 0;
    this.pitch = 0;
    this.yawVel = 0;
    this.pitchVel = 0;
    this.dragging = false;
    this.keys = new Set();

    this.shapes = new Map();
    this.assigns = new Map();
    this.current = this.opts.shape;
    this.morph = 1;

    this.flow = 0;
    this.time = 0;
    this.cycleClock = 0;
    this.lastFrame = 0;
    this.raf = 0;
    this.listeners = new Set();

    this._buildParticles();
    this._buildBackdrop();
    this._bindEvents();
    this._resize();

    if (this.opts.autoStart) this.start();
  }

  // ---- public API -------------------------------------------------------

  getOptions() {
    return { ...this.opts };
  }

  setOptions(partial) {
    for (const [k, v] of Object.entries(partial || {})) this.setOption(k, v);
  }

  setOption(key, value) {
    if (!(key in this.opts)) return;
    this.opts[key] = value;

    if (key === 'particles' || key === 'warmth') this._buildParticles();
    else if (key === 'bgStars') this._buildBackdrop();
    else if (key === 'glyphSize' || key === 'mode') this._resize();
    else if (key === 'background') this.host.style.background = value;
    else if (key === 'shape') this.setShape(value);

    for (const fn of this.listeners) fn(key, value);
  }

  onOptionChange(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  setShape(name, { immediate = false } = {}) {
    if (!SHAPE_NAMES.includes(name)) return;
    this._ensureShape(name);
    if (name === this.current && this.morph >= 1) return;
    // Freeze the visible positions, so an interrupted morph carries on from
    // where it actually is rather than snapping back.
    this.from.set(this.blend);
    this.fromFade.set(this.fade);
    this.current = name;
    this.opts.shape = name;
    this.morph = immediate ? 1 : 0;
    this.cycleClock = 0;
  }

  nextShape(step = 1) {
    const i = SHAPE_NAMES.indexOf(this.current);
    const next = SHAPE_NAMES[(i + step + SHAPE_NAMES.length * 2) % SHAPE_NAMES.length];
    this.setShape(next);
    for (const fn of this.listeners) fn('shape', next);
  }

  start() {
    if (this.raf) return;
    this.lastFrame = performance.now();
    const loop = (now) => {
      this.raf = requestAnimationFrame(loop);
      const dt = Math.min(0.05, (now - this.lastFrame) / 1000) || 0;
      this.lastFrame = now;
      this._step(dt * this.opts.timeScale);
      this._render(dt);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop() {
    if (!this.raf) return;
    cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  destroy() {
    this.stop();
    this._unbind();
    this.canvas.remove();
    this.listeners.clear();
  }

  // ---- particles --------------------------------------------------------

  _buildParticles() {
    const n = Math.max(200, Math.round(this.opts.particles));
    this.count = n;
    this.assigns.clear();

    const rng = makeRng(0x9e3779b9);
    this.mag = new Float32Array(n);
    this.tintIdx = new Uint8Array(n);
    this.lat = new Float32Array(n);
    this.zoff = new Float32Array(n);
    this.stagger = new Float32Array(n);
    this.phase = new Float32Array(n);

    const warmth = clamp(this.opts.warmth, 0, 1);
    for (let i = 0; i < n; i++) {
      // Most stars are faint dust; a steep curve leaves a handful of giants.
      this.mag[i] = Math.pow(rng(), 2.2);
      // Warm tints sit at the head of the table, cool ones at the tail. The
      // cool side leans blue rather than neutral, matching the reference.
      if (rng() < warmth) {
        this.tintIdx[i] = rng() < 0.5 ? 0 : 1;
      } else {
        const c = rng();
        this.tintIdx[i] = c < 0.3 ? 2 : c < 0.72 ? 3 : 4;
      }
      this.lat[i] = gauss(rng) * 0.5;
      this.zoff[i] = gauss(rng) * 0.5;
      this.stagger[i] = rng();
      this.phase[i] = rng() * TAU;
    }

    this.blend = new Float32Array(n * 3);
    this.fade = new Float32Array(n);
    this.from = new Float32Array(n * 3);
    this.fromFade = new Float32Array(n);
    this.target = new Float32Array(n * 3);
    this.targetFade = new Float32Array(n);

    this._ensureShape(this.current);
    this.morph = 1;
    this._evaluate(this.current, this.blend, this.fade);
    this.from.set(this.blend);
    this.fromFade.set(this.fade);
  }

  // Static specks scattered across the frame. They do not move with the
  // shape, which is what sells the field as sitting in real space.
  _buildBackdrop() {
    const n = Math.max(0, Math.round(this.opts.bgStars));
    const rng = makeRng(0x51ed270b);
    this.bg = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      this.bg[i * 4] = rng();
      this.bg[i * 4 + 1] = rng();
      this.bg[i * 4 + 2] = Math.pow(rng(), 2.4);
      this.bg[i * 4 + 3] = rng() < 0.16 ? 0 : 3;
    }
    this.bgCount = n;
    this.backdrop = null;
  }

  _ensureShape(name) {
    if (!this.shapes.has(name)) this.shapes.set(name, buildShape(name));
    const shape = this.shapes.get(name);
    if (!this.assigns.has(name)) this.assigns.set(name, this._assign(name, shape));
    return shape;
  }

  // Hand every star a path and a starting distance along it. Positions bunch
  // into clusters, so the lines read as knotty chains of stars rather than an
  // evenly dotted rule.
  _assign(name, shape) {
    const n = this.count;
    const rng = makeRng(0x1f123bb5 ^ Math.imul(name.length, 2654435761));
    const path = new Uint8Array(n);
    const u0 = new Float32Array(n);

    const cw = [];
    let acc = 0;
    for (const w of shape.weights) {
      acc += w;
      cw.push(acc);
    }
    const clusters = name === 'six' ? 150 : 110;

    for (let i = 0; i < n; i++) {
      const r = rng() * acc;
      let p = 0;
      while (p < cw.length - 1 && cw[p] < r) p++;
      path[i] = p;
      const c = (Math.floor(rng() * clusters) + gauss(rng) * 0.3) / clusters;
      u0[i] = c - Math.floor(c);
    }
    return { path, u0 };
  }

  // Place every star: walk it along its path by the shared flow distance, then
  // push it sideways and in depth by its own fixed jitter.
  _evaluate(name, out, fadeOut) {
    const shape = this._ensureShape(name);
    const a = this.assigns.get(name);
    const flow = this.flow;

    for (let i = 0; i < this.count; i++) {
      const p = shape.paths[a.path[i]];
      // Dividing by path length makes every star travel at the same speed in
      // world units, whatever the length of the line it is riding.
      let u = a.u0[i] + (flow * p.flowScale) / p.len;
      u -= Math.floor(u);

      const f = u * SAMPLES;
      const i0 = Math.floor(f) % SAMPLES;
      const i1 = (i0 + 1) % SAMPLES;
      const t = f - Math.floor(f);
      const x0 = p.xy[i0 * 2];
      const y0 = p.xy[i0 * 2 + 1];
      const dx = p.xy[i1 * 2] - x0;
      const dy = p.xy[i1 * 2 + 1] - y0;

      // Normal from the local tangent, so the scatter hugs the line.
      const tl = Math.hypot(dx, dy) || 1;
      const nx = -dy / tl;
      const ny = dx / tl;

      const width = p.width + (p.widthEnd - p.width) * u;
      const lat = this.lat[i] * width;
      out[i * 3] = x0 + dx * t + nx * lat;
      out[i * 3 + 1] = y0 + dy * t + ny * lat;
      out[i * 3 + 2] = this.zoff[i] * p.depth;

      // Open paths would pop as stars wrap from the end back to the start, so
      // fade them out over the last stretch and back in over the first.
      fadeOut[i] = p.closed ? 1 : smooth(clamp(Math.min(u, 1 - u) / 0.03, 0, 1));
    }
  }

  // ---- loop -------------------------------------------------------------

  _step(dt) {
    const reduced =
      this.opts.reducedMotion == null ? this.motionQuery.matches : !!this.opts.reducedMotion;
    const scale = reduced ? 0.25 : 1;
    this.time += dt * scale;
    // Negative: stars run inward along the arms, which is the direction the
    // reference turns. 0.03 world units a second is the pace measured off it.
    this.flow -= dt * scale * this.opts.flowSpeed * 0.025;

    let ax = 0;
    let ay = 0;
    if (this.keys.has('ArrowLeft')) ax -= 1;
    if (this.keys.has('ArrowRight')) ax += 1;
    if (this.keys.has('ArrowUp')) ay -= 1;
    if (this.keys.has('ArrowDown')) ay += 1;
    if (ax || ay) {
      this.yawVel += ax * 4.5 * dt;
      this.pitchVel += ay * 3.2 * dt;
    }

    if (!this.dragging) {
      const decay = Math.pow(0.06, dt);
      this.yawVel *= decay;
      this.pitchVel *= decay;
      this.yaw += this.opts.spinSpeed * scale * dt;
    }
    this.yaw += this.yawVel * dt;
    this.pitch = clamp(this.pitch + this.pitchVel * dt, -1.35, 1.35);

    if (this.morph < 1) {
      this.morph = Math.min(1, this.morph + dt * 0.55 * this.opts.morphSpeed);
    }

    if (this.opts.autoCycle && this.morph >= 1) {
      this.cycleClock += dt;
      if (this.cycleClock >= this.opts.cycleSeconds) this.nextShape(1);
    }

    this._blendPositions();
  }

  _blendPositions() {
    const out = this.blend;
    const fade = this.fade;
    const t = this.morph;

    if (t >= 1) {
      this._evaluate(this.current, out, fade);
      return;
    }

    const target = this.target;
    const targetFade = this.targetFade;
    this._evaluate(this.current, target, targetFade);

    const from = this.from;
    // Per-particle stagger spreads the swap over time; the mid-transit bulge
    // pushes stars outward so they arc rather than slide in straight lines.
    const spread = 0.45;
    for (let i = 0; i < this.count; i++) {
      const local = clamp(t * (1 + spread) - this.stagger[i] * spread, 0, 1);
      const e = smooth(local);
      const j = i * 3;
      const bulge = 1 + 0.34 * Math.sin(Math.PI * e);
      out[j] = (from[j] + (target[j] - from[j]) * e) * bulge;
      out[j + 1] = (from[j + 1] + (target[j + 1] - from[j + 1]) * e) * bulge;
      out[j + 2] = (from[j + 2] + (target[j + 2] - from[j + 2]) * e) * bulge;
      fade[i] = this.fromFade[i] + (targetFade[i] - this.fromFade[i]) * e;
    }
  }

  // ---- rendering --------------------------------------------------------

  _resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const rect = this.host.getBoundingClientRect();
    const w = Math.max(1, Math.round(rect.width));
    const h = Math.max(1, Math.round(rect.height));
    this.width = w;
    this.height = h;
    this.dpr = dpr;
    for (const c of [this.canvas, this.field]) {
      c.width = Math.round(w * dpr);
      c.height = Math.round(h * dpr);
    }
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.fieldCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.backdrop = null;

    if (this.opts.mode !== 'ascii') {
      this.lum = null;
      return;
    }

    const ctx = this.ctx;
    this.font = `${this.opts.glyphSize}px ui-monospace, SFMono-Regular, Menlo, Consolas, "Courier New", monospace`;
    ctx.font = this.font;
    ctx.textBaseline = 'top';
    this.cellW = Math.max(1, ctx.measureText('M').width);
    this.cellH = Math.max(1, this.opts.glyphSize * 1.08);
    this.cols = Math.max(1, Math.floor(w / this.cellW));
    this.rows = Math.max(1, Math.floor(h / this.cellH));
    this.offX = (w - this.cols * this.cellW) / 2;
    this.offY = (h - this.rows * this.cellH) / 2;
    this.lum = new Float32Array(this.cols * this.rows);
    this.tint = new Float32Array(this.cols * this.rows);
  }

  // Rotate, then project. Shared by both renderers.
  _project(i, cy, sy, cp, sp, radius, camera, focal) {
    const j = i * 3;
    const pts = this.blend;
    const x0 = pts[j];
    const y0 = pts[j + 1];
    const z0 = pts[j + 2];
    const x1 = x0 * cy + z0 * sy;
    const z1 = -x0 * sy + z0 * cy;
    const y2 = y0 * cp - z1 * sp;
    const z2 = y0 * sp + z1 * cp;
    const depth = camera - z2;
    if (depth <= 0.15) return null;
    const f = focal / depth;
    return {
      x: this.width / 2 + x1 * f * radius,
      y: this.height / 2 - y2 * f * radius,
      near: f / (focal / camera),
    };
  }

  _render(dt = 1 / 60) {
    if (this.opts.mode === 'ascii') this._renderAscii(dt);
    else this._renderGlow(dt);
    this._renderLabels();
  }

  _renderGlow(dt) {
    const { ctx, fieldCtx: fx, width: w, height: h } = this;

    // Fade the star layer's alpha instead of clearing it, so motion smears.
    const trail = clamp(this.opts.trail, 0, 0.95);
    if (trail <= 0) {
      fx.clearRect(0, 0, w, h);
    } else {
      const keep = Math.exp(-dt / (trail * 0.35));
      fx.save();
      fx.globalCompositeOperation = 'destination-out';
      fx.fillStyle = `rgba(0,0,0,${(1 - keep).toFixed(4)})`;
      fx.fillRect(0, 0, w, h);
      fx.restore();
    }

    const cy = Math.cos(this.yaw);
    const sy = Math.sin(this.yaw);
    const cp = Math.cos(this.pitch);
    const sp = Math.sin(this.pitch);
    const camera = 3.2;
    const focal = 2.6;
    const radius = Math.min(w, h) * 0.46 * this.opts.zoom;
    // Star sizes are authored against a 900px viewport and scaled from there,
    // so the field looks the same on a laptop and on a wall display.
    const unit = (Math.min(w, h) / 900) * this.opts.starScale;
    const exposure = this.opts.exposure;
    const shimmer = this.opts.shimmer;
    const haze = clamp(this.opts.haze, 0, 2);

    fx.save();
    fx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < this.count; i++) {
      const p = this._project(i, cy, sy, cp, sp, radius, camera, focal);
      if (!p) continue;
      const mag = this.mag[i];
      const twinkle = 1 + shimmer * 0.55 * Math.sin(this.time * 2.1 + this.phase[i]);
      // Diameter of the whole sprite, halo included. The gradient puts the
      // bright pinpoint inside the first tenth of it.
      const size = unit * (1.8 + 34 * mag * mag * mag) * p.near;
      if (size < 0.4) continue;
      if (p.x < -size || p.x > w + size || p.y < -size || p.y > h + size) continue;

      const alpha = clamp(
        (0.2 + 0.55 * Math.pow(mag, 0.7)) * twinkle * p.near * p.near * exposure * this.fade[i],
        0,
        1
      );
      if (alpha <= 0.004) continue;
      fx.globalAlpha = alpha;

      if (size < 3.4) {
        // Dust: a bare pixel is cheaper than a sprite and reads the same.
        const [r, g, b] = TINTS[this.tintIdx[i]];
        fx.fillStyle = `rgb(${r},${g},${b})`;
        const d = clamp(size * 0.55, 0.7, 1.9);
        fx.fillRect(p.x - d / 2, p.y - d / 2, d, d);
      } else {
        const sprite = this.sprites[this.tintIdx[i]];
        fx.drawImage(sprite, p.x - size / 2, p.y - size / 2, size, size);
        // A second, far wider copy at a trace of the alpha. Individually it is
        // invisible; across a whole arm it accumulates into the milky haze the
        // reference has hanging around the shape.
        if (haze > 0 && size > 5) {
          const wide = size * 5;
          fx.globalAlpha = alpha * 0.05 * haze;
          fx.drawImage(sprite, p.x - wide / 2, p.y - wide / 2, wide, wide);
          fx.globalAlpha = alpha;
        }
        // Diffraction spikes on the brightest handful only.
        if (mag > 0.997) {
          const flare = size * 2.4;
          fx.globalAlpha = alpha * 0.4;
          fx.drawImage(this.flares[this.tintIdx[i]], p.x - flare / 2, p.y - flare / 2, flare, flare);
        }
      }
    }
    fx.restore();

    this._drawBackdrop();
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(this.field, 0, 0);
    ctx.restore();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }

  _drawBackdrop() {
    const { ctx, width: w, height: h } = this;
    if (!this.backdrop) {
      // The base plate never changes between frames, so bake it once.
      const c = document.createElement('canvas');
      c.width = this.canvas.width;
      c.height = this.canvas.height;
      const b = c.getContext('2d');
      b.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      b.fillStyle = this.opts.background;
      b.fillRect(0, 0, w, h);

      const neb = clamp(this.opts.nebula, 0, 1.5);
      if (neb > 0) {
        const g = b.createRadialGradient(w / 2, h * 0.48, 0, w / 2, h * 0.48, Math.min(w, h) * 0.46);
        g.addColorStop(0, `rgba(150,165,190,${(0.07 * neb).toFixed(4)})`);
        g.addColorStop(0.32, `rgba(120,135,160,${(0.02 * neb).toFixed(4)})`);
        g.addColorStop(1, 'rgba(90,105,130,0)');
        b.fillStyle = g;
        b.fillRect(0, 0, w, h);
      }

      for (let i = 0; i < this.bgCount; i++) {
        const size = 0.6 + this.bg[i * 4 + 2] * 1.9;
        const [r, gg, bb] = TINTS[this.bg[i * 4 + 3]];
        b.globalAlpha = 0.12 + this.bg[i * 4 + 2] * 0.45;
        b.fillStyle = `rgb(${r},${gg},${bb})`;
        b.fillRect(this.bg[i * 4] * w, this.bg[i * 4 + 1] * h, size, size);
      }
      this.backdrop = c;
    }
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(this.backdrop, 0, 0);
    ctx.restore();
  }

  _renderAscii(dt) {
    const { ctx, cols, rows, lum, tint } = this;
    if (!lum) return;

    // Persistence instead of a hard clear gives the field its motion trail.
    // Written as an exponential moving average: the decay and the gain sum to
    // one, so a star that sits still lands at the same brightness whatever the
    // trail setting, and the frame rate does not change how bright things get.
    const trail = clamp(this.opts.trail, 0, 0.95);
    const decay = trail <= 0 ? 0 : Math.exp(-dt / (trail * 0.35));
    const gain = 1 - decay;
    if (decay <= 0) {
      lum.fill(0);
      tint.fill(0);
    } else {
      for (let i = 0; i < lum.length; i++) {
        lum[i] *= decay;
        tint[i] *= decay;
      }
    }

    const cy = Math.cos(this.yaw);
    const sy = Math.sin(this.yaw);
    const cp = Math.cos(this.pitch);
    const sp = Math.sin(this.pitch);
    const camera = 3.2;
    const focal = 2.6;
    const radius = Math.min(this.width, this.height) * 0.42 * this.opts.zoom;
    const glow = this.opts.glow;
    const shimmer = this.opts.shimmer;

    for (let i = 0; i < this.count; i++) {
      const p = this._project(i, cy, sy, cp, sp, radius, camera, focal);
      if (!p) continue;
      const col = Math.round((p.x - this.offX) / this.cellW);
      const row = Math.round((p.y - this.offY) / this.cellH);
      if (col < 0 || col >= cols || row < 0 || row >= rows) continue;

      const twinkle = 1 + shimmer * Math.sin(this.time * 2.1 + this.phase[i]);
      const b =
        (0.35 + 1.2 * this.mag[i]) * twinkle * p.near * p.near * 0.7 * gain * this.fade[i];
      const warm = this.tintIdx[i] < 2 ? 1 : 0;
      const idx = row * cols + col;
      lum[idx] += b;
      tint[idx] += b * warm;

      if (glow > 0) {
        const halo = b * glow * 0.34;
        if (col > 0) lum[idx - 1] += halo;
        if (col < cols - 1) lum[idx + 1] += halo;
        if (row > 0) lum[idx - cols] += halo * 0.7;
        if (row < rows - 1) lum[idx + cols] += halo * 0.7;
      }
    }

    ctx.fillStyle = this.opts.background;
    ctx.fillRect(0, 0, this.width, this.height);
    ctx.font = this.font;
    ctx.textBaseline = 'top';

    const ramp = RAMPS[this.opts.ramp] || RAMPS.standard;
    const last = ramp.length - 1;
    const exposure = this.opts.exposure;

    for (let row = 0; row < rows; row++) {
      const y = this.offY + row * this.cellH;
      for (let col = 0; col < cols; col++) {
        const idx = row * cols + col;
        const v = lum[idx] * exposure;
        if (v < 0.035) continue;
        // Soft knee rather than a hard clamp, so the bright core keeps detail.
        const level = Math.pow(1 - Math.exp(-v * 0.75), 0.75);
        const ci = Math.min(last, Math.max(1, Math.round(level * last)));
        const ch = ramp[ci];
        if (ch === ' ') continue;
        const warm = tint[idx] / lum[idx];
        const r = 232 + Math.round(23 * warm);
        const g = 238 - Math.round(18 * warm);
        const b = 255 - Math.round(72 * warm);
        ctx.fillStyle = `rgba(${r},${g},${b},${(0.36 + 0.64 * level).toFixed(3)})`;
        ctx.fillText(ch, this.offX + col * this.cellW, y);
      }
    }
  }

  _renderLabels() {
    const { labelLeft, labelRight } = this.opts;
    if (!labelLeft && !labelRight) return;
    const ctx = this.ctx;
    const size = Math.round(Math.min(this.width, this.height) * 0.12);
    ctx.save();
    ctx.font = `${size}px "Helvetica Neue", Helvetica, Arial, sans-serif`;
    ctx.fillStyle = 'rgba(255,255,255,0.95)';
    ctx.textBaseline = 'middle';
    const y = this.height / 2;
    const inset = Math.min(this.width, this.height) * 0.36;
    if (labelLeft) {
      ctx.textAlign = 'right';
      ctx.fillText(labelLeft, this.width / 2 - inset, y);
    }
    if (labelRight) {
      ctx.textAlign = 'left';
      ctx.fillText(labelRight, this.width / 2 + inset, y);
    }
    ctx.restore();
  }

  // ---- input ------------------------------------------------------------

  _bindEvents() {
    this._onResize = () => this._resize();
    window.addEventListener('resize', this._onResize);

    if (!this.opts.interactive) return;

    let lastX = 0;
    let lastY = 0;
    let pointerId = null;
    const interacted = () => this.host.dispatchEvent(new CustomEvent('astra:interact'));

    this._onDown = (e) => {
      pointerId = e.pointerId;
      this.dragging = true;
      lastX = e.clientX;
      lastY = e.clientY;
      this.canvas.setPointerCapture?.(pointerId);
      interacted();
    };
    this._onMove = (e) => {
      if (!this.dragging || e.pointerId !== pointerId) return;
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;
      const k = 3.2 / Math.min(this.width, this.height);
      this.yaw += dx * k * 2.4;
      this.pitch = clamp(this.pitch + dy * k * 2.0, -1.35, 1.35);
      this.yawVel = dx * k * 90;
      this.pitchVel = dy * k * 70;
    };
    this._onUp = (e) => {
      if (e.pointerId !== pointerId) return;
      this.dragging = false;
      pointerId = null;
    };

    let wheelLock = 0;
    this._onWheel = (e) => {
      const now = performance.now();
      if (now - wheelLock < 650 || Math.abs(e.deltaY) < 8) return;
      wheelLock = now;
      this.nextShape(e.deltaY > 0 ? 1 : -1);
      interacted();
    };

    this._onKeyDown = (e) => {
      if (e.key.startsWith('Arrow')) {
        this.keys.add(e.key);
        e.preventDefault();
        interacted();
      } else if (e.key >= '1' && e.key <= '3') {
        this.setShape(SHAPE_NAMES[Number(e.key) - 1]);
        for (const fn of this.listeners) fn('shape', this.current);
        interacted();
      } else if (e.key === ' ') {
        this.nextShape(1);
        e.preventDefault();
        interacted();
      }
    };
    this._onKeyUp = (e) => this.keys.delete(e.key);

    this.canvas.style.touchAction = 'none';
    this.canvas.style.cursor = 'grab';
    this.canvas.addEventListener('pointerdown', this._onDown);
    window.addEventListener('pointermove', this._onMove);
    window.addEventListener('pointerup', this._onUp);
    window.addEventListener('pointercancel', this._onUp);
    this.host.addEventListener('wheel', this._onWheel, { passive: true });
    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
  }

  _unbind() {
    window.removeEventListener('resize', this._onResize);
    if (!this.opts.interactive) return;
    this.canvas.removeEventListener('pointerdown', this._onDown);
    window.removeEventListener('pointermove', this._onMove);
    window.removeEventListener('pointerup', this._onUp);
    window.removeEventListener('pointercancel', this._onUp);
    this.host.removeEventListener('wheel', this._onWheel);
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('keyup', this._onKeyUp);
  }
}

export default AstraStarField;
