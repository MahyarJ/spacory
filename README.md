# 🪐 Spacory

**Spacory** is an open-source floor-plan and spatial-layout editor built with
React, TypeScript, and SVG. The goal: let anyone create and maintain floor plans
intuitively — no AutoCAD knowledge required — from simple wall layouts to
connected room structures.

🔗 **Try it live:** https://mahyarj.github.io/spacory/

---

## ✨ Features

- 🧱 **Walls** — click-to-chain or drag to draw, with grid snapping and
  selectable thickness presets
- 🔵 **Smart junctions** — where walls meet, their geometry is mitered so corners
  and T/X junctions join seamlessly (no overlap patches, no gaps); very acute
  angles fall back to a clean bevel. A wall ending part-way along another splits
  it in two, so mid-span T-junctions really connect and move like any other
  junction — and removing or detaching that wall merges the two segments back
  into one
- 🚪 **Openings** — place doors and windows along a wall by click-click or by
  dragging; toggle a door's hinge edge and swing side. Openings follow their
  wall as it moves and resizes
- 📏 **Dimensions** — every wall shows its length on-canvas; select a wall and
  type an exact length to resize it, or select a single door/window to read its
  current width and type a new one
- 🖱️ **Editing** — select / shift-multi-select / marquee-select, move walls by
  drag or arrow keys, delete, nudge thickness. Drag a junction to move every
  wall meeting there, or pull a single wall's endpoint back out of a junction
- 🔄 **Undo / redo** — diff-based history that also **survives a page refresh**
- ♻️ **Autosave** — the working plan and the viewport (pan/zoom) are persisted to
  `localStorage` and restored on reload
- 💾 **Import / export** — load a plan from JSON, and get it back out through the
  toolbar's **Export** menu, which groups the available formats (JSON plan file,
  PNG image and SVG vector image)
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

Not yet: rooms / enclosed areas, stylus/Apple Pencil specifics, and a
phone-width layout. See
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
| `[` / `]` | Decrease / increase selected wall thickness |
| `H` / `S` | Toggle selected door hinge / swing |
| Arrows | Nudge selected walls (Shift = ×10, Alt = raw 1 unit) |

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
