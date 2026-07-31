# Design decisions

A lightweight log of notable decisions and the reasoning behind them, so the
"why" isn't lost. Newest first. Each entry: what we decided, and why.

---

## The dispatcher classifies an agent verdict from its `**Verdict:**` line only

**Decision.** `verdict_of` and `triage_verdict_of` in `.agents/dispatch.sh` no
longer substring-match the whole comment body. Both run it through `verdict_clause`
first, which isolates the text after the final `**Verdict:**` marker — the one-line
verdict the product-agent / engineer-agent skills require every comment to end with.
Only that clause is classified. If a comment carries no marker (older or
hand-written), it falls back to scanning the whole body, so nothing regresses.

**Why.** The classifiers are ordered substring matches (`*reject*` before
`*accept*`; `*"changes requested"*` before `*accepted*`) run over the entire
flattened comment. Incidental prose anywhere in the write-up could therefore flip
the verdict. This actually happened on a **triage accept** whose out-of-scope note
mentioned "palm rejection" (Apple Pencil): `*reject*` matched, the idea was
classified `rejected`, and the dispatcher fired a "rejected in triage (closed, with
rationale)" Telegram message — contradicting the agent's own "accepted & enriched"
self-notify, while the issue stayed correctly open. The same latent trap sat in
`verdict_of` (a PR review saying "no changes requested to geometry" would read as
`changes`). The skills already mandate the terminal `**Verdict:**` line as the
machine-readable contract, so scoping classification to that clause is the
narrowest robust fix — the surrounding rationale prose is now free to use words
like "reject" or "changes" without hijacking the verdict.

---

## Miter limit is a multiple of half-thickness, not a fixed cm value

**Decision.** `computeWallGeometry` (`src/geometry/junction.ts`) caps each
corner's miter point at `MITER_LIMIT * theSmallerHalfThickness` of the two
adjoining walls (`MITER_LIMIT = 3`) from the shared node. Past that, the
corner falls back to a **bevel** — the wall's own unextended edge point —
instead of the far-flung miter spike, per-corner (one acute wedge in a
junction can bevel while its neighbours stay mitered).

A beveled wedge must still be gap-free, matching the existing 3+-wall
junction core fill: at a 2-wall corner (no ring of wedges to fold the extra
point into), a beveled wedge instead gets its own small triangular fill — the
shared node plus the two walls' own base points — so the two wall ends never
leave an open notch between them.

**Why a ratio, not a fixed distance.** The miter geometry itself scales with
wall thickness (a thicker wall's miter reaches proportionally farther at the
same angle), so the cutoff needs to scale the same way — a fixed cm limit
would cap thick walls too aggressively and thin walls not enough. This mirrors
SVG's own `stroke-miterlimit`, which is likewise a ratio to `stroke-width`.
`3` is a common default in CAD/vector tools: generous enough to leave normal
(right-angle, obtuse) corners fully mitered, tight enough to bound genuinely
acute ones. This resolves the gap noted below under "Wall junctions are
mitered, not covered."

## Viewport autosave: throttle, not debounce

**Decision.** The viewport (pan/zoom) is persisted to its own `localStorage`
key (separate from the Plan/undo history) via a 200ms **leading + trailing
throttle** — a small in-house helper (`src/util/throttle.ts`).

**Why.** *Throttle, not debounce:* debounce only writes after movement stops, so
a gesture ending in a tab close/crash is lost; throttle also writes mid-gesture,
so the last point survives. *In-house:* it's the app's only throttle and the dep
tree is deliberately lean — a pure, generic, Vitest-covered `throttle(fn,
delayMs)` needs no dependency.

## Wall junctions are mitered, not covered

**Decision.** Walls compute their own corner geometry so adjacent walls meet
exactly; a small "core" polygon fills the centre of 3+-wall junctions. The old
`NodeCapsLayer` (which drew filler polygons *on top* of junctions to hide gaps)
and `joint.ts` were removed.

**Why.** Covering junctions was a visual band-aid: it broke for 3+-wall (T/X)
junctions and could emit malformed polygons. Mitering is the correct model — each
wall edge is trimmed/extended to its neighbour's facing edge, so the union of
walls tiles the junction with no gaps and nothing drawn over it. The core-fill
for 3+-way junctions uses the *same* miter points and shares each edge with a
wall, so it tiles seamlessly rather than overlaying. See `geometry/junction.ts`.

**Scope.** Only shared **endpoints** form junctions. A wall ending mid-span of
another isn't auto-split (would require wall splitting). Very acute angles are
now capped by a miter limit (bevel fallback) — see "Miter limit is a multiple
of half-thickness, not a fixed cm value" above.

## Undo history is diff-based and persisted

