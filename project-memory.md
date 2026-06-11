# Project Memory

> Living institutional memory for the Spacory multi-agent workflow. The **Product
> Agent** reads this before every run and updates it after. The **Engineer Agent**
> never reads or writes this file — its only spec is the GitHub Issue it is given.
> A human may edit any section at any time to redirect or constrain the agents;
> human edits win.

## What this project is

Spacory is an open-source 2D floor-plan and spatial-layout editor for the web. Its
purpose is to let non-CAD users (homeowners, renters, small businesses, hobbyists)
draw and maintain floor plans intuitively — from simple wall layouts to connected
room structures — without AutoCAD knowledge. It is a browser app built with React,
TypeScript, and SVG (Vite). The product bet is that a focused, snappy, direct-
manipulation canvas beats heavyweight CAD tools for the "I just need a floor plan"
use case.

## Current state

Built and working today (entry point `src/main.tsx` → `src/App.tsx`):

- **Walls** — draw by click-to-chain or drag, with grid snapping and selectable
  thickness presets; nudge thickness with `[` / `]`.
- **Smart mitered junctions** — `src/geometry/junction.ts` computes per-wall corner
  geometry so adjacent walls meet exactly (corners, T- and X-junctions), plus a
  core-fill polygon for 3+-wall junctions. Replaced the old "cover cap" approach.
- **Openings** — doors and windows placed along a wall, attached by wall id + offset
  (`wallAttach`) so they follow the wall when it moves. Toggle door hinge (`H`) and
  swing (`S`).
- **Selection & editing** — click / shift-multi-select / marquee-select; move walls
  by drag or arrow keys (Shift = ×10, Alt = raw unit); delete.
- **Undo / redo** — diff-based history (JSON Patch via `fast-json-patch`) in
  `src/app/history.ts`; survives a page refresh.
- **Autosave** — whole undo history persisted to `localStorage` on each commit
  (`src/app/persistence.ts`); rehydrated on startup.
- **Import / export** — save/load a plan as JSON through a single validated boundary
  (`src/app/io.ts`).
- **Canvas** — pan (right-drag or Pan tool) and zoom (wheel).
- **Theming** — dark / light / system via CSS variables (`src/app/theming.ts`,
  `src/theme.css`).

State lives in one Zustand store (`src/app/store.ts`); `plan` is the single source
of truth and all edits flow through one `commit()` chokepoint. Pure logic
(`src/geometry/`, `src/app/io.ts`, `src/app/history.ts`) is unit-tested with Vitest
(randomized order). CI (Node 24) runs `biome ci` → `tsc -b` → tests.

## Known gaps & open questions

From the README ("Not yet:"), `docs/DECISIONS.md` scope notes, and code reading:

