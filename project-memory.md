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
  `src/app/history.ts`; survives a page refresh. Keyboard shortcuts `Cmd/Ctrl+Z` /
  `Shift+Z`-redo / `Ctrl+Y` shipped (#3, merged).
- **Autosave** — whole undo history persisted to `localStorage` on each commit
  (`src/app/persistence.ts`); rehydrated on startup.
- **Import / export** — save/load a plan as JSON through a single validated boundary
  (`src/app/io.ts`).
- **Canvas** — pan (right-drag or Pan tool) and zoom (wheel); the viewport
  (pan/zoom) persists across reloads, autosaved separately from the plan
  (`src/app/viewport.ts`).
- **Dimensions** — each wall shows its length as an on-canvas label
  (`src/features/canvas/DimensionsLayer.tsx`); display-only.
- **Editable wall lengths** — select a wall and type an exact length to resize it
  (anchor endpoint `a`, move endpoint `b`; angle preserved) (#11, merged).
- **Fit to content** — toolbar "Fit" button frames the whole plan in one click,
  using `computeFitView` in `src/app/viewport.ts` and `getPlanBounds` in
  `src/geometry/bounds.ts` (#9, merged).
- **Floating wall options bar** — thickness controls float over the canvas and no
  longer shift the layout when they appear/disappear (#14, merged).
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
  Blocked until #4 merges (reuses #4's content-SVG + bounds helper).
- **No mid-span wall splitting** — only shared *endpoints* form junctions. A wall
  ending mid-span of another is not auto-split (DECISIONS.md "Wall junctions").
- **Viewport persistence — done (#2, merged).**
- **Fit to content button — done (#9, merged).**
- **No fit-to-content keyboard shortcut / zoom to selection — in flight (#20).**
  Keyboard shortcut wires `fitView()`; also "zoom to selection" when walls are
  selected. Reuses `computeFitView` from `src/app/viewport.ts`.
- **No miter limit / bevel fallback** — very acute wall angles produce long
  spike-like miters; a miter limit is noted as a possible future tweak.
- **No rooms/areas as first-class objects** — walls and openings exist, but there is
  no notion of an enclosed room, area measurement, or labels. (Needs human product
  input before scoping — see open questions.)
- **On-canvas wall-length labels — done (#5, merged).**
- **Editable wall lengths — done (#11, merged).** Type to resize; angle preserved.
- **Auto-follow connected walls on move/resize — in flight (#19).** When a wall's
  endpoint moves, walls sharing that endpoint coordinate should follow.
  The pure connectivity helpers this needs now already exist (shipped with
  #22/#27): `findConnectedEndpoints`, `pointsEqual` (epsilon-based), and
  `translateEndpointsAt` in `src/geometry/connectivity.ts`. #19 consumes them and
  wires the whole-wall move paths (`translateSelectedWalls`, type-to-resize) to
  follow — distinct from #22 (which drags a connection point). #19's body was
  realigned to reuse these rather than re-create a helper.
- **No editable units / unit switching** — changing `plan.meta.units` from the UI is
  not yet scoped (explicitly out of scope of #11).
- **No furniture / fixtures** — only doors and windows; no other placeable objects.
- **Undo/redo keyboard shortcuts — done (#3, merged).**
- **Selection not pruned after undo/redo — in flight (#10).** A stored
  `selectedWalls`/`selectedItems` can reference walls/items that no longer exist
  after undo/redo; #10 prunes the selection to ids present in the new plan. (Full
  selection-in-history timeline remains explicitly out of scope.)
- **No error boundaries — in flight (#21).** An unexpected render error takes down
  the whole app rather than being contained; #21 adds a React error boundary.
- **Connection points selectable/draggable — done (#22, merged as #27).** A user
  can select and drag the corner/junction handle where walls meet and all
  co-located wall endpoints follow in one commit. This shipped **first** and built
  the pure connectivity primitives in `src/geometry/connectivity.ts`
  (`findConnectedEndpoints`, `pointsEqual`, `getConnectionPoints`,
  `translateEndpointsAt`, Vitest-tested) that #19 now reuses.

Open questions for the human (confirm before generating issues that depend on
these): target users' top unmet need, whether to prioritize export vs. rooms vs.
measurements, and any accessibility/i18n requirements.

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

Current open issues (as of 2026-07-05): #4 (PNG export), #10 (prune stale
selection), #19 (auto-follow connected walls), #20 (fit shortcut/zoom to
selection), #21 (error boundary), #22 (select/drag connection points). Do **not**
re-propose any of these.

The next high-value, well-scoped follow-ups once the current batch is clear (in
rough priority order) are:

1. **SVG (vector) export** — follow-up to #4; reuses #4's content-SVG/bounds helper.
   **Blocked until #4 merges** — don't open it before then.
2. **Cascading connected-wall follow** — follow-up to #19: once the immediate-
   endpoint follow ships, scope cascading (wall A→B→C: moving A's endpoint also
   cascades to C via B). Needs careful definition to avoid cycles.
3. **Rooms / enclosed areas** — bigger feature (area calc, labels). Still needs human
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

Newest first (reverse-chronological). Add each new entry at the **top** of this list.

- 2026-07-05 — Human-directed issue creation. A human noticed that connection points
  (the corners/junctions where walls meet) still can't be selected or dragged — only
  edges (walls) can. Confirmed against the code: no node/connection object exists
  (connectivity is implicit in shared endpoint coordinates), selection tracks only
  `selectedWalls`/`selectedItems`, and `SelectionLayer.tsx` renders no endpoint
  handles. Verified no existing issue covers it (#19 is the closest but is about
  auto-follow, not grabbing a junction). Created **#22** select/drag connection
  points (corner/junction handles), building on #19's connectivity helper. Added it
  to "Known gaps" and the focus-next open-issues list.
- 2026-06-30 — Third Product Agent run. Reconciled state with GitHub: #3 (undo/redo
  shortcuts), #9 (fit-to-content), #11 (editable wall lengths), and #14 (floating
  wall options bar) have all **merged** since the last run. Only #4 (PNG export) and
  #10 (prune stale selection) remain open from prior batches. Updated "Current state"
  to record all merged work. Created the third issue batch: **#19** auto-follow
  connected walls on move/resize, **#20** fit-to-content keyboard shortcut + zoom to
  selection, **#21** error boundary. Refreshed "Known gaps" and "focus next" (SVG
  export still blocked on #4; cascading wall-follow and rooms are the next horizon).
- 2026-06-16 — Second Product Agent run. Reconciled state with GitHub: #2 (viewport
  persistence) and #5 (wall-length labels) have merged; #3 (undo/redo shortcuts) and
  #4 (PNG export) remain open/in flight. Updated "Current state" to record the shipped
  viewport persistence and on-canvas dimension labels. Created the second issue batch:
  **#9** "Fit to content / Reset view" button, **#10** prune stale selection after
  undo/redo, **#11** editable wall lengths (type to resize, anchor `a`/move `b`).
  Refreshed "focus next" (SVG export still blocked on #4; new follow-ups: auto-follow
  connected walls, fit shortcut/zoom-to-selection, error boundary). No new open
  questions for the human.
- 2026-06-10 — First Product Agent run. Created the opening issue batch on GitHub:
  #2 persist viewport, #3 undo/redo keyboard shortcuts, #4 PNG export, #5 on-canvas
  wall-length labels. Updated "Known gaps" to mark these in flight and recorded the
  next follow-ups (SVG export, editable lengths, fit-to-content, selection-in-history,
  rooms) in "focus next". (This entry was reconstructed after the file was briefly
  reverted during debugging — the issues themselves were created successfully.)
- 2026-06-09 — Initial memory bootstrap. Surveyed README, `docs/ARCHITECTURE.md`,
  `docs/DECISIONS.md`, and `src/` layout. Recorded current state (walls, mitered
  junctions, openings, selection/editing, diff-based persisted undo, autosave,
  JSON import/export, theming), known gaps (no image export, no mid-span split, no
  viewport persistence, no rooms/measurements/furniture, no miter limit), and the
  proposed focus order (export → measurements → viewport persistence → rooms).
