// SolAscii3DHero — standalone reimplementation of the GPT-5.6 hero animation.
//
// A pixel-space orthographic three.js scene that renders three celestial bodies
// (Sol, Terra, Luna) as fields of ASCII glyph points on Fibonacci spheres, with
// procedural surface shading, a per-glyph intro reveal, continuous spin, a shared
// atmospheric particle field, and pointer interaction. The four GLSL programs are
// lifted verbatim from the original bundle; the geometry generator, layout, and
// orchestration are ported from it. See .reference-chunk_8.js for the source.

// three.js (r180) is pulled from a CDN so the library is a zero-config drop-in:
// no import map or bundler needed. Change the URL here to pin a different build.
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.180.0/build/three.module.js';

/* ------------------------------------------------------------------ *
 * Constants (from BODY_CONFIGS / module scope in the original bundle) *
 * ------------------------------------------------------------------ */

const ASCII_GLYPHS = ['5', '.', '6'];
const BODY_IDS = ['sol', 'terra', 'luna'];
const BODY_KIND = { sol: 0, terra: 1, luna: 2 }; // GLYPH_REVEAL_FADE_SECONDS (0.32) is inlined in the body vertex shader

const BODY_CONFIGS = {
  sol:   { seed: 43,  axialTiltDegrees: 7.25,  surfaceFlowElevationAmplitude: 0.016 / 0.06, surfaceFlowSpeed: 0.07, baselineSpinRadiansPerSecond: 0.018 },
  terra: { seed: 131, axialTiltDegrees: 23.44, surfaceFlowElevationAmplitude: 0,            surfaceFlowSpeed: 0,    baselineSpinRadiansPerSecond: 0.026 },
  luna:  { seed: 269, axialTiltDegrees: 6.68,  surfaceFlowElevationAmplitude: 0,            surfaceFlowSpeed: 0,    baselineSpinRadiansPerSecond: 0.038 },
};

const ANGULAR_SIZE = { sol: 15.1, terra: 14.4, luna: 13.5 };
const DOT_FRACTION = { sol: 0.1876, terra: 0.192, luna: 0.198 };
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
const SURFACE_SPACING_SCALE = 0.76;
const SURFACE_SPACING_UNITS = 15;
const GLYPH_SCALE_BY_BODY = { luna: 0.82, sol: 0.76, terra: 0.78 };
const OPACITY = { luna: 1, sol: 1, terra: 1.12 };
const PALETTE = {
  luna: ['#68616f', '#aaa1b1', '#ddd5e2', '#f8f2fb'],
  sol: ['#ff7b22', '#ffad24', '#ffd65a', '#fff0a6'],
  terra: ['#3478e5', '#5bb9ff', '#68d69b', '#ecf8ff'],
};
const INTERACTION_RESPONSE = { luna: 0.06, sol: 1, terra: 0.18 };
const ROTATION_RESPONSE = { luna: 0.05, sol: 1, terra: 0.16 };
const ROTATION_ACTIVITY_SCALE = { sol: 1.15, terra: 0.9, luna: 0.72 };

const ATMOSPHERE = { atmosphere: '#ff9147', atmosphereAccent: '#ffe092', luna: '#d5cedf', terra: '#bce5ff' };
const EMISSION = { emissionPulseLifetimeSeconds: 5.2, glyphSizeBySceneSize: { desktop: 8.2, mobile: 7.8 }, opacity: 0.4, solRotationEmissionVelocityMultiplier: 1.7 };
const TINT = {
  luna: { color: '#c5bdcd', opacity: 0.12 },
  sol: { color: '#ffad24', opacity: 0.18 },
  terra: { color: '#4aa2f5', opacity: 0.165 },
};

const INTRO = {
  bodyById: {
    luna:  { delaySeconds: 0.08, fadeDurationSeconds: 0.5,  revealOffsetSeconds: 0.08 },
    sol:   { delaySeconds: 0,    fadeDurationSeconds: 0.52, revealOffsetSeconds: 0 },
    terra: { delaySeconds: 0.12, fadeDurationSeconds: 0.49, revealOffsetSeconds: 0.12 },
  },
  system: {
    durationSeconds: 1.4, fieldFadeDelaySeconds: 0.94, fieldFadePortion: 0.3, fieldStartMotionScale: 0.12,
    orbitAxis: [0, 0.84, 0.54], startOrbitRadiansBySceneSize: { desktop: 0.085, mobile: 0.16 }, startScale: 0.97,
  },
};

// Reference layouts (px). Body boxes scale by container width against these.
const REF_DESKTOP = { width: 1440, bodies: { sol: { width: 522, height: 538 }, terra: { width: 256, height: 264 }, luna: { width: 91, height: 95 } } };
const REF_MOBILE  = { width: 390,  bodies: { sol: { width: 245, height: 252 }, terra: { width: 118, height: 121 }, luna: { width: 47, height: 49 } } };
const CENTER_FRAC = { desktop: { luna: [0.88, 0.17], sol: [0.137, 0.526], terra: [0.813, 0.604] }, mobile: { luna: [0.86, 0.15], sol: [0.242, 0.27], terra: [0.808, 0.63] } };
const SIZE_SCALE = { desktop: { luna: 1.16, sol: 1, terra: 1 }, mobile: { luna: 1.16, sol: 1, terra: 1 } };

// Radial-gradient glow (extent + [radiusMultiple, mixPercent] stops) per body.
const GLOW = {
  luna:  { extent: 2,   stops: [[1, 1], [1.14, 2.5], [1.4, 1.3], [1.8, 0.3], [2, 0]] },
  sol:   { extent: 3.8, stops: [[1, 2.5], [1.08, 6.2], [1.35, 4], [2, 1.2], [3, 0.35], [3.8, 0]] },
  terra: { extent: 2.7, stops: [[1, 2.2], [1.12, 5.6], [1.35, 3], [2, 0.45], [2.7, 0]] },
};

/* --------------------- small math helpers --------------------- */

const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (t) => t * t * (3 - 2 * t);
const smoother = (e) => e * e * e * (e * (6 * e - 15) + 10);
const clamp01 = (e) => Math.min(Math.max(e, 0), 1);
const clampDt = (t) => (Number.isFinite(t) ? Math.min(Math.max(t, 0), 1 / 30) : 0);
const approach = (rate, dt) => -Math.expm1(-Math.max(rate, 0) * clampDt(dt)); // 1 - e^(-rate*dt)
const decayTo = (v, rate, dt) => v * Math.exp(-Math.max(rate, 0) * clampDt(dt));

function hash(e, t, i, a) {
  let r = Math.imul(e, 0x165667b1);
  r ^= Math.imul(t, 0x27d4eb2f);
  r ^= Math.imul(i, 0x7fffffff);
  r ^= Math.imul(a, 0x4bf19f61);
  r = Math.imul(r ^ (r >>> 13), 0x4bf19f61);
  return ((r ^ (r >>> 16)) >>> 0) / 0xffffffff;
}

function valueNoise(e, t, i, a) {
  const r = Math.floor(e), o = Math.floor(t), n = Math.floor(i);
  const cx = smooth(e - r), cy = smooth(t - o), cz = smooth(i - n);
  const m = (dx, dy, dz) => 2 * hash(r + dx, o + dy, n + dz, a) - 1;
  const c000 = m(0, 0, 0), c100 = m(1, 0, 0), c010 = m(0, 1, 0), c110 = m(1, 1, 0);
  const c001 = m(0, 0, 1), c101 = m(1, 0, 1), c011 = m(0, 1, 1), c111 = m(1, 1, 1);
  const x00 = lerp(c000, c100, cx), x10 = lerp(c010, c110, cx);
  const x01 = lerp(c001, c101, cx), x11 = lerp(c011, c111, cx);
  return lerp(lerp(x00, x10, cy), lerp(x01, x11, cy), cz);
}

const fbmTerm = (dir, freq, seed, amp, acc) => acc + valueNoise(dir[0] * freq, dir[1] * freq, dir[2] * freq, seed) * amp;
const tanhShape = (e) => Math.tanh(1.28 * e);
const normalize3 = ([e, t, i]) => { const a = Math.hypot(e, t, i); return a > 0 ? [e / a, t / a, i / a] : [0, 0, 1]; };

const CRATERS = [
  { center: normalize3([0.31, 0.54, 0.78]),   depth: 0.62, rimDistance: 0.1 },
  { center: normalize3([-0.72, 0.19, 0.66]),  depth: 0.5,  rimDistance: 0.14 },
  { center: normalize3([0.58, -0.7, 0.41]),   depth: 0.56, rimDistance: 0.12 },
  { center: normalize3([-0.15, -0.83, 0.54]), depth: 0.42, rimDistance: 0.085 },
  { center: normalize3([0.86, 0.38, -0.34]),  depth: 0.47, rimDistance: 0.17 },
  { center: normalize3([-0.48, 0.7, -0.52]),  depth: 0.38, rimDistance: 0.075 },
];

function elevationAt(dir, kind, seed) {
  if (kind === 'sol') {
    let t = fbmTerm(dir, 1.15, seed, 0.52, 0);
    t = fbmTerm(dir, 2.55, seed + 101, 0.31, t);
    t = fbmTerm(dir, 5, seed + 307, 0.17, t);
    return tanhShape(t);
  }
  if (kind === 'terra') {
    let t = fbmTerm(dir, 1.05, seed, 0.55, 0);
    t = fbmTerm(dir, 2.4, seed + 101, 0.23, t);
    const i = Math.max(0, 1 - Math.abs(valueNoise(7.2 * dir[0], 7.2 * dir[1], 7.2 * dir[2], seed + 977)));
    t += 0.22 * (i * i * i * 1.8 - 0.75);
    return tanhShape(t);
  }
  let r = fbmTerm(dir, 1.4, seed, 0.22, 0);
  r = fbmTerm(dir, 4.2, seed + 101, 0.1, r);
  for (const { center, depth, rimDistance } of CRATERS) {
    const a = Math.max(0, 1 - (dir[0] * center[0] + dir[1] * center[1] + dir[2] * center[2])) / rimDistance;
    const n = Math.exp(-a * a * 2.4);
    const l = a - 1;
    r += depth * (-n + 0.58 * Math.exp(-(l * l) / (0.34 * 0.34)));
  }
  return tanhShape(r);
}

const powShape = (e) => { const t = Math.min(Math.max(e, -1), 1); return Math.sign(t) * Math.pow(Math.abs(t), 0.62); };
const glyphSizeForElevation = (e) => lerp(0.04, 0.3, (powShape(e) + 1) / 2);
function glyphIndexFor(index, seed, selected, elev) {
  if (selected) return 1;
  const r = lerp(0.08, 0.92, (powShape(elev) + 1) / 2);
  return hash(index, seed, 29, seed + 947) < r ? 2 : 0;
}

/* -------- Poisson-spaced "dot" glyph selection over the sphere -------- */
function selectDots(normals, elevations, seed, fraction) {
  const r = elevations.length;
  const selectedFlags = new Uint8Array(r);
  const target = Math.min(r, Math.round(r * fraction));
  if (target === 0) return selectedFlags;

  const s = Math.sqrt((4 * Math.PI) / r);
  const minDistSq = (1.255 * s) * (1.255 * s);
  const cells = Math.max(1, Math.ceil(2 / (1.255 * s)));
  const gridHead = new Int32Array(cells ** 3).fill(-1);
  const selPoint = new Int32Array(target);          // grid slot -> point index
  const selNext = new Int32Array(target).fill(-1);  // grid slot -> next slot

  const cellOf = (v) => Math.min(cells - 1, Math.max(0, Math.floor(((v + 1) * cells) / 2)));
  const gridIndex = (x, y, z) => x + cells * (y + cells * z);

  const nearestSelectedDistSq = (pointIndex) => {
    const i3 = 3 * pointIndex;
    const px = normals[i3] ?? 0, py = normals[i3 + 1] ?? 0, pz = normals[i3 + 2] ?? 0;
    const cx = cellOf(px), cy = cellOf(py), cz = cellOf(pz);
    let best = Infinity;
    for (let dz = -1; dz <= 1; dz += 1) {
      const iz = cz + dz; if (iz < 0 || iz >= cells) continue;
      for (let dy = -1; dy <= 1; dy += 1) {
        const iy = cy + dy; if (iy < 0 || iy >= cells) continue;
        for (let dx = -1; dx <= 1; dx += 1) {
          const ix = cx + dx; if (ix < 0 || ix >= cells) continue;
          let slot = gridHead[gridIndex(ix, iy, iz)] ?? -1;
          while (slot >= 0) {
            const t = 3 * (selPoint[slot] ?? -1);
            const ax = (normals[t] ?? 0) - px, ay = (normals[t + 1] ?? 0) - py, az = (normals[t + 2] ?? 0) - pz;
            best = Math.min(best, ax * ax + ay * ay + az * az);
            slot = selNext[slot] ?? -1;
          }
        }
      }
    }
    return best;
  };

  const searchWindow = Math.max(8, Math.ceil(Math.sqrt(r)));
  const startAngle = hash(seed, 23, 59, seed) * Math.PI * 2;
  const candidateIdx = new Int32Array(12);
  const candidateScore = new Float64Array(candidateIdx.length);

  for (let a = 0; a < target; a += 1) {
    const cc = 1 - 2 * (a + 0.5) / target, ff = Math.sqrt(Math.max(0, 1 - cc * cc)), A = a * GOLDEN_ANGLE + startAngle;
    const fx = Math.cos(A) * ff, fz = Math.sin(A) * ff;
    const approxIndex = Math.round((1 - cc) * r / 2 - 0.5);
    const lo = Math.max(0, approxIndex - searchWindow), hi = Math.min(r, approxIndex + searchWindow + 1);
    candidateIdx.fill(-1); candidateScore.fill(Infinity);
    for (let p = lo; p < hi; p += 1) {
      if (selectedFlags[p]) continue;
      const sizeWeight = (glyphSizeForElevation(elevations[p] ?? 0) - 0.04) / 0.26;
      const o3 = 3 * p;
      const dx = (normals[o3] ?? 0) - fx, dy = (normals[o3 + 1] ?? 0) - cc, dz = (normals[o3 + 2] ?? 0) - fz;
      const distSq = dx * dx + dy * dy + dz * dz;
      if (distSq > s * s * 2.25) continue;
      const score = distSq - sizeWeight * s * s * 9.5 + hash(p, seed, 83, seed + 1333) * s * s * 0.035;
      if (score >= (candidateScore[candidateScore.length - 1] ?? Infinity)) continue;
      let q = candidateScore.length - 1;
      while (q > 0 && score < (candidateScore[q - 1] ?? score)) {
        candidateScore[q] = candidateScore[q - 1] ?? Infinity; candidateIdx[q] = candidateIdx[q - 1] ?? -1; q -= 1;
      }
      candidateScore[q] = score; candidateIdx[q] = p;
    }
    let chosen = -1, chosenScore = Infinity, chosenSpacing = -Infinity;
    for (let e = 0; e < candidateIdx.length; e += 1) {
      const idx = candidateIdx[e] ?? -1; if (idx < 0) continue;
      const score = candidateScore[e] ?? Infinity;
      const spacing = nearestSelectedDistSq(idx);
      const ok = spacing >= minDistSq, hadOk = chosenSpacing >= minDistSq;
      if (
        (ok && !hadOk) ||
        (ok && hadOk && (score < chosenScore - 1e-9 || (Math.abs(score - chosenScore) <= 1e-9 && spacing > chosenSpacing))) ||
        (!ok && !hadOk && (spacing > chosenSpacing + 1e-9 || (Math.abs(spacing - chosenSpacing) <= 1e-9 && score < chosenScore)))
      ) { chosen = idx; chosenScore = score; chosenSpacing = spacing; }
      if (ok) break;
    }
    if (chosen < 0) continue;
    selectedFlags[chosen] = 1; selPoint[a] = chosen;
    const t = 3 * chosen, cell = gridIndex(cellOf(normals[t] ?? 0), cellOf(normals[t + 1] ?? 0), cellOf(normals[t + 2] ?? 0));
    selNext[a] = gridHead[cell] ?? -1; gridHead[cell] = a;
  }
  return selectedFlags;
}

