# Design decisions

A lightweight log of notable decisions and the reasoning behind them, so the
"why" isn't lost. Newest first. Each entry: what we decided, and why.

---

## Review handoffs use verified GitHub state

The dispatcher advances after each verified runner result. A signed webhook
queues wakes for outside changes, and the scheduled check reads the same GitHub
state for recovery. Keeping phase checkpoints and verdicts on the PR lets a
restarted dispatcher recognize a review or push that finished before the label
changed. A single lock prevents overlapping runs on the local runner.

Engineer reviews first and Product starts after Engineer approves the current
head. Exact SHAs keep an approval from following a later push. Product can reuse
Engineer evidence and focus its own pass on the issue's user workflow.

## Image export visibility keeps annotation positions fixed

The image export preview, both download formats, and clipboard copy use the same
light SVG in every editor theme so the preview matches the result for sharing
and print. When a measurement is hidden, its text is omitted after room name
layout. This keeps names in the same place and at the same size as measurements
toggle.

Copy uses the same PNG rasterizer as the PNG download so the exported plan can
be pasted into messages and documents. The clipboard write starts during the
click and receives the PNG as a promise to preserve Safari's user gesture.
[WebKit clipboard API discussion](https://bugs.webkit.org/show_bug.cgi?id=222262)

Project actions allow one PNG preparation and one clipboard write at a time.
Progress persists across dialog sessions, preventing duplicate downloads and
keeping older images from overwriting newer copies.

Copy and PNG feedback stays in the buttons. A loader replaces the action icon
while each button is disabled, keeping the label and width stable. The loader
stays static with reduced motion. Copy confirms success with **Copied**.
PNG and copy errors share a non-blocking notice above the export actions.
When an export fails after dismissal, the toolbar shows the notice.

PNG reports progress during rasterization and encoding. SVG uses the markup
already prepared for the preview. The browser handles saving each file after
the editor hands it off. Exports of untitled plans use the `floor-plan`
filename without changing the plan metadata.

The shared modal handles the close button, Escape and backdrop clicks. The
export dialog enables backdrop dismissal while both export actions are idle.
An eligible click starts and ends on the backdrop. The close button and Escape
also work while PNG preparation or copying is in progress.

## Plan labels and room names scale with the drawing

Plan labels store a plain text line and the start of its baseline in world
coordinates. Plan labels and room names use a 28-unit semibold font, and room
areas use a 24-unit regular font.
This gives 14 px names and 12 px areas at a typical 50% Fit zoom. The canvas
and exports share a world-space room layout. The layout tries the full name
on one or two lines at the default size, then at 75% before using an ellipsis.
This preserves more names in tight rooms while keeping abbreviations readable.
The full name stays in the plan. Where a room cannot fit an ellipsis and its
area at the default size, the available clearance determines their scale.
Room labels use world-space text sizes. On the canvas, the layout uses the
wall measurements visible at the current zoom, so a label may move to keep
both readable. SVG and PNG lay out against the exported measurements in
plan coordinates.

Fit uses the world-space label bounds. On very wide labeled plans, Fit can
lower the zoom limit. Wheel and pinch can return to that scale,
and the viewport preserves the limit on reload. The grid is hidden if its
lines would be too dense to draw. PNG export scales the entire SVG to fit
within an 8192-pixel side limit and the 16-megapixel canvas limit of older
iOS WebKit versions.

The preview and saved label use the same SVG text renderer. The visible
caret uses the SVG glyph positions while the native field handles editing.
The canvas pans to reveal the draft and follows the caret on lines wider
than the viewport. The chosen world anchor and zoom stay fixed, and the view
stays where it is on commit.
Leaving the field commits its text
before canvas selection can change, and Escape cancels the edit. The shared
Remove action is available for selected labels after inline editing ends.
Clearing an existing label also removes it. The marquee uses each label's
text bounds and can select labels alongside walls and openings. Dragging
a selected wall or label moves both together in one undo step. Openings follow
their host walls, and the whole group uses wall snapping when walls are selected.

## Keep measurement inputs compact with larger native tap areas

The floating options bar paints each measurement field at the toolbar's
32 px control height. On coarse pointers, the native input is 44 px tall and
centered over that frame so a tap in the extra area goes directly to the
browser's text editor. Both the bar and the measurement form reserve space
between wrapped rows for the overhang from adjacent targets.

Touch taps within the bar let blur save the draft. Move stays in place until
the next frame on blur so wrapping cannot redirect the click. Presses on the
canvas still commit before the selection can change.

## Share canonical agent contracts through small Claude/Codex adapters

**Decision.** Extend PR #108's Bash execution adapter instead of rewriting the
GitHub-label state machine. `.agents/engine.sh` resolves configuration and returns
normalized shell results; `.agents/providers/{claude,codex}.sh` own CLI arguments
and provider loading. Product, Engineer, and Reviewer contracts are independent
of the selected provider. Reviewer remains Engineer **review** mode with the same
entry point, comment header, and verdicts; it gains independent configuration,
not a new pipeline stage.

**One canonical contract, compatible Claude skills.** Role/shared Markdown lives
in `.agents/instructions/`. The existing `.claude/skills/` files retain their
original content and discovery metadata as byte-identical compatibility copies.
`npm run agents:sync` refreshes those copies; mocked tests check equality. The
`ship` skill stays in `.claude/skills/`. Claude keeps its existing task/slash text,
role shim, skill names, and launch arguments. Native skill expansion is the
installed Claude CLI's responsibility, not a guarantee made by this adapter.

**Codex receives instructions directly.** Before launching Codex, the adapter
resolves the selected role/mode against its own checkout, validates the exact
canonical role and three shared files, and embeds their text alongside the shim
and task. Reviewer also includes the Engineer contract it references. Missing,
empty, unreadable, or ambiguous contract selection fails before a CLI process.
This replaces the earlier generic note asking the model to find skill files.
Interactive Codex prompt files remain optional references to the same contracts;
their installer never starts an agent and requires `--force` to replace unrelated
files/symlinks. It unlinks symlinks rather than overwriting their targets, refuses
directories, and preflights both prompt destinations before installation.

**Explicit provider, model, and account selection.** Provider and model each
resolve from role+mode to role to global settings. `SPACORY_AGENT_PROVIDER`
precedes the legacy `SPACORY_AGENT_ENGINE`; absent overrides, Claude remains the
default. Models fall back to the selected provider's `CLAUDE_MODEL` or
`CODEX_MODEL`, then its CLI default. `CLAUDE_EFFORT` remains Claude-only; model
names do not transfer across providers. Codex requires an explicitly supplied,
absolute, accessible `CODEX_HOME` directory from the calling environment. Account
paths and credentials stay outside repository configuration. The adapter never
selects a default account, authenticates, or falls back to another provider.

**Streaming results and compatibility limits.** Separate FIFO/tee readers stream
and capture stdout/stderr, then drain before shell results are collected. A
background worker owns CLI/reader cleanup. The runner forwards cancellation,
waits for the worker, removes captures, then restores caller traps and invokes
any original signal handler. Ignored signals remain ignored; default cancellation
exits with 128 + signal number so EXIT cleanup still runs. Stdin forwarding and raw
CLI exit codes remain unchanged; known failed-process diagnostics are classified
as configuration/authentication errors, and unknown failures as execution errors.
Classification is best effort. Capture interruption can leave result strings
incomplete, and SIGKILL cannot execute cleanup traps. Dispatcher retries and
Product memory landing remain unchanged.

**Permission flags are not live permission guarantees.** Claude retains its
permission-mode/allowlist behavior. Codex maps `acceptEdits` to network-enabled
workspace-write with approval policy `never`, and `bypassPermissions` to bypass
approvals and sandbox; unsupported mappings fail explicitly. Codex does not use
Claude's allowlist, and neither provider's flags override host restrictions or
grant model/account access. Tests use mocked executables on a closed PATH and
temporary accounts; native CLI loading, authentication, and actual approval
behavior are unverified. No timer, workflow, or unattended execution is enabled.
See [provider setup and limitations](../.agents/README.md#provider-setup-and-configuration).

## Licence: MIT

**Decision.** Spacory is licensed **MIT**. The repo had called itself "open
source" while shipping *no* licence file — legally all-rights-reserved despite the
wording — so this closes a real gap, not just a formality.

**Why permissive, not copyleft.** MIT maximises freedom and frictionless adoption —
anyone, including companies, can use, modify, and build on the engine without
copyleft obligations, which is the whole point of publishing it openly. MIT (over
Apache-2.0) matches that "no-scare" familiarity; the trade-off accepted is MIT's
silence on patents and trademark, judged low-risk for a floor-plan geometry engine.

**Reversibility.** Starting permissive is deliberate, not accidental: MIT can always
be *relaxed* further, whereas going *stricter* later (e.g. AGPL) on an
already-published core is a one-way door. Permissive keeps future licensing options
open rather than foreclosing them.

---

## Rooms are derived planar-graph faces, not stored entities

**Decision.** A room is **derived**, not modelled: it is a *bounded face of the
planar graph formed by the wall centrelines*. Detection lives in a pure geometry
module (`src/geometry/rooms.ts`, same pattern as `junction.ts` / `bounds.ts`) that
traverses the subdivision, keeps the bounded faces, and discards the single
unbounded "outside" face. Nothing about a room is written into the `Plan` except
**user metadata** (name, and later fill/type), and that metadata is anchored to an
**interior point**, not to the set of wall ids that bound the face.

**Why derived, not stored.** Stored room entities inherit exactly the
reconcile-against-every-edit burden we already fight for openings, and they desync
the instant a wall moves. Derived rooms self-heal — move a wall and the faces
recompute — which is the same architectural grain as `connectivity.ts` deriving
junctions from coordinate equality rather than storing a "these walls are joined"
relation. It also keeps the schema floor-plan-minimal (no room array to migrate,
validate, or keep referentially consistent).

**Why an interior-point anchor.** Metadata has to survive wall edits, so it needs a
key that is stable across them. A key made of the bounding wall ids shatters the
moment a wall splits (which the mid-span T-junction feature does routinely) or two
faces merge. An interior point re-matches by point-in-polygon into whichever face
now contains it, which is how a user already thinks of a label ("it sits here").
Re-matching is cheap and degrades gracefully — a point stranded outside every face
(its room was opened up) just goes unplaced rather than corrupting anything.
When several anchors share a face, the first name in document order is visible.
Renaming keeps that record's anchor. Clearing removes the visible record and
reveals the next name in document order if another anchor shares the face. Other
anchors remain available when the room boundaries change again.

**Why this is tractable now specifically.** Face detection is well-behaved on a
planar *straight-line* graph but a mess against mid-span crossings. The just-landed
mid-span T-split (see below) makes every wall connection a shared endpoint — a real
graph vertex — so the walls now *are* a clean PSLG. The precondition the feature
needs arrived with that change; this is the moment to answer it.

**Area measurement.** The first rooms layer measures centreline polygons in cm²
and converts using the square of the display-unit factor. Wall thickness is not
subtracted, so this is not net usable interior area. Rooms are memoized from the
current wall array during rendering, including live edits. History records user
edits to names. Nested faces own their own interiors. The surrounding room uses
a point outside each enclosed face for selection, new name anchors, and label
placement. The area reading still measures each room's centreline outline.
Named labels fit between the painted wall polygons, junction fills, wall
dimensions, and the door hinge, leaf, and arc. Open space within the swing can
hold a label. Labels can shift within the same face to stay clear, wrap
to a second line, or use a smaller size before abbreviating with an ellipsis.
The visible position can shift as wall thickness changes, while the stored name
anchor stays fixed. Font measurement preserves the letters' natural proportions.
The full name stays in the document and is available in the editor and the SVG's title. Image
dimensions follow plan geometry, regardless of the length of any room name.
The editor caps newly saved names at 80 characters. Import and reload preserve
the name text already stored in a plan.

Tab moves keyboard focus between room labels. A dashed outline traces the room
boundary. Enter or Space selects the room and focuses its name field. The accent
fill indicates selection.

**Scope / what's deferred.** Openings don't affect enclosure (a door in a wall
doesn't open the polygon — enclosure is pure wall topology), and open/partial plans
simply yield fewer faces. Subtracting holes and islands from area measurements
remains a separate feature. The
product-facing choices (auto-name vs. blank, area shown always vs. on-select, fill
in MVP) live in the feature issue, not here.

---

## App-first, SDK-seam-aware: keep the core instantiable, defer the public boundary

**Decision.** Spacory is and stays a **standalone app**. We do **not** ship an
embeddable SDK (`createSpacoryEditor(...)`, a public `exports` map, `types`, a
library build, versioned npm consumption) as a *proactive* project. This is a "not
yet, on demand" call — **not a "never"**: the boundary can become worth it quickly
once a real consumer appears (comparable editors added one within their first year).
The "SDK path" is split into two decisions with two answers:

1. **The instance/storage seam — do soonish, opportunistically (not a sprint).**
   Today `history` is a module-scope `let` in `src/app/store.ts` (reassigned on
   every mutation) and persistence writes to fixed `localStorage` keys at module
   scope, so a page can hold exactly one editor with storage the host can't
   control. Lifting `history` into a `createAppStore()` instance and injecting a
   `storage` port (get/set interface, default = a localStorage adapter) is
   justified by the **app alone** — the planned content-library feature wants to
   instantiate/preview multiple `Plan`s, and injected storage makes the store's
   own tests cleaner. Do it the next time we're meaningfully in `store.ts`, or the
   first time a feature reaches for it. Blast radius is one file; the only cost of
   waiting is that the singleton accretes more code closing over it. Instance-scoping
   the history this way is a well-trodden refactor for editors of this kind, and it's
   what makes **switchable floors/layouts** cheap — one live editor swapping between
   saved plans, each with its own undo. Editing two canvases *simultaneously* is a
   further step (routing input and undo to the focused canvas, decoupling any
   remaining page-global state), so it stays demand-triggered under boundary #2.

2. **The public boundary — defer, demand-triggered.** Flip to building the facade,
   `exports`, versioning, and docs only when a real consumer exists — not before.
   Concrete triggers: a second surface wants to render Spacory (another app, a live
   embed on a page, a plugin host); two editor instances must live on one page
   (comparison view, template gallery with previews); or someone actually asks to
   `npm install` it.

**If/when the facade does get built**, prefer thin wrappers over the existing
named store actions (`editor.addWall(w)`, `editor.loadPlan(p)`, …) over an
`execute(command)` command bus. The bus's usual justification is undo/redo, which
diff-based history (see below) already gives us without a serializable command
vocabulary — so it would be a speculative public contract with no earned need.
`on("change", …)` should fire from the `commit()` chokepoint (committed document
changes only — not live-drag ticks or view pans), and `destroy()` only has meaning
once seam #1 makes instances real.

**Why.** A published SDK *with zero consumers* is a liability: every future refactor
must then preserve a contract nobody uses, under semver, on an API designed by
guessing. The point is the *ordering*, not hostility to an SDK — the same boundary
shipped *once real consumers exist* earns its keep. The bigger risk to the project
isn't "we can't embed it" —
it's "the editor isn't yet good enough that anyone *wants* to embed it," so scarce
attention belongs on the product, not a premature boundary. And because seam #1
makes the facade ~50 lines of glue whenever we want it, waiting costs almost
nothing — we're not saving future effort by building it now, just taking on the
maintenance early. Note the hard part of SDK-readiness — a clean, framework-free
core — is *already* largely done: geometry, `io.ts`, and `history.ts` are pure,
tested modules; the single UI-oriented Zustand store is the only real coupling
point, and its natural future cleave is document/history/persistence core vs.
editor UI state (tool, view, canvasSize, selection, marquee). Separately, the
"and library" wording lived only in the **GitHub repo description** metadata (not
the README, which already says "editor"); it was dropped there to stop promising
a boundary that doesn't exist.

**The data model follows the same rule.** The general "spatial engine" concepts —
arbitrary typed entities, product/catalog references, generic extension-metadata
bags, layers/levels, parametric constraints, cross-object relationships,
permissions/readonly entities, a formal migration framework — are **deferred behind
the same triggers**, and constraints/permissions in particular may be *never*
(parametric constraints cut against the non-CAD mission; permissions only exist
once it's a hosted multi-user product). Two things are *not* in that deferred pile:
**rooms**, which are a real product feature answered above (derived faces), and the
**one schema seam worth watching** — `Item.wallAttach` is currently *mandatory*, so
the first free-standing entity (furniture, a text label, a free dimension) is the
point at which `Item` should be lifted to "typed entity, *optionally* wall-attached"
rather than special-cased. Don't generalize it speculatively; let that first
feature define the shape, since it touches serialized data.

---

## A split seam is merged back only where the commit vacated it

**Decision.** `commit()` also runs the inverse of the split
(`src/geometry/wallMerge.ts`): where an edit leaves exactly **two** wall
endpoints on a coordinate an endpoint just *left*, and the two walls are
collinear, continue in the same direction and share a `thickness`, they become
one wall. The earlier wall in the array keeps its id and direction; the other
disappears into it, its openings rebased onto the merged wall. This is what
undoes the split when the T-wall that caused it is deleted or dragged out of the
junction.

**Why keyed on a *vacated* coordinate, not on "is this seam meaningless".** As a
global invariant it would change wall drawing: a click-to-chain straight run
creates collinear same-thickness neighbours **on purpose**, and so does an
imported plan. There is no stored provenance to tell a split seam from a drawn
one — connectivity is a query over coordinates and nothing else — so the trigger
is the *edit*, not the shape: a coordinate that fewer endpoints sit on than
before. An edit that only *adds* an endpoint merges nothing, and a whole-junction
drag moves every end at the coordinate together, so it changes nothing about how
many meet there. The corollary is deliberate: a chain's seam does merge if a
third wall that was ending there is removed, because at that point the two
arrangements are indistinguishable — and one straight wall is what the user sees
either way.

**Why all three conditions.** Exactly two ends means a 3-wall junction is a real
junction and stays. Collinearity is judged on the sine of the angle with a `1e-6`
tolerance — float noise from a projected split point is ~1e-13, while a degree of
difference is ~0.017, so merging can never visibly bend a wall. Same direction
*through* the point excludes two walls folding back over each other (an overlap,
not a seam), and equal thickness excludes walls that are visibly different.

**Why before the split in the same `commit()`.** The two share a trigger — an
endpoint move — and can pull opposite ways: an endpoint dragged off a host but
still *inside* its body should stay attached (#96's rule). Merging first and
splitting second reaches that in one commit — the seam merges, then the split
puts it back — and the result is a fixed point, whereas splitting first leaves a
plan the next commit would re-split. Riding in the same `commit()` also gives the
merge one undo entry with the edit that caused it, and keeps it out of live drag
previews, so the host stays split until the drag is released.

**The selection is repaired in the same step.** A merge removes a wall id and a
junction coordinate, so `commit()` now also drops a held connection point that no
endpoint sits on any more and prunes selected wall/item ids the committed plan no
longer has. A selection left behind is *invisible but still live* — the handle
isn't drawn, while an arrow key still routes to the junction nudge — which is the
same hazard the split's weld-following solves from the other direction.

---

## A mid-span T-junction is made by splitting the host, not by a new relation

**Decision.** When a wall's endpoint lands inside another wall's drawn body
(perpendicular distance ≤ `host.thickness / 2`), `commit()` splits the host at
the projected point and welds the touching endpoint exactly onto it
(`src/geometry/wallSplit.ts`). The host keeps its id for the first segment; each
further segment gets a fresh one, and every segment inherits the host's
thickness.

**Why split rather than model the relation.** Connectivity is *coordinate
equality between endpoints* (`connectivity.ts`) and nothing else — mitering,
auto-follow, junction drag and endpoint detach all derive from it. Splitting
produces the shared coordinate those features already react to, so a mid-span T
becomes an ordinary three-endpoint junction with no new code and no new concept
in the schema. A persistent "these walls are joined" relation would contradict
the settled model and need every downstream feature taught about it.

**Why `thickness / 2` is the tolerance.** It is the rule a user can see: if the
endpoint is inside the wall you drew, it looks like it touches, so it connects.
A fixed cm tolerance would either miss thick walls or fire on thin ones that
visibly don't meet.

**A weld moves the coordinate, not one endpoint.** Several wall ends can sit on
one coordinate — that is what a junction is — so moving only the end that was
detected as touching leaves its neighbours behind, and a corner the user drew
comes apart as a side effect of joining something else: the exact drift this
feature exists to stop, and nothing later recovers it. A weld therefore drags
*every* end at the coordinate onto the split point, the way `translateEndpointsAt`
already does for a junction drag. Bringing the stragglers along can leave a
collinear or duplicate result, which the run-level verdict below discards — so
the worst outcome is walls left as drawn, never walls silently disconnected. A
coordinate can only move to one place, so where two ends sharing one were
detected against different hosts the first decides; the other's split point is
dropped and re-detected on the next pass.

**Why a near-corner touch does nothing.** A projection within `MIN_WALL_LENGTH`
of either of the host's own endpoints is an ordinary corner, and splitting there
would carve a sliver wall. Two touches closer than `MIN_WALL_LENGTH` to each
other weld into a single junction for the same reason. Welding genuine near-miss
*corners* together is a separate feature and deliberately not done here.

**A wall with both ends inside one host is an overlap, not a T.** If both of a
wall's endpoints land inside the *same* host's body, welding them would collapse
that wall onto the host's centreline — to zero length where it crosses the host,
or onto a duplicate of the host's own span where it runs alongside. Neither is a
junction: the wall lies *within* another wall, which is the crossing/overlap
family this module leaves alone. Both touches are skipped and the host stays
whole. A wall whose two ends land on two *different* hosts is an ordinary pair of
T-junctions and still splits both.

**Two walls that already meet don't touch each other again.** Once a pair shares
an endpoint coordinate they are joined, so a further touch between that same pair
is the two lying over each other rather than a new T. Welding it produces a
*second* wall spanning the junctions they already share: the user sees one wall
but has two, with two length labels, and deleting the one they can see leaves its
twin. This is reachable from an ordinary draw, because a genuine T can create the
pair — welding a slanted endpoint onto a host leaves the host's own far endpoint
sitting inside the drawn wall's body. Touches between already-joined walls are
therefore skipped, which keeps the T that joined them.

**A mutual touch is one overlap, not two Ts.** When each of two walls ends inside
the *other*'s body, welding either one drags the centreline the other was
measured against, so the pair settles as two coincident walls — and which wall
gets mangled is array order. Neither side has a claim to the span: this is the
same overlap family as both-ends-in-one-host, so both touches are dropped and
both walls stay whole. They then look joined without being so, which is the
pre-feature status quo rather than a plan the user cannot repair. Doing something
better with genuine overlaps is a separate feature.

**Why in `commit()`.** It is the single chokepoint every plan edit passes
through, so draw, move, endpoint drag and type-to-resize are covered at one call
site, and the split rides inside the same history entry as the edit that caused
it — one undo restores the pre-split walls *and* items. Live drag previews
bypass `commit()` by design, so nothing splits mid-gesture. `loadPlan` also
bypasses it, so an imported plan isn't retro-split until the first edit.

**A host that moves in a pass is split in the next one.** Split offsets are
measured against the host's geometry *before* anything is welded, so a wall that
is both a toucher and a host would be sliced at stale offsets — producing
overlapping duplicate segments, or ones under `MIN_WALL_LENGTH`. Such a touch is
deferred instead: the detect→apply loop re-runs against the settled geometry,
where the ordinary guards apply and the touch either splits cleanly or turns out
to be a corner. Deferring costs a pass; slicing stale geometry corrupts the plan.
A *cycle* of deferrals — walls each ending mid-span of the next, all moving in
the same pass — settles to no split at all, leaving those walls looking joined
but not. That is the pre-feature status quo rather than a regression, it needs an
exotic pinwheel arrangement, and drawing commits each wall separately, so it only
arises from a loaded plan.

**A run that doesn't settle is discarded whole.** The individual guards above are
per-touch, and on thick walls that isn't enough: the band is `thickness / 2`, so
at the 40cm preset it is 20cm — wide enough to swallow a coordinate that is
*already* a junction. Welding it drags the walls meeting there onto the new
host's centreline, which creates fresh touches, and applying such a pass anyway
grinds the neighbourhood into slivers and leaves the plan unsettled, so the next
commit grinds it again: three grid-snapped 40cm draws once committed as 27 walls
and roughly doubled on every commit after. Rather than adding a per-touch guard
for each arrangement that can reach a bad outcome, the whole detect→apply run is
judged at the end and kept only if the plan settled — no touches left, no
sub-`MIN_WALL_LENGTH` wall and no coincident pair that the input didn't already
have. That makes the invariants structural: a split never produces a sliver or a
duplicate span, and a plan the split has been through never changes on a later
commit (a kept result re-detects nothing; a discarded one is returned untouched,
so the next commit reaches the same verdict). A discarded run leaves those walls
looking joined without being so — the same fallback the overlap guards take. It
also subsumes the degenerate case of a wall welding onto two hosts whose
centrelines are within `MIN_WALL_LENGTH` of each other, which no per-touch guard
caught because each end is judged against its own nearest host.

**Openings follow the reposition-first rule.** Each of the host's openings
re-attaches to whichever segment holds it with `offset` rebased to that
segment's `a`; one straddling the split point moves into the segment holding its
larger part, keeping its width, and is removed only if it cannot fit there at
all — the same last-resort rule `reconcileItemsToWalls` already applies.

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

## Plan bounds measure a door's arc by its quadrant's extreme points

**Decision.** `getPlanBounds` (`src/geometry/bounds.ts`) adds, for every door,
the points from `getDoorSweepPoints` (`src/geometry/itemGeometry.ts`): the hinge,
both leaf tips, **and** any of the swing circle's four axis-aligned extreme
points (`hinge ± radius` in x / y) that fall inside the swept quadrant. A
candidate direction is inside when its dot product with **both** quadrant edge
unit vectors (hinge→closed tip and hinge→open tip) is non-negative. Those points
are already-drawn positions, so they are included with **zero** padding.

**Why not just the two tips.** The arc bulges past the chord between its tips.
On an axis-aligned wall a tip happens to be the extreme, which hides the bug; on
a 45° wall the arc's own `hinge ± radius` point sets the box side and no tip
does. **Why not pad the hinge by the radius.** That's a square around the hinge:
correct but loose on the three sides the leaf never sweeps, which would make the
export and **Fit** leave dead space on every plan with a door. The quadrant test
is exact and costs four dot products.

**Why in the bounds, not `EXPORT_MARGIN`.** The overflow is the opening's own
length, so no fixed margin can cover a wide-enough door, and raising it would pad
every plan. Fixing the bounds also fixes `computeFitView` (`src/app/viewport.ts`)
cropping a door, since Fit frames off the same box. Windows need nothing: their
rect and midline stay within half the item's thickness of the wall centerline,
which the existing per-endpoint padding already covers (pinned by a test).

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
another is now made into one by splitting the host — see "A mid-span T-junction
is made by splitting the host, not by a new relation" above, and "A split seam is
merged back only where the commit vacated it" for the cleanup; a true X crossing
(neither wall *ends* on the other) still isn't. Very acute angles are now capped
by a miter limit (bevel fallback) — see "Miter limit is a multiple of
half-thickness, not a fixed cm value" above.

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

## Typed wall lengths follow visible anchors

The order in which a wall was drawn must not decide which junction moves.
Typing a length keeps the only joined end fixed when there is one. With two
joined ends or none, the edit defaults to the center. The user can choose
which end moves or move both for the current edit. The canvas previews each
moved junction and the walls that follow it, so any change to neighboring wall
angles or lengths is visible before the single undoable commit. Openings keep
their position along the resized wall wherever they still fit. A resize can
form a new mid-span junction at an exact touch. The entered length and wall
angle take precedence over snapping the resized endpoints to a nearby wall.
When moving the stem of a T whose host is still one segment, preview and commit
split the host at the original junction so both legs can follow the stem.
If a host cannot split safely, the resize is blocked and the status explains
that the selected move would disconnect a junction. Shortening an unsplit
host past an existing T contact is blocked for the same reason.

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
beside it. That last part is a fact about *those* buttons, not a general rule:
an **icon-only** control is narrower than the target, so a `min-width` there
would visibly stretch it, and the answer is the same overlay made square plus a
gap wide enough that two neighbours' hit areas don't meet — which is what the
selection action buttons in `WallOptions.module.css` do. The one thing the
overlays do cost is a taller `row-gap` once the row wraps, so two rows' targets
don't overlap. `Menu`'s entries keep a real
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
is shown **nothing**, not a touch equivalent, because right-drag and the wheel
have no touch counterpart, and whether to advertise the gestures that replaced
them (below) is a separate call. Encoded in a component that would be a comment;
encoded in `canvasHint.ts` it is a test.

## Touch on the canvas: one finger drives the tool, two drive the viewport

**Decision.** The canvas sets `touch-action: none` (in
`FloorPlan.module.css`) and reads the contacts itself: **one** finger runs the
active tool's gesture exactly as a mouse left-drag does, and **two or more** pan
and pinch-zoom regardless of the tool. The page's `<meta name="viewport">` is
left alone — no `user-scalable=no`, no `maximum-scale=1`.

**Why scope the suppression to the canvas.** Without a `touch-action`
declaration the browser claims a finger drag as a page scroll before the pointer
handlers see it, then fires `pointercancel` — on a tablet you could not draw at
all. Killing the browser's own pinch page-wide would fix that too, but it takes
an accessibility affordance away from the toolbar and every dialog for the sake
of one element. `touch-action: none` on that one element is the narrow fix.

**Why two fingers work with any tool.** Requiring a switch to the Pan tool to
move around makes drawing on a tablet a mode-toggling chore. Since two contacts
are unambiguous — no tool uses them — the second finger can safely mean "move the
view". It does mean a second finger landing mid-drag has to **abandon** the
gesture in flight rather than commit it: hence `cancelLiveDrag()` in the store,
which rolls the live preview back to the last committed plan (unlike
`endLiveDrag()`, which keeps it — right for a drag that ended where it started,
wrong for one that never got to finish). `pointercancel` takes the same path.

**Why the pinch math is a pure module.** `computePinchView` (`src/app/viewport.ts`)
turns the anchor (both contacts and the viewport at gesture start) plus the two
current positions into the new `ViewState`. jsdom cannot do real multi-touch, so
the arithmetic — pan, zoom, the midpoint staying anchored, the scale clamp — is
only testable outside the component. It is deliberately **anchor-absolute** rather
than accumulated per move: once the scale clamps, incremental updates drift and
the midpoint stops holding. One rule ("the world point under the starting midpoint
must sit under the current midpoint") covers pan, pinch, and both at once.

**Why pan stopped using `movementX`/`movementY`.** Browsers only populate those
for mouse pointers, so the Pan tool moved nothing under a finger. The canvas now
tracks each contact's last position and pans by its delta, which is identical for
a mouse and defined for touch.

## PR previews and production share one `gh-pages` branch

**Decision.** GitHub Pages serves the site from the **`gh-pages` branch**, not
from the GitHub Actions source. A merge to `main` publishes the build to that
branch's **root** (`deploy.yml`), and every open PR publishes to
**`preview/pr-<N>/`** on the same branch (`pr-preview.yml`, via
`rossjrw/pr-preview-action`), which comments the live link and deletes the
folder on close. To let a build run at either depth, Vite's `base` is relative
(`./`) rather than `/spacory/`.

**Why one branch.** Pages has a single source, so production and previews can
only coexist as different *paths* under one deployment — root versus
`preview/pr-N/`. A main deploy therefore must not clean the preview subtree,
so `deploy.yml` uses `clean-exclude: preview/`. The relative base is what
makes the identical `dist` resolve its assets correctly whether it lands at the
root or three folders deep; nothing in the app reads `import.meta.env.BASE_URL`
or hard-codes `/spacory/`, so the switch is transparent.

**Why `pull_request`, not `pull_request_target`.** Previews build from the PR's
head code, so running the deploy with a write-scoped token on
`pull_request_target` would hand repo-write to untrusted forked code. Same-repo
branches (the agent workflow) get a write token under plain `pull_request` and
work; forked PRs get a read-only token and simply skip the deploy. That's the
safe trade for a public repo.

**Two settings follow `pr-preview-action`'s own guidance.** The preview job's
concurrency is `preview-${{ github.ref }}` with cancellation **off** (a
cancelled run desyncs the deployed files from the sticky comment), and the main
deploy sets `force: false` so a rebase — not a stale-clone force-push — lands it,
which can't clobber a preview committed in the same window. The sticky comment
`pr-preview-action` posts is the preview link; we deliberately don't register a
GitHub deployment environment for a "View deployment" button, since it only
duplicates that comment at the cost of extra plumbing.

## Shared interactive agent command policy

Keep command prefixes in `.agents/command-policy.json` and generate Claude Bash
permissions and Codex project rules with `agents:sync`. Previously only Claude
had a repository command allowlist; the Codex headless flags did not cover
interactive sessions. Generating both formats prevents their command lists from
drifting while retaining provider-specific sandbox and skill configuration.
Codex rules require a trusted project configuration and a new session. Preserve
the existing prefixes, including their option-order limitations, rather than
silently broadening interpreter permissions. See [Agent command permissions](AGENT-PERMISSIONS.md).


## Plan measurement systems (#63)

Store `meta.measurementSystem` (`metric` or `imperial`) with the plan. Metric
uses cm for lengths and m² for areas; Imperial uses feet/inches and ft².
Coordinates, thicknesses, and snap spacing remain in cm. JSON and autosaved
history preserve the setting; SVG/PNG measurement labels use the same formatters
as the canvas. Imports read only `meta.measurementSystem`: Imperial is explicit,
and missing or invalid values default to Metric. No `meta.units` compatibility
mapping or legacy undo-history migration is maintained.

Imperial lengths display tenths of an inch, with carry into feet. Editors use
separate ft/in fields and validate the combined cm value. An unchanged rounded
display never resizes geometry; moving focus between the two fields does not
commit, and leaving the editor commits before a measurement-system change.
Thickness presets are specific to each system: 10/15/30 cm in Metric and
4½″/6½″/12″ in Imperial, with custom overall thickness entered in cm or decimal
inches. Preset identity stays selected when switching systems: 10 cm maps to
4½″, 15 cm to 6½″, and 30 cm to 12″ for newly drawn walls. Custom retains its
exact cm value, even when it happens to equal a preset. Existing walls are never
resized. Drawing thickness and preset identity are session tool settings,
separate from the plan. The smaller presets are based on framed partition
assemblies; the 30 cm/12″ option is a convenient thick-wall drawing preset.
These are not nominal stud/block dimensions or guarantees about construction
suitability.

Measurement-system changes commit metadata against the last committed geometry,
while copying that metadata into any live preview. Metadata-only commits skip
geometry normalization and selection reconciliation. This preserves the drag's
original item/selection snapshots: cancelling discards the preview while keeping
the system choice, and releasing records the drag as its own undo step.

The schema exposes only `MeasurementSystem`; it no longer advertises individually
selectable display units. Formatting accepts the system directly, while numeric
editors share a `LengthUnit` type limited to cm/in.

## Wall-backed basin (#120)

Store the basin in `Plan.fixtures` with its wall id, the span of its back edge,
its side relative to the wall direction, and its depth. The wall face provides
the orientation and holds the back edge in place when the depth changes. Width
edits keep the center of the back edge as far as the wall length allows. The
same geometry drives the canvas, framing, and image exports. Wall splits and
merges rebase the attachment with the wall spans used by openings, including
flipping the stored side when a merged segment reverses direction.

The placement preview and release use the same footprint and wall-face
selection. At low zoom the pointer target expands in screen pixels while
the drawn basin keeps its dimensions. Placement, drag, and dimensional edits
reject positive-area overlap with the painted wall and junction polygons.
Door openings are checked as spans on the host wall, across both faces. Edge
contact is allowed. Width and Depth show the same blue or red footprint as
placement while the user types. A rejected edit restores the committed
dimension and leaves plan history untouched.

Duplicate tries the usual offset on either side first. When those are blocked,
it searches the original face from the edges of door openings, painted wall
geometry, and existing basins on that face. Checking the edges finds clear
spans narrower than the grid step.

Selections with basins on separate walls slide along their current faces.
Parallel faces share a slide direction and preserve the group's spacing.
Walls at different angles keep the selection in place. When basins share a
wall, selected labels keep their position relative to the basins as the
group slides or moves onto another face. A conflicting footprint turns every
preview outline red and blocks the whole drop.
When the pointer leaves wall range, the group slides along its current faces
within the travel available to all selected basins. The label follows that
same constrained movement.

The wall anchor applies to this basin. A future countertop sink can use a
countertop edge for orientation. Earlier draft sinks migrate to a nearby wall
when there is room, while plans without a suitable wall keep their remaining
content. Autosave resets undo and redo for timelines containing draft sinks.
