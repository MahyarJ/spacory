# 🪐 Spacory

**Spacory** is an open-source floor-plan and spatial-layout editor built with
React, TypeScript, and SVG. The goal: let anyone create and maintain floor plans
intuitively — no AutoCAD knowledge required — from simple wall layouts to
connected room structures.

🔗 **Try it live:** https://mahyarj.github.io/spacory/

---

## ✨ Features

- 📐 **Metric / Imperial** — switch between cm and m² or feet/inches and ft².
  Measurement inputs, thickness labels, and SVG/PNG exports follow the plan’s
  system; JSON files and autosave preserve it. Unit, theme, and thickness
  choices share a consistent segmented control.

- 🧱 **Walls** — click-to-chain or drag to draw, with grid snapping and
  thickness presets (10 / 15 / 30 cm or 4½″ / 6½″ / 12″) and custom overall thickness
- 🔵 **Smart junctions** — where walls meet, their geometry is mitered so corners
  and T/X junctions join seamlessly (no overlap patches, no gaps); very acute
  angles fall back to a clean bevel. A wall ending part-way along another splits
  it in two, so mid-span T-junctions really connect and move like any other
  junction — and removing or detaching that wall merges the two segments back
  into one
- 🚪 **Openings** — place doors and windows along a wall by click-click or by
  dragging; toggle a door's hinge edge and swing side. Openings follow their
  wall as it moves and resizes
- 🚰 **Fixtures** — choose **Sink** to preview a 60 × 60 cm basin against a
  wall face. Click or tap to place it, or touch and slide before releasing.
  Drag a basin or a selected group along the wall or to another face. Set
  **Width** along the wall and **Depth** out from it, or use the options bar to
  duplicate or remove the basin.
  Sinks on separate parallel walls keep their spacing when dragged together.
  Selected sinks and plan labels slide together along the sinks' wall faces.
  Placement, dragging, and dimension edits preview in blue when valid and
  red when blocked, with a short explanation. Fit, autosave, JSON, SVG, and PNG
  include the basin.
- 🏠 **Rooms** — enclosed wall layouts automatically show a subtle room fill and
  area in the plan’s units. With Select active, choose a room to add, edit, or
  clear its name. New names and edits can use up to 80 characters. Labels on
  the canvas and in SVG and PNG exports wrap or abbreviate to fit, and the
  editor keeps the full name. Areas are measured to wall centrelines, and
  doors and windows preserve enclosure
- 🏷️ **Plan labels** — choose **Label** in the main toolbar, click or tap anywhere
  indoors or outdoors, and type in place. Press Enter to save or tap another
  canvas point to save and place the next label. Choose **Select** to finish.
  In **Select**, drag a label to move it or select it and tap again to edit.
  Use **Remove** in the options bar to delete selected labels. Fit, autosave,
  and exports include labels.
- 📏 **Dimensions** — every wall shows its length on-canvas; select a wall and
  type an exact length to resize it, or select a single door/window to read its
  current width and type a new one
- 🖱️ **Editing** — select / shift-multi-select / marquee-select, move walls by
  drag or arrow keys, delete, nudge thickness. Drag a junction to move every
  wall meeting there, or pull a single wall's endpoint back out of a junction
- 🔄 **Undo / redo** — diff-based history that also **survives a page refresh**
- ♻️ **Autosave** — the working plan and the viewport (pan/zoom) are persisted to
  `localStorage` and restored on reload
- 💾 **Import / export** — load a plan from JSON or download it from **Export → JSON**.
  Choose **Export → Image…** for a light plan preview in every editor theme.
  Show or hide **Wall lengths** and **Room areas** independently, then download
  PNG or SVG, or select **Copy image** to paste a PNG in supported browsers.
  Default export filenames use `floor-plan`.
- 🧭 **Canvas** — pan (right-drag, two-finger drag, or the Pan tool) and zoom
  (wheel or pinch); "Fit" frames the whole plan in one click
- 🎨 **Theming** — dark / light / system, via CSS variables
- 📱 **Tablet-ready** — the toolbar and app shell adapt to tablet viewport
  widths (the toolbar wraps instead of clipping its controls) and every control
  is a comfortable touch target on a touch screen. On the canvas, one finger runs
  the active tool (draw, place, select, drag) and two fingers pan and pinch-zoom
  whatever the tool. Selecting something also puts an on-screen **Remove**
  button in the floating options bar, joined by **Hinge** and **Swing** when the
  selection includes a door, so editing what you've drawn never needs a
  keyboard — and that bar is where further selection actions will land
- ⚡ Built with **Vite + React + TypeScript**

Not yet: subtracting holes or islands from room areas, interior-face areas, stylus/Apple Pencil
specifics, and a phone-width layout. See
[`docs/DECISIONS.md`](docs/DECISIONS.md) for scope notes.

---

## 🚀 Getting started

Requires **Node 20+** (CI runs on Node 24).

```bash
npm install
npm run dev        # start the dev server (Vite)
```

Then open the printed local URL.

### Scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | Start the Vite dev server |
| `npm run build` | Type-check (`tsc -b`) and build for production |
| `npm run preview` | Preview the production build locally |
| `npm test` | Run the test suite once (Vitest, randomized order) |
| `npm run test:watch` | Run tests in watch mode |
| `npm run lint` | Lint with Biome |
| `npm run format` | Format with Biome (writes) |
| `npm run check` | Biome lint + format + import-organize (read-only) |
| `npm run check:fix` | Apply Biome's safe fixes |

---

## ⌨️ Keyboard shortcuts

| Key | Action |
| --- | --- |
| `Cmd/Ctrl+Z` | Undo |
| `Cmd/Ctrl+Shift+Z` / `Cmd/Ctrl+Y` | Redo |
| `Esc` | Cancel the current draw / drag |
| `Delete` / `Backspace` | Remove the selection |
| `[` / `]` | Decrease / increase thickness for wall-only selections |
| `H` / `S` | Toggle selected door hinge / swing |
| Arrows | Nudge selected walls, labels, fixtures, or a junction (Shift = ×10, Alt = raw 1 unit) |

---

## 🧱 Tech stack

- **React 18** + **TypeScript** (strict)
- **Zustand** for state, with a custom diff-based undo history
  ([`fast-json-patch`](https://github.com/Starcounter-Jack/JSON-Patch))
- **SVG** rendering, split into composable layers
- **Vite** build, **Vitest** tests, **Biome** lint + format
- **GitHub Actions** CI: `biome ci` → `tsc -b` → tests

---

## 📚 Documentation

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — how the app is structured, the
  data model, and how the geometry / history / persistence work.
- [`docs/DECISIONS.md`](docs/DECISIONS.md) — key design decisions and the
  reasoning behind them (a lightweight decision log).

---

## 🤝 Contributing

Before pushing, make sure the same gates CI runs pass locally:

```bash
npm run check && npx tsc -b && npm test
```

Geometry and serialization live in pure, well-tested modules (`src/geometry`,
`src/app/io.ts`, `src/app/history.ts`) — prefer adding logic there with tests.

---

## 📄 Licence

Spacory is open source under the [MIT License](LICENSE) — use it, embed it, fork
it, build on it. If you do something interesting with it, I'd love to hear about
it.