function createBodyGlyphGeometryData(kind, count, seed = BODY_CONFIGS[kind].seed, dotFraction = DOT_FRACTION[kind]) {
  const r = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
  const startAngle = hash(seed, 23, 59, seed) * Math.PI * 2;
  const elevations = new Float32Array(r);
  const glyphIndices = new Float32Array(r);
  const revealDelays = new Float32Array(r);
  const surfaceNormals = new Float32Array(3 * r);
  const elevF64 = new Float64Array(r);
  const normF64 = new Float64Array(3 * r);
  const dir = [0, 0, 1];
  for (let t = 0; t < r; t += 1) {
    const y = 1 - 2 * (t + 0.5) / r, ring = Math.sqrt(Math.max(0, 1 - y * y)), theta = t * GOLDEN_ANGLE + startAngle;
    dir[0] = Math.cos(theta) * ring; dir[1] = y; dir[2] = Math.sin(theta) * ring;
    const elev = elevationAt(dir, kind, seed), g = 3 * t;
    normF64[g] = dir[0]; normF64[g + 1] = dir[1]; normF64[g + 2] = dir[2];
    elevF64[t] = elev;
    surfaceNormals[g] = dir[0]; surfaceNormals[g + 1] = dir[1]; surfaceNormals[g + 2] = dir[2];
    elevations[t] = elev;
    revealDelays[t] = 0.48 * hash(t, seed, 71, seed + 1009);
  }
  const selected = selectDots(normF64, elevF64, seed, dotFraction);
  for (let e = 0; e < r; e += 1) glyphIndices[e] = glyphIndexFor(e, seed, selected[e] === 1, elevF64[e] ?? 0);
  return { count: r, elevations, glyphIndices, revealDelays, surfaceNormals };
}

/* --------------------- sizing + layout --------------------- */

function getSurfaceGlyphScale(width = 1440) {
  const w = Number.isFinite(width) ? Math.max(0, width) : 1440;
  if (w <= 390) return (w / 390) * 0.8;
  const i = Math.min(Math.max((w - 767) / (1440 - 767), 0), 1);
  return 0.8 + i * i * (3 - 2 * i) * 0.19999999999999996;
}
const getBodyGlyphSize = (bodyId, width = 1440) => ANGULAR_SIZE[bodyId] * getSurfaceGlyphScale(width);
const surfaceSpacing = (width = 1440) => SURFACE_SPACING_UNITS * getSurfaceGlyphScale(width) * SURFACE_SPACING_SCALE;
function bodyPointCount(radius, spacing) {
  const r = Number.isFinite(radius) ? Math.max(0, radius) : 0;
  const s = Number.isFinite(spacing) ? Math.max(0, spacing) : 0;
  return r === 0 || s === 0 ? 0 : Math.max(1, Math.round((4 * Math.PI * r * r) / (s * s)));
}
const withCenterRadius = (b) => ({ ...b, centerX: b.x + b.width / 2, centerY: b.y + b.height / 2, radius: Math.min(b.width, b.height) / 2 });

function bodyBox(bodyId, sceneSize, width) {
  const ref = sceneSize === 'mobile' ? REF_MOBILE : REF_DESKTOP;
  const rb = ref.bodies[bodyId];
  const o = Math.min(1, width / ref.width);
  const n = SIZE_SCALE[sceneSize][bodyId];
  if (sceneSize === 'desktop' || width <= REF_MOBILE.width) return { width: rb.width * o * n, height: rb.height * o * n };
  const l = smooth(clamp01((width - REF_MOBILE.width) / (767 - REF_MOBILE.width)));
  const s = REF_DESKTOP.bodies[bodyId], c = 768 / REF_DESKTOP.width, u = SIZE_SCALE.desktop[bodyId];
  const d = s.width * c * u, f = s.height * c * u, m = rb.width * n, h = rb.height * n;
  return { width: m + (d - m) * l, height: h + (f - h) * l };
}
function bodyCenterFrac(bodyId, sceneSize, width) {
  const a = CENTER_FRAC[sceneSize][bodyId];
  if (sceneSize === 'mobile') return a;
  const rm = CENTER_FRAC.mobile[bodyId];
  const o = smooth(clamp01((width - 767) / (REF_DESKTOP.width - 767)));
  return [rm[0] + (a[0] - rm[0]) * o, rm[1] + (a[1] - rm[1]) * o];
}
function computeLayout(width, height, direction = 'ltr') {
  const a = Math.max(0, width || 0), r = Math.max(0, height || 0);
  const sceneSize = a <= 767 ? 'mobile' : 'desktop';
  const bodies = {};
  for (const id of BODY_IDS) {
    const { width: bw, height: bh } = bodyBox(id, sceneSize, a);
    const [fx, fy] = bodyCenterFrac(id, sceneSize, a);
    bodies[id] = withCenterRadius({ x: fx * a - bw / 2, y: fy * r - bh / 2, width: bw, height: bh });
  }
  if (direction === 'rtl') for (const id of BODY_IDS) { const t = bodies[id]; bodies[id] = withCenterRadius({ ...t, x: a - t.x - t.width }); }
  return { direction, width: a, height: r, sceneSize, visualLayerOrder: ['sol', 'terra', 'luna'], bodies };
}

/* --------------------- shaders (verbatim) --------------------- */