**Decision.** Persist the **whole undo history** to `localStorage` (not just the
current plan), stored as **JSON Patch diffs** (`fast-json-patch`) rather than full
snapshots. Rehydrate on startup. Cap at a generous `MAX_STEPS`; on a quota
failure, fall back to saving the current plan only.

**Why.**
- *History, not just the plan:* a refresh then restores undo/redo too, and saving
  can key off discrete history **commits** — which means the live wall-drag
  preview (intentionally uncommitted) is excluded for free, removing the need for
  a debounce/flush timer.
- *Diffs, not snapshots:* a wall move is a ~3-op patch instead of a whole plan
  copy, so history stays small enough to retain many steps and persist cheaply.
- *Cap + quota fallback:* `localStorage` is ~5 MB and patches still accumulate
  over a long session, so an unbounded history would eventually fail silently. A
  backstop cap and present-only fallback keep autosave robust.

## Validation is a single boundary (`io.ts`)

**Decision.** All untrusted JSON — file import **and** localStorage — goes through
`parsePlan`/`coercePlan`. Validation is structural, not version-strict.

**Why.** One place to keep the renderer safe from malformed data. Accepting
unknown `version` strings and dropping items that reference a missing wall means
older or partial exports still load instead of crashing.

## Biome for lint + format (not ESLint + Prettier)

**Decision.** Use Biome as the single lint + format tool.

**Why.** We wanted both linting and formatting; Biome does both in one fast tool
with one config and native CSS support. There was no existing ESLint config to
migrate, so the usual reasons to stay on ESLint+Prettier didn't apply. Only
`style/noNonNullAssertion` is disabled — `svgRef.current!` etc. are idiomatic for
a ref-driven SVG canvas.

## Testing: Vitest with randomized order

**Decision.** Vitest for the pure modules, with `sequence.shuffle` enabled.

**Why.** The geometry / io / history modules are pure and easy to test. Shuffling
test order makes hidden order-dependence (e.g. a shared fixture mutated in place)
fail fast and reproducibly instead of passing by luck.

## Pointer capture on the `<svg>`

**Decision.** Capture/release the pointer on `e.currentTarget` (the `<svg>`), not
`e.target`.

**Why.** On a wall hit `e.target` is a child `<polygon>` that re-renders during a
drag (walls recompute geometry every move), which would drop the capture. The
`<svg>` is stable.

## CI runs on Node 24

**Decision.** GitHub Actions uses `actions/checkout@v6` + `actions/setup-node@v6`
on Node 24.

**Why.** The previous v4 actions ran on Node 20, which GitHub deprecated. The v6
majors run on Node 24, clearing the deprecation warnings.

## Wall length labels: counter-scaled text, short-wall threshold

**Decision.** `DimensionsLayer` draws each wall's length near its midpoint. The
label is counter-scaled by `1/view.scale` (one inner unit becomes one screen
pixel), so the **font stays a constant size on screen at any zoom**. Walls
shorter than 24px on screen get no label. Labels are `pointer-events: none`.

**Why constant size.** Everything inside the canvas `<g>` is scaled by
`view.scale`, so plain `<text>` would shrink/grow into illegibility;
counter-scaling keeps it readable without a separate screen-space pass. This is
the same constant-size labelling that Figma, CAD tools, and map UIs use — a
label is an annotation about the wall, not part of it, so it shouldn't grow with
the wall. (A label can therefore look small against a wall zoomed to fill the
viewport; that is the intended trade-off, not a bug.) Hiding labels on tiny
walls avoids text overflowing the wall it describes. Non-interactive labels
never interfere with the geometry-based hit-testing for
drawing/selecting/moving. The cm → unit formatting is a pure, tested function
(`src/app/format.ts`).

**Why a thickness-aware offset.** The font is screen-constant, but a wall's
`thickness` lives in world units, so its on-screen half-thickness
(`thickness/2 * scale`) grows as you zoom in. A label offset by a constant from
the *centreline* would be swallowed by the thickening wall — overlap that worsens
the more you zoom. So the perpendicular offset is `thickness/2 * scale +
LABEL_GAP_PX`: it clears the wall's *drawn edge* by a constant `LABEL_GAP_PX`
(8px) at every zoom. (Inner units are screen pixels because the net scale inside
the counter-scaled group is 1.)

## Toolbar icons: all from lucide-react

**Decision.** Use `lucide-react` (MIT, tree-shakeable) for every toolbar icon,
including the floor-plan tools — Wall (`BrickWall`), Window (`Grid2x2`), Door
(`DoorOpen`). Buttons keep their visible text label (icon + label, not
icon-only). No in-house glyphs — lucide covers the domain tools well enough, so
there's one consistent set and nothing to hand-maintain.

