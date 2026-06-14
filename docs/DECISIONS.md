# Design decisions

A lightweight log of notable decisions and the reasoning behind them, so the
"why" isn't lost. Newest first. Each entry: what we decided, and why.

---

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
another isn't auto-split (would require wall splitting). Very acute angles
produce long miters; a miter limit (bevel fallback) is a possible future tweak.

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