const BODY_VERTEX = `
  attribute float aElevation;
  attribute float aGlyphIndex;
  attribute float aRevealDelay;

  uniform float uDevicePixelRatio;
  uniform float uGlyphSize;
  uniform float uIntroOpacity;
  uniform float uMaxPointSize;
  uniform float uOpacity;
  uniform float uRadius;
  uniform float uReducedMotion;
  uniform float uRevealTimeOffset;
  uniform float uSurfaceFlowElevationAmplitude;
  uniform float uSurfaceFlowSpeed;
  // x: weighted rotation, y: weighted interaction.
  uniform vec2 uSurfaceDynamics;
  uniform vec3 uSurfaceInteractionDirection;
  uniform vec3 uSurfacePalette[4];
  uniform float uTime;
  uniform vec2 uViewportSize;

  varying float vGlyphAlphaScale;
  varying float vGlyphIndex;
  // right.xy, up.xy in point-sprite coordinates, with screen Y pointing up.
  varying vec4 vProjectedGlyphBasis;
  varying vec3 vSurfaceColor;

  float solarSurfaceFlow(vec3 normal, float time) {
    float broad = sin(dot(normal, vec3(4.8, -3.2, 5.7)) + time);
    float folding = sin(dot(normal, vec3(-8.1, 6.4, 3.5)) - time * 0.62);
    float detail = cos(dot(normal, vec3(13.7, 9.2, -7.4)) + time * 0.37);
    float cells = broad * folding;
    return broad * 0.34 + folding * 0.24 + detail * 0.12 + cells * 0.30;
  }

  vec3 safeNormalize(vec3 value) {
    return value * inversesqrt(max(dot(value, value), 0.000001));
  }

  float waveField(vec3 point, vec3 directionA, vec3 directionB) {
    float primary = sin(dot(point, directionA));
    float secondary = cos(dot(point, directionB));
    return primary * 0.58 + secondary * 0.42;
  }

  float phasedWaveField(
    vec3 point,
    vec3 directionA,
    vec3 directionB,
    vec2 phase
  ) {
    float primary = sin(dot(point, directionA) + phase.x);
    float secondary = cos(dot(point, directionB) + phase.y);
    return primary * 0.58 + secondary * 0.42;
  }

  float interactionInfluence(vec3 normal) {
    float energy = clamp(uSurfaceDynamics.y, 0.0, 1.0);
    if (energy <= 0.0) return 0.0;
    return smoothstep(
      -0.22,
      0.86,
      dot(normal, uSurfaceInteractionDirection)
    ) * energy;
  }

  vec3 interactionWarp(vec3 normal, float influence, float strength) {
    if (influence <= 0.0) return normal;
    vec3 tangent = cross(uSurfaceInteractionDirection, normal);
    float directionPhase = dot(normal, vec3(7.3, -5.1, 6.7));
    float pulse = sin(directionPhase + uTime * 0.34) * 0.5 + 0.5;
    return safeNormalize(
      normal + tangent * influence * strength * mix(0.65, 1.0, pulse)
    );
  }

  vec3 solSurfaceColor(vec3 normal) {
    float interaction = interactionInfluence(normal);
    float rotation = clamp(uSurfaceDynamics.x, 0.0, 1.0);
    // Keep the storm's spatial basis fixed in object space so it turns with
    // the glyph lattice. Rotation adds energy below; it must not accelerate
    // or reorient the mask while the body is being spun.
    vec3 warpedNormal = interactionWarp(normal, interaction, 0.14);
    float motion = 1.0 - uReducedMotion;
    // A complete cycle remains slow, but three seconds now advances the
    // object-space convection enough to reward an attentive viewer.
    float stormPhase = uTime * motion * 0.10;
    float broadBands = phasedWaveField(
      warpedNormal,
      vec3(7.6, -4.2, 6.1),
      vec3(-5.4, 8.3, 4.7),
      vec2(stormPhase, -stormPhase * 0.73)
    );
    float convection = 0.5 + broadBands * 0.5;

    #if SURFACE_SHADER_QUALITY >= 2
      float folding = phasedWaveField(
        warpedNormal,
        vec3(13.4, 9.7, -8.2),
        vec3(-11.3, 7.2, 12.6),
        vec2(stormPhase * 0.56, -stormPhase * 0.41)
      );
      convection = clamp(
        convection * 0.68 + (0.5 + folding * 0.5) * 0.32,
        0.0,
        1.0
      );
    #endif

    #if SURFACE_SHADER_QUALITY >= 3
      float filaments = sin(
        dot(warpedNormal, vec3(24.7, -18.9, 21.4)) +
          broadBands * 2.2 - stormPhase * 0.58
      ) * 0.5 + 0.5;
      convection = mix(convection, filaments, 0.14 + interaction * 0.08);
    #endif

    // Sol remains gently active at rest. Interaction raises the same energy
    // ramp that drives source-particle births and velocity, pulsing the
    // object-space cells without sliding a camera-fixed mask over them.
    float baselinePulse = 0.15 +
      0.035 * sin(uTime * motion * 0.31 + broadBands * 0.7);
    float rotationPulse = baselinePulse +
      rotation * (1.0 - baselinePulse) *
        (0.88 + 0.12 * sin(uTime * motion * 0.72));
    float stormEnergy = clamp(
      rotationPulse + interaction * 0.32,
      0.0,
      1.0
    );
    float stormContrast = 1.0 +
      rotationPulse * 0.34 + interaction * 0.18;
    convection = clamp(
      (convection - 0.5) * stormContrast + 0.5,
      0.0,
      1.0
    );
    float hotCell = smoothstep(
      mix(0.76, 0.67, stormEnergy),
      0.98,
      convection
    );
    vec3 color = mix(uSurfacePalette[0], uSurfacePalette[1], convection);
    color = mix(
      color,
      uSurfacePalette[2],
      smoothstep(0.48, 0.88, convection)
    );
    color = mix(color, uSurfacePalette[3], hotCell);
    float energizedGlow = stormEnergy *
      smoothstep(0.54, 0.93, convection) * 0.22;
    return mix(color, uSurfacePalette[3], energizedGlow);
  }

  vec3 terraSurfaceColor(vec3 normal, float elevation) {
    float interaction = interactionInfluence(normal);
    float rotation = clamp(uSurfaceDynamics.x, 0.0, 1.0);
    float continentField = waveField(
      normal,
      vec3(3.8, 5.3, -4.6),
      vec3(-6.7, 3.1, 5.8)
    );

    #if SURFACE_SHADER_QUALITY >= 2
      float coastDetail = waveField(
        normal,
        vec3(9.1, -7.4, 8.6),
        vec3(7.7, 10.3, -6.2)
      );
      continentField += coastDetail * 0.28;
    #endif
    continentField += elevation * 0.2;

    float land = smoothstep(0.08, 0.27, continentField);
    float oceanLight = smoothstep(-0.82, 0.48, normal.y * 0.4 - normal.z * 0.2);
    vec3 color = mix(
      uSurfacePalette[0],
      uSurfacePalette[1],
      oceanLight
    );
    color = mix(color, uSurfacePalette[2], land);

    #if SURFACE_SHADER_QUALITY >= 2
      float motion = 1.0 - uReducedMotion;
      vec3 cloudNormal = interactionWarp(normal, interaction, 0.32);
      // Activity modulates contrast below, never absolute-time phase. The old
      // time * changing-rate expression rephased the entire map on pointer
      // down, which read as a surface flicker instead of added energy.
      float cloudTime = uTime * motion * 0.018;
      float cloudField = waveField(
        cloudNormal,
        vec3(12.2, 3.7, -9.4) + vec3(cloudTime),
        vec3(-8.8, 5.1, 13.6) - vec3(cloudTime * 0.67)
      );
      float latitudeBands = sin(cloudNormal.y * 21.0 + cloudField * 1.8);
      float clouds = smoothstep(
        mix(0.67, 0.62, rotation),
        mix(0.94, 0.91, rotation),
        cloudField * 0.56 + latitudeBands * 0.44
      );
      color = mix(
        color,
        uSurfacePalette[3],
        clouds * mix(0.74, 0.82, rotation)
      );
    #endif

    return color;
  }

  vec3 lunaSurfaceColor(vec3 normal, float elevation) {
    float interaction = interactionInfluence(normal);
    float rotation = clamp(uSurfaceDynamics.x, 0.0, 1.0);
    vec3 mottledNormal = interactionWarp(normal, interaction, 0.16);
    float surfaceTime = uTime * (1.0 - uReducedMotion) * 0.006;
    float broadMottling = waveField(
      mottledNormal,
      vec3(5.7, -7.9, 4.3) + vec3(surfaceTime),
      vec3(-8.6, 4.8, 7.1) - vec3(surfaceTime * 0.71)
    ) * 0.5 + 0.5;
    float relief = clamp(elevation * 0.34 + 0.5, 0.0, 1.0);
    float maria = smoothstep(
      mix(0.58, 0.55, rotation),
      mix(0.82, 0.79, rotation),
      broadMottling - relief * 0.18
    );
    vec3 color = mix(uSurfacePalette[1], uSurfacePalette[2], relief);
    color = mix(color, uSurfacePalette[0], maria * 0.82);

    #if SURFACE_SHADER_QUALITY >= 2
      float craterField = waveField(
        mottledNormal,
        vec3(15.4, 11.8, -13.1),
        vec3(-12.7, 17.2, 9.6)
      ) * 0.5 + 0.5;
      float craterRim = smoothstep(0.72, 0.8, craterField) *
        (1.0 - smoothstep(0.8, 0.9, craterField));
      color = mix(color, uSurfacePalette[3], craterRim * 0.7);
    #endif

    return color;
  }

  vec3 proceduralSurfaceColor(vec3 normal, float elevation) {
    #if BODY_KIND == 0
      return solSurfaceColor(normal);
    #elif BODY_KIND == 1
      return terraSurfaceColor(normal, elevation);
    #else
      return lunaSurfaceColor(normal, elevation);
    #endif
  }

  void main() {
    // Each point is one surface glyph. The former instanced quad evaluated all
    // procedural surface work at each of its four corners even though every
    // corner shared the same normal, elevation, reveal, and color.
    // The worker emits analytic unit Fibonacci normals. Avoid normalizing the
    // same immutable attribute for every frame of every body.
    vec3 localNormal = position;
    vec3 viewNormal = normalize(normalMatrix * localNormal);

    // Collapse the hidden hemisphere before surface flow, topography, tangent,
    // and projection work so those glyph points never reach rasterization.
    if (viewNormal.z <= 0.0) {
      vGlyphAlphaScale = 0.0;
      vGlyphIndex = aGlyphIndex;
      vProjectedGlyphBasis = vec4(1.0, 0.0, 0.0, 1.0);
      vSurfaceColor = vec3(0.0);
      gl_PointSize = 1.0;
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      return;
    }

    float surfaceActivity = step(
      0.00001,
      abs(uSurfaceFlowElevationAmplitude)
    );
    float animatedTime = uTime * (1.0 - uReducedMotion) * uSurfaceFlowSpeed;
    float surfaceFlow = 0.0;
    if (surfaceActivity > 0.0) {
      surfaceFlow = solarSurfaceFlow(localNormal, animatedTime);
    }
    float dynamicElevation = clamp(
      aElevation + surfaceFlow * uSurfaceFlowElevationAmplitude,
      -1.25,
      1.25
    );
    vec3 localCenter = localNormal * uRadius;
    vec4 viewCenter = modelViewMatrix * vec4(localCenter, 1.0);

    // A continuous typographic contour cue is deliberately carried in ink
    // rather than RGB. That keeps black-on-light and white-on-dark surfaces
    // perceptually symmetric, and avoids turning the ASCII body into a
    // conventionally shaded solid sphere. Four gently eased terraces produce
    // coherent plateaus without introducing hard thresholds that could pop on
    // Sol's moving surface.
    float reliefProgress = smoothstep(-0.72, 0.72, dynamicElevation);
    float terracedRelief = 0.25 * (
      smoothstep(0.12, 0.22, reliefProgress) +
      smoothstep(0.37, 0.47, reliefProgress) +
      smoothstep(0.62, 0.72, reliefProgress) +
      smoothstep(0.82, 0.92, reliefProgress)
    );
    float contourTerrace = 0.5 + 0.5 * cos(
      (dynamicElevation + 0.08) * 11.0
    );
    float topographyInk = clamp(
      0.72 +
        terracedRelief * 0.22 +
        contourTerrace * 0.03,
      0.72,
      1.0
    );

    vec3 glyphSurfaceNormal = viewNormal;
    vec3 tangentUp = vec3(0.0, 1.0, 0.0) -
      glyphSurfaceNormal * dot(
        vec3(0.0, 1.0, 0.0),
        glyphSurfaceNormal
      );
    if (dot(tangentUp, tangentUp) < 0.0001) {
      tangentUp = vec3(1.0, 0.0, 0.0) -
        glyphSurfaceNormal * dot(
          vec3(1.0, 0.0, 0.0),
          glyphSurfaceNormal
        );
    }
    tangentUp = normalize(tangentUp);
    vec3 tangentRight = cross(tangentUp, glyphSurfaceNormal);

    float spotPattern = -1.0;
    if (surfaceActivity > 0.0) {
      spotPattern = sin(dot(localNormal, vec3(10.4, -7.8, 6.1)) +
        animatedTime * 0.09);
      spotPattern *= cos(dot(localNormal, vec3(-5.7, 12.2, 8.6)) -
        animatedTime * 0.055);
    }

    // This projected affine basis is exact because the hero Canvas uses an
    // orthographic camera. A future perspective camera would require a
    // perspective-correct inverse map (or a different primitive).
    vec4 clipCenter = projectionMatrix * viewCenter;
    vec4 clipRight = projectionMatrix * vec4(
      tangentRight * uGlyphSize,
      0.0
    );
    vec4 clipUp = projectionMatrix * vec4(
      tangentUp * uGlyphSize,
      0.0
    );
    vec2 physicalViewport = max(uViewportSize, vec2(1.0)) *
      max(uDevicePixelRatio, 1.0);
    vec2 screenScale = physicalViewport * 0.5;
    vec2 projectedRight = clipRight.xy * screenScale;
    vec2 projectedUp = clipUp.xy * screenScale;
    vec2 projectedExtent = abs(projectedRight) + abs(projectedUp);
    float requestedPointSize = max(
      max(projectedExtent.x, projectedExtent.y),
      1.0
    );
    // The atlas glyphs occupy only the centered 78% of each cell. Crop the
    // transparent point footprint while preserving every visible glyph pixel.
    const float pointCropScale = 0.78;
    float pointSize = min(
      requestedPointSize,
      max(uMaxPointSize, 1.0)
    ) * pointCropScale;
    float croppedRequestedPointSize = requestedPointSize * pointCropScale;

    float revealTime = max(uTime - uRevealTimeOffset, 0.0);
    float reveal = smoothstep(
      aRevealDelay,
      aRevealDelay + 0.32,
      revealTime
    );
    reveal = mix(reveal, 1.0, uReducedMotion);
    float limbOpacity = smoothstep(0.07, 0.43, viewNormal.z);
    float frontOpacity = mix(
      0.93,
      1.0,
      smoothstep(0.43, 0.78, viewNormal.z)
    );
    float surfacePulse = surfaceActivity *
      smoothstep(0.52, 0.94, spotPattern);
    float sunspot = 1.0 - surfacePulse * 0.16;
    vGlyphAlphaScale = limbOpacity * frontOpacity * topographyInk *
      sunspot * reveal * uOpacity * uIntroOpacity;

    // The point itself is an axis-aligned bounding square. The fragment shader
    // inverse-maps its coordinates through this projected tangent basis, which
    // preserves the old camera-upright orientation and limb foreshortening.
    vGlyphIndex = aGlyphIndex;
    vProjectedGlyphBasis = vec4(
      projectedRight / croppedRequestedPointSize,
      projectedUp / croppedRequestedPointSize
    );
    vSurfaceColor = proceduralSurfaceColor(localNormal, dynamicElevation);
    gl_PointSize = max(pointSize, 1.0);
    gl_Position = clipCenter;
  }
`;
const BODY_FRAGMENT = `
  uniform sampler2D uAtlas;

  varying float vGlyphAlphaScale;
  varying float vGlyphIndex;
  varying vec4 vProjectedGlyphBasis;
  varying vec3 vSurfaceColor;

  vec2 atlasUv(float glyphIndex, vec2 glyphUv) {
    const float atlasColumns = 3.0;
    const float cellPadding = 0.02;
    vec2 insetUv = mix(
      vec2(cellPadding),
      vec2(1.0 - cellPadding),
      glyphUv
    );

    return vec2(
      (glyphIndex + insetUv.x) / atlasColumns,
      insetUv.y
    );
  }

  void main() {
    if (vGlyphAlphaScale <= 0.0) discard;

    // gl_PointCoord starts at the point's upper-left. Convert to a centered,
    // screen-Y-up offset, then inverse-map through the projected tangent basis
    // authored by the vertex. Pixels outside the resulting parallelogram are
    // the transparent padding of the point's axis-aligned bounding square.
    vec2 pointOffset = vec2(
      gl_PointCoord.x - 0.5,
      0.5 - gl_PointCoord.y
    );
    vec2 projectedRight = vProjectedGlyphBasis.xy;
    vec2 projectedUp = vProjectedGlyphBasis.zw;
    float basisDeterminant = projectedRight.x * projectedUp.y -
      projectedUp.x * projectedRight.y;
    if (abs(basisDeterminant) < 0.00001) discard;
    vec2 glyphOffset = vec2(
      projectedUp.y * pointOffset.x - projectedUp.x * pointOffset.y,
      -projectedRight.y * pointOffset.x +
        projectedRight.x * pointOffset.y
    ) / basisDeterminant;
    if (max(abs(glyphOffset.x), abs(glyphOffset.y)) > 0.5) discard;
    vec2 glyphUv = glyphOffset + 0.5;

    float sampledAlpha = texture2D(
      uAtlas,
      atlasUv(vGlyphIndex, glyphUv)
    ).a;
    float glyphAlpha = smoothstep(0.025, 0.68, sampledAlpha);
    if (glyphAlpha < 0.015) discard;

    float alpha = glyphAlpha * vGlyphAlphaScale;
    if (alpha < 0.01) discard;

    gl_FragColor = vec4(vSurfaceColor, alpha);
  }
`;
const BACKDROP_VERTEX = `
  attribute vec2 aEmissionSpawn;
  attribute vec3 aEffectSeed;
  attribute float aEffectKind;
  attribute float aGlyphIndex;
  attribute float aGlyphScale;
  attribute float aPhase;
  attribute float aSourceEmission;

  uniform float uBodyActivities[3];
  uniform float uBodyIntroOpacities[3];
  uniform vec3 uBodyPositions[3];
  uniform float uBodyRadii[3];
  uniform vec3 uBodyVelocities[3];
  uniform float uDevicePixelRatio;
  uniform float uEmissionPulseLifetime;
  uniform float uEmissionTime;
  uniform float uFieldOpacity;
  uniform float uFieldTime;
  uniform float uGlyphSize;
  uniform vec3 uInteractionAdvectiveVelocity;
  uniform float uInteractionEnergy;
  uniform vec3 uInteractionFlowAxis;
  uniform vec3 uInteractionPosition;
  uniform float uInteractionRadius;
  uniform float uInteractionWakeStrength;
  uniform float uMaxPointSize;
  uniform float uReducedMotion;
  uniform float uSystemScale;
  uniform float uSystemAxisAngle;
  uniform float uTrajectoryTime;
  uniform vec3 uVolumeCenter;
  uniform vec3 uVolumeSize;
  uniform float uWindSpread;

  varying vec4 vBodyClearanceCorners;
  varying float vDensity;
  varying float vFieldMix;
  varying float vGlyphIndex;
  varying float vLifecycle;
  varying float vPulse;

  const float TAU = 6.28318530718;

  vec3 safeNormalize(vec3 value) {
    return value * inversesqrt(max(dot(value, value), 0.000001));
  }

  // Dynamic force fields must go to zero continuously at their centers.
  // Normalizing those vectors would make an arbitrarily small crossing flip
  // a particle from full force in one direction to full force in the other.
  vec3 softNormalize(vec3 value, float softening) {
    return value * inversesqrt(
      dot(value, value) + max(softening * softening, 0.000001)
    );
  }

  float bodyMassWeight(int index) {
    if (index == 0) return 1.0;
    if (index == 1) return 0.82;
    return 0.68;
  }

  float bodyIntroOpacity(int index) {
    if (index == 0) return uBodyIntroOpacities[0];
    if (index == 1) return uBodyIntroOpacities[1];
    return uBodyIntroOpacities[2];
  }

  float lifecycleFade(float progress) {
    return smoothstep(0.0, 0.12, progress) *
      (1.0 - smoothstep(0.86, 1.0, progress));
  }

  float diffuseWindRate() {
    return 0.011 + (aEffectSeed.x * 0.5 + 0.5) * 0.008;
  }

  float structuredWindRate() {
    return 0.016 + (aEffectSeed.z * 0.5 + 0.5) * 0.012;
  }

  float sourceEmissionProgress(float windRate) {
    // The birth clock is sampled from the same monotonically integrated wind
    // clock that advances ambient particles. This keeps old and new glyphs in
    // one advecting volume when Sol adds energy instead of creating a fast,
    // independently timed overlay.
    float travelAge = max(uTrajectoryTime - aEmissionSpawn.y, 0.0);
    return travelAge * windRate;
  }

  float sourceEmissionLifecycle(float progress) {
    float age = uEmissionTime - aEmissionSpawn.x;
    float spawned = step(0.0, aEmissionSpawn.x) * step(0.0, age);
    float travelEnvelope = smoothstep(0.0, 0.006, progress) *
      (1.0 - smoothstep(0.82, 1.0, progress));
    float ageEnvelope = 1.0 - smoothstep(
      uEmissionPulseLifetime * 0.72,
      uEmissionPulseLifetime,
      age
    );
    return spawned * travelEnvelope * ageEnvelope;
  }

  float resolveWindProgress(
    float windRate,
    bool isSourceEmission,
    out float lifecycle
  ) {
    if (isSourceEmission) {
      float sourceProgress = sourceEmissionProgress(windRate);
      lifecycle = sourceEmissionLifecycle(sourceProgress);
      return min(sourceProgress, 1.08);
    }

    float ambientProgress = fract(
      aPhase / TAU + uTrajectoryTime * windRate
    );
    lifecycle = lifecycleFade(ambientProgress);
    return ambientProgress;
  }

  // zSeed in [-1, 1]. uWindSpread ~0 keeps the original near-planar disc; ~1 lifts
  // the z cosine across the full range so the wind radiates over a whole sphere.
  vec3 radialDirection(float angle, float zSeed) {
    float z = clamp(zSeed * uWindSpread, -0.999, 0.999);
    float r = sqrt(max(1e-4, 1.0 - z * z));
    return vec3(r * cos(angle), r * sin(angle), z);
  }

  float structuredWindAngle() {
    const float spokeCount = 18.0;
    float spokeIndex = floor(
      (aEffectSeed.y * 0.5 + 0.5) * spokeCount
    );
    return spokeIndex / spokeCount * TAU + aEffectSeed.x * 0.035;
  }

  vec3 diffuseWindPosition(
    float time,
    float progress
  ) {
    float radius = max(uBodyRadii[0], 0.0001);
    float fullAngle = (aEffectSeed.y * 0.5 + 0.5) * TAU;
    float broadSystemFan = uSystemAxisAngle + aEffectSeed.y * 2.05;
    float fanSelector = fract(sin(
      aPhase * 12.9898 + aEffectSeed.z * 78.233
    ) * 43758.5453);
    float angle = mix(
      fullAngle,
      broadSystemFan,
      step(0.42, fanSelector)
    ) + aEffectSeed.x * 0.14;
    vec3 direction = radialDirection(angle, aEffectSeed.z);
    vec3 tangent = safeNormalize(vec3(-direction.y, direction.x, 0.0));
    float travel = uVolumeSize.x * 1.16;
    float billow = sin(
      progress * 5.1 + aEffectSeed.x * 2.1 + time * 0.045
    );
    vec3 source = uBodyPositions[0] + direction * radius *
      (1.01 + (aEffectSeed.z * 0.5 + 0.5) * 0.12);
    return source + direction * travel * progress +
      tangent * radius * billow * (0.035 + progress * 0.1);
  }

  vec3 structuredWindPosition(
    float time,
    float progress
  ) {
    float radius = max(uBodyRadii[0], 0.0001);
    float angle = structuredWindAngle();
    vec3 direction = radialDirection(angle, aEffectSeed.z);
    vec3 tangent = safeNormalize(vec3(-direction.y, direction.x, 0.0));
    float travel = uVolumeSize.x * 1.18;
    float streamWave = sin(
      progress * 5.8 + angle * 0.7 + aEffectSeed.x * 0.16 - time * 0.07
    );
    vec3 source = uBodyPositions[0] + direction * radius *
      (1.01 + (aEffectSeed.z * 0.5 + 0.5) * 0.08);
    return source + direction * travel * progress +
      tangent * radius * streamWave * (0.03 + progress * 0.075);
  }

  vec3 sharedCurlDisplacement(vec3 point, float time) {
    vec3 scale = max(uVolumeSize, vec3(1.0));
    vec3 p = (point - uVolumeCenter) / scale;
    float slowTime = time * 0.07;
    vec3 curlLike = vec3(
      sin(p.y * 7.1 + slowTime) - cos(p.z * 8.3 - slowTime * 0.71),
      sin(p.z * 6.7 - slowTime * 0.83) - cos(p.x * 7.7 + slowTime),
      sin(p.x * 8.9 + slowTime * 0.61) - cos(p.y * 6.3 - slowTime)
    ) * 0.5;
    vec3 solarDelta = point - uBodyPositions[0];
    vec3 solarDirection = safeNormalize(solarDelta);
    vec3 solarTangent = safeNormalize(vec3(
      -solarDirection.y,
      solarDirection.x,
      solarDirection.z * 0.16
    ));
    float radialPhase = length(solarDelta.xy) / max(scale.x, 1.0) * 18.0;
    float outwardWave = sin(
      radialPhase - time * 0.24 + aEffectSeed.y * 1.3
    );
    float xyAmplitude = min(uVolumeSize.x, uVolumeSize.y) * 0.034;
    float curlStrength = aEffectKind < 0.5 ? 1.12 : 0.92;
    return curlLike * vec3(xyAmplitude, xyAmplitude, uVolumeSize.z * 0.1) *
      curlStrength +
      solarTangent * xyAmplitude * outwardWave * 0.62 +
      solarDirection * xyAmplitude * cos(radialPhase - time * 0.18) * 0.16;
  }

  vec3 bodyDisturbance(vec3 point, float time, out float fieldEnergy) {
    vec3 displacement = vec3(0.0);
    fieldEnergy = 0.0;
    float solarRadius = max(uBodyRadii[0], 0.0001);
    vec3 flowDirection = softNormalize(
      point - uBodyPositions[0],
      solarRadius * 0.08
    );

    for (int index = 0; index < 3; index += 1) {
      float bodyPresence = clamp(bodyIntroOpacity(index), 0.0, 1.0);
      float radius = max(uBodyRadii[index], 0.0001);
      vec3 fromBody = point - uBodyPositions[index];
      vec3 toBody = -fromBody;
      float centerDistance = max(length(fromBody), 0.0001);
      float distanceFromSurface = max(centerDistance - radius, 0.0);
      vec3 attractionDirection = softNormalize(toBody, radius * 0.14);
      vec3 transverseAttraction = attractionDirection - flowDirection *
        dot(attractionDirection, flowDirection);
      float softenedRadius = radius * 0.52;
      float gravityKernel = radius * radius /
        (centerDistance * centerDistance + softenedRadius * softenedRadius);
      float sourceEscape = 1.0;
      if (index == 0) {
        sourceEscape = smoothstep(radius * 1.04, radius * 1.82, centerDistance);
      }
      float gravityStrength = radius * 0.44 * gravityKernel *
        bodyMassWeight(index) * sourceEscape * bodyPresence;
      displacement += (
        attractionDirection * 0.32 + transverseAttraction * 0.68
      ) * gravityStrength;
      float longitudinalDistance = dot(fromBody, flowDirection);
      vec3 transverseOffset = fromBody -
        flowDirection * longitudinalDistance;
      float lensEnvelope = exp(
        -abs(longitudinalDistance) / (radius * 2.6) -
          length(transverseOffset) / (radius * 1.6)
      );
      displacement += transverseAttraction * radius * 0.085 *
        lensEnvelope * bodyMassWeight(index) * sourceEscape * bodyPresence;

      float rotationActivity = clamp(uBodyActivities[index], 0.0, 1.0);
      vec3 boundedAngularVelocity = uBodyVelocities[index];
      vec3 radialDirection = softNormalize(fromBody, radius * 0.12);
      // omega x radius is both physically coherent and continuous. Keeping
      // its magnitude (instead of normalizing it) lets the wake pass through
      // rest smoothly when a drag reverses direction.
      vec3 rotationalFlow = cross(
        boundedAngularVelocity,
        radialDirection
      );
      float activeWakeReach = index == 0 ? 2.1 : 2.85;
      float rotationalFalloff = exp(-distanceFromSurface /
        (radius * mix(1.65, activeWakeReach, rotationActivity)));
      float downstreamWake = 0.72 + 0.28 * smoothstep(
        -0.6,
        2.4,
        longitudinalDistance / radius
      );
      float fieldBreathing = 0.92 + 0.08 * sin(time * 0.42 + aPhase * 0.2);
      float activeWakeStrength = index == 0 ? 0.5 : 1.15;
      displacement += rotationalFlow * radius * 0.14 *
        (1.0 + rotationActivity * activeWakeStrength) *
        rotationalFalloff * downstreamWake * fieldBreathing * bodyPresence;
      fieldEnergy += (
        gravityKernel * bodyMassWeight(index) * 0.58 +
        min(length(rotationalFlow) * 0.14, 0.32) * rotationalFalloff *
          (1.0 + rotationActivity * 0.55)
      ) * bodyPresence;
    }

    fieldEnergy = clamp(fieldEnergy, 0.0, 1.0);
    return displacement;
  }

  vec3 interactionDisturbance(
    vec3 point,
    float time,
    out float interactionFieldEnergy
  ) {
    vec3 delta = point - uInteractionPosition;
    float radius = max(uInteractionRadius * 1.12, 1.0);
    vec3 flowAxis = uInteractionFlowAxis;
    float downstreamDistance = dot(delta, flowAxis);
    vec3 lateralDelta = delta - flowAxis * downstreamDistance;
    float distanceRatio = length(delta) / radius;
    float headFalloff = exp(-distanceRatio * distanceRatio * 1.65);
    float tailProgress = max(downstreamDistance, 0.0) / (radius * 4.2);
    float tailWidth = radius * (0.62 + min(tailProgress, 1.0) * 0.25);
    float downstreamGate = smoothstep(
      -radius * 0.16,
      radius * 0.24,
      downstreamDistance
    );
    float tailFalloff = downstreamGate * exp(
      -tailProgress * 1.1 -
        dot(lateralDelta, lateralDelta) /
          max(tailWidth * tailWidth, 0.0001)
    );
    float fieldEnvelope = headFalloff + tailFalloff * 0.82 *
      (1.0 - headFalloff);
    vec3 advectiveVelocity = uInteractionAdvectiveVelocity;
    float wakeStrength = uInteractionWakeStrength;
    float ripple = 0.92 + 0.08 * sin(
      distanceRatio * 3.1 - time * 0.22
    );

    // Use the unnormalized offset for the local swirl so it has zero force at
    // the cursor rather than reversing a unit vector across it. The advective
    // term likewise carries velocity magnitude through zero continuously.
    vec3 normalizedOffset = delta / radius;
    vec3 localSwirl = cross(
      vec3(0.0, 0.0, 1.0),
      normalizedOffset
    ) * radius * 0.11 * ripple * headFalloff;
    vec3 advectiveWake = advectiveVelocity * radius * 0.18 *
      fieldEnvelope;
    vec3 solarDrift = flowAxis * radius * 0.035 * tailFalloff;

    interactionFieldEnergy = clamp(
      fieldEnvelope * uInteractionEnergy * (0.7 + wakeStrength),
      0.0,
      1.0
    );
    return (localSwirl + advectiveWake + solarDrift) * uInteractionEnergy;
  }

  vec4 projectedBodyClearanceCorners(vec3 viewCenter, vec2 halfGlyph) {
    vec4 clearance = vec4(1.0);
    vec4 cornerX = viewCenter.x + vec4(
      -halfGlyph.x,
      halfGlyph.x,
      halfGlyph.x,
      -halfGlyph.x
    );
    vec4 cornerY = viewCenter.y + vec4(
      -halfGlyph.y,
      -halfGlyph.y,
      halfGlyph.y,
      halfGlyph.y
    );

    for (int index = 0; index < 3; index += 1) {
      float bodyPresence = clamp(bodyIntroOpacity(index), 0.0, 1.0);
      float radius = max(
        uBodyRadii[index] * max(uSystemScale, 0.0001),
        0.0001
      );
      vec3 bodyViewPosition = (
        modelViewMatrix * vec4(uBodyPositions[index], 1.0)
      ).xyz;
      vec4 deltaX = cornerX - bodyViewPosition.x;
      vec4 deltaY = cornerY - bodyViewPosition.y;
      vec4 projectedDistance = sqrt(
        deltaX * deltaX + deltaY * deltaY
      );

      // Every free-space glyph passes through the body's visual atmosphere,
      // including glyphs in front of its nominal depth. This avoids a crisp
      // front-depth exception at the limb while still making particles behind
      // a body substantially more occluded. Keep the mask analytic and
      // body-scaled: Sol gets the broadest envelope, while the glyph-size floor
      // prevents the smaller bodies from exposing a one-character cutoff.
      float relativeHaloReach = index == 0
        ? 0.50
        : (index == 1 ? 0.42 : 0.36);
      float haloFeather = max(
        uGlyphSize * 1.8,
        radius * relativeHaloReach
      );
      vec4 radialClearance = smoothstep(
        vec4(radius),
        vec4(radius + haloFeather),
        projectedDistance
      );
      vec4 frontSurfaceDepth = bodyViewPosition.z + sqrt(max(
        vec4(radius * radius) - projectedDistance * projectedDistance,
        vec4(0.0)
      ));
      float depthFeather = max(uGlyphSize, uVolumeSize.z * 0.03);
      vec4 behindBody = vec4(1.0) - smoothstep(
        frontSurfaceDepth - depthFeather,
        frontSurfaceDepth + depthFeather,
        vec4(viewCenter.z)
      );
      vec4 atmosphericOcclusion = mix(
        vec4(0.98),
        vec4(1.0),
        behindBody
      );
      clearance *= mix(
        vec4(1.0),
        mix(vec4(1.0), radialClearance, atmosphericOcclusion),
        vec4(bodyPresence)
      );
    }

    return clearance;
  }

  void cullAtmospherePoint() {
    vBodyClearanceCorners = vec4(0.0);
    vDensity = 0.0;
    vFieldMix = 0.0;
    vGlyphIndex = 0.0;
    vLifecycle = 0.0;
    vPulse = 0.0;
    gl_PointSize = 1.0;
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
  }

  void main() {
    // The particle layer is exactly transparent during its intro delay. This
    // uniform branch keeps all vertices on one path and avoids evaluating a
    // volume that cannot contribute to the frame.
    if (uFieldOpacity <= 0.0) {
      cullAtmospherePoint();
      return;
    }

    // Most source-emission instances are dormant reservoir slots. Cull them
    // before evaluating curl, body wakes, interaction forces, or projection.
    // Ambient instances have aSourceEmission = 0.0 and always continue.
    if (aSourceEmission > 0.5) {
      float sourceAge = uEmissionTime - aEmissionSpawn.x;
      if (
        aEmissionSpawn.x < 0.0 ||
        sourceAge < 0.0 ||
        sourceAge >= uEmissionPulseLifetime
      ) {
        cullAtmospherePoint();
        return;
      }
    }

    float animatedTime = uFieldTime * (1.0 - uReducedMotion);
    vec3 seedPosition;
    float lifecycle = 1.0;
    bool isSourceEmission = aSourceEmission > 0.5;
    float sourceMix = isSourceEmission ? 1.0 : 0.0;
    float windRate = aEffectKind < 0.5
      ? diffuseWindRate()
      : structuredWindRate();
    float progress = resolveWindProgress(
      windRate,
      isSourceEmission,
      lifecycle
    );
    if (aEffectKind < 0.5) {
      seedPosition = diffuseWindPosition(
        uTrajectoryTime,
        progress
      );
      vDensity = 0.62;
    } else {
      seedPosition = structuredWindPosition(
        uTrajectoryTime,
        progress
      );
      vDensity = 0.76;
    }

    vec3 curlDisplacement = sharedCurlDisplacement(seedPosition, animatedTime);
    float bodyFieldEnergy;
    vec3 bodyField = bodyDisturbance(
      seedPosition + curlDisplacement,
      animatedTime,
      bodyFieldEnergy
    );
    vec3 preInteractionPosition = seedPosition + curlDisplacement + bodyField;
    float interactionFieldEnergy = 0.0;
    vec3 interactionField = vec3(0.0);
    // Pointer energy is a coherent uniform, so idle particles can all bypass
    // the interaction wake without introducing divergent per-point branches.
    if (uInteractionEnergy > 0.0001) {
      interactionField = interactionDisturbance(
        preInteractionPosition,
        animatedTime,
        interactionFieldEnergy
      );
    }
    vec3 effectPosition = preInteractionPosition + interactionField;

    vec4 viewCenter = modelViewMatrix * vec4(effectPosition, 1.0);
    float fieldScale = 1.0 +
      clamp(bodyFieldEnergy + interactionFieldEnergy, 0.0, 1.0) * 0.18;
    float glyphSize = uGlyphSize * aGlyphScale * fieldScale;
    const float pointCropScale = 0.78;
    float requestedPointSize = glyphSize * max(uDevicePixelRatio, 1.0);
    float fullPointSize = min(
      requestedPointSize,
      max(uMaxPointSize, 1.0)
    );
    float pointSize = fullPointSize * pointCropScale;
    float renderedGlyphSize = fullPointSize /
      max(uDevicePixelRatio, 1.0);
    vec2 halfGlyph = vec2(renderedGlyphSize * 0.5);
    vec4 clipCenter = projectionMatrix * viewCenter;

    // The scene camera is orthographic, so a view-space half-glyph projects to
    // one constant clip-space padding. Expand it slightly before rejecting a
    // center to keep every potentially visible point on-screen.
    vec2 clipPadding = abs((
      projectionMatrix * vec4(halfGlyph, 0.0, 0.0)
    ).xy) * 1.05 + vec2(0.002);
    vec2 centerNdc = clipCenter.xy / max(abs(clipCenter.w), 0.000001);
    if (any(greaterThan(
      abs(centerNdc),
      vec2(1.0) + clipPadding
    ))) {
      cullAtmospherePoint();
      return;
    }

    // Keep the approved continuous atmospheric fade without evaluating the
    // complete fluid field four times. A point vertex samples only the four
    // lightweight clearance corners; the fragment shader blends them across
    // the glyph just as the former quad's vertex varyings did.
    vBodyClearanceCorners = projectedBodyClearanceCorners(
      viewCenter.xyz,
      halfGlyph
    );
    vDensity *= 1.0 + bodyFieldEnergy * 0.22 +
      interactionFieldEnergy * 0.14;
    vFieldMix = clamp(
      bodyFieldEnergy * 0.68 + interactionFieldEnergy +
        (aEffectKind > 0.5 ? 0.26 : 0.12) + sourceMix * 0.16,
      0.0,
      1.0
    );
    vGlyphIndex = aGlyphIndex;
    vLifecycle = lifecycle;
    vPulse = 0.86 + 0.14 * sin(animatedTime * 0.7 + aPhase);
    gl_PointSize = max(pointSize, 1.0);
    gl_Position = clipCenter;
  }
`;
const BACKDROP_FRAGMENT = `
  uniform sampler2D uAtlas;
  uniform vec3 uAccentColor;
  uniform vec3 uColor;
  uniform float uFieldOpacity;
  uniform float uOpacity;

  varying vec4 vBodyClearanceCorners;
  varying float vDensity;
  varying float vFieldMix;
  varying float vGlyphIndex;
  varying float vLifecycle;
  varying float vPulse;

  vec2 atlasUv(float glyphIndex, vec2 glyphUv) {
    const float atlasColumns = 3.0;
    const float cellPadding = 0.02;
    vec2 insetUv = mix(
      vec2(cellPadding),
      vec2(1.0 - cellPadding),
      glyphUv
    );
    return vec2(
      (glyphIndex + insetUv.x) / atlasColumns,
      insetUv.y
    );
  }

  void main() {
    // Source particles outside their one-shot lifecycle cannot contribute.
    // Reject them before paying for the atlas texture lookup.
    if (vLifecycle <= 0.0) discard;
    // WebGL point coordinates start at the upper-left; flip Y to match the
    // atlas UV convention used by the former camera-facing quads.
    vec2 glyphUv = vec2(gl_PointCoord.x, 1.0 - gl_PointCoord.y);
    const float pointCropScale = 0.78;
    vec2 uncroppedGlyphUv = vec2(0.5) +
      (glyphUv - vec2(0.5)) * pointCropScale;
    float sampledAlpha = texture2D(
      uAtlas,
      atlasUv(vGlyphIndex, uncroppedGlyphUv)
    ).a;
    if (sampledAlpha <= 0.02) discard;
    float lowerClearance = mix(
      vBodyClearanceCorners.x,
      vBodyClearanceCorners.y,
      uncroppedGlyphUv.x
    );
    float upperClearance = mix(
      vBodyClearanceCorners.w,
      vBodyClearanceCorners.z,
      uncroppedGlyphUv.x
    );
    float bodyClearance = mix(
      lowerClearance,
      upperClearance,
      uncroppedGlyphUv.y
    );
    float glyphAlpha = smoothstep(0.02, 0.62, sampledAlpha);
    float alpha = glyphAlpha * vPulse * vDensity * bodyClearance *
      vLifecycle * uOpacity * uFieldOpacity;
    if (alpha < 0.01) discard;
    vec3 color = mix(uColor, uAccentColor, 0.24 + vFieldMix * 0.58);
    gl_FragColor = vec4(color, alpha);
  }
`;

