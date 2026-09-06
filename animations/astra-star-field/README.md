# Astra Star Field

Stars streaming along a shape, morphing between three of them. Drag it around
and the stars arc outward as they fly to the next target.

A recreation of the header on OpenAI's
[GPT-6 Astra post](https://openai.com/index/gpt-6-astra/), which scrolls through
the same three shapes.

## How it moves

Every shape is a set of paths, and every star holds a position along one of
them. The stars flow; the shape itself stays put. On the cursor you can watch
clumps travel around the outline, and the galaxy arms appear to turn because
their stars are running along them.

That distinction matters: the field is not a rigid object being spun. Rotating
the whole thing is what dragging does, and it is off by default (`spinSpeed: 0`).
Flow rate and direction are matched to the original.

## Shapes

| Key | Shape    | What it is                                                                             |
| --- | -------- | ---------------------------------------------------------------------------------------- |
| `1` | `six`    | A galaxy spiral whose long outer arm sweeps up and right, so it reads as a numeral **6**. |
| `2` | `cursor` | The arrow pointer, traced as an outline.                                                  |
| `3` | `knot`   | The looping six-strand knot OpenAI uses as its mark.                                      |

The `six` is a logarithmic spiral, tuned against the original: radius grows about
1.6x per turn, and the last stretch of the long arm flares wide of the coil.
That flare is what opens the counter of the 6 and leaves the black gap at the
upper right. Without it the arm just winds on and the shape closes into a plain
spiral. The second arm is deliberately short so it cannot fill that gap. Core and
halo are rings, so those stars orbit rather than streaming off the end.

The other two shapes are the actual vector paths from the source page, walked
with `getPointAtLength` so stars travel them by true arc length.

## Modes

`mode: 'glow'` (the default) draws each star as a soft additive sprite: a hot
white pinpoint inside a wide halo, with diffraction spikes on the brightest few.
That is the look of the original.

`mode: 'ascii'` renders the same field as text glyphs, to match the rest of this
repo. Everything else — shapes, rotation, morphing — is shared.

## Quick start

Serve the repo root and open `/animations/astra-star-field/`:

```sh
python3 -m http.server
# then visit http://localhost:8000/animations/astra-star-field/
```

It uses ES modules, so `file://` will not work. Nothing else to install.

## Controls

| Input       | Does                       |
| ----------- | -------------------------- |
| Drag        | Rotate, with some inertia. |
| Arrow keys  | Rotate.                    |
| Scroll      | Next or previous shape.    |
| `1` `2` `3` | Jump to a shape.           |
| Space       | Next shape.                |

## Files

| File                        | Role                                                                                        |
| --------------------------- | ----------------------------------------------------------------------------------------------- |
| `astra-star-field.js`       | **The lib.** `AstraStarField` class: shape building, morph, both renderers, input, render loop. |
| `astra-star-field-panel.js` | Optional settings panel. Reads `AstraStarField.OPTIONS` and drives `setOption()`. Decoupled.    |
| `index.html`                | Page shell.                                                                                     |

## Using the lib

```js
import { AstraStarField } from "./astra-star-field.js";

const hero = new AstraStarField(); // builds its own DOM, mounts full-viewport
const hero = new AstraStarField({ container: "#hero", shape: "knot", autoCycle: true });
```

Change things live with `hero.setOption(key, value)`. Read current values with
`hero.getOptions()`. Swap shapes with `hero.setShape("cursor")` or
`hero.nextShape()`.

The host element fires an `astra:interact` event the first time someone drags,
scrolls, or uses the keyboard, which is what the page shell uses to fade its
hint line out.

## Config reference

`AstraStarField.DEFAULTS` lists every key. The panel exposes the visual ones:

**Motion:** `flowSpeed` (how fast stars run along the paths, `1` matches the
original), `spinSpeed` (idle tumble, off by default), `morphSpeed`, `shimmer`,
`trail`, `timeScale`, `autoCycle`, `cycleSeconds`, `reducedMotion` (`null`
follows `prefers-reduced-motion`)

**Field:** `mode`, `shape`, `particles`, `zoom`, `warmth` (share of amber stars)

**Glow mode:** `starScale`, `exposure`, `haze` (the milky glow along the arms),
`nebula` (the ambient wash behind everything), `bgStars` (static specks across
the frame), `background`

**ASCII mode:** `glyphSize`, `ramp`, `glow`

**Labels:** `labelLeft` and `labelRight` draw big text either side of the field,
the way the source page flanks it with wordmarks. Both empty by default:

```js
new AstraStarField({ labelLeft: "GPT", labelRight: "Astra" });
```

**Setup only (construction time):** `container`, `interactive`, `autoStart`

## Settings panel

```js
import { mountControlPanel } from "./astra-star-field-panel.js";
mountControlPanel(hero);
```

A gear button appears bottom-right on pointer move. **Copy** puts a
`new AstraStarField({...})` snippet with your changes on the clipboard.

## License

[MIT](../../LICENSE) © 2026 Andre Gil
