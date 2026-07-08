// GPU fluid simulation (Stam-style Navier-Stokes) rendered as colored ASCII.
// Pointer moves inject velocity + dye splats; clicks fire staggered ripples.

const VERT = `#version 300 es
layout(location = 0) in vec2 aPosition;
out vec2 vUv;
void main() {
  vUv = aPosition * 0.5 + 0.5;
  gl_Position = vec4(aPosition, 0.0, 1.0);
}
`;

const ADVECT = `#version 300 es
precision highp float;
uniform sampler2D uVelocity;
uniform sampler2D uSource;
uniform vec2 texelSize;
uniform float dt;
uniform float dissipation;
in vec2 vUv;
out vec4 fragColor;
void main() {
  vec2 vel = texture(uVelocity, vUv).xy;
  vec2 coord = vUv - dt * vel * texelSize;
  fragColor = dissipation * texture(uSource, coord);
}
`;

const JACOBI = `#version 300 es
precision highp float;
uniform sampler2D uX;
uniform sampler2D uB;
uniform vec2 texelSize;
uniform float alpha;
uniform float rBeta;
in vec2 vUv;
out vec4 fragColor;
void main() {
  vec4 xL = texture(uX, vUv - vec2(texelSize.x, 0.0));
  vec4 xR = texture(uX, vUv + vec2(texelSize.x, 0.0));
  vec4 xB = texture(uX, vUv - vec2(0.0, texelSize.y));
  vec4 xT = texture(uX, vUv + vec2(0.0, texelSize.y));
  vec4 bC = texture(uB, vUv);
  fragColor = (xL + xR + xB + xT + alpha * bC) * rBeta;
}
`;

const DIVERGENCE = `#version 300 es
precision highp float;
uniform sampler2D uVelocity;
uniform vec2 texelSize;
in vec2 vUv;
out vec4 fragColor;
void main() {
  float L = texture(uVelocity, vUv - vec2(texelSize.x, 0.0)).x;
  float R = texture(uVelocity, vUv + vec2(texelSize.x, 0.0)).x;
  float B = texture(uVelocity, vUv - vec2(0.0, texelSize.y)).y;
  float T = texture(uVelocity, vUv + vec2(0.0, texelSize.y)).y;
  float div = 0.5 * (R - L + T - B);
  fragColor = vec4(div, 0.0, 0.0, 1.0);
}
`;

const GRADIENT = `#version 300 es
precision highp float;
uniform sampler2D uPressure;
uniform sampler2D uVelocity;
uniform vec2 texelSize;
in vec2 vUv;
out vec4 fragColor;
void main() {
  float pL = texture(uPressure, vUv - vec2(texelSize.x, 0.0)).x;
  float pR = texture(uPressure, vUv + vec2(texelSize.x, 0.0)).x;
  float pB = texture(uPressure, vUv - vec2(0.0, texelSize.y)).x;
  float pT = texture(uPressure, vUv + vec2(0.0, texelSize.y)).x;
  vec2 vel = texture(uVelocity, vUv).xy;
  vel -= vec2(pR - pL, pT - pB) * 0.5;
  fragColor = vec4(vel, 0.0, 1.0);
}
`;

const SPLAT = `#version 300 es
precision highp float;
uniform sampler2D uTarget;
uniform vec2 point;
uniform vec3 color;
uniform float radius;
uniform float aspectRatio;
in vec2 vUv;
out vec4 fragColor;
void main() {
  vec2 p = vUv - point;
  p.x *= aspectRatio;
  vec3 splat = exp(-dot(p, p) / radius) * color;
  vec3 base = texture(uTarget, vUv).xyz;
  fragColor = vec4(base + splat, 1.0);
}
`;

const CLEAR = `#version 300 es
precision highp float;
uniform sampler2D uTexture;
uniform float value;
in vec2 vUv;
out vec4 fragColor;
void main() {
  fragColor = value * texture(uTexture, vUv);
}
`;

const CURL = `#version 300 es
precision highp float;
uniform sampler2D uVelocity;
uniform vec2 texelSize;
in vec2 vUv;
out vec4 fragColor;
void main() {
  float L = texture(uVelocity, vUv - vec2(texelSize.x, 0.0)).y;
  float R = texture(uVelocity, vUv + vec2(texelSize.x, 0.0)).y;
  float B = texture(uVelocity, vUv - vec2(0.0, texelSize.y)).x;
  float T = texture(uVelocity, vUv + vec2(0.0, texelSize.y)).x;
  fragColor = vec4(0.5 * (R - L - T + B), 0.0, 0.0, 1.0);
}
`;

