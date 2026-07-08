# ASCII Unicorn Barf 🦄

An interactive fluid simulation rendered as colorful ASCII on a dark page. Move
the mouse to paint flowing trails. Click for concentric ripples. When left
alone, an idle "demo" cursor wanders and clicks on its own.

Inspired by the background effect on [trystero.dev](https://trystero.dev).

> **Note on the name:** "ASCII Unicorn Barf" is a playful working title. For a
> more formal setting, use something like **ASCII Fluid**, the lib itself
> is already named neutrally (`fluid-ascii.js` / `FluidAscii`), so only the page
> title and this README use the "official" name.

## Quick start

It runs straight from the file, with nothing to install. Open `index.html` in a
modern browser.

If your browser blocks WebGL or scripts on `file://`, serve the folder instead:

```sh
python3 -m http.server
# then visit http://localhost:8000
```

Requires **WebGL2** with the `EXT_color_buffer_float` extension, standard on
current desktop browsers.

## How it works

A GPU fluid solver (Stam-style Navier-Stokes in WebGL2) advects velocity and
dye fields each frame. Those fields are read back and drawn as a grid of
monospace characters. Density picks the character, flow direction picks the
hue, and speed drives both saturation and brightness. Pointer input injects
velocity and dye "splats". A click sends out staggered concentric ripple rings.

## Files

| File             | Role                                                                                                                                            |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `fluid-ascii.js` | **The lib.** Self-contained `FluidAscii` class holding the fluid solver, ASCII renderer, pointer input, and animation loop. No UI dependencies. |
| `controls.js`    | Generic, schema-driven settings panel. Knows nothing about fluids.                                                                              |
| `controls.css`   | Settings-panel styling.                                                                                                                         |
| `demo.js`        | Idle "attract" mode (`DemoCursor`). App-only, not part of the lib.                                                                              |
| `app.js`         | Instantiates the lib, then wires up the panel and idle demo.                                                                                    |
| `index.html`     | Page shell.                                                                                                                                     |

## Using the lib

The whole engine is one drop-in class:

```js
const fx = new FluidAscii(".my-canvas"); // selector
const fx = new FluidAscii(canvasEl, { curl: 40 }); // element + options
const fx = new FluidAscii({ fontSize: 12 }); // auto-creates a fullscreen canvas
```

It self-contains the WebGL sim, the renderer, the pointer/resize listeners, and
its own render loop.

### Live config

All parameters live on `fx.config` and are read every frame, so changes apply
instantly:

```js
fx.config.curl = 50;
fx.config.fontSize = 10; // grid rebuild is handled automatically
fx.config.colorMode = "fixed";
fx.config.colorHue = 300;
```

`FluidAscii.defaults` lists every key and its default value.

### Lifecycle

```js
fx.reset(); // restore defaults
fx.stop();
fx.start(); // pause / resume the loop
fx.destroy(); // remove all listeners, timers, and the GL context
```

## Config reference

**Fluid:** `velocityDissipation`, `dyeDissipation`, `pressureIterations`,
`pressureClear`, `curl`

**Mouse splat:** `splatForce`, `splatRadius`, `splatDyeStrength`,
`clickMultiplier`

**Click ripple:** `rippleForce`, `rippleDye`, `rippleRings`, `rippleRingStep`,
`ripplePoints`, `rippleStaggerMs`, `rippleBaseForce`, `rippleRadius`

**Render:** `fontSize`, `densityThreshold`, `hueOffset`, `saturationBase`,
`lightnessBase`

**Ink color:** `colorMode` (`'random'` or `'fixed'`), `colorHue` (0 to 360)

## Settings panel and demo (app)

`app.js` binds a live settings panel (the ⚙ button, top-right) to every config
value, plus a **Reset** button.

The idle demo (`demo.js`) simulates a wandering cursor by dispatching synthetic
pointer events, which the lib treats like a real mouse. Those events carry
`isTrusted: false`, so any real input pauses the demo at once, and it resumes
once the pointer leaves the page. Toggle it under **Demo → Play when idle**.