## Menus/overlays: hand-rolled behavior in `src/ui/`, no UI library (yet)

**Decision.** The toolbar's Export menu is built in-house: `src/ui/Menu.tsx` owns
the WAI-ARIA menu-button behavior (`aria-haspopup`/`aria-expanded` trigger,
`role="menu"` popup of `role="menuitem"` buttons, roving keyboard focus,
dismissal on select / `Escape` / outside click / focus leave, focus back to the
trigger on `Escape`). No UI-component dependency was added. The keyboard
wrapping rules live in the pure, tested `src/ui/menuNavigation.ts`.

**Why not a styled kit** (MUI/Chakra/Mantine). It brings its own theming and
would fight the CSS Modules + `src/theme.css` CSS-variable styling used
everywhere here, for a much larger dependency footprint than this app wants.

**Why not a headless library yet** (Radix/Base UI, Ariakit, React Aria).
Defensible in principle, premature now: before this change the app had exactly
one overlay (`WallOptionsBar`, a plain absolutely-positioned `<div>` with no
focus or dismissal logic), which isn't enough signal to pick an API and lock it
in. Keeping the behavior behind the single `Menu` component means a later swap is
one file, not every call site.

**Tripwire for revisiting.** Adopt a headless behavior library (leading
candidates Radix/Base UI or Ariakit — both unstyled, so the CSS Modules + theme
variables stay) once a 2nd/3rd dismissable-overlay feature lands and the
focus/dismissal logic would otherwise be hand-rolled again: e.g. an import-error
dialog replacing the `window.alert` calls, item/wall context menus or property
popovers, or toolbar tooltips.

## Cmd/Ctrl+drag detaches a wall endpoint, resolving a junction by z-order

**Decision.** Holding Cmd (macOS) / Ctrl (Win/Linux) and dragging near any wall
endpoint detaches just that endpoint, with no selection required — an
accelerator layered on top of the discoverable select-first square handles,
which are unchanged. Cmd/Ctrl was the one canvas drag modifier still free
(Shift = additive select / ×10 nudge, Alt = raw/un-snapped); it only meant
undo/redo on the keyboard, which a pointer drag can't collide with.

**How it picks a wall at a junction.** The headline use case is pulling one wall
out of a *shared junction*, where two or more endpoints sit at the same
coordinate. An earlier take declined that case as "ambiguous" and fell
through — but that carved out precisely the case the feature exists for, so the
accelerator did nothing observable in normal use (a lone endpoint has nothing to
leave behind; a junction fell through to the whole-junction hinge move). So
`pickAnyWallEndpoint` (`src/geometry/connectivity.ts`) now resolves a
co-located junction by **z-order**: it detaches the topmost wall (last in draw
order, matching the `findLast` the canvas already uses to hit-test walls). The
pick is predictable and cheaply reversible (Cmd+Z, or re-drag the wall back), so
"top wall wins" beats "no shortcut."

**When it still declines.** Only a *genuinely* ambiguous grab — endpoints tied
for nearest but at **different** coordinates (equidistant by chance, not a real
junction) — reports a `"tie"` and falls through to the normal hit-tests, since
the cursor there doesn't name a spot to act on.

**Where it sits in the pointer-down order.** After the item and select-first
endpoint hit-tests, before connection points and walls — so the accelerator
wins over starting a junction or whole-wall drag, but the existing behavior for
a selected wall is untouched.

## Component tests: jsdom per-file, not globally

**Decision.** A handful of component tests (currently
`src/features/toolbar/ProjectActions.test.tsx`) run under jsdom +
`@testing-library/react`, opted into with a `// @vitest-environment jsdom`
docblock. The Vitest default environment stays `node`.