const VORTICITY = `#version 300 es
precision highp float;
uniform sampler2D uVelocity;
uniform sampler2D uCurl;
uniform vec2 texelSize;
uniform float curl;
uniform float dt;
in vec2 vUv;
out vec4 fragColor;
void main() {
  float L = texture(uCurl, vUv - vec2(texelSize.x, 0.0)).x;
  float R = texture(uCurl, vUv + vec2(texelSize.x, 0.0)).x;
  float B = texture(uCurl, vUv - vec2(0.0, texelSize.y)).x;
  float T = texture(uCurl, vUv + vec2(0.0, texelSize.y)).x;
  float C = texture(uCurl, vUv).x;
  vec2 force = 0.5 * vec2(abs(T) - abs(B), abs(R) - abs(L));
  float len = length(force) + 1e-5;
  force = force / len * curl * C;
  vec2 vel = texture(uVelocity, vUv).xy;
  fragColor = vec4(vel + force * dt, 0.0, 1.0);
}
`;

function compileShader(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader) ?? "Unknown error";
    gl.deleteShader(shader);
    throw new Error(log);
  }
  return shader;
}

function createProgram(gl, vertSrc, fragSrc) {
  const vert = compileShader(gl, gl.VERTEX_SHADER, vertSrc);
  const frag = compileShader(gl, gl.FRAGMENT_SHADER, fragSrc);
  const program = gl.createProgram();
  gl.attachShader(program, vert);
  gl.attachShader(program, frag);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program) ?? "Unknown error";
    gl.deleteProgram(program);
    throw new Error(log);
  }
  const uniforms = {};
  const count = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < count; i++) {
    const info = gl.getActiveUniform(program, i);
    if (info) uniforms[info.name] = gl.getUniformLocation(program, info.name);
  }
  return { program, uniforms };
}

function createFBO(gl, w, h, internalFormat, format, type, filter) {
  gl.activeTexture(gl.TEXTURE0);
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, w, h, 0, format, type, null);
  const fbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
  gl.viewport(0, 0, w, h);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return { texture, fbo, width: w, height: h };
}

function createDoubleFBO(gl, w, h, internalFormat, format, type, filter) {
  let read = createFBO(gl, w, h, internalFormat, format, type, filter);
  let write = createFBO(gl, w, h, internalFormat, format, type, filter);
  return {
    width: w,
    height: h,
    get read() { return read; },
    get write() { return write; },
    swap() { const tmp = read; read = write; write = tmp; },
  };
}