- **PNG image export — in flight (#4).** Raster export of the plan; SVG (vector)
  export deliberately deferred to a follow-up.
- **No SVG/vector image export** — follow-up to PNG export (#4); not yet scoped.
- **No mid-span wall splitting** — only shared *endpoints* form junctions. A wall
  ending mid-span of another is not auto-split (DECISIONS.md "Wall junctions").
- **Viewport persistence — in flight (#2).** Pan/zoom currently resets on refresh
  (plan + history persist, but `view` does not); #2 persists it separately.
- **No miter limit / bevel fallback** — very acute wall angles produce long
  spike-like miters; a miter limit is noted as a possible future tweak.
- **No rooms/areas as first-class objects** — walls and openings exist, but there is
  no notion of an enclosed room, area measurement, or labels. (Needs human product
  input before scoping — see open questions.)
- **On-canvas wall-length labels — in flight (#5).** Display-only; *editable*
  lengths (type to resize) and a unit-switching UI remain open follow-ups.
- **No editable dimensions / unit switching** — follow-up to #5; type-to-resize and
  changing `plan.meta.units` from the UI are not yet scoped.
- **No furniture / fixtures** — only doors and windows; no other placeable objects.
- **Undo/redo keyboard shortcuts — in flight (#3).** Was toolbar-only; #3 adds
  `Cmd/Ctrl+Z` / `Shift`-redo / `Ctrl+Y` in `src/features/canvas/FloorPlan.tsx`.
- **Selection is not part of the history snapshot** — after undo/redo, a stored
  `selectedWalls`/`selectedItems` can reference walls/items that no longer exist (or
  reappear); delete-then-undo leaves a stale selection.
- **No error boundaries** — an unexpected render error takes down the whole app
  rather than being contained.

Open questions for the human (see "Report back" — confirm before generating issues
that depend on these): target users' top unmet need, whether to prioritize export
vs. rooms vs. measurements, and any accessibility/i18n requirements.

## Architecture decisions

(Authoritative source: `docs/ARCHITECTURE.md` and `docs/DECISIONS.md`. Summary:)

- **Language/stack:** React 18 + TypeScript (strict), SVG rendering, Vite build.
- **State:** a single Zustand store; `plan` is the source of truth; every plan edit
  goes through one `commit(next)` chokepoint that drives undo history + autosave.
- **Pure-logic-first:** geometry, serialization (`io.ts`), and history are pure
  modules with Vitest tests. New logic belongs there with tests, not in components.
- **Undo history is diff-based** (JSON Patch) and the *whole history* is persisted to
  `localStorage`; saving keys off discrete commits, so the live drag preview is
  excluded without a debounce.
- **Single validation boundary** (`io.ts`): all untrusted JSON (file import *and*
  localStorage) is structurally validated; unknown versions normalized, items with a
  missing wall dropped.
- **Mitered junctions, not cover caps** (`geometry/junction.ts`).
- **Pointer captured on the `<svg>`**, not the clicked child, so re-rendering layers
  don't drop a drag.
- **Coordinates are plain numbers in cm**; no separate model space.
- **Tooling:** Biome for lint+format (only `style/noNonNullAssertion` disabled);
  Vitest with shuffled order; GitHub Actions CI on Node 24.
- **Folder conventions:** `src/app/` = model (state/schema/persistence/io),
  `src/geometry/` = pure math, `src/features/{canvas,toolbar}/` = view. CSS Modules
  per component; generated `*.module.css.d.ts` are gitignored.

## What the Product Agent should focus on next

The first issue batch (#2–#5) is now in flight, covering the top thin/shippable
items: viewport persistence (#2), undo/redo keyboard shortcuts (#3), PNG export (#4),
and on-canvas wall-length labels (#5). Do **not** re-propose these. Once they land,
the next high-value, well-scoped follow-ups (in rough priority order) are:

1. **SVG (vector) export** — follow-up to #4; clean once the PNG content-SVG +
   bounding-box helper exists (reuse that pure helper). Thin and shippable.
2. **Editable wall lengths** — follow-up to #5; let the user type an exact length to
   resize a wall. Higher effort (resize semantics, which endpoint moves), leans on
   pure geometry — good candidate but define the interaction carefully.
3. **"Fit to content / reset view" button** — pairs naturally with the #2 bounding
   box / viewport work; small polish.
4. **Selection not in history snapshot** — bug-ish gap: undo/redo can leave a stale
   selection. Small, testable, leans on `history.ts` + store.
5. **Rooms / enclosed areas** — bigger feature (area calc, labels). Still needs human
   product input before scoping (see open questions); defer until answered.

Prefer issues that are vertically thin, independently shippable, and that lean on the
pure-logic modules (so the Engineer Agent can add tested logic, not just UI).

## What the Product Agent should NOT do

- **Do not revisit settled architecture decisions** in `docs/DECISIONS.md` (mitered
  junctions, diff-based persisted history, single `io.ts` validation boundary, Biome,
  Zustand single store, pointer-capture-on-svg, cm coordinates). Build on them.
- **Do not propose swapping the stack** (React/TS/SVG/Vite/Zustand/Biome/Vitest) or
  introducing a backend/server — Spacory is a client-only app.
- **Do not write issues that span many subsystems at once.** Keep each issue thin and
  independently shippable; split epics into ordered issues.
- **Do not specify the "how" in a way that boxes the engineer in** beyond the
  acceptance criteria and necessary technical context — the Engineer Agent owns
  implementation choices.
- **Do not add AI/Claude attribution** to commits or PRs (repo policy in `CLAUDE.md`).
- **Do not invent product requirements that contradict this file or a human edit.**
  When in doubt about scope, write the open question into "Known gaps" rather than
  guessing in an issue.

## Changelog

- 2026-06-09 — Initial memory bootstrap. Surveyed README, `docs/ARCHITECTURE.md`,
  `docs/DECISIONS.md`, and `src/` layout. Recorded current state (walls, mitered
  junctions, openings, selection/editing, diff-based persisted undo, autosave,
  JSON import/export, theming), known gaps (no image export, no mid-span split, no
  viewport persistence, no rooms/measurements/furniture, no miter limit), and the
  proposed focus order (export → measurements → viewport persistence → rooms).
- 2026-06-10 — First Product Agent run. Created the opening issue batch on GitHub:
  #2 persist viewport, #3 undo/redo keyboard shortcuts, #4 PNG export, #5 on-canvas
  wall-length labels. Updated "Known gaps" to mark these in flight and recorded the
  next follow-ups (SVG export, editable lengths, fit-to-content, selection-in-history,
  rooms) in "focus next". (This entry was reconstructed after the file was briefly
  reverted during debugging — the issues themselves were created successfully.)