/* --------------------- glyph atlas --------------------- */
function createGlyphAtlas() {
  const canvas = document.createElement('canvas');
  canvas.width = 128 * ASCII_GLYPHS.length;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#fff';
  ctx.font = '500 92px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ASCII_GLYPHS.forEach((glyph, i) => ctx.fillText(glyph, 128 * i + 64, 66));
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.NoColorSpace;
  tex.generateMipmaps = true;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  return tex;
}

/* --------------------- atmospheric backdrop geometry --------------------- */
function buildBackdrop(count) {
  const total = Math.max(0, Math.floor(count));
  const ambientCount = Math.min(total, Math.ceil(total / 3));
  const reservoirCount = total - ambientCount;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(3 * total), 3));
  const seed3 = new Float32Array(3 * total), kind = new Float32Array(total), glyph = new Float32Array(total);
  const scale = new Float32Array(total), phase = new Float32Array(total), src = new Float32Array(total), spawn = new Float32Array(2 * total);
  let t = 566;
  const rand = () => { t = (Math.imul(t, 1664525) + 0x3c6ef35f) >>> 0; return t / 0x100000000; };
  for (let e = 0; e < total; e += 1) {
    seed3[3 * e] = 2 * rand() - 1; seed3[3 * e + 1] = 2 * rand() - 1; seed3[3 * e + 2] = 2 * rand() - 1;
    kind[e] = rand() < 0.7 ? 0 : 1;
    const tv = rand(); glyph[e] = tv < 0.45 ? 0 : tv < 0.55 ? 1 : 2;
    scale[e] = 0.94 + 0.62 * rand();
    phase[e] = rand() * Math.PI * 2;
    src[e] = e >= ambientCount ? 1 : 0;
    spawn[2 * e] = -1; spawn[2 * e + 1] = -1;
  }
  geo.setAttribute('aEffectSeed', new THREE.BufferAttribute(seed3, 3));
  geo.setAttribute('aEffectKind', new THREE.BufferAttribute(kind, 1));
  geo.setAttribute('aGlyphIndex', new THREE.BufferAttribute(glyph, 1));
  geo.setAttribute('aGlyphScale', new THREE.BufferAttribute(scale, 1));
  geo.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));
  geo.setAttribute('aSourceEmission', new THREE.BufferAttribute(src, 1));
  const spawnAttr = new THREE.BufferAttribute(spawn, 2);
  spawnAttr.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('aEmissionSpawn', spawnAttr);
  geo.setDrawRange(0, ambientCount);
  const src0 = new THREE.BufferGeometry(), src1 = new THREE.BufferGeometry();
  for (const g of [src0, src1]) for (const [name, attr] of Object.entries(geo.attributes)) g.setAttribute(name, attr);
  src0.setDrawRange(ambientCount, 0); src1.setDrawRange(ambientCount, 0);
  return { ambientGeometry: geo, reservoirStartIndex: ambientCount, reservoirCount, sourceGeometries: [src0, src1], spawnAttribute: spawnAttr };
}