class FluidSolver {
  constructor(canvas, simW, simH) {
    const gl = canvas.getContext("webgl2", { alpha: false, depth: false, stencil: false, antialias: false });
    if (!gl) throw new Error("WebGL2 not supported");
    gl.getExtension("EXT_color_buffer_float");
    gl.getExtension("OES_texture_float_linear");
    this.gl = gl;
    this.simW = simW;
    this.simH = simH;
    canvas.width = simW;
    canvas.height = simH;

    const quad = new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]);
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, quad, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    this.programs = {
      advect: createProgram(gl, VERT, ADVECT),
      jacobi: createProgram(gl, VERT, JACOBI),
      divergence: createProgram(gl, VERT, DIVERGENCE),
      gradient: createProgram(gl, VERT, GRADIENT),
      splat: createProgram(gl, VERT, SPLAT),
      clear: createProgram(gl, VERT, CLEAR),
      curl: createProgram(gl, VERT, CURL),
      vorticity: createProgram(gl, VERT, VORTICITY),
    };

    this.allocate();
  }

  allocate() {
    const gl = this.gl;
    const type = gl.HALF_FLOAT, internal = gl.RGBA16F, format = gl.RGBA, filter = gl.LINEAR;
    const w = this.simW, h = this.simH;
    this.velocity = createDoubleFBO(gl, w, h, internal, format, type, filter);
    this.pressure = createDoubleFBO(gl, w, h, internal, format, type, filter);
    this.dye = createDoubleFBO(gl, w, h, internal, format, type, filter);
    this.divergenceFBO = createFBO(gl, w, h, internal, format, type, filter);
    this.curlFBO = createFBO(gl, w, h, internal, format, type, filter);
    this.texelSize = new Float32Array([1 / w, 1 / h]);
    this.dyeBuffer = new Float32Array(w * h * 4);
    this.velBuffer = new Float32Array(w * h * 4);
  }

  blit(target) {
    const gl = this.gl;
    if (target) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
      gl.viewport(0, 0, target.width, target.height);
    } else {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, this.simW, this.simH);
    }
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  bindTexture(unit, texture) {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, texture);
  }

  splat(x, y, velX, velY, dyeR, dyeG, dyeB, radius) {
    const gl = this.gl, p = this.programs.splat;
    gl.useProgram(p.program);
    gl.uniform2f(p.uniforms.point, x, y);
    gl.uniform1f(p.uniforms.radius, radius);
    gl.uniform1f(p.uniforms.aspectRatio, this.simW / this.simH);

    this.bindTexture(0, this.velocity.read.texture);
    gl.uniform1i(p.uniforms.uTarget, 0);
    gl.uniform3f(p.uniforms.color, velX, velY, 0);
    this.blit(this.velocity.write);
    this.velocity.swap();

    this.bindTexture(0, this.dye.read.texture);
    gl.uniform1i(p.uniforms.uTarget, 0);
    gl.uniform3f(p.uniforms.color, dyeR, dyeG, dyeB);
    this.blit(this.dye.write);
    this.dye.swap();
  }

  step(dt, cfg) {
    this.computeCurl();
    this.applyVorticity(dt, cfg.curl);
    this.advect(this.velocity, this.velocity, dt, cfg.velocityDissipation);
    this.advect(this.velocity, this.dye, dt, cfg.dyeDissipation);
    this.computeDivergence();
    this.clearPressure(cfg.pressureClear);
    this.solvePressure(cfg.pressureIterations);
    this.subtractGradient();
  }

  computeCurl() {
    const gl = this.gl, p = this.programs.curl;
    gl.useProgram(p.program);
    gl.uniform2f(p.uniforms.texelSize, this.texelSize[0], this.texelSize[1]);
    this.bindTexture(0, this.velocity.read.texture);
    gl.uniform1i(p.uniforms.uVelocity, 0);
    this.blit(this.curlFBO);
  }

  applyVorticity(dt, curl) {
    const gl = this.gl, p = this.programs.vorticity;
    gl.useProgram(p.program);
    gl.uniform2f(p.uniforms.texelSize, this.texelSize[0], this.texelSize[1]);
    this.bindTexture(0, this.velocity.read.texture);
    gl.uniform1i(p.uniforms.uVelocity, 0);
    this.bindTexture(1, this.curlFBO.texture);
    gl.uniform1i(p.uniforms.uCurl, 1);
    gl.uniform1f(p.uniforms.curl, curl);
    gl.uniform1f(p.uniforms.dt, dt);
    this.blit(this.velocity.write);
    this.velocity.swap();
  }

  advect(velocity, target, dt, dissipation) {
    const gl = this.gl, p = this.programs.advect;
    gl.useProgram(p.program);
    gl.uniform2f(p.uniforms.texelSize, this.texelSize[0], this.texelSize[1]);
    gl.uniform1f(p.uniforms.dt, dt);
    gl.uniform1f(p.uniforms.dissipation, dissipation);
    this.bindTexture(0, velocity.read.texture);
    gl.uniform1i(p.uniforms.uVelocity, 0);
    this.bindTexture(1, target.read.texture);
    gl.uniform1i(p.uniforms.uSource, 1);
    this.blit(target.write);
    target.swap();
  }

  computeDivergence() {
    const gl = this.gl, p = this.programs.divergence;
    gl.useProgram(p.program);
    gl.uniform2f(p.uniforms.texelSize, this.texelSize[0], this.texelSize[1]);
    this.bindTexture(0, this.velocity.read.texture);
    gl.uniform1i(p.uniforms.uVelocity, 0);
    this.blit(this.divergenceFBO);
  }

  clearPressure(value) {
    const gl = this.gl, p = this.programs.clear;
    gl.useProgram(p.program);
    this.bindTexture(0, this.pressure.read.texture);
    gl.uniform1i(p.uniforms.uTexture, 0);
    gl.uniform1f(p.uniforms.value, value);
    this.blit(this.pressure.write);
    this.pressure.swap();
  }

  solvePressure(iterations) {
    const gl = this.gl, p = this.programs.jacobi;
    gl.useProgram(p.program);
    gl.uniform2f(p.uniforms.texelSize, this.texelSize[0], this.texelSize[1]);
    gl.uniform1f(p.uniforms.alpha, -1);
    gl.uniform1f(p.uniforms.rBeta, 0.25);
    this.bindTexture(1, this.divergenceFBO.texture);
    gl.uniform1i(p.uniforms.uB, 1);
    for (let i = 0; i < iterations; i++) {
      this.bindTexture(0, this.pressure.read.texture);
      gl.uniform1i(p.uniforms.uX, 0);
      this.blit(this.pressure.write);
      this.pressure.swap();
    }
  }

  subtractGradient() {
    const gl = this.gl, p = this.programs.gradient;
    gl.useProgram(p.program);
    gl.uniform2f(p.uniforms.texelSize, this.texelSize[0], this.texelSize[1]);
    this.bindTexture(0, this.pressure.read.texture);
    gl.uniform1i(p.uniforms.uPressure, 0);
    this.bindTexture(1, this.velocity.read.texture);
    gl.uniform1i(p.uniforms.uVelocity, 1);
    this.blit(this.velocity.write);
    this.velocity.swap();
  }

  readDye() {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.dye.read.fbo);
    gl.readPixels(0, 0, this.simW, this.simH, gl.RGBA, gl.FLOAT, this.dyeBuffer);
    return this.dyeBuffer;
  }

  readVelocity() {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.velocity.read.fbo);
    gl.readPixels(0, 0, this.simW, this.simH, gl.RGBA, gl.FLOAT, this.velBuffer);
    return this.velBuffer;
  }

  resize(simW, simH) {
    this.simW = simW;
    this.simH = simH;
    this.gl.canvas.width = simW;
    this.gl.canvas.height = simH;
    this.allocate();
  }
}