**Why.** Some behavior only exists once a component is wired up — that the Export
menu really offers an "SVG" entry, and that selecting it hands a `.svg` blob to
the download helper, can't be reached by testing a pure function. Rather than
verify that by hand (which doesn't regress-guard), test it where it lives. Keeping
jsdom per-file rather than global means the many pure geometry/io/history tests
don't pay for a DOM they never touch.

## Click-away commits an inline draft field via a document-capture pre-commit

**Decision.** The options bar's inline number fields (wall length, opening width)
commit their draft on a `pointerdown` that lands **outside** the field while the
field still holds focus, using a listener on `document`'s **capture** phase
(`src/features/toolbar/wall/draftField.ts`, wired up by the shared
`useCommitOnClickAway` hook beside it).

**Why a listener rather than a blur handler.** `onBlur={commit}` cannot cover
clicking back onto the canvas: that click clears (or moves) the selection, the
field is rendered conditionally on there *being* a single selection, and removing
a focused element from the DOM does **not** fire `blur` — so the typed value was
silently dropped. Capture-phase on `document` runs ahead of React's root-level
handler, so the value is applied while the field and the selection it targets
still exist.

**Why not commit on unmount instead.** An effect cleanup runs *after* the
selection has already changed, so `setSelectedWallLength` /
`setSelectedOpeningWidth` — which act on the *current* selection — would either
bail out or, worse, apply the old draft to the newly selected element. Keeping
the commit ahead of the selection change avoids inventing an id-targeted second
write path alongside the existing `commit()` chokepoint.

**Why it can't double-commit.** Both store actions already skip a no-op resize,
so the later `blur` (when the field survives, e.g. clicking the same element)
adds no second or empty undo entry. Every path — Enter, blur, click-away —
shares one `parseDraft` validation, so an invalid draft is rejected identically.

## Responsive breakpoints live as tokens in `theme.css`, touch sizing as a pointer query

**Decision.** The named breakpoint (`--sp-bp-tablet`) and the touch-target floor
(`--sp-touch-target`) are tokens in `src/theme.css`. Anything that varies **by
width** is expressed as a token flip inside the single `@media (max-width: 768px)`
block in that same file, so the pixel literal is spelled out exactly once; CSS
modules only read `var(--sp-toolbar-gap)` / `var(--sp-toolbar-padding-x)`.
Anything that varies **by pointer** — the 44px control floors — is a
`@media (pointer: coarse)` block in the CSS module beside the control it sizes,
reading the shared token for the value.

**Why the split.** CSS cannot interpolate a custom property into a media
condition (`@media (max-width: var(--sp-bp-tablet))` is invalid), so a breakpoint
"token" only actually prevents duplication if the width-dependent rules
themselves are centralized. Pointer queries carry no such literal, so keeping
them next to the controls costs nothing and keeps a button's sizing readable in
one place. A phone-width pass adds `--sp-bp-phone` and a second flip block the
same way.

**Why the touch floor grows the hit area, not the control.** A 44px `min-height`
on a 28px button is a visible restyle: the toolbar gets taller, buttons that were
wide-and-short turn square, and the theme switch's `border-radius: 999px`
segments become circles. None of that is what the floor is *for* — the
requirement is that a finger can hit the control, not that the control looks
different on a touch screen. So under `pointer: coarse` each control gets an
invisible `::after` overlay `--sp-touch-target` tall, centred on its box: the
tap target is finger-sized while the painted control is pixel-identical to the
desktop one. Horizontally a plain `min-width` does the job — every toolbar
button is an icon plus a label and already exceeds the target, so it never
binds, and a width floor (unlike an overlay) can't reach into the neighbour
beside it. The one thing the overlays do cost is a taller `row-gap` once the row
wraps, so two rows' targets don't overlap. `Menu`'s entries keep a real
`min-height` instead: they are stacked full-width rows, where overlapping hit
areas would mean tapping one entry and triggering the next.

**Why the toolbar wraps rather than scrolls.** At 768px the row is wider than the
viewport, and a non-wrapping row clipped Undo/Redo off-screen with no way to
reach them. `flex-wrap: wrap` is invisible at desktop widths (nothing wraps) and
needs no breakpoint at all, where a horizontal scroller would hide controls
behind a gesture.

## The canvas pan/zoom tip is a positioned caption, and a pure function decides it

**Decision.** The `Tip: Right-drag to pan, Wheel to zoom` advice moved out of the
toolbar row into `CanvasHint` (`src/features/canvas/`), absolutely positioned at
the canvas's bottom-right with `pointer-events: none`. *Which* text to show is
`canvasHintForPointer` in `src/app/canvasHint.ts` — a pure function of the
pointer kind, which `usePointerKind` (`src/ui/`) reads from `matchMedia`.

**Why it moved.** It is advice about the canvas, so it reads as a caption there
rather than as the 14th control in a row of controls — and it was the single
widest contributor to the row's overflow at tablet widths, so relocating it fixes
the clipping at the source instead of only below a breakpoint. It floats (rather
than occupying layout) for the same reason `WallOptionsBar` does: toggling it
must never reflow the canvas. `pointer-events: none` is not optional — it now
sits over drawable canvas, and a passive hint that ate the start of a drag would
be a worse bug than the overflow.

**Why a pure helper for one string.** jsdom has no layout engine, so the layout
half of responsive work isn't unit-testable; the pointer decision is the part
that *can* be pinned down, and it carries a real product rule — a coarse pointer
is shown **nothing**, not a touch equivalent, because touch pan/zoom gestures
don't exist yet. Encoded in a component that would be a comment; encoded in
`canvasHint.ts` it is a test.
