# ASCII Screensavers

A small collection of browser animations rendered as text. Each one is a
self-contained static page with its own drop-in library and settings panel. No
build step, no dependencies to install.

Open `index.html` at the root for the list, then click through.

## Animations

| Animation                                                | What it is                                                                                    |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| [ASCII Unicorn Barf 🦄](animations/ascii-unicorn-barf/)   | GPU fluid simulation painted as colorful ASCII. Mouse paints trails, clicks send out ripples. |
| [Sol ASCII 3D](animations/sol-ascii-3d/)                  | A 3D solar system of spinning glyph-rendered bodies, with an orbit mode.                       |
| [Astra Star Field](animations/astra-star-field/)          | Glowing stars morphing between a spiral 6, a cursor, and a knot. Drag to rotate. Has an ASCII mode. |

## Running it

Serve the repo root. Sol ASCII 3D and Astra Star Field use ES modules, so
`file://` will not work for them. Sol ASCII 3D also pulls three.js from a CDN, so
it needs to be online.

```sh
python3 -m http.server
# then visit http://localhost:8000
```

## Layout

```
index.html                 gallery: the list of animations
animations/<name>/         one self-contained animation: index.html, lib, panel, README
```

Animation pages have no back link on purpose. The browser back button already
does the job, and any chrome we add would sit on top of the artwork.

## Adding an animation

1. Drop a self-contained folder under `animations/<name>/` with its own
   `index.html`.
2. Add a `<li>` entry to the root `index.html` and a row to the table above.

## License

[MIT](LICENSE) © 2026 Andre Gil
