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
  and T/X junctions join seamlessly (no overlap patches, no gaps)
- 🚪 **Openings** — place doors and windows along walls; toggle a door's hinge
  edge and swing side
- 🖱️ **Editing** — select / shift-multi-select / marquee-select, move walls by
  drag or arrow keys, delete, nudge thickness
- 🔄 **Undo / redo** — diff-based history that also **survives a page refresh**
- ♻️ **Autosave** — the working plan is persisted to `localStorage`
- 💾 **Import / export** — save and load a plan as JSON
- 🧭 **Canvas** — pan (right-drag or Pan tool) and zoom (wheel)
- 🎨 **Theming** — dark / light / system, via CSS variables
- ⚡ Built with **Vite + React + TypeScript**

Not yet: PNG/SVG image export, splitting a wall where another ends mid-span,
persisting the viewport. See [`docs/DECISIONS.md`](docs/DECISIONS.md) for scope
notes.

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
