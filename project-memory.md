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
- **Export menu** — Import stays a top-level toolbar button; the export formats
  (JSON, PNG) live behind one **Export** menu button (`src/ui/Menu.tsx`,
  `ProjectActions.tsx`), which SVG export (#33) will extend with a third entry
  (#66, merged as PR #69).
- **Connection points selectable/draggable** — drag a corner/junction handle and
  every co-located wall endpoint moves together in one commit (#22, merged as
  #27; `src/geometry/connectivity.ts`).
- **Auto-follow connected walls on move/resize** — moving a whole selected wall,
  or type-to-resizing one, also moves the immediate (non-cascading) endpoint of
  any other wall sharing that point, so junctions stay intact (#19, merged;
  `translateSelectedWallsFollowing` in `src/app/store.ts`).
- **Zero-length walls rejected when drawing** (#29, merged).
- **Toolbar icon + label buttons** — every toolbar button pairs its text label with
  an icon (`lucide-react` for generic controls, hand-drawn inline-SVG for Wall/Window
  in `src/features/toolbar/icons.tsx`); Door temporarily borrows lucide's `DoorOpen`
  pending a custom swing glyph (#52) (#51, merged as PR #53).
- **Drag-creation for openings** — doors/windows can be placed by press-drag-release
  along a wall (mirroring the wall tool's dual-gesture pattern), alongside the
  existing click-click flow; reuses the preview, grid snapping, 30 cm tolerance, and
  5 cm min-width (#55, merged as PR #56).
- **Detach a wall's endpoint from a junction** — when exactly one wall is selected,
  square endpoint handles (`WallEndpointsLayer`) let you drag just that wall's end
  out of a shared junction while co-located endpoints stay put (#30, merged as PR
  #58; `pickWallEndpoint` in `src/geometry/connectivity.ts`).
- **Resize a door/window opening & show its width** — a single selected opening gets
  a width field in the floating options bar, mirroring the wall-length field; the
  pure clamp/keep-on-wall helper lives in `src/geometry/opening.ts` (#60, merged as
  PR #65). **Not yet in the README** — see #78.
- **Export menu** — the toolbar's export formats (JSON plan, PNG image) are grouped
  under one **Export** dropdown built on a shared, keyboard/ARIA-correct `Menu`
  (`src/ui/Menu.tsx` + pure `src/ui/menuNavigation.ts`); Import stays a separate
  top-level button (#66, merged as PR #69).
- **Tablet-ready chrome** — the toolbar wraps instead of clipping below the 768 px
  breakpoint (`--sp-bp-tablet` in `src/theme.css`) and every chrome control gets a
  44 px (`--sp-touch-target`) *hit area* on a coarse pointer via an invisible
  `::after` overlay, so the painted buttons keep their desktop size; the canvas
  pan/zoom tip is hidden on a coarse pointer by the pure `src/app/canvasHint.ts`
  (#85, merged as PR #89). The floating options bar's own controls were **not**
  covered — see the #93 bullet under Known gaps.
- **On-screen Remove / Hinge / Swing controls** — the floating options bar now shows
  editing buttons for **any non-empty selection** (not just a single wall/item), on
  every pointer kind, with Hinge/Swing appearing whenever the selection contains at
  least one door; the "which controls apply" decision is a pure tested function in
  `src/app/selection.ts`. Makes the three keyboard-only verbs reachable without a
  keyboard (#93, merged as PR #95).
- **Touch-drawable canvas** — `touch-action` scoped to the canvas so one finger
  runs the active tool, two fingers pan and pinch-zoom whatever the tool (pure
  multi-touch math in `src/app/viewport.ts`), and `pointercancel` aborts a gesture
  without committing, restoring both plan and selection (#84, merged as PR #91).

State lives in one Zustand store (`src/app/store.ts`); `plan` is the single source
of truth and all edits flow through one `commit()` chokepoint. Pure logic
(`src/geometry/`, `src/app/io.ts`, `src/app/history.ts`) is unit-tested with Vitest
(randomized order). CI (Node 24) runs `biome ci` → `tsc -b` → tests.

## Known gaps & open questions

From the README ("Not yet:"), `docs/DECISIONS.md` scope notes, and code reading:

- **PNG image export — done (#4, merged).** Raster export of the plan; SVG
  (vector) export deliberately deferred to a follow-up.
- **No SVG/vector image export — in flight (#33).** Thin wiring follow-up to #4:
  save `buildExportSvg`'s existing markup as a `.svg` file; no new rendering logic.
  **Respecced 2026-07-29** (clarify run, at the human's prompting) now that the
  Export menu has shipped: #33 adds a **third entry ("SVG") inside the existing
  Export menu**, appended after "JSON" and "PNG" — *not* a fourth flat toolbar
  button, which would undo #66. Menu structure/styling and the existing entries
  stay out of scope; the icon glyph is the engineer's choice.
- **Exports clip door swing arcs near the plan's edge — open gap, no issue yet
  (found 2026-07-30 on PR #82).** `getPlanBounds` (`src/geometry/bounds.ts`) pads each
  item only by `item.thickness / 2` around its wall centerline, but a door's swing arc
  has `radius = opening length` (`getDoorGeometry`, `src/geometry/itemGeometry.ts`) and
  sweeps *perpendicular* to the wall. So an ~80 cm door on a perimeter wall opening
  outward overflows the content box by roughly its own leaf length, and
  `EXPORT_MARGIN = 40` cm doesn't cover it — the arc is cut off at the export edge.
  **Affects PNG export too** (both formats frame off `buildExportSvg`, since #4), so
  this is pre-existing and *not* caused by #33/#82, whose scope explicitly excludes
  `buildExportSvg`'s visual output. Product call (clarify on #82, 2026-07-30): fix it
  in the **bounds**, not by inflating `EXPORT_MARGIN` — a fixed margin can't scale with
  wider openings and would pad every plan, whereas including the arc's actual extent in
  `getPlanBounds` is exact, testable pure logic, and fixes both formats at once. Also
  audit the window midline/leaf line for the same overflow. Next cycle should scope this
  as its own thin issue.
- **Export formats grouped under one Export menu — done (#66, merged as PR #69).**
  `ProjectActions.tsx` renders Import (JSON) as its own button plus a `Menu`
  (`src/ui/Menu.tsx`) labelled **Export** whose `items` are `json` and `png`.
  Product calls that still bind: **only exports are grouped** — Import stays its own
  top-level button (different action, and folding it in would turn this into a vaguer
  "File" menu) — and **#66 did not add SVG export** (#33 owns that; #66 built the
  place it lands). Spec pinned
  behavior parity (same contents/filenames/error alerts), close-on
  select/Escape/outside-click/blur, keyboard + screen-reader support, floating over
  the canvas without layout shift, and theming via the existing CSS variables.
  **Amended 2026-07-28** during PR #69's review: the entries' text size must match the
  toolbar buttons' by sharing one explicit declaration (a font size on the toolbar's
  button class, or a token in `src/theme.css`), not a pixel literal tuned to the
  browser's default control font; that one toolbar-style touch is the sole exception to
  the "no toolbar restyling" exclusion.
- **Canvas shortcuts fire while a toolbar control has focus — in flight (#77, scoped
  2026-07-29).** `h`, `s`, `[`, `]`, `Delete`/`Backspace` **and the arrows** reach
  `FloorPlan`'s `window` keydown listener and edit the plan even when focus sits on a
  toolbar button, so a user tabbing through the toolbar can mutate the plan by typing.
  The listener's only guard skips `INPUT`/`TEXTAREA`/`SELECT`/`contentEditable` —
  buttons aren't covered. Pre-existing and not caused by #66; PR #69 only worked around
  it locally via `stopPropagation` in `Menu.tsx` while its menu is open (that code's own
  comment names the leak and notes "a closed trigger … leaks them as before"). Product
  calls settled in #77: **focus inside the toolbar suppresses the canvas verbs**, with
  **`Escape` the one exception** (non-destructive, universally "get me out"; the open
  menu still consumes its own Escape first), and **undo/redo stay global** (app
  commands, not canvas verbs). `Delete` semantics on the canvas are unchanged.
- **Desktop-only UI; no responsive or touch support — now a two-issue front
  (#84, #85; triaged 2026-07-30 from human-submitted ideas).** Verified in code:
  `src/theme.css` holds the only `@media` queries in `src/` (both
  `prefers-color-scheme`), there are **no width breakpoints and no `touch-action`
  declarations anywhere**, `.toolbar` is a single non-wrapping flex row of ~14
  controls that **clips Undo/Redo off-screen at iPad portrait width (768 px)**,
  toolbar buttons are ~28–30 px tall (under a comfortable touch target), and
  `App.module.css` uses `100vh` (which on iOS Safari hides the bottom of the canvas
  under the browser chrome). Split into two independent issues on purpose, because
  the submitted #85 was an epic spanning gestures + layout + two device classes:
  - **#84 — canvas touch gestures** (tap-and-drag scrolls instead of drawing; owns
    `touch-action`, one/two-finger pan, pinch zoom). **Higher user impact — on iPad
    you currently cannot draw at all.** **Triaged & enriched 2026-07-30**, retitled
    "Make the canvas drawable by touch: one-finger tool gestures, two-finger pan and
    pinch zoom." Premise confirmed in code: **zero `touch-action` declarations in
    `src/`**, so the browser claims the finger drag before `FloorPlan.tsx`'s pointer
    handlers see it. Two same-root-cause gaps folded in: touch has no pan/zoom path
    (pan = `e.button === 2` right-drag or the Pan tool, zoom = `onWheel` only) and
    there is **no `onPointerCancel`**, so a browser-stolen gesture leaves
    `drawingWall`/`moving*`/`beginLiveDrag()` stuck. Product calls: **one finger =
    the active tool's gesture, two fingers = pan + pinch with any tool active**
    (never forces a trip to the Pan tool); pinch anchors on the finger midpoint the
    way wheel zoom anchors on the cursor; **never disable page zoom** to fix it
    (no `user-scalable=no`/`maximum-scale=1` — suppression is scoped to the canvas
    via `touch-action`); the **multi-touch viewport math must live in a pure tested
    module** (`src/app/viewport.ts`, beside `clampScale`/`computeFitView`) since
    there's no browser e2e and jsdom can't do real multi-touch; one undo entry per
    completed touch edit, none for pan/pinch, and `pointercancel` aborts without
    committing.
    **Delivered by PR #91 (accepted 2026-07-31 on `13325d8`; awaiting merge).**
    Clarify pass 2026-07-31 settled the leftovers: **abandoning a gesture restores
    the *selection*, not just the plan** — `cancelLiveDrag` snapshots
    `selectedConnectionPoint` in `beginLiveDrag` and puts it back, and the arm order
    matters (select *then* snapshot, so a wall grab doesn't resurrect the junction
    selection it replaced). Two review rounds converged on that rule and
    `DECISIONS.md` records only the plan rollback, so **fold one sentence about the
    selection restore into its `cancelLiveDrag` vs `endLiveDrag` paragraph** in the
    next docs pass (deliberately not held against #91 — one doc line doesn't justify
    another CI round on an approved PR). Also decided: **do not advertise the new
    touch gestures on the canvas** — two-finger pan/pinch is the gesture people
    arrive with from maps and photos, and a standing label spends the smallest
    viewport's scarce space teaching it; if discoverability proves to be a real
    problem, the answer is a **dismissible first-run hint**, which needs its own
    issue. #84's Docs criterion was amended the same day (it still claimed the
    "Not yet:" line needed no change, which #85 falsified).
  - **#85 — the app shell + toolbar at tablet widths** (triaged & enriched this
    run, retitled "Make the toolbar and app shell usable at tablet (iPad) widths").
    Product calls: the desktop `Tip: Right-drag to pan, Wheel to zoom` label is
    **hidden** on a coarse pointer rather than replaced with touch instructions
    (promising gestures #84 hasn't built yet would be a lie), that hint decision
    goes in a **pure tested helper** (the `src/ui/menuNavigation.ts` shape) since
    jsdom has no layout engine to assert the CSS on, ≥44 px targets under
    `@media (pointer: coarse)`, `dvh`/`dvw` for the shell, **breakpoints as shared
    tokens** in `theme.css` (the reusable "primitives" the human asked for), and
    **pinch-zoom must not be disabled** (no `user-scalable=no`).
    **Clarify pass 2026-07-31 (PR #89) pinned the width-vs-pointer split, and it is
    the rule the phone pass inherits:** *spacing/layout* rules (toolbar `gap`, side
    padding, wrapping) are keyed on **viewport width**, so a mouse window narrowed
    below the breakpoint gets the tablet spacing — intended, since the clipping
    problem is a width problem; *sizing* rules (the 44 px touch-target floors) are
    keyed on **`pointer: coarse`**, so a mouse user never sees them at any width.
    "No desktop regression" therefore means *above* the 768 px breakpoint only.
    Criterion 7 of #85 was amended to say so. Also decided: the relocated canvas tip
    stays at 12 px on a `--sp-panel` background, matching `FloorPlan`'s existing
    bottom-left `.badge`, so the two corner captions read as one family.
    **Clarify pass 2026-07-31 (second, PR #89) settled what "44 px" means, and this
    is also inherited by the phone pass:** the **tap target** must be 44 × 44 px,
    **not the painted control**. A coarse-pointer control keeps its desktop height,
    padding, radius and font and extends only its *hit area* (an out-of-flow
    transparent overlay centred on the box) — the human objected that inflating the
    painted boxes made the touch toolbar look unlike the desktop one ("the buttons
    look fat… the theme switch is circular and big"), and the overlay satisfies both
    at once, so it is the preferred technique, not a compromise. Constraints: the hit
    area must stay inside the toolbar's bounds (never over drawable canvas) and
    wrapped rows must not overlap; stacked full-width popup rows (`src/ui/Menu`) are
    the exception and keep a real `min-height`. Criterion 2 of #85 was amended to
    say so. Consequence worth carrying: the criterion's value is now **invisible in
    review** and unassertable in jsdom — it is the **top** candidate for the first
    Cypress/Playwright viewport test, ahead of the wrap geometry.
  **Both merged 2026-08-01** (#85 as PR #89, #84 as PR #91), so the tablet front is
  shipped and the third issue below is what it exposed.
  Explicit follow-ups left out of both: **phone-width layout** (below ~600 px),
  **stylus / Apple Pencil specifics** (pressure, tilt, palm rejection — the human
  called these out as motivating, worth its own issue once touch drawing works),
  and finger-sizing the **on-canvas** interaction targets (belongs with #84).
- **Editing verbs are keyboard-only, so a touch user can draw but not edit — in
  flight (#93, triaged & enriched 2026-08-02 from a human-submitted idea).**
  Verified in `src/features/canvas/FloorPlan.tsx`: `deleteSelected`,
  `toggleSelectedDoorHingeEdge` and `toggleSelectedDoorSwingSide` are reachable
  **only** from the `window` keydown listener (`Delete`/`Backspace`, `H`, `S`), so
  after #84/#85 shipped, a tablet user can draw, place and select and then cannot
  remove or adjust anything — while `HintBar` advertises the very shortcuts the
  device can't press. Retitled "Add on-screen Remove, Hinge and Swing controls so a
  selection can be edited without a keyboard." Product calls: the **floating
  options bar** (`WallOptionsBar`) is the affordance, not a new canvas gesture, and
  its visibility must widen from "exactly one wall/item" to **any non-empty
  selection** (otherwise a marquee multi-selection stays undeletable — the most
  common "I drew the wrong thing" case); the controls show for **every pointer
  kind**, *not* gated on `(pointer: coarse)` — one code path, it makes three
  undiscoverable shortcuts discoverable for mouse users too (tooltip names the
  accelerator rather than replacing it), and a hybrid device that mis-reports its
  pointer kind can't end up with no way to delete; **Hinge/Swing appear whenever
  the selection contains at least one door**, mirroring what the store actions and
  `HintBar`'s `hasSelectedDoor` already do rather than inventing single-door
  semantics; the "which controls apply" decision goes in **`src/app/selection.ts`**
  as a pure tested function (the `canvasHint.ts` / `menuNavigation.ts` pattern), and
  a jsdom test must assert the buttons are *wired* (click Remove → wall gone from
  the plan), not merely rendered. Two explicit out-of-scopes are themselves gaps
  worth a later ticket: **(a) the third keyboard-only verb, `[`/`]` wall thickness**
  — a button isn't enough, it needs a product call on whether the existing preset
  pills should retarget the current selection instead of the next-wall default; and
  **(b) the options bar's *existing* controls (thickness pills, length/width number
  inputs) never got the 44 px coarse-pointer treatment** that `Toolbar.module.css` /
  `Menu.module.css` / `ThemeSwitch.module.css` have — a leftover from #85, not
  caused by #93. **(b) is now ticketed as #94** (created this cycle run).
- **No mid-span wall splitting — in flight (#96, triaged & enriched 2026-08-03 from
  a human-submitted idea).** Only shared *endpoints* form junctions, so a wall
  ending mid-span of another is not auto-split (DECISIONS.md "Wall junctions"
  Scope paragraph; README "Not yet"). Verified in code: `connectivity.ts` defines
  connectivity as endpoint coordinate equality (`pointsEqual`), so a mid-span T is
  invisible to the mitered junction geometry, to auto-follow (#19) and to the
  junction drag (#22/#27) — the walls look joined and come apart on the first edit.
  Retitled "Split a wall where another wall ends on it, so mid-span T-junctions are
  really connected." Product calls pinned: **split the host wall rather than
  introducing a persistent "these walls are joined" relation** — splitting yields
  the shared coordinate the whole app already reacts to, so the T-junction fill,
  the follow-on-move and the junction handle all work with no new model concept,
  whereas a stored relation would contradict the settled coordinate-equality model;
  **"on the wall" means inside the host's drawn body** (perpendicular distance
  ≤ `thickness / 2`) with the touching endpoint snapped exactly onto the projection
  (the human's "mid-snap"), and the split point must stay `MIN_WALL_LENGTH` clear
  of the host's own endpoints so a near-miss *corner* is left alone instead of
  producing a sliver; **openings on the host must survive**, rebased onto whichever
  segment holds them, with a straddler moved into the larger side and removed only
  as a last resort — the same reposition-first rule `reconcileItemsToWalls` already
  applies (#38's settled precedent). Hooked at the **`commit()` chokepoint** beside
  that reconcile, so draw / move / endpoint drag / type-to-resize are covered by one
  call site and the split rides in a single undo step; live drags bypass `commit()`,
  so nothing splits mid-gesture. Idempotence is its own criterion (after the split
  the endpoint sits on a segment *endpoint*, so it can't re-split). Explicit
  out-of-scopes, each a plausible follow-up: **X crossings** where neither wall ends
  on the other, **welding near-miss corners**, **un-splitting** when the touching
  wall is later deleted (the host stays two segments), **retro-splitting imported
  plans** (`loadDocument` builds history via `createHistory`, not `commit()`), and a
  **snap preview/indicator while drawing**. Note this is the prerequisite for rooms /
  enclosed areas. Did not add `agent:ready` (a human promotes it).
  **Delivered by PR #97** (accepted 2026-08-03 on `82d8348`, verdict *accepted pending
  non-code fixes* — the only thing left is the PR description, the Engineer Agent's
  artifact). The implementation lesson worth carrying, and the reason it took three
  review rounds: **the connection-point selection is tracked by coordinate, so any
  feature that moves an endpoint inside `commit()` silently invalidates a held
  junction handle** — the handle stays at its pre-split coordinate, invisible (the
  layer only highlights a coordinate an endpoint actually sits at) but still live
  (arrow keys route on `selectedConnectionPoint != null`), so the next keypress
  un-welds the junction just created. Patched per-call-site twice and still leaked
  (`addWall`, then the door toggles, which have no early return and fire on bare
  `h`/`s`); the settled shape is **structural — `commit(next, heldPoint)` returns the
  plan *and* the followed selection**, so all 11 call sites get it by construction.
  Clarify pass 2026-08-03 amended three of #96's criteria to match what shipped:
  the multi-touch criterion now names the two cases where the global
  "no sub-`MIN_WALL_LENGTH` wall" invariant beats a literal split (two touches closer
  than `MIN_WALL_LENGTH` weld into one junction; a touch that would shorten the
  *touching* wall below the minimum is skipped); the near-corner criterion now says
  the protected band is only `MIN_WALL_LENGTH` = 1 cm; and "the new junction is an
  ordinary junction" now carries the held-handle requirement above instead of
  claiming the junction needs "no new code."
- **Un-splitting and stub tidying after a mid-span split — open gap, no issue yet
  (surfaced during PR #97's acceptance, 2026-08-03; next cycle should ticket it).**
  Two related loose ends the split (#96) deliberately left: (a) **delete the T-wall
  and the host stays as two collinear segments**, so the user sees two length labels
  where they had one and the plan carries a seam that no longer means anything —
  merging collinear segments that share a now-2-wall junction is the fix; and (b) an
  endpoint that overshoots a corner by more than `MIN_WALL_LENGTH` (1 cm) **does**
  split and leaves a short stub segment, because that is all the "near a corner, do
  nothing" guard protects. Both are cleanup of the same shape (short/meaningless
  segments left behind), so scope them as **one** thin issue rather than two. Note the
  product call already on record: widening the *weld* band so near-miss corners snap
  together is a **different** feature ("welding near-miss corners", still out of
  scope) — this gap is only about not leaving debris behind.
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
- **Toolbar icon + label buttons — done (#51, merged as PR #53).** Every toolbar
  button pairs its text label with an icon (`lucide-react` for generic controls,
  hand-drawn inline-SVG for Wall/Window in `src/features/toolbar/icons.tsx`), per
  `docs/DECISIONS.md`. Door temporarily borrows lucide's `DoorOpen`; **#52** (open)
  tracks its replacement with a custom plan-view swing glyph.
- **On-canvas wall-length labels — done (#5, merged).**
- **Editable wall lengths — done (#11, merged).** Type to resize; angle preserved.
- **Auto-follow connected walls on move/resize — done (#19, merged).** Moving a
  whole selected wall, or type-to-resizing one, moves the immediate endpoint of
  any other wall sharing that point (`translateSelectedWallsFollowing` in
  `src/app/store.ts`), reusing `src/geometry/connectivity.ts`'s primitives. Only
  the immediate endpoint follows — no cascading further through the connectivity
  graph (see "Cascading connected-wall follow" below).
- **No editable units / unit switching — in flight (#63).** The unit model already
  exists (`Units` in `schema.ts`; `plan.meta.units`; `formatLength` converts cm →
  cm/m/mm/in/ft) but is **unreachable** — no UI changes `plan.meta.units`, so it's
  stuck at the `cm` default. #63 adds a units selector (through `commit()`), makes
  the selected-wall length field convert both ways (it currently shows/parses raw cm
  while mislabelling itself with `plan.meta.units` — a dormant bug that only a unit
  switcher would expose), and adds the pure inverse of `formatLength`
  (`lengthToCm`) in `format.ts` with tests. Was previously out of scope of #11.
  Thickness presets and compound imperial entry left as explicit follow-ups.
- **Inline number fields don't commit on click-away to the canvas — in flight (#76,
  scoped 2026-07-29; confirmed as a real UX defect by the clarify on PR #65,
  2026-07-27).** The selected-wall length field (#11, shipped) and the
  opening-width field (#60, merged as PR #65) both apply the typed value only on Enter/blur;
  clicking on the canvas (rather than tabbing/Enter) silently discards what the
  user just typed instead of committing it. Product decision: click-away **should**
  commit — the field already commits on blur, so this is an inconsistency and a
  silent-data-loss surprise, not intended behavior. It's a **pre-existing,
  cross-cutting** issue (originated with #11; the opening-width field inherits it by
  faithfully mirroring that field), so it is **not** a blocker for PR #65 — the fix
  is a separate thin bug-fix follow-up covering **both** fields. The *why*/how
  (likely: clicking the canvas deselects the item and unmounts the field before its
  blur handler runs) was confirmed while scoping #76: clicking empty canvas calls
  `selectNone()` from `FloorPlan`'s `onPointerDown`, React unmounts the focused
  `<input>`, and removing a focused element fires no `blur`. Clicking a *different*
  wall loses it for a second reason — the field is `key`ed on the selected id, so it
  remounts with a fresh draft. #76 covers **both** fields on one shared path and
  requires a test that would fail if the fix were reverted; the *mechanism* is left
  to the Engineer Agent.
- **No furniture / fixtures** — only doors and windows; no other placeable objects.
- **Openings can't be resized, and their width isn't shown — done (#60, merged as
  PR #65; triaged from a human-submitted idea 2026-07-26).** An opening's width
  (`wallAttach.length`) is fixed at creation; the only way to change it is
  delete-and-redraw, and there's no readout of how wide a placed door/window is.
  Accepted and enriched into the wall-work analogue: a pure, tested resize helper
  in `src/geometry/opening.ts` (clamp to `MIN_OPENING_WIDTH`, keep the opening on
  its wall by shifting `offset`/clamping `length`), a store action modeled on
  `setSelectedWallLength` through `commit()`, and an options-bar width field
  mirroring the wall-length field (#11). On-canvas always-on width labels (the
  #5 analogue) and drag-handle resize are explicit out-of-scope follow-ups.
  **PR #65 shipped the code but not the docs** — the README still describes openings
  as place-only, so the drift is tracked as #78 (docs-only).
- **README drift: opening width undocumented — in flight (#78, opened 2026-07-29 by
  the cycle's README backstop check).** #60/PR #65 shipped a user-visible capability
  and touched no docs, so the README's Openings and Dimensions bullets still imply
  openings are delete-and-redraw. Thin docs-only issue; everything else in the README
  (Export menu, "Not yet", shortcuts, scripts, stack) verified accurate this run.
- **Drag-creation for openings — done (#55, merged as PR #56).** Doors/windows can
  now be placed by press-drag-release along a wall (mirroring the wall tool's
  dual-gesture pattern), and the existing click-click flow is intact; reuses the
  existing preview, grid snapping, 30 cm tolerance, and 5 cm min-width. Triaged from
  a human-submitted idea whose body mentioned walls (which already dragged) but whose
  title named the real gap — openings.
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
- **Detach a single wall's endpoint from a junction — done (#30, merged as PR
  #58).** #22 welds and #19 follows co-located endpoints; #30 adds the inverse —
  pulling a **single** wall's endpoint out of a shared junction. Since connectivity
  is implicit in coordinate equality, detach = moving that one wall's endpoint to a
  distinct coordinate (not a persistent flag). Shipped as per-wall square endpoint
  handles shown when exactly one wall is selected (`WallEndpointsLayer`), dragging
  one detaches just that end (`pickWallEndpoint` + `moveWallEndpointLive` in
  `store.ts`).
- **Follow-up to #30: Cmd+drag to detach an endpoint without pre-selecting the
  wall — in flight (#61, now implemented by open PR #75 on branch
  `feat/issue-61-cmd-drag-detach-endpoint`, awaiting review/acceptance).** Raised by the owner on PR #58 (2026-07-19); scoped into
  an issue this cycle (2026-07-26) now that #58 has merged. Adds an *accelerator* —
  hold Cmd/Ctrl and drag any wall's endpoint directly, no selection needed. Cmd/Ctrl
  is free (unused as a canvas drag modifier; only Cmd+Z/Y for undo/redo), so #30's
  "modifiers are contended" objection doesn't apply. Product resolution of the
  disambiguation question: grab the nearest endpoint under the cursor; on a genuine
  tie at a junction fall back to the selection-first square-handle path. #61 folds
  in a new pure endpoint-picker helper (pick nearest endpoint across all walls, or
  signal a tie) in `connectivity.ts` with tests. Open technical question deferred to
  the Engineer Agent in the issue: hit-testing any endpoint without pre-selection,
  and any Cmd/Ctrl+drag OS/browser collision on the canvas.
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
  **live**, during an in-progress connection-point/wall drag — the initial fix
  only reconciled once the drag was committed, since `translateSelected*Live`
  intentionally bypasses `commit()` to avoid spamming undo history. Spec
  updated on #38 to require live parity, and that follow-up **shipped**: all
  three `*Live` store functions (`translateSelectedWallsLive`,
  `translateSelectedConnectionPointLive`, `moveWallEndpointLive`) now reconcile
  the pre-drag item snapshot against the live walls via `reconcileItemsToWalls`
  (no history entry). #38 is fully done and closed.

Open questions for the human (confirm before generating issues that depend on
these): target users' top unmet need, whether to prioritize export vs. rooms vs.
measurements, any accessibility/i18n requirements, **should a whole-wall move
cascade through a connected chain as one rigid body, or stay "hinge" behavior as it
is today** (see "Cascading connected-wall follow" above), and — new this run —
**should on-screen `[`/`]` wall-thickness editing retarget the current selection,
or keep setting the next-wall default** (the third keyboard-only verb #93 left out;
see the #93 bullet under "Known gaps")?

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

Current open issues (as of 2026-08-03, read during the #96 triage run): #10 (prune
stale selection), #20 (fit shortcut/zoom to selection), #21 (error boundary), #52
(custom door swing glyph, follow-up to #51), #63 (switch display units
cm/m/mm/in/ft), #77 (ignore canvas shortcuts while a toolbar control has focus),
#94 (44px touch targets for the options bar's existing controls), and **#96**
(split a wall where another ends on it — **implemented by PR #97**, product-accepted
on `82d8348` pending the PR description being brought up to what shipped; awaiting
that fix and a merge). **#93** (on-screen Remove/Hinge/Swing controls)
merged 2026-08-02 as PR #95. Closed since: **#84**
(touch canvas, merged as PR #91), **#85** (tablet chrome, merged as PR #89), **#76**
(commit typed length/width on click-away), **#33** (SVG export, PR #82), **#61**
(Cmd/Ctrl+drag detach, PR #75), **#78** (README opening-width docs, PR #81); #60 and
#66 merged before that. Do **not** re-propose any of these. One follow-up #93
deliberately left out is still unticketed: on-screen **wall-thickness** editing for
a selection (the `[`/`]` verb — needs a product call on the preset pills first,
since it's genuinely ambiguous whether the existing preset row should retarget the
current selection or keep setting the next-wall default). A **second** unticketed
follow-up is now queued and needs no human call: **un-splitting / stub tidying after
a mid-span split** (see its bullet under "Known gaps") — the next cycle should write
it as one thin issue.

The next high-value, well-scoped follow-ups once the current batch is clear (in
rough priority order) are:

1. **Rooms / enclosed areas** — bigger feature (area calc, labels). Still needs
   human product input before scoping (see open questions); defer until answered.
   Note the dependency discovered during #96's triage: **mid-span wall splitting
   (#96) is a prerequisite** — without it a plan's walls don't form a connected
   graph, so no enclosure can be derived. Sequence #96 first.
2. **Cascading connected-wall follow** — genuinely needs a human UX call before
   it can be scoped as an issue (rigid-chain vs. hinge behavior); see "Known
   gaps" and the open question above. Do not write this issue until answered.

The backlog is eight issues deep and every *known* gap that doesn't need a human
call is ticketed. The next cycle should reconcile GitHub state, run the README
backstop check again (it caught real drift two runs ago, and #93/PR #95 shipped a
user-visible feature whose README delta should be spot-checked), and resist
inventing work:
rooms and cascading-follow both still await a human answer, and there is no other
concrete queued slice.

**A note on testability for UI-behavior issues (#76, #77, #85) — updated 2026-07-30,
the gap is now half closed.** This file previously recorded "no DOM testing library
or Cypress"; that is **out of date**. `vitest.config.ts` still defaults to
`environment: "node"` for the pure modules, but its comment now documents that
**component tests opt into jsdom with a `@vitest-environment jsdom` docblock**, and
`src/features/toolbar/ProjectActions.test.tsx` is a working example. So component
behavior *is* reachable now — cite that file as the precedent when writing UI issues.
Two limits still bind: jsdom has **no layout engine** (so CSS layout/responsive
criteria can't be asserted there — #85's layout criteria are prose-verified while its
one real *decision*, which hint text to show, is required to live in a pure helper),
and there is still **no Cypress / real-browser e2e**, so genuine pointer-gesture
behavior (#84's touch drawing) has no automated harness. Keep asking for a test that
would **fail if the fix were reverted**, and keep pointing at
`src/ui/menuNavigation.ts` as the pattern for lifting a component's decision into a
pure module.

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

- 2026-08-03 — Clarify pass on **PR #97** (#96's mid-span split, already accepted on
  `82d8348` with the verdict *accepted pending non-code fixes*). Nothing
  product-blocking was left; three things settled. **(1) Repaired #96's spec, this
  time during clarify rather than waving the deviations through.** Three criteria had
  drifted from what shipped and would have become the permanent, wrong record: the
  multi-touch criterion said a host with N touches splits into N segments, but the
  global "no sub-`MIN_WALL_LENGTH` wall may ever be produced" rule beats that in two
  cases the code correctly handles (touches closer than `MIN_WALL_LENGTH` weld into
  one junction; a touch that would shorten the *touching* wall below the minimum is
  skipped); the near-corner criterion's "leave near-miss corners alone" reads far
  broader than the 1 cm band it actually protects; and "the new junction is an
  ordinary junction … should need no new code" was simply false — **the held junction
  handle must follow the weld**, which is what three rounds of blocking review were
  about. Amended all three, dated, with the originals' reasoning preserved. **The
  transferable lesson: connection-point selection is tracked by *coordinate*, so any
  future feature that moves an endpoint inside `commit()` invalidates a held handle**
  — invisible (the layer highlights only coordinates an endpoint sits at) yet live
  (arrow keys route on `selectedConnectionPoint != null`), so the next keypress undoes
  the thing just created. Per-site patches leaked twice; the fix that held was
  structural (`commit(next, heldPoint)` returns plan + followed selection). Any issue
  that moves endpoints should carry this as a criterion up front. **(2) Deferred the
  PR-body rewrite to the Engineer Agent by name** — it is materially behind the branch
  (describes 1 of 4 commits, stale counts) and it becomes the squash-merge message, so
  it still gates the merge; it is just their artifact, not mine. **(3) Declined to
  widen the near-corner band and declined to file the follow-up from this mode:**
  recorded the **un-splitting / stub-tidying** gap as its own "Known gaps" bullet, to
  be ticketed as **one** thin issue next cycle (merging collinear segments when the
  T-wall is deleted, plus the stub an overshooting endpoint leaves). Widening the weld
  band remains the separate, still-out-of-scope "welding near-miss corners" feature.

- 2026-08-03 — Triage run on human-submitted idea #96 ("Connect the walls on
  mid-snap"). The submission cited this file's own record of the gap, and it checks
  out in code: `connectivity.ts` defines connectivity as **endpoint coordinate
  equality** (`pointsEqual`, eps `1e-6`), so a wall ending mid-span of another is
  invisible to the mitered junction geometry, to auto-follow (#19) and to the
  junction drag (#22/#27) — the walls look joined and come apart on the first edit.
  Confirmed this is a **documented scope gap, not a settled "no"**: DECISIONS.md's
  "Wall junctions" Scope paragraph names splitting as the missing capability, and the
  README lists it under "Not yet" — so accepting it doesn't revisit a settled
  decision. Accepted and enriched into "Split a wall where another wall ends on it,
  so mid-span T-junctions are really connected."
  **The mechanism call is the one that mattered: split the host wall, don't add a
  persistent "these walls are joined" relation.** The tempting alternative is a
  stored T-relation in the schema, and it's wrong — it would contradict the settled
  coordinate-equality model and force every consumer (junction mitering, follow,
  detach, connection-point drag) to learn a second notion of connectedness. Splitting
  produces the shared coordinate they *already* react to, so the T-junction fill, the
  follow-on-move and the junction handle come for free with no new model concept.
  Second call: **"on the wall" means inside the host's drawn body** (perpendicular
  distance ≤ `thickness / 2`) with the touching endpoint snapped exactly onto the
  projection — that is the human's "mid-snap", and it's the rule that makes the
  feature match what the user sees ("if it looks like it touches, it connects")
  rather than demanding exact coincidence, which grid snapping only ever delivers for
  axis-aligned walls. Guarded with `MIN_WALL_LENGTH` clearance from the host's own
  endpoints so a near-miss *corner* is left alone instead of producing a sliver wall.
  Made **openings surviving the split** its own criterion rather than leaving it to
  chance — it's the consequence most likely to be missed, and it has a settled
  precedent to follow (#38's reposition-first, remove-as-a-last-resort rule in
  `reconcileItemsToWalls`), including a rule for the genuinely ambiguous straddling
  opening (move into the larger side; remove only if it can't fit). Hooked at the
  **`commit()` chokepoint** beside that reconcile — one call site covers draw, move,
  endpoint drag and type-to-resize, gives a single undo step for free, and (because
  live drags deliberately bypass `commit()`) means nothing splits mid-gesture.
  Required **idempotence** as a criterion so a wall can't re-split on successive
  commits. Explicit out-of-scopes, each a plausible follow-up: X crossings, welding
  near-miss corners, **un-splitting** when the touching wall is later deleted (the
  host stays two segments — classic CAD behaviour and acceptable), retro-splitting
  imported plans (`loadDocument` uses `createHistory`, not `commit()`), and a snap
  preview while drawing. Also recorded a **sequencing dependency**: #96 is a
  prerequisite for rooms / enclosed areas, since without it the walls don't form a
  connected graph. Corrected stale state found while reading: **#93 merged as PR
  #95** and was missing from "Current state". Did not add `agent:ready` (a human
  promotes it).

- 2026-08-02 — Fourteenth Product Agent run (cycle), same day as the #93 triage.
  Reconciled with GitHub: no change since that triage pass — the same seven issues
  are open (#10, #20, #21, #52, #63, #77, #93) and there are no open PRs (PR #92, a
  merged infra change adding per-PR preview builds on GitHub Pages, has no
  corresponding product issue and needed none — it's automation, not a floor-plan
  feature). Ran the README backstop check: Features, shortcuts, "Not yet", scripts,
  and stack all still match shipped reality — no drift, no docs issue needed.
  Created **one** issue: **#94** — give the floating options bar's existing controls
  (thickness pills, length/width field) the same 44px coarse-pointer touch-target
  treatment already established in `Toolbar.module.css` / `Menu.module.css` /
  `ThemeSwitch.module.css`. This was the one of #93's two unticketed follow-ups that
  needed no human product call (unlike the `[`/`]` wall-thickness verb, which
  genuinely does and stays parked as an open question). Scoped it to the two
  existing controls only; #93's new buttons and any future on-canvas thickness
  control are explicit out-of-scope, to be covered by their own issues once they
  exist. Did not add `agent:ready` (a human promotes it). Open questions for the
  human unchanged: rooms scope, cascading-wall-follow (rigid-chain vs. hinge), and
  now also the `[`/`]` retarget-vs-next-wall-default call.

- 2026-08-02 — Triage run on human-submitted idea #93 ("Bring the remove and change
  functions to touch screen experiences"). Verified the report in code rather than
  trusting it, and it is exact: `deleteSelected`, `toggleSelectedDoorHingeEdge` and
  `toggleSelectedDoorSwingSide` are dispatched **only** from `FloorPlan.tsx`'s
  `window` keydown listener, so with #84/#85 merged a tablet user can draw, place
  and select — and then has no way to remove or adjust any of it. Accepted and
  enriched into "Add on-screen Remove, Hinge and Swing controls so a selection can
  be edited without a keyboard." Product calls pinned: the **floating options bar**
  is the affordance (not a long-press menu or a swipe gesture — the bar already
  exists, already floats without layout shift, and already appears on selection),
  but its visibility must widen from "exactly one wall/item" to **any non-empty
  selection**, because today a marquee multi-selection gets no bar at all and would
  stay undeletable by touch — the criterion most likely to be missed, so it is its
  own bullet. **Not gated on `(pointer: coarse)`**: the tempting move is to show the
  buttons only on touch, and it's wrong three ways (a second code path to test, a
  hybrid device that mis-reports its pointer kind left with no way to delete, and it
  throws away the chance to make three genuinely undiscoverable shortcuts
  discoverable — so the tooltips *name* the accelerator instead of replacing it).
  **Hinge/Swing key off "selection contains ≥1 door"**, mirroring what the store
  actions and `HintBar`'s `hasSelectedDoor` already do, rather than inventing
  single-door semantics that would silently diverge from the keyboard. Required the
  "which controls apply" decision to live in **`src/app/selection.ts`** as a pure
  tested function (the `canvasHint.ts` / `menuNavigation.ts` pattern) *and* a jsdom
  test that the buttons are **wired** — a rendered-but-dead button would otherwise
  tick every box. Deliberately **kept the third keyboard-only verb out**: `[`/`]`
  wall thickness can't be solved with a button alone (does the existing preset row
  retarget the selection, or keep setting the next-wall default?), so it needs its
  own product call; recorded as an untracked follow-up along with the options bar's
  existing controls never having received #85's 44 px coarse-pointer treatment.
  Also corrected stale state found while reading: #84, #85 and #76 have all merged
  (PRs #91, #89), and "Current state" had never recorded the tablet chrome or the
  touch canvas as shipped. Did not add `agent:ready` (a human promotes it).

- 2026-07-31 — Clarify pass on **PR #91** (#84's touch-gesture implementation, already
  accepted on `13325d8`). Nothing product-blocking was left; three things settled.
  **(1) Repaired #84's spec — reversing my own acceptance note.** Both acceptance
  passes recorded "#84 needs no repair," and that was wrong on one bullet: the Docs
  criterion still said *"No change to the 'Not yet:' line is needed (it doesn't
  currently mention touch),"* true when written and falsified when **#85 merged in
  between** and added both a "touch drawing gestures on the canvas" entry under
  "Not yet:" and a Tablet-ready bullet promising drawing "still needs a mouse." PR #91
  correctly removed both, so the criterion described a README that contradicts what
  shipped — a permanently wrong record for anyone reading #84 later. Amended the
  criterion to the delta that actually shipped, dated and with the original's reasoning
  preserved. **Lesson worth carrying: when a sibling issue merges between grooming and
  implementation, the older issue's *exact-delta* README criterion is the thing most
  likely to go stale** — check it during acceptance instead of waving the deviation
  through as "no repair needed."
  **(2) Declined to hold #91 for a `DECISIONS.md` line.** The Engineer's non-blocking
  nit was right that the `cancelLiveDrag` vs `endLiveDrag` paragraph documents only the
  plan rollback, not the *selection* restore that two review rounds converged on. Real
  and worth the durable record, but one doc sentence doesn't justify another commit +
  CI round on an approved PR — recorded above under the #84 bullet to fold into the
  next docs pass instead (the store's doc comments carry it meanwhile).
  **(3) Reaffirmed the canvas-hint decision** from the first acceptance: keep the hint
  desktop-only, don't advertise the touch gestures on the canvas; if discoverability
  proves to be a real problem the answer is a **dismissible first-run hint**, its own
  issue in a future cycle, not a standing label on the smallest viewport. The PR-body
  staleness the last review flagged (the `cancelLiveDrag` bullet, `263` → `265` tests,
  the "11 tests, 9 fail on revert" count) is the Engineer Agent's artifact and was
  deferred to them by name.

- 2026-07-30 — Triage run on human-submitted idea #84 ("iPad Wall drawing is not
  possible as it scrolls the canvas") — the companion pass to #85's triage earlier
  today. Verified the report in code instead of trusting it: there is **no
  `touch-action` declaration anywhere in `src/`**, so the default `touch-action: auto`
  lets the browser take a finger drag as a page scroll and fire `pointercancel` before
  `FloorPlan.tsx`'s handlers can act — the user's description was exactly right.
  Accepted and enriched into "Make the canvas drawable by touch: one-finger tool
  gestures, two-finger pan and pinch zoom." Deliberately folded in **two gaps with the
  same root cause** rather than ticketing them separately, because fixing
  `touch-action` without them ships a canvas you can draw on but can't navigate: touch
  has no pan/zoom equivalent at all (pan is right-drag or the Pan tool; zoom is
  `onWheel`), and there is **no `onPointerCancel` handler**, so a browser-stolen
  gesture strands `drawingWall`/`moving`/`movingPoint`/`movingEndpoint` and an open
  `beginLiveDrag()`. Product calls pinned: **one finger = the active tool's gesture,
  two fingers = pan + pinch with any tool active** (making two-finger pan
  tool-independent avoids the awkward "switch to Pan, move, switch back" loop that a
  literal reading would have produced); pinch anchors the world point under the finger
  midpoint, mirroring wheel zoom's cursor anchoring; **never fix this by disabling
  page zoom** (`user-scalable=no`/`maximum-scale=1` is the tempting one-line "fix" and
  an accessibility regression — suppression is scoped to the canvas element); the
  **multi-touch viewport math must live in a pure tested module** (`src/app/viewport.ts`)
  with the specific cases named, since there's still no browser e2e and jsdom has no
  real multi-touch — otherwise nothing about this feature would be automatically
  verifiable; and undo semantics stated explicitly (one entry per completed touch edit,
  none for pan/pinch, `pointercancel` aborts without committing). README delta given
  exactly (the Canvas bullet; "Not yet" needs no change — it never mentioned touch).
  Kept independent of #85: this issue owns **canvas gestures**, #85 owns **chrome
  layout**. Explicit follow-ups left out: stylus / Apple Pencil specifics, finger-sizing
  the on-canvas handle hit radii, phone-width layout, and any new touch-only gestures
  (double-tap zoom, long-press, rotate). Did not add `agent:ready` (a human promotes it).
- 2026-07-30 — Triage run on human-submitted idea #85 ("Responsive design kick off").
  The submission was a **staged epic** ("responsive primitives → iPad/tablets → then
  phones", motivated by touch *and* styluses/Apple Pencil). Accepted the direction but
  **narrowed the issue to stage one**, since one ticket spanning gestures + shell
  layout + two device classes isn't independently shippable — and the human's own
  wording already staged it. Retitled to "Make the toolbar and app shell usable at
  tablet (iPad) widths." Verified the "desktop-only" premise in code rather than
  taking it on faith, and it's worse than cosmetic: `.toolbar` is a single
  non-wrapping flex row of ~14 controls that **clips Undo/Redo off-screen at 768 px**,
  buttons are ~28–30 px tall, `App.module.css` uses `100vh` (iOS Safari hides the
  canvas bottom under browser chrome), and there are **zero width breakpoints or
  `touch-action` declarations** in `src/`. Key sequencing call: **canvas touch
  gestures belong to #84, not #85** — #84 ("tap and drag scrolls the canvas") is the
  higher-impact bug (on iPad you can't draw at all) and owns `touch-action` / pan /
  pinch; the two are independent and can land in either order, but #84 should be
  promoted first. #84 was left on `agent:triage` for its own pass (one mode per run).
  Product calls pinned in #85: hide the desktop `Right-drag to pan, Wheel to zoom` tip
  on a coarse pointer rather than replacing it with touch instructions (don't promise
  gestures #84 hasn't built); put that hint decision in a **pure tested helper**;
  ≥44 px targets under `@media (pointer: coarse)`; `dvh`/`dvw`; breakpoints as
  **shared tokens** in `theme.css` (the "primitives" the human asked for, and what the
  phone pass reuses); and **never disable pinch-zoom** (no `user-scalable=no`) — an
  accessibility regression that's tempting as an overflow "fix". Left phone-width
  layout, stylus/Pencil specifics, and finger-sizing the on-canvas handles as explicit
  follow-ups. Also corrected two pieces of stale memory found while reading: the
  open-issue list (#33/#61/#78 have merged as PRs #82/#75/#81) and the testability
  note — **jsdom component tests now exist** (`ProjectActions.test.tsx`, via a
  `@vitest-environment jsdom` docblock), though there's still no browser e2e and jsdom
  has no layout engine. Did not add `agent:ready` (a human promotes it).
- 2026-07-29 — Clarify run on issue #33 (SVG export). The human flagged that the
  spec predated the Export menu: it asked for "a new Export SVG button next to Export
  PNG," a toolbar that no longer exists now that #66 shipped as PR #69. Rewrote the
  issue body around the menu — **SVG becomes a third entry appended after "JSON" and
  "PNG" inside the existing Export menu**, never a fourth flat button (that would undo
  #66); label is the bare format name to match the siblings; an icon distinct from
  PNG's, glyph left to the engineer; menu restructuring/restyling and the existing
  entries explicitly out of scope. Added the missing README criterion with the exact
  delta (Import/export bullet gains SVG; "SVG (vector) image export" leaves "Not yet").
  Behavior is otherwise unchanged (same `buildExportSvg` markup, `sanitizeFilename`,
  `downloadBlob`). Also updated Current state, which had never recorded the Export menu
  as shipped. Standing lesson: **when a UI-shell issue lands, re-read the older issues
  that target the shell it replaced** — #33 sat stale for a day pointing at a button
  row that was gone, and only a human caught it.
- 2026-07-29 — Thirteenth Product Agent run (cycle). Reconciled with GitHub: **#60**
  (opening resize, PR #65) and **#66** (Export menu, PR #69) merged since the last
  cycle — both moved to "Current state"; **PR #75** is open implementing #61 (awaiting
  review/acceptance, out of cycle scope). Created **three** issues, and notably none of
  them were invented: two were gaps this file had explicitly parked *for a cycle run to
  groom*, and the third came from the README backstop check.
  **#76** — commit a typed wall length / opening width when the user clicks away onto
  the canvas. Verified the mechanism in code rather than restating the 2026-07-27
  hypothesis: the canvas `onPointerDown` calls `selectNone()`, React unmounts the
  focused `<input>`, and **removing a focused element fires no `blur`** — so
  `onBlur={commit}` never runs; clicking a *different* wall loses the draft for a
  second reason (`key`ed on the selected id → remount). One shared fix for both fields.
  **#77** — ignore canvas shortcuts while a toolbar control has focus. Confirmed the
  listener's only guard skips `INPUT`/`TEXTAREA`/`SELECT`/`contentEditable`, so
  **buttons leak**, and the leak is wider than this file recorded: the **arrows** leak
  too, not just `h`/`s`/`[`/`]`/`Delete`. Also corrected a prior note — PR #69 didn't
  "fix the arrow-key case," it worked around it locally with `stopPropagation` in
  `Menu.tsx` *only while the menu is open*, and that file's own comment says a closed
  trigger "leaks them as before." Three product calls made so the criteria couldn't
  contradict the story: toolbar focus suppresses the canvas verbs; **`Escape` is the
  exception** (non-destructive, universally "get me out"); **undo/redo stay global**
  (app commands, not canvas verbs). `Delete` semantics on the canvas are unchanged.
  **#78** — README docs drift: PR #65 shipped the opening-width field and touched no
  docs, so the README still implies openings are delete-and-redraw. This is exactly the
  case the backstop exists for; filed as a thin docs-only issue for a code PR rather
  than edited here. Everything else in the README verified accurate (Export menu
  described correctly; "Not yet" correctly lists SVG export, mid-span split, rooms).
  One cross-cutting observation recorded under "focus next": #76 and #77 are the first
  issues whose *behavior* no current test can reach (all tests are pure modules,
  `environment: "node"`, no DOM library or Cypress), so both require a
  fails-if-reverted test and explicitly permit the `jsdom` switch that
  `vitest.config.ts`'s own comment invites. Open questions for the human unchanged
  (rooms scope; rigid-chain vs. hinge cascading follow).
- 2026-07-28 — Clarify run on PR #69 (implements #66). One new scope call from the
  human: the menu entries' `font-size: 13px` in `src/ui/Menu.module.css` is a literal
  hand-matched to `.toolbar .button`'s *undeclared* UA control font, which differs per
  browser/platform — both agents had parked the durable fix as a follow-up under #66's
  "no toolbar restyling," and the human asked for it in this PR rather than as accrued
  debt. **Accepted and pulled into scope**: #66 gained an acceptance criterion (entry
  text size must match the toolbar's *by construction* — one explicit declaration
  shared by both, either a font size on the toolbar's button class or a token in
  `src/theme.css` — not a literal tuned to a default), and its "Restyling the rest of
  the toolbar" out-of-scope bullet now carries that one narrow exception, with spacing
  / colors / grouping / other button groups still excluded. Which of the two shapes to
  use was deferred to the Engineer Agent as an implementation choice. The stale PR
  description remains open and remains the Engineer Agent's `gh pr edit --body`; both
  can land in one round now that code is needed anyway. Precedent worth keeping: a
  *symptom already fixed in a PR whose cause is a one-line durable fix in adjacent code*
  is worth pulling into that PR rather than ticketing — the follow-up that fixes only a
  cause nobody can see is the one that never gets written. Still deliberately out:
  the pre-existing canvas-shortcut leak (`h` / `s` / `[` / `]` / `Delete` reaching the
  plan while any toolbar control has focus), which is toolbar-wide, not caused by #66,
  and needs its own issue in a cycle run.
- 2026-07-27 — Triage run on human-submitted idea #66 ("Make an export menu").
  Verified the premise in `src/features/toolbar/ProjectActions.tsx`: three flat
  top-level buttons — Import (JSON), Export (JSON), Export PNG — so two of them are
  exports differing only by a label suffix, and #33 would add a third. Corrected one
  detail in the submitted body: the import is **JSON**, not SVG (no SVG import
  exists or is proposed). Accepted and enriched #66 into a full spec, retitled
  "Group the export formats under a single Export menu in the toolbar." Two product
  calls: **only exports are grouped** (Import stays a separate top-level button —
  different action, and folding it in would drift into a vaguer "File" menu), and
  **#66 does not add SVG export** (#33 owns it; #66 just builds the place it lands,
  so #66 is the better sequence-first of the two). Spec pins the dropdown details
  that are easy to get wrong: identical export behavior (contents/filenames/error
  alerts), close on select/Escape/outside-click/blur, keyboard + screen-reader
  support, floats over the canvas with no layout shift, themes off existing CSS
  variables, plus a README Features-bullet delta. Left combined File menus, new
  export options (scale/DPI/transparency/selection-only), and export keyboard
  shortcuts explicitly out of scope. Did not add `agent:ready` (a human promotes it).
- 2026-07-27 — Twelfth Product Agent run (cycle). Reconciled state with GitHub:
  no new issues since the eleventh run — the same eight are open (#10, #20, #21,
  #33, #52, #60, #61, #63). The one change is that the Engineer Agent opened
  **PR #65** implementing #60 (resize a door/window opening & show its width,
  branch `feat/issue-60-opening-width`) — now awaiting review/acceptance (out of
  cycle scope; a later acceptance run judges it). Ran the README backstop check:
  README still matches shipped reality (Features/shortcuts/"Not yet" all accurate —
  "Not yet" correctly lists SVG export (#33), mid-span wall splitting, and rooms),
  so no drift and no docs issue needed. Created **no** new issues: the backlog is
  healthy and fully scoped, and the only two next-tier candidates — rooms/enclosed
  areas and cascading connected-wall follow — both still await a human product/UX
  call before they can be scoped. Nothing new to scope against, so held off
  inventing work. Open questions for the human unchanged.
- 2026-07-27 — Clarify run on PR #65 (opening-width field, closes #60). The owner
  asked whether the length/width fields should apply a typed value when you click
  on the canvas instead of pressing Enter/tab — today they don't. Product decision:
  **yes, click-away should commit** — the field already commits on blur, so silently
  discarding typed input on a canvas click is an inconsistency and a data-loss
  surprise, not intended behavior. Scoped it as a **pre-existing, cross-cutting**
  defect (started with the wall-length field #11; the opening-width field inherits
  it) so it is **not** a blocker for #65 — the fix is a separate thin follow-up
  covering both fields. Deferred the *why*/how (likely canvas-click deselect
  unmounting the field before blur fires) to the Engineer Agent. Recorded it as a
  new known gap; did not open an issue this run (clarify mode) — next cycle grooms
  it or a human fast-tracks it. No spec change to #65 itself.
- 2026-07-26 — Eleventh Product Agent run (cycle). Reconciled state with GitHub:
  no change since the tenth run — the same seven issues are open (#10, #20, #21,
  #33, #52, #60, #61) and there are no open PRs to acceptance-test. Ran the README
  backstop check: the README was synced to shipped reality earlier today (via the
  now-merged docs PR #62), so no drift. Created **one** issue: **#63** — let the
  user switch display units (cm / m / mm / in / ft). This completes a **half-built**
  feature rather than inventing scope: `schema.ts`'s `Units`, `plan.meta.units`, and
  `formatLength` (cm → all five units) already exist, but nothing exposes a unit
  switch, so it's stuck at `cm`; and the selected-wall length field mislabels raw cm
  with `plan.meta.units` (a dormant bug a switcher would expose). #63 adds the
  selector via `commit()`, the pure inverse `lengthToCm` in `format.ts` with tests,
  and fixes the field to convert both ways. Marked the "no editable units" gap
  in flight (#63). Note: this is the first issue written under the updated
  product-agent skill — its Technical context is plain self-contained prose (no
  "the Engineer Agent reads only this issue" narration) and, being user-visible, it
  carries a "README updated in the same PR" acceptance criterion with the exact
  Features-bullet delta. Did not add `agent:ready` (a human promotes it).
- 2026-07-26 — Tenth Product Agent run (cycle). Reconciled state with GitHub:
  **#30 merged** (detach a single wall's endpoint from a junction, via PR #58) and
  **#45 merged** (dispatcher self-heal, via PR #57) since the last run — both now
  closed; moved #30 to shipped in "Current state"/"Known gaps". No open PRs to
  acceptance-test. Created **one** issue: **#61** — Cmd/Ctrl+drag any wall's
  endpoint to detach it without pre-selecting the wall (enhancement). This is the
  #30/#58 follow-up that was already product-groomed on PR #58 (2026-07-19) and
  parked in Known gaps "for a future cycle"; now unblocked (#58 merged), so scoped
  it into a thin, standalone issue as planned. The one open piece is technical
  (hit-testing any endpoint without selection; Cmd/Ctrl+drag OS/browser collision)
  and is deferred to the Engineer Agent inside the issue. Did not add `agent:ready`
  (a human promotes it). Standing backlog (#10, #20, #21, #33, #52, plus triaged
  #60) remains healthy; rooms and cascading-wall-follow still await a human call.
- 2026-07-26 — Triage run on human-submitted idea #60 ("Resize openings"). The
  idea: openings (doors/windows) can only be removed/redrawn, never resized, and
  their width is never shown. Confirmed against the code — an opening's width is
  `wallAttach.length` (cm) with no read or edit path, while walls already have both
  (labels #5, type-to-resize #11). Accepted as a thin, high-value parallel and
  enriched #60 into a full spec: a pure/tested resize helper in
  `src/geometry/opening.ts` (clamp ≥ `MIN_OPENING_WIDTH`, keep the opening on its
  wall), a `setSelectedWallLength`-style store action through `commit()`, and an
  options-bar width field for a single selected opening (mirroring
  `WallOptions`/`WallLengthField`). Retitled to "Resize a door/window opening and
  show its width." Left on-canvas always-on width labels and canvas drag-resize as
  explicit out-of-scope follow-ups. Did not add `agent:ready` (a human promotes it).
- 2026-07-19 — Clarify run on PR #58 (detach a wall's endpoint, closes #30). The
  owner asked whether we could add a **Cmd+drag to detach a single wall's endpoint
  without pre-selecting the wall** ("the combinations we considered"). Product
  decision: **yes as a follow-up, not in #58** — #58 fully delivers #30's accepted
  selection-first square-handle spec and should merge unchanged; Cmd+drag is a
  power-user *accelerator* on top of that discoverable default. #30 had rejected a
  *modifier*-drag only because Shift/Alt are taken — that doesn't apply to
  Cmd/Ctrl (unused as a canvas drag modifier today), so it's genuinely available.
  Wrinkle to settle in the follow-up issue: with no pre-selection, at a 3+-wall
  junction the gesture must pick *which* wall's endpoint — decided to grab the
  nearest endpoint under the cursor and fall back to the selection-first path on a
  true tie. Feasibility (hit-testing any endpoint without selection; Cmd+drag OS
  collisions) deferred to the Engineer Agent. Recorded as a new follow-up in Known
  gaps for a future cycle to groom; no change to #58's scope.
- 2026-07-19 — Ninth Product Agent run. Reconciled state with GitHub: the
  Engineer Agent has opened two PRs since the last run — **PR #58** implements
  #30 (detach a single wall's endpoint from a junction, branch
  `feat/issue-30-detach-wall-endpoint`) and **PR #57** implements #45 (the
  human-authored dispatcher self-heal automation issue). Both are open and
  awaiting review/acceptance; moved #30 to "PR open" in Known gaps and focus-next.
  No PRs were ready for a product acceptance pass this run (cycle mode only).
  Created no new issues: the backlog is healthy — #10, #20, #21, #33, and #52 are
  well-scoped, unclaimed, and untouched by any in-flight PR — and the two
  next-tier features (rooms/enclosed areas, and whether whole-wall moves should
  cascade through a connected chain) both still need a human product/UX call
  before they can be scoped. Nothing new to scope against, so held off inventing
  work.
- 2026-07-17 — Eighth Product Agent run. Reconciled state with GitHub: #55
  (drag-creation for openings) merged via PR #56, and #51 (toolbar icons) merged
  via PR #53 — moved both from "Known gaps"/"in flight" to "Current state" as
  shipped. #30 (detach a wall's endpoint from a junction) is now
  `agent:implementing` (the Engineer Agent is building it; no PR open yet). No open
  PRs to acceptance-test. Created no new issues this cycle: the backlog is healthy —
  #10, #20, #21, #33, and #52 are all well-scoped, unclaimed, and untouched by any
  in-flight PR — and the two next-tier features (rooms/enclosed areas, and whether
  whole-wall moves should cascade through a connected chain) both still need a human
  product/UX call before they can be scoped. Nothing new to scope against, so held
  off inventing work.
- 2026-07-16 — Triage run on human-submitted idea #55 ("Drag-creation for
  openings"). The idea's body claimed "walls and doors can only be made by
  click-click," but verifying `FloorPlan.tsx` showed walls **already** support
  click-drag creation (the `dragging` flag + `onPointerUp` build path) — so the
  real, unaddressed gap is the one the *title* names: doors/windows can only be
  placed via two clicks, with no drag gesture. Accepted and enriched #55 into a
  full spec: add drag-creation for openings mirroring the wall tool's dual-gesture
  pattern, keep the existing click-click flow, reuse the existing preview / grid
  snapping / 30 cm tolerance / 5 cm min-width. Retitled to "Create a door/window
  opening by click-dragging along a wall." Also reconciled state: #51 (toolbar
  icons) has merged via PR #53. Did not add `agent:ready` (a human promotes it).
- 2026-07-16 — Seventh Product Agent run. Reconciled state with GitHub: #48's
  fix has merged (PR #49). Two new issues appeared since the last run, #51
  (toolbar icon+label buttons) and #52 (custom door swing glyph, a follow-up
  to #51), with #51's implementation already on branch `feat/toolbar-icons`
  as open PR #53 (mergeable, not yet merged) — added both to "Known gaps" and
  "focus next" so they aren't re-proposed. Note: `feat/toolbar-icons` carries
  its own edited copy of this file (documenting #51/#52 as if already
  shipped on `main`) — per this file's own contract it must live only on
  `main` and only the Product Agent writes it, so that branch copy is stale/
  out of process and was **not** used as a source here; `main`'s copy (this
  one) is authoritative. Created no new issues this cycle: #10, #20, #21,
  #30, #33 remain well-scoped and untouched by any in-flight PR, and both
  standing blockers — rooms scope, and whether whole-wall moves should
  cascade through a connected chain — still have no human answer.
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