function ringRanges(start, count, head, active) {
  if (count <= 0 || active <= 0) return [{ count: 0, start }, { count: 0, start }];
  if (active >= count) return [{ count, start }, { count: 0, start }];
  const r = (head - active + count) % count;
  return r < head ? [{ count: active, start: start + r }, { count: 0, start }] : [{ count: head, start }, { count: count - r, start: start + r }];
}

/* --------------------- body rotation --------------------- */
const tiltAxisFromDeg = (deg) => { const t = deg * Math.PI / 180; return [Math.sin(t), Math.cos(t), 0]; };
// A free (sun-like) spin axis leaves drag unconstrained; others project onto the tilt axis.
const projectToTilt = (axis, free, v) => { if (free) return [...v]; const d = v[0] * axis[0] + v[1] * axis[1] + v[2] * axis[2]; return [axis[0] * d, axis[1] * d, axis[2] * d]; };
function screenToAngular(axis, free, sx, sy, k) {
  const r = Number.isFinite(sx) ? sx : 0, o = Number.isFinite(sy) ? sy : 0, n = Math.max(0, k);
  if (free) return [o * n, r * n, 0];
  const s = (r * axis[1] + o * axis[0]) * n;
  return [axis[0] * s, axis[1] * s, axis[2] * s];
}

/* --------------------- bodies + orbit specs --------------------- */

// Per-body glow presets. Default (static) mode reproduces the original three; orbit
// planets derive a modest glow from their palette.
const DEFAULT_GLOW = {
  sol:   { extent: GLOW.sol.extent, stops: GLOW.sol.stops, inner: '#fff0c9', outer: '#f3a343', color: TINT.sol.color, opacity: TINT.sol.opacity },
  terra: { extent: GLOW.terra.extent, stops: GLOW.terra.stops, inner: ATMOSPHERE.terra, outer: ATMOSPHERE.terra, color: TINT.terra.color, opacity: TINT.terra.opacity },
  luna:  { extent: GLOW.luna.extent, stops: GLOW.luna.stops, inner: ATMOSPHERE.luna, outer: ATMOSPHERE.luna, color: TINT.luna.color, opacity: TINT.luna.opacity },
};
const planetGlow = (kind, palette, isSun) => isSun
  ? DEFAULT_GLOW.sol
  : { extent: GLOW[kind].extent, stops: GLOW[kind].stops, inner: palette[3], outer: palette[1], color: palette[1], opacity: 0.13 };

// Orbit layout. sizeRel and orbit.r are fractions of ORBIT_REF_HALF (a stable
// reference half-min-dimension); period is relative to Earth = 1. Sizes/spacing
// are compressed from reality so the whole system stays on screen and legible.
const ORBIT_REF_HALF = 420;
const ORBIT_SPACING = 6;             // px glyph spacing used to mesh orbit bodies (denser than default)
const ORBIT_GLYPH_SIZE = 7;          // px glyph size at the reference scale
const ORBIT_PLANE_TILT = 27 * Math.PI / 180; // ellipse flatness / depth of the orbital plane
const ORBIT_BASE_RATE = (2 * Math.PI) / 34;  // Earth completes an orbit in ~34s at orbitSpeed 1
const ORBIT_PERIOD_COMPRESS = 0.5;   // flatten the huge outer-planet periods so they still move

const SOLAR_SYSTEM = [
  { key: 'sun',     kind: 'sol',   isSun: true, sizeRel: 0.15,  seed: 43,  palette: PALETTE.sol, glyphScale: 0.72, tiltDeg: 7.25, baselineSpin: 0.02, orbit: null },
  { key: 'mercury', kind: 'luna',  sizeRel: 0.028, seed: 911, palette: ['#3f3a34', '#6e655a', '#9a8f7f', '#cbbfa9'], baselineSpin: 0.05,  tiltDeg: 0.03, orbit: { r: 0.24, period: 0.24, phase: 0.4 } },
  { key: 'venus',   kind: 'terra', sizeRel: 0.04,  seed: 733, palette: ['#8a6a2f', '#c8a24a', '#e6cf8f', '#fdf3d0'], baselineSpin: 0.03,  tiltDeg: 2.6,  orbit: { r: 0.33, period: 0.62, phase: 2.1 } },
  { key: 'earth',   kind: 'terra', sizeRel: 0.043, seed: 131, palette: PALETTE.terra, baselineSpin: 0.06,  tiltDeg: 23.44, orbit: { r: 0.45, period: 1, phase: 0.9 } },
  { key: 'moon',    kind: 'luna',  sizeRel: 0.016, seed: 269, palette: PALETTE.luna, baselineSpin: 0.04,  tiltDeg: 6.68, parent: 'earth', orbit: { r: 0.08, period: 0.16, phase: 1.4 } },
  { key: 'mars',    kind: 'luna',  sizeRel: 0.033, seed: 457, palette: ['#5a2a18', '#8a3f22', '#b56a3e', '#e0a878'], baselineSpin: 0.058, tiltDeg: 25, orbit: { r: 0.57, period: 1.88, phase: 3.4 } },
  { key: 'jupiter', kind: 'terra', sizeRel: 0.092, seed: 601, palette: ['#7a4a26', '#c78a4f', '#e3b98a', '#f5e6cf'], baselineSpin: 0.11,  tiltDeg: 3,  orbit: { r: 0.7, period: 11.86, phase: 5.2 } },
  { key: 'saturn',  kind: 'terra', sizeRel: 0.078, seed: 307, palette: ['#8a6b3a', '#c2a061', '#e2c98f', '#f7ecca'], baselineSpin: 0.1,   tiltDeg: 26.7, orbit: { r: 0.82, period: 29.4, phase: 1.7 } },
  { key: 'uranus',  kind: 'terra', sizeRel: 0.055, seed: 829, palette: ['#2f7d86', '#5bb6bf', '#9fe0e2', '#e8fbfb'], baselineSpin: 0.07,  tiltDeg: 97, orbit: { r: 0.9, period: 84, phase: 4.0 } },
  { key: 'neptune', kind: 'terra', sizeRel: 0.052, seed: 389, palette: ['#1b3aa0', '#2f66d6', '#5b9bf0', '#cfe4ff'], baselineSpin: 0.07,  tiltDeg: 28, orbit: { r: 0.97, period: 165, phase: 0.2 } },
];

function defaultBodySpecs() {
  return ['sol', 'terra', 'luna'].map((kind) => ({
    key: kind, kind, isSun: kind === 'sol', static: true, orbit: null, parent: null, sizeRel: 0,
    seed: BODY_CONFIGS[kind].seed, dotFraction: DOT_FRACTION[kind],
    palette: PALETTE[kind], opacity: OPACITY[kind], glyphScale: GLYPH_SCALE_BY_BODY[kind],
    tiltDeg: BODY_CONFIGS[kind].axialTiltDegrees, baselineSpin: BODY_CONFIGS[kind].baselineSpinRadiansPerSecond,
    surfaceFlowAmp: BODY_CONFIGS[kind].surfaceFlowElevationAmplitude, surfaceFlowSpeed: BODY_CONFIGS[kind].surfaceFlowSpeed,
    delay: INTRO.bodyById[kind].delaySeconds, fadeDuration: INTRO.bodyById[kind].fadeDurationSeconds, revealOffset: INTRO.bodyById[kind].revealOffsetSeconds,
    rotationResponse: ROTATION_RESPONSE[kind], interactionResponse: INTERACTION_RESPONSE[kind], rotationActivityScale: ROTATION_ACTIVITY_SCALE[kind],
    glow: DEFAULT_GLOW[kind],
  }));
}

function orbitBodySpecs() {
  return SOLAR_SYSTEM.map((b, i) => ({
    key: b.key, kind: b.kind, isSun: !!b.isSun, static: false, sizeRel: b.sizeRel,
    orbit: b.orbit ? { ...b.orbit } : null, parent: b.parent || null,
    seed: b.seed, dotFraction: DOT_FRACTION[b.kind],
    palette: b.palette, opacity: b.opacity ?? 1, glyphScale: b.glyphScale ?? GLYPH_SCALE_BY_BODY[b.kind],
    tiltDeg: b.tiltDeg ?? 0, baselineSpin: b.baselineSpin ?? 0.03,
    surfaceFlowAmp: b.isSun ? BODY_CONFIGS.sol.surfaceFlowElevationAmplitude : 0,
    surfaceFlowSpeed: b.isSun ? BODY_CONFIGS.sol.surfaceFlowSpeed : 0,
    delay: i * 0.04, fadeDuration: 0.5, revealOffset: i * 0.03,
    rotationResponse: ROTATION_RESPONSE[b.kind], interactionResponse: INTERACTION_RESPONSE[b.kind], rotationActivityScale: ROTATION_ACTIVITY_SCALE[b.kind],
    glow: planetGlow(b.kind, b.palette, b.isSun),
  }));
}

/* --------------------- library shell --------------------- */

const DARK_BACKGROUND = '#05070d';

const DEFAULTS = {
  container: null,        // element or selector; defaults to document.body (full-viewport)
  background: null,       // CSS color for the backdrop; null => the default dark tone
  timeScale: 1,           // overall animation speed (surface flow, field, spin phase)
  spinSpeed: 1,           // extra multiplier on each body's baseline spin
  glyphSizeScale: 1,      // glyph point-size multiplier
  zoom: 1,                // orthographic camera zoom
  fieldOpacity: 0.4,      // atmospheric particle opacity (original default 0.4)
  glowOpacity: 1,         // CSS radial-gradient glow intensity
  reducedMotion: null,    // null => follow prefers-reduced-motion
  interactive: true,      // pointer drag / field stir
  orbit: false,           // orbit simulation (full solar system) vs the default 3-body composition
  orbitSpeed: 1,          // orbital revolution speed multiplier
  shaderQuality: 3,       // 0..3 procedural surface detail (construction-time only)
  autoStart: true,        // begin the render loop immediately
};

