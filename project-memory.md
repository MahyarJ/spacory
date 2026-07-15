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
- **PNG image export** — "Export PNG" toolbar button rasters the plan via
  `buildExportSvg` (`src/geometry/exportSvg.ts`) → `<canvas>` → PNG blob (#4,
  merged).
- **Connection points selectable/draggable** — drag a corner/junction handle and
  every co-located wall endpoint moves together in one commit (#22, merged as
  #27; `src/geometry/connectivity.ts`).
- **Auto-follow connected walls on move/resize** — moving a whole selected wall,
  or type-to-resizing one, also moves the immediate (non-cascading) endpoint of
  any other wall sharing that point, so junctions stay intact (#19, merged;
  `translateSelectedWallsFollowing` in `src/app/store.ts`).
- **Zero-length walls rejected when drawing** (#29, merged).
- **Icon + label toolbar** — toolbar buttons pair each label with an icon:
  `lucide-react` for generic controls, in-house inline-SVG glyphs for the domain
  tools (Wall, Window) in `src/features/toolbar/icons.tsx` (#51). Door borrows
  lucide's `DoorOpen` pending a custom swing glyph (#52). See `docs/DECISIONS.md`.

State lives in one Zustand store (`src/app/store.ts`); `plan` is the single source
of truth and all edits flow through one `commit()` chokepoint. Pure logic
(`src/geometry/`, `src/app/io.ts`, `src/app/history.ts`) is unit-tested with Vitest
(randomized order). CI (Node 24) runs `biome ci` → `tsc -b` → tests.

## Known gaps & open questions

From the README ("Not yet:"), `docs/DECISIONS.md` scope notes, and code reading:

- **PNG image export — done (#4, merged).** Raster export of the plan; SVG
  (vector) export deliberately deferred to a follow-up.
- **No SVG/vector image export — in flight (#33).** Thin wiring follow-up to #4:
  save `buildExportSvg`'s existing markup as a `.svg` file next to "Export PNG";
  no new rendering logic.
- **No mid-span wall splitting** — only shared *endpoints* form junctions. A wall
  ending mid-span of another is not auto-split (DECISIONS.md "Wall junctions").
- **Viewport persistence — done (#2, merged).**
- **Fit to content button — done (#9, merged).**
- **No fit-to-content keyboard shortcut / zoom to selection — in flight (#20).**
  Keyboard shortcut wires `fitView()`; also "zoom to selection" when walls are
  selected. Reuses `computeFitView` from `src/app/viewport.ts`.
- **No miter limit / bevel fallback — done (#34, merged as PR #43).** Very
  acute wall angles produce long spike-like miters; #34 caps the miter at a
  multiple of half-thickness and falls back to a bevel, per
  `docs/DECISIONS.md`'s noted future tweak. Two clarify passes on PR #43
  (2026-07-14): the first floated a decorative "patch cap" for beveled
  corners, which was declined as cosmetic scope creep. The follow-up
  pinpointed a real gap instead — the 2-wall case had no equivalent of the
  3+-wall `junctions` core-fill, leaving an open notch on a beveled 2-wall
  corner; the spec was amended to require the 2-wall bevel to be gap-free
  too, and PR #43 landed that follow-up commit before merging. A residual
  dead-code artifact from this fill (`wedgePoints` writes on the `m === 2`
  path) is tracked as its own cleanup issue, #46.
- **No rooms/areas as first-class objects** — walls and openings exist, but there is
  no notion of an enclosed room, area measurement, or labels. (Needs human product
  input before scoping — see open questions.)
- **On-canvas wall-length labels — done (#5, merged).**
- **Editable wall lengths — done (#11, merged).** Type to resize; angle preserved.
- **Auto-follow connected walls on move/resize — done (#19, merged).** Moving a
  whole selected wall, or type-to-resizing one, moves the immediate endpoint of
  any other wall sharing that point (`translateSelectedWallsFollowing` in
  `src/app/store.ts`), reusing `src/geometry/connectivity.ts`'s primitives. Only
  the immediate endpoint follows — no cascading further through the connectivity
  graph (see "Cascading connected-wall follow" below).
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
- **Cascading connected-wall follow — not yet scoped; needs human input.** #19
  (merged) only follows the *immediate* endpoint a moved wall touches — a chain
  A–B–C (B shares one endpoint with A, its other endpoint with C) does not
  propagate a whole-wall move of A on to C. Whether it *should* is a genuine UX
  question, not just an implementation gap: making it cascade means treating the
  whole connected chain as a single rigid body (every reachable wall translates
  by the same delta), which is a materially different feel from today's "hinge"
  behavior (an unselected neighbor's far endpoint stays put; only the shared
  point moves) — and could mean dragging one wall of a large connected floor
  plan drags much of the building with it. Don't scope an issue for this until a
  human confirms which behavior is wanted (see open questions below).
- **No way to detach a wall from a junction — in flight (#30).** #22 welds and #19
  follows co-located endpoints, but there is no way to pull a **single** wall's
  endpoint out of a shared junction. Since connectivity is implicit in coordinate
  equality, detach = moving that one wall's endpoint to a distinct coordinate (not
  a persistent flag). #30 proposes per-wall endpoint handles on a single selected
  wall; best landed after #19.
- **Connection-point drag can snap onto an unrelated overlapping junction —
  in flight (#48, triaged from a human-submitted bug report).** The live
  connection-point drag (#22/#27) re-derives which wall endpoints belong to
  the dragged junction by matching the *live* (moving) coordinate against all
  walls on every pointer-move tick, rather than fixing the endpoint set once
  at drag start. If the live position merely passes over another junction's
  coordinate (common with grid snapping), that junction's walls get welded in
  and keep moving along, even though the user never meant to merge them.
  Fix: snapshot the junction's endpoints once at grab time (`connectivity.ts`'s
  unused-outside-tests `findConnectedEndpoints` is the natural primitive) and
  keep the existing intentional drop-to-merge behavior unchanged.
- **Attached openings not reconciled when their wall shrinks — done (#38,
  closed).** `item.wallAttach` (offset/length) is never adjusted against the
  wall's current `length` on any resize path (type-to-resize, connection-point
  drag, or a connected wall shrinking via auto-follow), so a door/window can
  end up rendered off the wall. Triaged from a human-submitted idea
  (2026-07-13); chosen fix is reposition-first (clamp offset back within
  bounds), remove only as a last resort (opening no longer fits at any
  offset). PR #39 implements this at the `commit()` chokepoint, but the
  reporter clarified (2026-07-13) that the same clamp/remove must also apply
  **live**, during an in-progress connection-point/wall drag — today's fix
  only reconciles once the drag is committed, since `translateSelected*Live`
  intentionally bypasses `commit()` to avoid spamming undo history. Spec
  updated on #38 to require live parity (reuse
  `reconcileItemsToWalls`/`itemGeometry.ts` from the `*Live` store functions
  too, without pushing a history entry) — this is still open work.

Open questions for the human (confirm before generating issues that depend on
these): target users' top unmet need, whether to prioritize export vs. rooms vs.
measurements, any accessibility/i18n requirements, and — new this run — **should
a whole-wall move cascade through a connected chain as one rigid body, or stay
"hinge" behavior as it is today** (see "Cascading connected-wall follow" above)?

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

Current open issues (as of 2026-07-15): #10 (prune stale selection), #20 (fit
shortcut/zoom to selection), #21 (error boundary), #30 (detach a wall from a
junction), #33 (SVG export), #45 (dispatcher can't recover an orphaned
in-flight label — human-authored automation issue, not a floor-plan product
feature; not this agent's spec to write, left as-is), #48 (connection-point
drag snaps onto unrelated overlapping junctions). #34 and #46 have **merged/
closed**; #48's fix has landed as **PR #49**, labeled `agent:accepted` and
awaiting a human merge. Do **not** re-propose any of these.

The next high-value, well-scoped follow-ups once the current batch is clear (in
rough priority order) are:

1. **Rooms / enclosed areas** — bigger feature (area calc, labels). Still needs
   human product input before scoping (see open questions); defer until answered.
2. **Cascading connected-wall follow** — genuinely needs a human UX call before
   it can be scoped as an issue (rigid-chain vs. hinge behavior); see "Known
   gaps" and the open question above. Do not write this issue until answered.

Once #33 lands, the next cycle should reconcile GitHub state and look for the
next thin, independently-shippable slice — nothing else is currently queued.

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

- 2026-07-15 — Sixth Product Agent run. Reconciled state with GitHub: #46
  (dead `wedgePoints` cleanup) has closed, and #48's fix has landed as PR #49
  (labeled `agent:accepted`, awaiting a human merge). Noted new issue #45
  (dispatcher can't recover a ticket orphaned on a transient in-flight
  label) — a human-authored, already-fully-specced automation issue about
  `.agents/dispatch.sh`, not a floor-plan product feature, so left it as-is
  rather than re-triaging or duplicating it. Created no new issues this
  cycle: the remaining open issues (#10, #20, #21, #30, #33) are already
  well-scoped and untouched by any in-flight PR, and the two blockers on the
  next tier of work — rooms scope, and whether whole-wall moves should
  cascade through a connected chain — still have no human answer. Per the
  prior run's guidance, held off proposing anything new until #33 lands or
  one of those open questions is resolved.
- 2026-07-14 — Triage run on human-submitted bug report #48 ("dragging a
  junction snaps onto another junction it passes over"). Investigated the
  live connection-point drag path (`FloorPlan.tsx` → `store.ts` →
  `connectivity.ts`'s `translateEndpointsAt`): confirmed it re-matches the
  dragged junction's endpoint set against the *live* coordinate on every
  pointer-move tick instead of fixing the set once at drag start, so merely
  transiting over another junction's coordinate (common with grid snapping)
  welds it in permanently for the rest of the drag. Accepted as a genuine bug
  (not a UX quirk) and enriched #48 into a full spec: snapshot the junction's
  endpoints once at grab time via the existing-but-unused
  `findConnectedEndpoints`, preserve intentional drop-to-merge behavior, add
  regression test coverage. Also reconciled GitHub state while here: #38
  (reconcile openings on wall shrink) has closed since the last run.
- 2026-07-14 — Re-triage of human-submitted idea #46 ("dead `wedgePoints`
  writes for `m === 2` in `junction.ts`"). A prior triage pass had
  **rejected** #46 because the dead code lived only in PR #43, which was
  still open/unmerged at the time — cosmetic cleanup of unmerged work isn't a
  backlog item. The reporter followed up: PR #43 (implementing #34,
  miter-limit/bevel) has since **merged** to `main`, and the engineer
  declined to fold the cleanup into that PR as scope drift. Re-checked the
  merged `src/geometry/junction.ts`: the dead `wedgePoints.push` calls for
  the `m === 2` case are indeed present on `main`. Reversed the verdict to
  **accepted** and enriched #46 into a full spec (guard the two dead pushes
  with `m >= 3`, add a regression test, behavior-preserving). Also updated
  "Known gaps"/"focus next" to mark #34 done (merged as PR #43).
- 2026-07-14 — Second clarify run on PR #43 (issue #34). Reporter clarified that
  the earlier "patch cap" question was really pointing at a genuine gap: 3+-wall
  junctions fill the beveled wedge cleanly, but the 2-wall case has no
  equivalent core-fill (`m >= 3` guard in `computeWallGeometry`), so a beveled
  2-wall corner leaves an open notch — inconsistent with the 3+-wall case and
  with #34's "clean, bounded corner" promise. Reversed the prior "cosmetic,
  not a defect" read for this specific complaint: added a new acceptance
  criterion to #34 requiring the 2-wall bevel to be gap-free (reuse the
  existing base-point fill approach, no new visual language), kept the
  decorative "patch cap" idea itself out of scope. PR #43 needs a follow-up
  commit to satisfy the amended spec before it's mergeable.
- 2026-07-14 — Clarify run on PR #43 (#34's miter-limit/bevel fallback, already
  accepted). A human asked whether the plain bevel fallback at very acute
  corners should be visually "patched" with a small square/rect cap, since
  the wall ends otherwise look uncured. Decided no spec change: the plain
  bevel is the documented, intentional behavior and matches common
  `stroke-miterlimit`-style convention, so this isn't a defect in #34/#43.
  Logged the patch-cap idea as a candidate future cosmetic enhancement under
  "Known gaps" rather than opening an issue — no evidence yet it's worth
  prioritizing over the current backlog.
- 2026-07-13 — Clarify run on #38: reporter followed up that the landed fix
  (PR #39) only reconciles openings at `commit()` time, so during a live
  connection-point/wall drag the opening still renders off-bounds until
  pointer-up. Decided live parity is required (clamp/remove during the drag
  preview too, reusing `reconcileItemsToWalls`), and rejected the alternative
  of deliberately showing the opening off-bounds mid-drag as a "distance"
  cue — a truthful live preview beats a surprising one for this tool. Updated
  #38's spec (Chosen behavior, acceptance criteria, Technical context) to
  require this; PR #39 will need follow-up work before #38 is fully done.
- 2026-07-13 — Triage run on human-submitted idea #38 ("windows/doors go off
  the wall after it's shrunk"). Confirmed the root cause in the code: no
  resize path (type-to-resize, connection-point drag, connected-wall
  auto-follow) reconciles `item.wallAttach` against the wall's new `length`.
  Accepted and enriched: chose reposition-first (clamp the opening back
  within the wall's new bounds), remove-as-last-resort (only when the
  opening no longer fits at any offset) — rejected "block the resize"
  (punishes an unrelated action) and "always remove" (too destructive) as
  the primary behavior. Scoped the fix to the shared `commit()` chokepoint so
  every resize path is covered by one pure, tested reconciliation function.
  Rewrote #38's title/body into a full spec and posted the triage verdict.
- 2026-07-13 — Triage run on human-submitted idea #35 ("deploy the app on main
  update"). Accepted and enriched: scoped tightly to a GitHub Pages deploy
  gated on green CI on `main` (no backend, no secrets, no new hosting
  decision — fits the client-only architecture as-is). Rewrote #35's title/body
  into a full spec (GitHub Actions Pages deploy, `vite.config.ts` base-path
  check, README link) and posted the triage verdict; left custom domain, PR
  previews, and other hosts out of scope.
- 2026-07-13 — Fifth Product Agent run. Checked GitHub: no change since the last
  run — #10, #20, #21, #30, #33, #34 are all still open with zero comments, and
  there are no open PRs at all (the Engineer Agent hasn't started any of them
  yet). No human input has landed on either open product question (rooms scope;
  whether whole-wall moves should cascade through a connected chain). Per the
  prior run's note ("nothing else is currently queued" until #33/#34 land), took
  no action this cycle — created no issues and made no substantive edits, since
  there is nothing to reconcile and no new information to scope against.
- 2026-07-12 — Fourth Product Agent run. Reconciled state with GitHub: #4 (PNG
  export), #19 (auto-follow connected walls), and #22/#27 (select/drag connection
  points) have all **merged** since the last run; #28/#29 (reject zero-length
  walls) also merged. Only #10, #20, #21, #30 remain open from prior batches.
  Updated "Current state" and "Known gaps" to reflect all of the above. Created
  the fourth issue batch: **#33** SVG (vector) export (thin follow-up to #4,
  reuses `buildExportSvg`'s markup as-is) and **#34** miter-limit/bevel fallback
  for acute wall junctions (resolves the documented `DECISIONS.md` gap in
  `geometry/junction.ts`). Did **not** open a cascading-connected-wall-follow
  issue: on inspection this isn't just an implementation gap but a real UX fork
  (rigid-chain-body vs. today's hinge behavior) — recorded as a new open question
  for the human instead of guessing. Rooms remain deferred pending human input.
- 2026-07-11 — Human-directed issue creation. After #22/#27 (drag a connection
  point → co-located endpoints move together) and #19 (open; whole-wall moves make
  connected walls follow), a human noted there's no way to do the **opposite** —
  pull one wall out of a junction. Confirmed the gap and that connectivity is
  implicit in coordinate equality (no node object), so "disconnect" must mean
  moving one wall's endpoint to a distinct coordinate, not a persistent flag. This
  is the follow-up #22 explicitly deferred ("splitting a junction"). Created
  **#30** Detach a single wall's endpoint from a junction (enhancement) — proposes
  per-wall endpoint handles on a single selected wall, reuses
  `connectivity.ts`/`getWallLength` guards, best sequenced after #19. No new open
  questions.
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
