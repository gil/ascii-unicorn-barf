# Sol ASCII 3D

A 3D solar system drawn entirely with characters. Bodies spin, their surfaces
flow, and a haze of atmospheric particles drifts around them. Drag to stir the
scene. There is an orbit mode that swaps the default 3-body composition for the
full system.

## Quick start

Serve the repo root and open `/animations/sol-ascii-3d/`:

```sh
python3 -m http.server
# then visit http://localhost:8000/animations/sol-ascii-3d/
```

This one needs a real server. It uses ES modules and pulls
[three.js](https://threejs.org) 0.180.0 from jsDelivr, so `file://` and offline
both fail.

## Files

| File                    | Role                                                                                          |
| ----------------------- | --------------------------------------------------------------------------------------------- |
| `sol-ascii-3d.js`       | **The lib.** `SolAscii3D` class: scene, bodies, glyph renderer, pointer input, render loop.   |
| `sol-ascii-3d-panel.js` | Optional settings panel. Reads `SolAscii3D.OPTIONS` and drives `setOption()`. Decoupled.       |
| `index.html`            | Page shell.                                                                                    |

## Using the lib

```js
import { SolAscii3D } from "./sol-ascii-3d.js";

const hero = new SolAscii3D(); // builds its own DOM, mounts full-viewport
const hero = new SolAscii3D({ container: "#hero", orbit: true });
```

Change things live with `hero.setOption(key, value)`. Read current values with
`hero.getOptions()`.

## Config reference

`SolAscii3D.DEFAULTS` lists every key. The panel exposes the visual ones:

**Motion:** `timeScale`, `spinSpeed`, `orbit`, `orbitSpeed`, `reducedMotion`
(`null` follows `prefers-reduced-motion`)

**Look:** `glyphSizeScale`, `zoom`, `fieldOpacity`, `glowOpacity`, `background`

**Setup only (construction time):** `container`, `shaderQuality` (0 to 3),
`interactive`, `autoStart`

## Settings panel

```js
import { mountControlPanel } from "./sol-ascii-3d-panel.js";
mountControlPanel(hero);
```

A gear button appears bottom-right on pointer move. **Copy** puts a
`new SolAscii3D({...})` snippet with your changes on the clipboard.

## License

[MIT](../../LICENSE) © 2026 Andre Gil