// Metadata so external UI (see sol-ascii-3d-panel.js) can build controls generically.
const OPTIONS = [
  { key: 'orbit', label: 'Orbit mode', type: 'boolean' },
  { key: 'orbitSpeed', label: 'Orbit speed', type: 'range', min: 0, max: 4, step: 0.1 },
  { key: 'timeScale', label: 'Animation speed', type: 'range', min: 0, max: 3, step: 0.05 },
  { key: 'spinSpeed', label: 'Spin speed', type: 'range', min: 0, max: 5, step: 0.1 },
  { key: 'glyphSizeScale', label: 'Glyph size', type: 'range', min: 0.4, max: 2, step: 0.05 },
  { key: 'zoom', label: 'Zoom', type: 'range', min: 0.5, max: 2, step: 0.05 },
  { key: 'fieldOpacity', label: 'Atmosphere', type: 'range', min: 0, max: 1, step: 0.02 },
  { key: 'glowOpacity', label: 'Glow', type: 'range', min: 0, max: 1.5, step: 0.05 },
  { key: 'background', label: 'Background', type: 'color' },
  { key: 'reducedMotion', label: 'Reduced motion', type: 'boolean' },
  { key: 'interactive', label: 'Interactive', type: 'boolean' },
];

const STYLE_ID = 'sol-ascii-3d-styles';
const STYLE_TEXT = `
.sa3d-scene { position: absolute; inset: 0; overflow: hidden; background: var(--sa3d-bg, #05070d); }
.sa3d-scene--fixed { position: fixed; }
.sa3d-artwork { position: absolute; inset: 0; }
.sa3d-backdrop { position: absolute; inset: 0; opacity: 0; transition: opacity 900ms cubic-bezier(0.22, 1, 0.36, 1); will-change: opacity; }
.sa3d-backdrop.is-visible { opacity: var(--sa3d-glow, 1); }
.sa3d-backdrop.is-reduced-motion { transition: none; }
.sa3d-canvas-layer { position: absolute; inset: 0; }
.sa3d-canvas-layer canvas { display: block; width: 100%; height: 100%; }
`;

function injectStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = STYLE_TEXT;
  document.head.appendChild(style);
}
function resolveElement(target) {
  if (!target) return null;
  return typeof target === 'string' ? document.querySelector(target) : target;
}
function makeDiv(className) { const d = document.createElement('div'); d.className = className; return d; }

/* --------------------- the hero --------------------- */

export class SolAscii3D {
  static get OPTIONS() { return OPTIONS.map((o) => ({ ...o })); }
  static get DEFAULTS() { return { ...DEFAULTS }; }

