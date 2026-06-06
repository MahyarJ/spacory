# Architecture

A tour of how Spacory is put together and why. For the reasoning behind specific
choices, see [`DECISIONS.md`](DECISIONS.md).

## Philosophy

Keep the **domain logic pure and testable**, and keep **React/SVG as a thin view**
over a single source of truth. Geometry and (de)serialization live in plain
functions with unit tests; components mostly read state and draw.

## Directory layout

```
src/
  app/                 # state, schema, persistence — the "model"
    schema.ts          # Plan / Wall / Item types + createInitialPlan
    store.ts           # Zustand store (single source of truth + actions)
    history.ts         # diff-based undo/redo (JSON Patch)
    persistence.ts     # localStorage autosave (load/save the history)
    io.ts              # JSON serialize + validate (import/export + persistence)
    theming.ts         # theme mode persistence + <html> attribute
    selection.ts       # small selection-state helpers
  geometry/            # pure math, no React
    wall.ts            # wall length/angle/direction, point projection
    junction.ts        # wall mitering + junction core fills
    hit.ts             # hit-testing walls and items
    rect.ts            # rect + segment/rect intersection (marquee)
    snap.ts            # grid snapping + screen↔world transform
  features/
    canvas/            # the SVG editor and its layers
    toolbar/           # tool buttons, wall options, theme switch, import/export
  main.tsx, App.tsx, theme.css
```

## Data model (`app/schema.ts`)

A document is a `Plan`:

- `meta` — name, timestamps, `units` (default `cm`), `gridSize`.
- `walls: Wall[]` — each a centerline segment `a`–`b` plus `thickness`.
- `items: Item[]` — doors/windows, a discriminated union on `type`. An item is
  **attached to a wall** by id + offset along it (`wallAttach`), not by absolute
  coordinates, so it follows the wall when the wall moves.

Coordinates are plain numbers in the plan's units (cm). There is no separate
"model space" vs "cm" — the canvas renders plan units directly under a view
transform.

## State (`app/store.ts`)

A single Zustand store holds everything: the current `plan`, `view`
(pan/zoom), `tool`, `selectedWalls`/`selectedItems`, `marquee`, theme, and the
current wall thickness. **`plan` is the source of truth** the layers render.

Every plan edit goes through one `commit(next)` chokepoint, which advances the
undo history and triggers autosave. The undo history itself lives in a
module-level value (`history`) outside React; the store mirrors `history.present`
into `plan` so components re-render.

### Undo history (`app/history.ts`)

History is **diff-based**: `present` is the full plan, while `past`/`future` hold
JSON Patches (RFC 6902, via `fast-json-patch`) to step backward/forward. Undo
applies the stored inverse patch to reconstruct the previous plan. This keeps
history tiny (a wall move is a ~3-op patch, not a full copy) so many steps can be
retained and persisted cheaply. Capped at `MAX_STEPS` as a backstop.

### Persistence (`app/persistence.ts`)

The whole history is autosaved to `localStorage` on every commit/undo/redo/load,
and rehydrated on startup. Saving keys off **discrete history commits**, so the
live wall-drag preview (which deliberately doesn't commit) is naturally excluded
— no debounce needed. `present` is validated through `io.ts` on load; a corrupt
or outdated payload is ignored. A quota failure falls back to saving present-only.

### Serialization boundary (`app/io.ts`)

`serializePlan` / `parsePlan` are the single validated boundary for untrusted
JSON (file import **and** localStorage). `coercePlan` validates an
already-parsed value (used for nested snapshots). Validation is structural, not
version-strict: unknown `version` strings are normalized and items referencing a
missing wall are dropped, so older/partial data still loads safely.

## Rendering (`features/canvas`)

`FloorPlan.tsx` owns the `<svg>`, the pointer/keyboard handlers, and the view
transform, and composes stateless layers inside one transformed `<g>`:

- `GridLayer` — adaptive grid lines for the visible region
- `WallsLayer` — mitered wall polygons + junction core fills
- `ItemsLayer` — doors/windows drawn in each wall's local frame
- `SelectionLayer` — highlights for selected walls/items
- `MarqueeLayer` — the drag-select rectangle

Pointer position is converted screen→world via `snap.ts`
(`applyInverseViewTransform`); the pointer is captured on the `<svg>` itself so a
re-rendering child can't drop a drag.

## Geometry (`src/geometry`)

Pure functions, each unit-tested. The notable one is **`junction.ts`**: walls are
not fixed rectangles — `computeWallGeometry` mitres each wall's corners against
its neighbours at shared nodes (angular sort + edge-line intersection), and emits
a core fill polygon for 3+-wall junctions. See `DECISIONS.md` for why this
replaced the old "cover cap" approach.

## Tooling

- **Vitest** (`*.test.ts`, randomized order) for the pure modules.
- **Biome** for lint + format (`biome.json`).
- **GitHub Actions**: `biome ci` → `tsc -b` → `npm test` on push/PR to `main`.