const CHARS = " .·:;¡+=xX$#%@";
const MAX_CHAR = CHARS.length - 1;

// HSL (h 0-360, s/l 0-100) -> "rgb(r,g,b)"
function hslToRgb(h, s, l) {
  s /= 100;
  l /= 100;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => {
    const k = (n + h / 30) % 12;
    return l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
  };
  const r = Math.round(f(0) * 255);
  const g = Math.round(f(8) * 255);
  const b = Math.round(f(4) * 255);
  return `rgb(${r},${g},${b})`;
}

class AsciiRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    if (!this.ctx) throw new Error("Canvas 2D context not available");
    this.fontSize = 14;
    this.measure();
  }

  measure() {
    const dpr = window.devicePixelRatio || 1;
    this.screenW = window.innerWidth;
    this.screenH = window.innerHeight;
    this.canvas.width = this.screenW * dpr;
    this.canvas.height = this.screenH * dpr;
    this.canvas.style.width = this.screenW + "px";
    this.canvas.style.height = this.screenH + "px";
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.ctx.font = `${this.fontSize}px "Courier New", Courier, monospace`;
    this.ctx.textBaseline = "top";
    this.cellW = this.ctx.measureText("█").width;
    this.cellH = this.fontSize * 1.2;
    this.cols = Math.floor(this.screenW / this.cellW);
    this.rows = Math.floor(this.screenH / this.cellH);
    return { cols: this.cols, rows: this.rows };
  }

  draw(dye, vel, cols, rows) {
    const { ctx, cellW, cellH } = this;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, this.screenW, this.screenH);
    ctx.font = `${this.fontSize}px "Courier New", Courier, monospace`;
    ctx.textBaseline = "top";
    let lastColor = "";

    for (let row = 0; row < this.rows; row++) {
      const simRow = this.rows - 1 - row; // flip: WebGL texture is bottom-up
      if (simRow < 0 || simRow >= rows) continue;
      const base = simRow * cols;
      const yPix = row * cellH;

      for (let col = 0; col < this.cols; col++) {
        if (col >= cols) continue;
        const idx = (base + col) * 4;

        const dr = dye[idx], dg = dye[idx + 1], db = dye[idx + 2];
        const density = Math.sqrt(dr * dr + dg * dg + db * db);
        if (density < 0.02) continue;

        const vx = vel[idx], vy = vel[idx + 1];
        const speed = Math.sqrt(vx * vx + vy * vy);

        const t = Math.min(1, density * 0.4);
        const ci = Math.max(1, Math.min(MAX_CHAR, Math.round(t * MAX_CHAR)));
        const ch = CHARS[ci];

        const hue = (Math.atan2(vy, vx) * 180 / Math.PI + 360) % 360;
        const sat = Math.min(100, 60 + speed * 100);
        const light = Math.min(80, 20 + density * 20 + speed * 10);
        const color = hslToRgb(hue, sat, light);
        if (color !== lastColor) {
          ctx.fillStyle = color;
          lastColor = color;
        }
        ctx.fillText(ch, col * cellW, yPix);
      }
    }
  }
}

// --- Simulation tuning (matches trystero.dev feel) ---
const CONFIG = {
  velocityDissipation: 0.985,
  dyeDissipation: 0.975,
  pressureIterations: 25,
  pressureClear: 0.8,
  curl: 30,
  splatRadius: 0.003,
  splatForce: 3500,
  splatDyeStrength: 2.5,
  clickMultiplier: 2,
};