  constructor(userOptions = {}) {
    this.opts = { ...DEFAULTS, ...userOptions };
    this.shaderQuality = this.opts.shaderQuality;
    const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.reducedMotion = this.opts.reducedMotion === null ? prefersReduced : !!this.opts.reducedMotion;

    // Build the scene DOM so callers only need to instantiate the class.
    injectStyles();
    const container = resolveElement(this.opts.container) || document.body;
    this.container = container;
    this.sceneEl = makeDiv('sa3d-scene' + (container === document.body ? ' sa3d-scene--fixed' : ''));
    this.sceneEl.setAttribute('aria-hidden', 'true');
    this.sceneEl.dataset.asciiScene = 'true';
    this.sceneEl.dataset.sceneReady = 'false';
    this.sceneEl.dataset.introComplete = 'false';
    const artwork = makeDiv('sa3d-artwork');
    this.backdropEl = makeDiv('sa3d-backdrop');
    this.host = makeDiv('sa3d-canvas-layer');
    artwork.append(this.backdropEl, this.host);
    this.sceneEl.append(artwork);
    container.append(this.sceneEl);
    this._applyBackground();
    this.backdropEl.style.setProperty('--sa3d-glow', String(this.opts.glowOpacity));

    this.clock = 0;                 // intro/animation time (uTime for bodies)
    this.introComplete = false;
    this.introDurationLimit = Math.max(INTRO.system.durationSeconds, ...BODY_IDS.map((id) => INTRO.bodyById[id].delaySeconds + INTRO.bodyById[id].fadeDurationSeconds));

    this.renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, depth: false, powerPreference: 'high-performance', stencil: false });
    this.renderer.setClearColor(0x000000, 0);
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.renderer.setPixelRatio(this.dpr);
    this.host.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 1600);
    this.camera.position.set(0, 0, 800);
    this.view = { yaw: 0, pitch: 0 }; // camera orbit, driven by dragging the background
    this._proj = new THREE.Vector3();

    this.atlas = createGlyphAtlas();
    this.maxPointSize = this._maxPointSize();

    this.systemGroup = new THREE.Group();
    this.scene.add(this.systemGroup);

    this.uTime = { value: 0 };
    this.bodyList = [];            // body instances (runtime + material)
    this.bodyByKey = {};
    this.backdrop = null;          // backdrop runtime + material

    // interaction targets (world px)
    this.interaction = { position: new THREE.Vector3(), velocity: new THREE.Vector3(), energy: 0 };
    this.interactionTarget = { position: new THREE.Vector3(), velocity: new THREE.Vector3(), energy: 0 };
    this._stirTmp = new THREE.Vector3();
    this._axisTmp = new THREE.Vector3();
    this._dq = new THREE.Quaternion();
    this._orbitQuat = new THREE.Quaternion();
    this._orbitAxis = new THREE.Vector3(...INTRO.system.orbitAxis).normalize();
    this._pointer = null;          // active pointer for field stir
    this._drag = null;             // active body drag
    this._viewDrag = null;         // active background drag (camera orbit)
    this._optionListeners = new Set();
    this._preOrbitZoom = null;

    this.size = { width: 0, height: 0 };
    this._raf = null;
    this._last = 0;

    this.camera.zoom = this.opts.zoom;
    this._buildScene();
    this._bindEvents();
    this.resize();
    if (this.opts.autoStart) this.start();
  }

  /* ---------- options ---------- */
  getOptions() { return { ...this.opts }; }
  setOptions(partial) { for (const [k, v] of Object.entries(partial || {})) this.setOption(k, v); }
  onOptionChange(fn) { this._optionListeners.add(fn); return () => this._optionListeners.delete(fn); }
  setOption(key, value) {
    if (!(key in this.opts)) return;
    this.opts[key] = value;
    switch (key) {
      case 'background': this._applyBackground(); break;
      case 'reducedMotion': this.setReducedMotion(value); break;
      // camera zoom scales the WebGL bodies; recompute the glow to track them (see _applyGlow)
      case 'zoom': this.camera.zoom = value; this.camera.updateProjectionMatrix(); this._applyGlow(); break;
      case 'glyphSizeScale': this._applyGlyphSizes(); break;
      case 'fieldOpacity': if (this.backdrop) this.backdrop.material.uniforms.uOpacity.value = value; break;
      case 'glowOpacity': this.backdropEl.style.setProperty('--sa3d-glow', String(value)); break;
      case 'orbit':
        this._rebuildBodies();
        // orbit spreads the bodies out, so zoom in a bit; restore the prior zoom on exit
        if (value) { this._preOrbitZoom = this.opts.zoom; this.setOption('zoom', 1.5); }
        else if (this._preOrbitZoom != null) { const z = this._preOrbitZoom; this._preOrbitZoom = null; this.setOption('zoom', z); }
        break;
      // timeScale, spinSpeed, orbitSpeed, interactive are read live in the loop / handlers
    }
    for (const fn of this._optionListeners) fn(key, value);
  }
  _applyBackground() {
    const bg = this.opts.background || DARK_BACKGROUND;
    this.sceneEl.style.setProperty('--sa3d-bg', bg);
    this.sceneEl.style.setProperty('--color-background', bg); // used by the glow color-mix
  }

  _maxPointSize() {
    const gl = this.renderer.getContext();
    const range = gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE);
    const max = Number(range?.[1]);
    return Number.isFinite(max) ? Math.max(max, 1) : 64;
  }

  _buildScene() {
    const width = REF_DESKTOP.width, height = Math.round(width * 9 / 16);
    const layout = computeLayout(width, height);
    this.layout = layout;

    this.bodyList = [];
    this.bodyByKey = {};
    const specs = this.opts.orbit ? orbitBodySpecs() : defaultBodySpecs();

    // geometry counts sized to a stable reference so a resize does not re-mesh
    const spacing = surfaceSpacing(width);
    for (const spec of specs) {
      const refRadius = this.opts.orbit
        ? spec.sizeRel * ORBIT_REF_HALF
        : layout.bodies[spec.key].radius;
      const count = bodyPointCount(refRadius, this.opts.orbit ? ORBIT_SPACING : spacing);
      const data = createBodyGlyphGeometryData(spec.kind, count, spec.seed, spec.dotFraction);
      this._createBody(spec, data);
    }
    // introDurationLimit spans every body's reveal plus the (default-mode) system intro
    this.introDurationLimit = Math.max(
      this.opts.orbit ? 0.8 : INTRO.system.durationSeconds,
      ...this.bodyList.map((b) => b.spec.delay + b.spec.fadeDuration),
    );
    this.representatives = this._pickRepresentatives();

    const emissions = this._emissionCount(layout);
    this._createBackdrop(emissions);
    this._applyTheme();
  }

  // Sun (index 0) plus the two largest other bodies feed the 3-slot field shader.
  _pickRepresentatives() {
    const sun = this.bodyByKey.sun || this.bodyByKey.sol || this.bodyList[0];
    const others = this.bodyList.filter((b) => b !== sun).sort((a, b) => b.refRadius - a.refRadius);
    return [sun, others[0], others[1]].filter(Boolean);
  }

  _rebuildBodies() {
    const wasRunning = !!this._raf;
    if (this._raf) { cancelAnimationFrame(this._raf); this._raf = null; }
    for (const b of this.bodyList || []) { b.geometry.dispose(); b.material.dispose(); this.systemGroup.remove(b.group); }
    if (this.backdrop) {
      this.systemGroup.remove(this.backdrop.group);
      this.backdrop.material.dispose();
      this.backdrop.ambient.geometry.dispose();
    }
    this.systemGroup.position.set(0, 0, 0);
    this.systemGroup.quaternion.identity();
    this.systemGroup.scale.setScalar(1);
    this.clock = 0; this.introComplete = false; this.uTime.value = 0;
    if (this.sceneEl) this.sceneEl.dataset.introComplete = 'false';
    if (this.backdropEl) this.backdropEl.classList.remove('is-visible');
    this._buildScene();
    this.size = { width: 0, height: 0 };
    this.resize();
    if (wasRunning) { this._last = performance.now(); const loop = (now) => { this._raf = requestAnimationFrame(loop); const dt = clampDt((now - this._last) / 1000) * this.opts.timeScale; this._last = now; this._frame(dt); }; this._raf = requestAnimationFrame(loop); }
  }

  _emissionCount(layout) {
    const w = Math.max(0, layout.width), h = Math.max(0, layout.height), solR = layout.bodies.sol.radius;
    return Math.round(3 * Math.round((w * h) / 1500 + (2 * Math.PI * solR) / 4));
  }

  _createBody(spec, data) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(data.surfaceNormals, 3));
    geo.setAttribute('aElevation', new THREE.BufferAttribute(data.elevations, 1));
    geo.setAttribute('aGlyphIndex', new THREE.BufferAttribute(data.glyphIndices, 1));
    geo.setAttribute('aRevealDelay', new THREE.BufferAttribute(data.revealDelays, 1));
    geo.setDrawRange(0, data.count);

    const introOpacity = { value: 1 };
    const material = new THREE.ShaderMaterial({
      defines: { BODY_KIND: BODY_KIND[spec.kind], SURFACE_SHADER_QUALITY: Math.min(Math.max(this.shaderQuality, 0), 3) },
      depthTest: false, depthWrite: false, transparent: true, toneMapped: false,
      vertexShader: BODY_VERTEX, fragmentShader: BODY_FRAGMENT,
      uniforms: {
        uAtlas: { value: this.atlas },
        uDevicePixelRatio: { value: Math.max(this.dpr, 1) },
        uGlyphSize: { value: 1 },
        uIntroOpacity: introOpacity,
        uMaxPointSize: { value: this.maxPointSize },
        uOpacity: { value: spec.opacity },
        uRadius: { value: 1 },
        uReducedMotion: { value: this.reducedMotion ? 1 : 0 },
        uRevealTimeOffset: { value: spec.revealOffset },
        uSurfaceFlowElevationAmplitude: { value: spec.surfaceFlowAmp },
        uSurfaceFlowSpeed: { value: spec.surfaceFlowSpeed },
        uSurfaceDynamics: { value: new THREE.Vector2() },
        uSurfaceInteractionDirection: { value: new THREE.Vector3(0, 0, 1) },
        uSurfacePalette: { value: [new THREE.Color('#fff'), new THREE.Color('#fff'), new THREE.Color('#fff'), new THREE.Color('#fff')] },
        uTime: this.uTime,
        uViewportSize: { value: new THREE.Vector2(1, 1) },
      },
    });

    const points = new THREE.Points(geo, material);
    points.frustumCulled = false;
    const group = new THREE.Group();
    group.add(points);
    this.systemGroup.add(group);

    const tilt = tiltAxisFromDeg(spec.tiltDeg);
    const instance = {
      key: spec.key, kind: spec.kind, spec, tiltAxis: tilt, isSun: spec.isSun,
      group, points, geometry: geo, material, introOpacity, builtCount: data.count,
      refRadius: this.opts.orbit ? spec.sizeRel * ORBIT_REF_HALF : (this.layout.bodies[spec.key]?.radius ?? 1),
      quaternion: new THREE.Quaternion(),
      angularVelocity: new THREE.Vector3(tilt[0] * spec.baselineSpin, tilt[1] * spec.baselineSpin, tilt[2] * spec.baselineSpin),
      excess: [0, 0, 0],
      sampledAngularVelocity: [0, 0, 0],
      isDragging: false,
      worldPos: new THREE.Vector3(),
      radius: 0,
      interactionDirection: new THREE.Vector3(0, 0, 1),
      inverseQuaternion: new THREE.Quaternion(),
      surfaceState: { interactionEnergy: 0, localInteractionDirection: new THREE.Vector3(0, 0, 1), rotationActivity: 0 },
    };
    points.renderOrder = this.bodyList.length;
    this.bodyList.push(instance);
    this.bodyByKey[spec.key] = instance;
  }

  _createBackdrop(count) {
    const built = buildBackdrop(count);
    const material = new THREE.ShaderMaterial({
      depthTest: false, depthWrite: false, transparent: true, toneMapped: false,
      vertexShader: BACKDROP_VERTEX, fragmentShader: BACKDROP_FRAGMENT,
      uniforms: {
        uAccentColor: { value: new THREE.Color('#fff') },
        uAtlas: { value: this.atlas },
        uBodyPositions: { value: [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()] },
        uBodyActivities: { value: new Float32Array(3) },
        uBodyIntroOpacities: { value: new Float32Array([1, 1, 1]) },
        uBodyRadii: { value: new Float32Array(3) },
        uBodyVelocities: { value: [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()] },
        uColor: { value: new THREE.Color('#fff') },
        uDevicePixelRatio: { value: Math.max(this.dpr, 1) },
        uEmissionPulseLifetime: { value: EMISSION.emissionPulseLifetimeSeconds },
        uEmissionTime: { value: 0 },
        uFieldOpacity: { value: 0 },
        uFieldTime: { value: 0 },
        uGlyphSize: { value: 5 },
        uInteractionEnergy: { value: 0 },
        uInteractionAdvectiveVelocity: { value: new THREE.Vector3() },
        uInteractionFlowAxis: { value: new THREE.Vector3() },
        uInteractionPosition: { value: new THREE.Vector3() },
        uInteractionRadius: { value: 1 },
        uInteractionWakeStrength: { value: 0 },
        uMaxPointSize: { value: this.maxPointSize },
        uOpacity: { value: this.opts.fieldOpacity },
        uReducedMotion: { value: this.reducedMotion ? 1 : 0 },
        uSystemScale: { value: 1 },
        uSystemAxisAngle: { value: 0 },
        uTrajectoryTime: { value: 0 },
        uVolumeCenter: { value: new THREE.Vector3() },
        uVolumeSize: { value: new THREE.Vector3(1, 1, 1) },
        uWindSpread: { value: this.opts.orbit ? 1 : 0.045 },
      },
    });

    const group = new THREE.Group();
    const ambient = new THREE.Points(built.ambientGeometry, material);
    ambient.frustumCulled = false; ambient.renderOrder = 5;
    group.add(ambient);
    const sources = built.sourceGeometries.map((g) => { const p = new THREE.Points(g, material); p.frustumCulled = false; p.renderOrder = 5; p.visible = false; group.add(p); return p; });
    this.systemGroup.add(group);

    this.backdrop = {
      material, group, ambient, sources, spawnAttribute: built.spawnAttribute,
      reservoirStartIndex: built.reservoirStartIndex, reservoirCount: built.reservoirCount,
      activeCap: Number.isFinite(built.reservoirCount) ? Math.floor(0.7 * Math.max(0, built.reservoirCount)) : 0,
      emitted: 0, emissionTime: 0, fieldTime: 0, trajectoryTime: 0, activeCount: 0, ringHead: 0,
      glyphSizeBySceneSize: EMISSION.glyphSizeBySceneSize,
    };
  }

  /* ---------- theming ---------- */
  _applyTheme() {
    for (const b of this.bodyList) {
      const palette = b.spec.palette;
      for (let i = 0; i < palette.length; i += 1) b.material.uniforms.uSurfacePalette.value[i].set(palette[i]);
      b.material.uniforms.uOpacity.value = b.spec.opacity;
    }
    if (this.backdrop) {
      this.backdrop.material.uniforms.uColor.value.set(ATMOSPHERE.atmosphere);
      this.backdrop.material.uniforms.uAccentColor.value.set(ATMOSPHERE.atmosphereAccent);
    }
  }
  // Position the camera on a sphere around the scene center (yaw/pitch), looking in.
  _applyCamera() {
    const d = 800, v = this.view;
    const cp = Math.cos(v.pitch), sp = Math.sin(v.pitch), cy = Math.cos(v.yaw), sy = Math.sin(v.yaw);
    this.camera.position.set(d * cp * sy, d * sp, d * cp * cy);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(0, 0, 0);
    this.camera.updateMatrixWorld();
  }
  _projectScreen(worldVec) {
    this._proj.copy(worldVec).project(this.camera);
    return { x: (this._proj.x * 0.5 + 0.5) * this.layout.width, y: (-this._proj.y * 0.5 + 0.5) * this.layout.height, depth: this._proj.z };
  }
  _applyGlow() {
    if (!this.backdropEl) return;
    // Project each body through the (possibly orbited) camera so the CSS glow
    // tracks the WebGL bodies at any view angle. Ortho keeps radius = r * zoom.
    this.camera.updateMatrixWorld();
    const zoom = this.opts.zoom;
    const items = this.bodyList.map((b) => {
      const p = this._projectScreen(b.worldPos);
      return { b, sx: p.x, sy: p.y, depth: p.depth };
    });
    items.sort((a, c) => c.depth - a.depth); // farthest first so nearer glows layer on top
    const gradients = items.map(({ b, sx, sy }) => {
      const glow = b.spec.glow, radius = Math.max(b.radius, 1) * zoom;
      const pct = (e) => `${(e / glow.extent) * 100}%`;
      const core = (op, at) => `color-mix(in srgb, ${glow.color} ${op}%, var(--color-background)) ${pct(at)}`;
      const coreStops = [core(100 * glow.opacity, 0), core(100 * glow.opacity, 0.72), core(92 * glow.opacity, 0.88), core(45 * glow.opacity, 0.96)];
      const ringStops = glow.stops.map(([e, s]) => {
        const col = e <= 1.2 ? glow.inner : glow.outer;
        const c = s === 0 ? 'transparent' : `color-mix(in srgb, ${col} ${s}%, transparent)`;
        return `${c} ${pct(e)}`;
      });
      return `radial-gradient(circle ${radius * glow.extent}px at ${sx}px ${sy}px, ${coreStops.join(', ')}, ${ringStops.join(', ')})`;
    });
    this.backdropEl.style.backgroundImage = gradients.join(', ');
  }

  setReducedMotion(on) {
    this.reducedMotion = !!on;
    for (const b of this.bodyList) b.material.uniforms.uReducedMotion.value = on ? 1 : 0;
    if (this.backdrop) this.backdrop.material.uniforms.uReducedMotion.value = on ? 1 : 0;
    if (on) {
      this.clock = Math.max(this.clock, this.introDurationLimit);
      this.uTime.value = this.clock;
      this.interaction.energy = 0; this.interactionTarget.energy = 0;
      this.interaction.velocity.set(0, 0, 0); this.interactionTarget.velocity.set(0, 0, 0);
      for (const b of this.bodyList) { b.excess = [0, 0, 0]; b.angularVelocity.set(0, 0, 0); }
    }
    this._lastGlowClock = null; // force the orbit glow to retrack the frozen/thawed positions
    if (this.backdropEl) this.backdropEl.classList.toggle('is-reduced-motion', on);
  }

  /* ---------- sizing ---------- */
  resize() {
    const rect = this.host.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width)), height = Math.max(1, Math.round(rect.height));
    if (width === this.size.width && height === this.size.height) return;
    this.size = { width, height };
    const direction = this.sceneEl && getComputedStyle(this.sceneEl).direction === 'rtl' ? 'rtl' : 'ltr';
    this.layout = computeLayout(width, height, direction);

    this.renderer.setSize(width, height, false);
    this.camera.left = -width / 2; this.camera.right = width / 2;
    this.camera.top = height / 2; this.camera.bottom = -height / 2;
    this.camera.zoom = this.opts.zoom;
    this.camera.updateProjectionMatrix();
    this._applyCamera();

    this._updatePositions();
    for (const b of this.bodyList) {
      b.material.uniforms.uRadius.value = b.radius;
      b.material.uniforms.uViewportSize.value.set(width, height);
      b.material.uniforms.uDevicePixelRatio.value = Math.max(this.dpr, 1);
    }
    this._applyGlyphSizes();
    if (this.backdrop) {
      const m = this.backdrop.material.uniforms;
      // orbit mode emits spherically, so give the volume real depth instead of a thin slab
      const depthZ = (this.opts.orbit ? 0.7 : 0.22) * Math.min(width, height);
      const volume = new THREE.Vector3(width, 0.86 * height, depthZ);
      m.uVolumeCenter.value.set(0, 0, 4);
      m.uVolumeSize.value.copy(volume);
      m.uWindSpread.value = this.opts.orbit ? 1 : 0.045;
      m.uGlyphSize.value = this.backdrop.glyphSizeBySceneSize[this.layout.sceneSize === 'mobile' ? 'mobile' : 'desktop'];
      m.uInteractionRadius.value = Math.max(1, 0.3 * Math.min(volume.x, volume.y));
      m.uSystemAxisAngle.value = this._systemAxisAngle();
      m.uDevicePixelRatio.value = Math.max(this.dpr, 1);
    }
    this._applyGlow();
  }
  _applyGlyphSizes() {
    const width = this.size.width;
    if (this.opts.orbit) {
      const scale = this._orbitScale();
      for (const b of this.bodyList) b.material.uniforms.uGlyphSize.value = ORBIT_GLYPH_SIZE * scale * this.opts.glyphSizeScale;
      return;
    }
    for (const b of this.bodyList) {
      const density = this._densityCompensation(b, b.radius, width);
      b.material.uniforms.uGlyphSize.value =
        getBodyGlyphSize(b.kind, width) * b.spec.glyphScale * density * this.opts.glyphSizeScale;
    }
  }
  _densityCompensation(b, radius, width) {
    // meshes are built once at the reference size; grow glyphs when the runtime
    // radius would call for more points than the fixed mesh actually has.
    const full = bodyPointCount(radius, surfaceSpacing(width));
    if (full === 0 || b.builtCount === 0 || b.builtCount >= full) return 1;
    return Math.min(Math.sqrt(full / b.builtCount), 1.28);
  }
  _orbitScale() { return Math.min(this.size.width, this.size.height) / 2 / ORBIT_REF_HALF; }
  _systemAxisAngle() {
    const [sun, a] = this.representatives;
    const p = a ? a.worldPos : sun.worldPos;
    return Math.atan2(sun.worldPos.y - p.y, p.x - sun.worldPos.x);
  }

  // Set worldPos + radius for every body (static layout, or orbital positions).
  _updatePositions() {
    const W = this.layout.width, H = this.layout.height;
    if (!this.opts.orbit) {
      for (const b of this.bodyList) {
        const box = this.layout.bodies[b.key];
        b.radius = box.radius;
        b.worldPos.set(box.centerX - W / 2, H / 2 - box.centerY, 0);
      }
      return;
    }
    const halfMin = Math.min(W, H) / 2;
    const sinT = Math.sin(ORBIT_PLANE_TILT), cosT = Math.cos(ORBIT_PLANE_TILT);
    const t = this.clock; // reduced motion freezes the clock, so planets hold their current spot
    for (const b of this.bodyList) {
      b.radius = b.spec.sizeRel * halfMin;
      const orbit = b.spec.orbit;
      if (!orbit) { b.worldPos.set(0, 0, 0); continue; }
      const rate = ORBIT_BASE_RATE / Math.pow(orbit.period, ORBIT_PERIOD_COMPRESS) * this.opts.orbitSpeed;
      const angle = orbit.phase + t * rate;
      const R = orbit.r * halfMin;
      const x = Math.cos(angle) * R, s = Math.sin(angle) * R;
      const local = this._axisTmp.set(x, -s * sinT, s * cosT);
      const parent = b.spec.parent ? this.bodyByKey[b.spec.parent] : null;
      if (parent) local.add(parent.worldPos);
      b.worldPos.copy(local);
    }
  }

  /* ---------- lifecycle ---------- */
  start() {
    if (this._raf) return;
    this._resizeObserver = new ResizeObserver(() => this.resize());
    this._resizeObserver.observe(this.host);
    if (this.sceneEl) this.sceneEl.dataset.sceneReady = 'true';
    if (this.reducedMotion && this.backdropEl) this.backdropEl.classList.add('is-reduced-motion');
    // The glow fades in only once the intro settle completes (see _frame).
    this._last = performance.now();
    const loop = (now) => {
      this._raf = requestAnimationFrame(loop);
      const dt = clampDt((now - this._last) / 1000) * this.opts.timeScale;
      this._last = now;
      this._frame(dt);
    };
    this._raf = requestAnimationFrame(loop);
  }
  dispose() {
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = null;
    this._resizeObserver?.disconnect();
    for (const b of this.bodyList) { b.geometry.dispose(); b.material.dispose(); }
    this.backdrop?.material.dispose();
    this.backdrop?.ambient.geometry.dispose();
    this.atlas.dispose();
    this.renderer.dispose();
    this.sceneEl.remove();
  }

  /* ---------- per-frame ---------- */
  _frame(dt) {
    if (this.reducedMotion) this.clock = Math.max(this.clock, this.introDurationLimit); // intro completes instantly
    else this.clock += dt;
    this.uTime.value = this.clock;

    // smooth interaction toward target, decay target
    if (!this.reducedMotion) {
      this.interaction.position.lerp(this.interactionTarget.position, approach(1.8, dt));
      this.interaction.velocity.lerp(this.interactionTarget.velocity, approach(1.4, dt));
      this.interaction.energy += (this.interactionTarget.energy - this.interaction.energy) * approach(3, dt);
      this.interactionTarget.energy = decayTo(this.interactionTarget.energy, 0.55, dt);
      this.interactionTarget.velocity.multiplyScalar(decayTo(1, 0.75, dt));
      if (this.interaction.energy < 0.001) this.interaction.energy = 0;
    }

    if (!this.introComplete && this.clock >= this.introDurationLimit) {
      this.introComplete = true;
      if (this.sceneEl) this.sceneEl.dataset.introComplete = 'true';
      if (this.backdropEl) this.backdropEl.classList.add('is-visible'); // fade the glow in once bodies have settled
    }

    // intro/system motion. Default mode nudges the whole group (small entrance
    // orbit + scale); orbit mode positions each body itself so the group stays put.
    const motion = this._introMotion(this.clock);
    if (!this.opts.orbit) {
      this._orbitQuat.setFromAxisAngle(this._orbitAxis, motion.orbitRadians * (this.layout.direction === 'rtl' ? -1 : 1));
      const solAnchor = this._bodyWorld('sol');
      this._stirTmp.copy(solAnchor).multiplyScalar(motion.scale).applyQuaternion(this._orbitQuat).multiplyScalar(-1).add(solAnchor);
      this.systemGroup.position.copy(this._stirTmp);
      this.systemGroup.quaternion.copy(this._orbitQuat);
      this.systemGroup.scale.setScalar(motion.scale);
    }

    this._updatePositions();

    // per-body spin + surface interaction
    for (const b of this.bodyList) {
      const step = this._rotationStep(b, dt);
      if (!b.isDragging) { this._applyRotationDelta(b.quaternion, step.rotationDelta); b.angularVelocity.set(...step.angularVelocity); }
      b.introOpacity.value = this._bodyIntroOpacity(b.spec, this.clock);
      b.group.position.copy(b.worldPos);
      b.group.quaternion.copy(b.quaternion);

      const activity = this.reducedMotion ? 0 : Math.min(1, Math.hypot(...b.excess) / b.spec.rotationActivityScale);
      // surface interaction direction, projected onto the sphere and into body-local space
      const dir = b.interactionDirection.copy(this.interaction.position).sub(b.worldPos);
      const planar = Math.hypot(dir.x, dir.y), radius = Math.max(b.radius, 1e-4);
      const nx = dir.x / radius, ny = dir.y / radius, r2 = nx * nx + ny * ny;
      if (r2 >= 1) b.interactionDirection.set(nx, ny, 0).normalize();
      else b.interactionDirection.set(nx, ny, Math.sqrt(1 - r2));
      b.inverseQuaternion.copy(b.quaternion).invert();
      b.surfaceState.localInteractionDirection.copy(b.interactionDirection).applyQuaternion(b.inverseQuaternion).normalize();
      const falloff = Math.exp(-Math.max(planar - b.radius, 0) / Math.max(0.9 * b.radius, 1));
      const targetEnergy = this.reducedMotion ? 0 : this.interaction.energy * falloff;
      b.surfaceState.interactionEnergy += (targetEnergy - b.surfaceState.interactionEnergy) * approach(targetEnergy > b.surfaceState.interactionEnergy ? 4 : 2.4, dt);
      b.surfaceState.rotationActivity += (activity - b.surfaceState.rotationActivity) * approach(activity > b.surfaceState.rotationActivity ? 6 : 3.4, dt);

      b.material.uniforms.uSurfaceInteractionDirection.value.copy(b.surfaceState.localInteractionDirection);
      b.material.uniforms.uSurfaceDynamics.value.set(b.surfaceState.rotationActivity * b.spec.rotationResponse, b.surfaceState.interactionEnergy * b.spec.interactionResponse);
    }

    // orbit mode: depth-sort draw order (by distance toward the camera) and track glow
    if (this.opts.orbit) {
      const c = this.camera.position;
      const depth = (b) => b.worldPos.x * c.x + b.worldPos.y * c.y + b.worldPos.z * c.z;
      const sorted = this.bodyList.slice().sort((a, b) => depth(a) - depth(b)); // far first
      for (let i = 0; i < sorted.length; i += 1) sorted[i].points.renderOrder = i;
      if (!this.reducedMotion) {
        // moving: retrack the glow every few frames
        if ((this._glowTick = (this._glowTick || 0) + 1) % 3 === 0) this._applyGlow();
      } else if (this.clock !== this._lastGlowClock) {
        // frozen: the clock can still jump once (e.g. intro settle / toggle); retrack then hold
        this._applyGlow();
        this._lastGlowClock = this.clock;
      }
    }

    this._updateBackdrop(dt, motion);
    this.renderer.render(this.scene, this.camera);
  }

  _introMotion(clock) {
    if (this.reducedMotion) return { fieldMotionScale: 1, fieldOpacity: 1, orbitRadians: 0, scale: 1 };
    const s = INTRO.system, n = Math.max(0, clock);
    const l = smoother(s.durationSeconds <= 0 ? 1 : clamp01(n / s.durationSeconds));
    const fadeSpan = s.durationSeconds * s.fieldFadePortion;
    const c = fadeSpan <= 0 ? 1 : clamp01((n - s.fieldFadeDelaySeconds) / fadeSpan);
    return {
      fieldMotionScale: s.fieldStartMotionScale + (1 - s.fieldStartMotionScale) * l,
      fieldOpacity: smoother(c),
      orbitRadians: s.startOrbitRadiansBySceneSize[this.layout.sceneSize] * (1 - l),
      scale: s.startScale + (1 - s.startScale) * l,
    };
  }
  _bodyIntroOpacity(spec, clock) {
    const o = Math.max(0, clock) - spec.delay;
    const p = spec.fadeDuration <= 0 ? 1 : clamp01(o / spec.fadeDuration);
    return 1 - (1 - p) ** 3;
  }
  _bodyWorld(key) {
    const box = this.layout.bodies[key];
    return this._axisTmp.set(box.centerX - this.layout.width / 2, this.layout.height / 2 - box.centerY, 0);
  }
  _baselineSpin(b) {
    const s = b.spec.baselineSpin * this.opts.spinSpeed;
    return [b.tiltAxis[0] * s, b.tiltAxis[1] * s, b.tiltAxis[2] * s];
  }
  _rotationStep(b, dt) {
    const r = clampDt(dt);
    const [bl, bs, bd] = this._baselineSpin(b);
    if (b.isDragging) return { angularVelocity: [...b.sampledAngularVelocity], rotationDelta: [0, 0, 0] };
    if (r === 0) return { angularVelocity: [bl + b.excess[0], bs + b.excess[1], bd + b.excess[2]], rotationDelta: [0, 0, 0] };
    const f = Math.LN2 / 0.85, m = Math.exp(-f * r), p = (1 - m) / f;
    const [y, v, g] = b.excess;
    const x = y * m, s = v * m, w = g * m;
    b.excess = [x, s, w];
    return { angularVelocity: [bl + x, bs + s, bd + w], rotationDelta: [bl * r + y * p, bs * r + v * p, bd * r + g * p] };
  }
  _applyRotationDelta(quat, delta) {
    const i = Math.hypot(delta[0], delta[1], delta[2]);
    if (i === 0) return;
    this._axisTmp.set(delta[0] / i, delta[1] / i, delta[2] / i);
    this._dq.setFromAxisAngle(this._axisTmp, i);
    quat.premultiply(this._dq).normalize();
  }

  _updateBackdrop(dt, motion) {
    const bd = this.backdrop; if (!bd) return;
    const m = bd.material.uniforms;
    // feed the field's 3 slots: sun + the two largest bodies
    for (let i = 0; i < this.representatives.length; i += 1) {
      const b = this.representatives[i];
      m.uBodyPositions.value[i].copy(b.worldPos);
      m.uBodyActivities.value[i] = b.surfaceState.rotationActivity;
      m.uBodyIntroOpacities.value[i] = clamp01(b.introOpacity.value);
      m.uBodyRadii.value[i] = b.radius;
      if (this.reducedMotion) m.uBodyVelocities.value[i].set(0, 0, 0);
      else { const len = b.angularVelocity.length(); m.uBodyVelocities.value[i].copy(b.angularVelocity).divideScalar(1 + len / 1.8); }
    }

    const solActivity = this.reducedMotion ? 0 : clamp01(m.uBodyActivities.value[0]);
    const lifetime = Math.max(0.5, EMISSION.emissionPulseLifetimeSeconds);
    if (!this.reducedMotion) {
      const a = clampDt(dt);
      const fieldStep = a * motion.fieldMotionScale;
      bd.fieldTime += fieldStep;
      const velMul = Math.min(Math.max(EMISSION.solRotationEmissionVelocityMultiplier, 1), 3);
      bd.trajectoryTime += clampDt(fieldStep) * (1 + solActivity * (velMul - 1));
      bd.emissionTime += a;
      bd.emitted = Math.min(bd.activeCap, bd.emitted + (solActivity * Math.max(Math.floor(bd.activeCap), 0) / Math.max(lifetime, 0.001)) * a);

      const spawn = bd.spawnAttribute.array;
      let active = bd.activeCount;
      // expire from tail
      while (active > 0 && bd.reservoirCount > 0) {
        const spawnTime = spawn[(bd.reservoirStartIndex + (bd.ringHead - active + bd.reservoirCount) % bd.reservoirCount) * 2] ?? -1;
        if (spawnTime >= 0 && bd.emissionTime - spawnTime < lifetime) break;
        active -= 1;
      }
      // spawn from head
      let budget = Math.floor(bd.emitted), spawned = 0; const startHead = bd.ringHead;
      while (budget > 0 && bd.reservoirCount > 0) {
        const slot = bd.ringHead, base = 2 * (bd.reservoirStartIndex + slot), existing = spawn[base] ?? -1;
        if (existing >= 0 && bd.emissionTime - existing < lifetime) break;
        spawn[base] = bd.emissionTime; spawn[base + 1] = bd.trajectoryTime;
        bd.ringHead = (slot + 1) % bd.reservoirCount; active += 1; budget -= 1; spawned += 1;
      }
      if (spawned > 0) {
        bd.emitted -= spawned;
        const first = Math.min(spawned, bd.reservoirCount - startHead);
        bd.spawnAttribute.addUpdateRange((bd.reservoirStartIndex + startHead) * 2, 2 * first);
        const rest = spawned - first;
        if (rest > 0) bd.spawnAttribute.addUpdateRange(2 * bd.reservoirStartIndex, 2 * rest);
        bd.spawnAttribute.needsUpdate = true;
      }
      bd.activeCount = active;
      const ranges = ringRanges(bd.reservoirStartIndex, bd.reservoirCount, bd.ringHead, active);
      bd.sources[0].geometry.setDrawRange(ranges[0].start, ranges[0].count);
      bd.sources[1].geometry.setDrawRange(ranges[1].start, ranges[1].count);
      bd.sources[0].visible = ranges[0].count > 0;
      bd.sources[1].visible = ranges[1].count > 0;
    }

    m.uEmissionTime.value = bd.emissionTime;
    m.uFieldOpacity.value = motion.fieldOpacity;
    m.uFieldTime.value = bd.fieldTime;
    m.uSystemScale.value = motion.scale;
    m.uTrajectoryTime.value = bd.trajectoryTime;

    if (this.reducedMotion) {
      m.uInteractionAdvectiveVelocity.value.set(0, 0, 0);
      m.uInteractionFlowAxis.value.set(0, 0, 0);
      m.uInteractionWakeStrength.value = 0;
      m.uInteractionEnergy.value = 0;
    } else {
      const S = Math.max(1.12 * m.uInteractionRadius.value, 1);
      m.uInteractionPosition.value.copy(this.interaction.position);
      const solRadius = Math.max(m.uBodyRadii.value[0], 1);
      const soften = Math.max(0.3 * solRadius, 0.12 * S);
      const axis = m.uInteractionFlowAxis.value.copy(this.interaction.position).sub(m.uBodyPositions.value[0]);
      axis.multiplyScalar(1 / Math.sqrt(axis.lengthSq() + soften * soften));
      const speed = this.interaction.velocity.length();
      m.uInteractionAdvectiveVelocity.value.copy(this.interaction.velocity).divideScalar(2.6 * S + speed);
      m.uInteractionWakeStrength.value = m.uInteractionAdvectiveVelocity.value.length();
      m.uInteractionEnergy.value = clamp01(this.interaction.energy);
    }
  }

  /* ---------- pointer interaction ---------- */
  _bindEvents() {
    const el = this.renderer.domElement;
    el.style.touchAction = 'none';
    el.addEventListener('pointerdown', (e) => this._onPointerDown(e));
    el.addEventListener('pointermove', (e) => this._onPointerMove(e));
    el.addEventListener('pointerup', (e) => this._onPointerUp(e));
    el.addEventListener('pointercancel', (e) => this._onPointerUp(e));
    el.addEventListener('pointerleave', () => { this._pointer = null; });
  }
  _localPoint(e) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top, rect };
  }
  _bodyAt(x, y) {
    const zoom = this.opts.zoom;
    this.camera.updateMatrixWorld();
    // nearest (toward camera) first so the topmost body wins
    const c = this.camera.position;
    const ordered = this.bodyList.slice().sort((a, b) =>
      (b.worldPos.x * c.x + b.worldPos.y * c.y + b.worldPos.z * c.z) - (a.worldPos.x * c.x + a.worldPos.y * c.y + a.worldPos.z * c.z));
    for (const b of ordered) {
      const p = this._projectScreen(b.worldPos), sr = Math.max(b.radius * zoom, 8);
      if (x >= p.x - sr && x <= p.x + sr && y >= p.y - sr && y <= p.y + sr) return b;
    }
    return null;
  }
  _onPointerDown(e) {
    if (!this.opts.interactive || this.reducedMotion || !e.isPrimary) return;
    const { x, y } = this._localPoint(e);
    const b = this._bodyAt(x, y);
    this.renderer.domElement.setPointerCapture?.(e.pointerId);
    if (b) {
      b.isDragging = true; b.excess = [0, 0, 0]; b.sampledAngularVelocity = [0, 0, 0];
      this._drag = { body: b, pointerId: e.pointerId, x, y, time: e.timeStamp };
    } else {
      // dragging empty space orbits the camera (rotate the perspective)
      this._viewDrag = { pointerId: e.pointerId, x, y };
      this._pointer = null;
    }
  }
  _onPointerMove(e) {
    if (!this.opts.interactive || this.reducedMotion) return;
    const { x, y } = this._localPoint(e);
    if (this._viewDrag && this._viewDrag.pointerId === e.pointerId) {
      this.view.yaw -= (x - this._viewDrag.x) * 0.005;
      this.view.pitch = Math.min(Math.max(this.view.pitch + (y - this._viewDrag.y) * 0.005, -1.35), 1.35);
      this._viewDrag.x = x; this._viewDrag.y = y;
      this._applyCamera();
      this._applyGlow();
      return;
    }
    if (this._drag && this._drag.pointerId === e.pointerId) {
      const b = this._drag.body;
      const dx = x - this._drag.x, dy = y - this._drag.y;
      const dtSeconds = Math.max((e.timeStamp - this._drag.time) / 1000, 1 / 240);
      const delta = screenToAngular(b.tiltAxis, b.isSun, dx, dy, 0.006);
      this._applyRotationDelta(b.quaternion, delta);
      const inst = [delta[0] / dtSeconds, delta[1] / dtSeconds, delta[2] / dtSeconds];
      const blend = approach(29, dtSeconds);
      const sampled = [
        b.sampledAngularVelocity[0] * (1 - blend) + inst[0] * blend,
        b.sampledAngularVelocity[1] * (1 - blend) + inst[1] * blend,
        b.sampledAngularVelocity[2] * (1 - blend) + inst[2] * blend,
      ];
      b.sampledAngularVelocity = projectToTilt(b.tiltAxis, b.isSun, sampled);
      b.angularVelocity.set(...b.sampledAngularVelocity);
      b.group.quaternion.copy(b.quaternion);
      this._drag.x = x; this._drag.y = y; this._drag.time = e.timeStamp;
      return;
    }
    // stir the field
    const prev = this._pointer;
    const dx = prev ? x - prev.x : 0, dy = prev ? y - prev.y : 0;
    const dt = prev ? Math.max((e.timeStamp - prev.time) / 1000, 1 / 240) : 1 / 60;
    this.stirField(x, y, dx, dy, dt, false);
    this._pointer = { x, y, time: e.timeStamp };
  }
  _onPointerUp(e) {
    if (this._viewDrag && this._viewDrag.pointerId === e.pointerId) this._viewDrag = null;
    if (this._drag && this._drag.pointerId === e.pointerId) {
      const b = this._drag.body;
      // hand momentum to excess angular velocity (decays back to baseline)
      const sampled = projectToTilt(b.tiltAxis, b.isSun, b.sampledAngularVelocity);
      const capped = this._clampSpeed(sampled, 3.5);
      const baseline = this._baselineSpin(b);
      b.excess = this.reducedMotion ? [0, 0, 0] : [capped[0] - baseline[0], capped[1] - baseline[1], capped[2] - baseline[2]];
      b.isDragging = false; b.sampledAngularVelocity = [0, 0, 0];
      this._drag = null;
    }
    this._pointer = null;
  }
  _clampSpeed(v, max) {
    const len = Math.hypot(v[0], v[1], v[2]);
    if (len === 0 || len <= max) return [...v];
    const k = max / len; return [v[0] * k, v[1] * k, v[2] * k];
  }
  stirField(x, y, dx, dy, dt, isDown) {
    if (this.reducedMotion) return;
    const w = this.layout.width, h = this.layout.height;
    this.interactionTarget.position.set(x - w / 2, h / 2 - y, 0);
    const u = Math.max(clampDt(dt), 1 / 240);
    if (isDown) this.interactionTarget.velocity.set(0, 0, 0);
    else {
      this._stirTmp.set(dx, -dy, 0).multiplyScalar(0.55 / u).clampLength(0, 1.5 * Math.min(w, h));
      this.interactionTarget.velocity.lerp(this._stirTmp, approach(4.5, u));
    }
    const speed = Math.hypot(dx, dy);
    const energy = Math.min(0.68, 0.18 + 7e-4 * (Math.max(speed, 0) / Math.max(clampDt(dt), 1 / 240)));
    if (isDown) this.interactionTarget.energy = 1;
    else if (energy > this.interactionTarget.energy) this.interactionTarget.energy += (energy - this.interactionTarget.energy) * approach(7, u);
  }
}

// Back-compat alias and optional global for plain <script type="module"> usage.
export { SolAscii3D as SolAscii3DHero };
if (typeof window !== 'undefined') window.SolAscii3D = SolAscii3D;