// Ripple (click) tuning
const RIPPLE_RINGS = 5;
const RIPPLE_POINTS = 20;
const RIPPLE_STAGGER_MS = 100;
const RIPPLE_RING_STEP = 0.055;
const RIPPLE_BASE_FORCE = 0.004;
const RIPPLE_RADIUS = 8e-4;
const RIPPLE_FORCE = 8000;
const RIPPLE_DYE = 2;

// Random vivid color in 0..1 (HSL h=random, s=1, l=0.5)
function randomColor() {
  const h = Math.random();
  const l = 0.5, s = 1;
  const f = (n) => {
    const k = (n + h * 12) % 12;
    return l - s * Math.min(l, 1 - l) * Math.max(Math.min(k - 3, 9 - k, 1), -1);
  };
  return { r: f(0), g: f(8), b: f(4) };
}

function main() {
  const asciiCanvas = document.querySelector(".ambient-canvas");
  const renderer = new AsciiRenderer(asciiCanvas);
  let { cols, rows } = renderer.measure();

  const glCanvas = document.createElement("canvas");
  const solver = new FluidSolver(glCanvas, cols, rows);

  let pending = []; // queued splats to inject this frame
  const rippleTimers = [];

  function fireRipple(nx, ny) {
    for (let ring = 0; ring < RIPPLE_RINGS; ring++) {
      const timer = window.setTimeout(() => {
        const radius = (ring + 1) * RIPPLE_RING_STEP;
        const fade = 1 - (ring / RIPPLE_RINGS) * 0.6;
        const dir = ring % 2 === 0 ? 1 : -0.5;
        const force = RIPPLE_BASE_FORCE * fade * dir;
        for (let i = 0; i < RIPPLE_POINTS; i++) {
          const a = (i / RIPPLE_POINTS) * Math.PI * 2;
          const cx = Math.cos(a), cy = Math.sin(a);
          pending.push({
            x: nx + cx * radius,
            y: ny + cy * radius,
            dx: cx * force,
            dy: cy * force,
            ripple: true,
          });
        }
      }, ring * RIPPLE_STAGGER_MS);
      rippleTimers.push(timer);
    }
  }

  let prevX = 0, prevY = 0, down = false, firstMove = true;

  function onMove(e) {
    const nx = e.clientX / window.innerWidth;
    const ny = e.clientY / window.innerHeight;
    if (firstMove) {
      firstMove = false;
      prevX = nx;
      prevY = ny;
      return;
    }
    const dx = nx - prevX;
    const dy = ny - prevY;
    prevX = nx;
    prevY = ny;
    pending.push({ x: nx, y: 1 - ny, dx, dy: -dy, down });
  }

  function onDown(e) {
    down = true;
    const nx = e.clientX / window.innerWidth;
    const ny = e.clientY / window.innerHeight;
    prevX = nx;
    prevY = ny;
    fireRipple(nx, 1 - ny);
  }

  function onUp() { down = false; }

  function onResize() {
    const next = renderer.measure();
    if (next.cols !== cols || next.rows !== rows) {
      cols = next.cols;
      rows = next.rows;
      solver.resize(cols, rows);
    }
  }

  let prevTime = performance.now();
  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min((now - prevTime) / 1000, 0.033);
    prevTime = now;

    for (const s of pending) {
      let force, radius, dyeStrength;
      if (s.ripple) {
        force = RIPPLE_FORCE;
        radius = RIPPLE_RADIUS;
        dyeStrength = RIPPLE_DYE;
      } else {
        const mult = s.down ? CONFIG.clickMultiplier : 1;
        force = CONFIG.splatForce * mult;
        radius = CONFIG.splatRadius * mult;
        dyeStrength = CONFIG.splatDyeStrength * mult;
      }
      const c = randomColor();
      solver.splat(
        s.x, s.y,
        s.dx * force, s.dy * force,
        c.r * dyeStrength, c.g * dyeStrength, c.b * dyeStrength,
        radius
      );
    }
    pending = [];

    solver.step(dt, CONFIG);
    const dye = solver.readDye();
    const vel = solver.readVelocity();
    renderer.draw(dye, vel, cols, rows);
  }

  window.addEventListener("pointermove", onMove, { passive: true });
  window.addEventListener("pointerdown", onDown, { passive: true });
  window.addEventListener("pointerup", onUp);
  window.addEventListener("pointercancel", onUp);
  window.addEventListener("resize", onResize);

  requestAnimationFrame(frame);
}

main();
