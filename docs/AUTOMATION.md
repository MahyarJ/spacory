# Autonomous agent loop (orchestration)

Spacory's two agents (Product & Engineer) are headless `claude -p` runs — see
`.agents/run-product.sh` and `.agents/run-engineer.sh`. This doc covers the
**orchestrator** that drives them around the ticket lifecycle on a timer:
create/refine issues → implement → review + accept → resolve → merge.

## Design: GitHub is the state machine

There is **no separate database or queue**. The dispatcher
(`.agents/dispatch.sh`) is stateless and idempotent: every tick it reads open
issues/PRs and their `agent:*` labels, derives the one highest-priority action,
fires the matching agent, and records the result by moving a label. This mirrors
how the agents themselves work — spun up fresh each run, with GitHub as the only
memory.

### The label state machine

The dispatcher owns **every** `agent:*` transition (the agents don't touch
labels — they just post their usual verdict comments, which the dispatcher
reads). Run `.agents/dispatch.sh setup` once to create the labels.

```
 issue agent:triage ──triage──▶ enriched backlog issue  (accepted → issue rewritten as a spec)
                          └────▶ closed                 (rejected, with a rationale comment)
 groomed backlog issue ──(human labels agent:ready)──▶ into the build loop
 issue agent:ready ──implement──▶ PR agent:review
 PR agent:review ──review + acceptance──▶ agent:changes   (if either asks for changes)
                                    └────▶ agent:accepted  (if both pass)
 PR agent:changes ──resolve──▶ PR agent:review            (loops, capped by SPACORY_MAX_ROUNDS)
 PR agent:conflict ──reconcile──▶ PR agent:review         (merge main in, resolve conflicts, push)
 issue/PR agent:clarify ──clarify──▶ spec refined; PR ▶ agent:review, issue ▶ backlog
 PR agent:accepted ──▶ human merges  (or SPACORY_AUTOMERGE=1 + CI green)
 anything ──▶ agent:blocked          (needs a human; the dispatcher leaves it alone)
```

**Merge conflicts (the "main moved under me" door).** When another PR merges,
`main` advances and an open PR's branch can start **conflicting** with it. A conflict
only actually matters at the **merge boundary** — `review` reads the PR's own diff and
`resolve` edits its branch, both fine while it conflicts with `main` — so the loop
gates it there rather than scanning every resting PR each tick: when a PR reaches
**`agent:accepted`**, `maybe_merge` checks its mergeability and, if it's `CONFLICTING`,
routes it to **`agent:conflict`** instead of merging. (You can also label any PR
`agent:conflict` by hand to force a reconcile sooner.) A PR in `agent:conflict` is the
**highest-priority** action: the Engineer's **`reconcile`** mode merges the latest
`main` **into** the branch (a merge commit + plain push — never a rebase or
force-push; the PR squash-merges anyway, so the merge commit never reaches `main`),
resolves the conflicts preserving **both** sides' intent, re-verifies, and pushes. The
PR returns to **`agent:review`** to be re-judged against the merged base. If a conflict
needs a product call to resolve, the Engineer asks on the PR and stops (blocked), same
as any other ambiguity.

**The freshness gate (behind main, without a textual conflict).** `CONFLICTING` only
catches *textual* conflicts. Under a fast merge rate a PR can be perfectly
`MERGEABLE`, pass CI, and still break `main` once merged — because main changed an API
it depends on and CI only ever ran against the branch's now-**stale base**. So at the
**merge boundary only** — when a PR reaches `agent:accepted` (`maybe_merge`) — the
dispatcher also checks whether the branch is **behind** `main` (via the compare API's
`behind_by`, so it works whether or not branch protection is on) and, if so, routes it
to `agent:conflict` → `reconcile`. That merges main in cleanly and sends the PR back
through review, so CI validates the **actual merged result** before we (or a human)
merge. The check is deliberately **scoped to the accept boundary** — not to
implement/resolve or the review queue — so fast-moving main never churns every
intermediate run; a PR only needs to be current at the moment it's about to land.
(`implement` already branches from freshly-fetched `origin/main` every run, so a PR is
never stale *at creation* — staleness only accrues afterward, as other PRs merge.)

**Complementary GitHub setting.** For defense in depth, enable **"Require branches to
be up to date before merging"** in `main`'s branch protection. GitHub then blocks a
merge until the branch is current and re-runs required checks against the merged
result — a server-side backstop to the dispatcher's freshness gate (and it makes
`gh pr view --json mergeStateStatus` report `BEHIND`, which the gate picks up too).

**Trade-off under a very fast main.** If `main` merges faster than a full
reconcile → review → accept cycle (a few minutes of agent runs), a PR can end up
"chasing" main — reconciled, re-accepted, found behind again, reconciled again. This is
inherent to requiring up-to-date merges (GitHub's own "Update branch" button has the
same treadmill) and self-corrects once the burst quiets. A reconcile counts as a fresh
attempt, so it resets the review-round budget rather than tripping the non-convergence
cap on what is legitimate churn.

In-flight states (`agent:triaging` / `implementing` / `reviewing` / `resolving` /
`reconciling` / `clarifying`) are set while an agent is running so a crash or restart
is visible and can't double-fire.

### Enqueuing work

**Two front doors, both label-driven:**

- **You have a spec-ready issue** → label it **`agent:ready`** and the loop
  implements it. Do this by hand, or let the daily product `cycle` create issues
  and label the ones it deems ready. (The `cycle` runs on its own slow timer so it
  can't flood the implement queue.)
- **You have a rough idea / feature request** → open an issue with a title and a
  few sentences and label it **`agent:triage`**. The Product Agent grooms it:
  **accepts** it (rewriting the issue into a full spec and clearing the triage
  label, so it lands in the backlog exactly like a `cycle`-created issue) or
  **rejects** it (a rationale comment + close). Promoting an enriched idea to
  `agent:ready` is **your** call — triage never auto-enqueues work into the build
  loop. If it needs a product decision it can't infer, it asks on the issue and the
  item is left **blocked** for you.

**Mid-flight refinement (the "daily-scrum" door):** when work is already in the
loop and you want to reshape the spec — you left a question, or a PR's result made
you realize the requirements should change — label the **issue _or_ the PR**
**`agent:clarify`**. On an **issue**, the Product Agent answers on the thread and
folds any decision back into the **issue body** (the spec is the issue, always). On a
**PR**, **both agents run in parallel** (like review + acceptance): Product handles
product/scope questions and the issue body, while the **Engineer** handles technical
questions and the PR's **own metadata — its title/description** via `gh pr edit`.
That engineer lane matters: the PR description is the engineer's artifact, so Product
won't touch it and `resolve` won't (it's non-code) — without an engineer clarify the
request deadlocks, every agent correctly deferring to a lane nothing invoked. The
dispatcher then sends the PR back to **`agent:review`** to be re-judged against the
updated spec (an issue just returns to the backlog). Raising it on the PR where the
confusion lives is fine — the answer still lands in the ticket. Because editing the
issue body **resets the review-round budget** (below), refining the spec this way
never counts against the non-convergence guard.

### How a verdict becomes a transition

The Engineer `review` and Product `acceptance` runs each post a PR comment with a
header (`🛠️ Engineer review`, `🪐 Product acceptance`) and a `**Verdict:**` line.
The dispatcher reads the newest such comment **created after the PR's head
commit** (so a stale approval from before the last `resolve` push is ignored) and
maps `changes requested → agent:changes`, `approve`/`accepted → toward
agent:accepted`. If it can't parse a verdict, the PR is **blocked** rather than
guessed at.

Triage works the same way on an **issue**: the Product `triage` run posts a
`🪐 Product triage` comment with a `**Verdict:**` line, and the dispatcher maps
`accepted → clear the triage label (groomed backlog issue)`,
`rejected → (already closed by the agent)`, `needs input → agent:blocked`.
Unparseable → blocked.

## Priority per tick (drain before pulling new work)

1. `agent:conflict` PR → **reconcile** (merge `main` in, resolve conflicts), then transition — reached via a hand-label or `maybe_merge` routing an accepted-but-conflicting/behind PR here
2. `agent:changes` PR → **resolve**
3. `agent:clarify` issue/PR → **clarify** (issue: Product; PR: Product + Engineer in parallel), then transition
4. `agent:review` PR → **review + acceptance** (run in parallel), then transition
5. `agent:triage` issue → **triage** (groom the idea), then transition
6. `agent:ready` issue with no PR → **implement**

One action per tick, so a short interval can never stampede a stack of expensive
agent runs. A single `mkdir` lock (macOS has no `flock`) is shared by the tick
and the daily `cycle` — they can't run at once because both touch git
(`commit_memory` switches branches). An overlapping **tick** just skips (it fires
again in ~10 min), but the once-a-day **cycle** instead *waits* for the lock up to
`SPACORY_CYCLE_LOCK_WAIT_SECS` (30 min) so a concurrent tick can't cost it a whole
day — and if it still can't get in, it says so and pings. Stale locks >2h are
reclaimed.

## Running it

**Prerequisite:** the run-scripts need **bash ≥ 4.4** (`brew install bash` — macOS's
stock `/bin/bash` is 3.2, where an empty-args `cycle` run trips an `ORIG_ARGS[@]:
unbound variable` crash under `set -u`). `#!/usr/bin/env bash` picks up the newer one.

### Option A — launchd (recommended for "on my Mac")

launchd, **not cron**, is the supported macOS timer. The jobs run as you, reusing
your existing `claude` + `gh` auth and `.agents/.env` Telegram creds — nothing to
copy. They only run while you're logged in and the Mac is awake.

```bash
.agents/dispatch.sh setup                 # one-time: create agent:* labels
.agents/launchd/install.sh install        # load both jobs (dispatch every 10m, cycle daily 09:00)
.agents/launchd/install.sh status         # are they loaded?
.agents/launchd/install.sh uninstall      # remove them
tail -f .agents/logs/dispatch.log         # watch it work
```

Tune cadence/time by editing the `*.plist.template` files and re-running
`install`. Knobs (env, read by `dispatch.sh`):

| Var | Default | Meaning |
|-----|---------|---------|
| `SPACORY_MAX_ROUNDS` | `5` | resolve↔review rounds **since the budget last reset** before a PR is blocked. Resets on either of two signals: a **fresh attempt** (the PR re-enters the review loop from outside — a reopen from `accepted`/`blocked`, a `clarify`, a `reconcile`, a rebase-relabel, or first implement) or a **spec edit** (the linked issue body changes). So a converged PR reopened for one more change starts fresh |
| `SPACORY_AUTOMERGE` | `0` | `1` = squash-merge an accepted PR once CI is green |
| `SPACORY_AGENT_RETRIES` | `1` | extra attempts for an agent run that exits non-zero before blocking (a non-zero exit is always an infra fault — a stalled stream, a killed process — never a "changes requested" verdict, so a retry can't mask a real rejection). `0` = block on first failure |
| `SPACORY_AGENT_RETRY_BACKOFF_SECS` | `20` | wait between those attempts |
| `SPACORY_CYCLE_LOCK_WAIT_SECS` | `1800` | how long the daily `cycle` waits for the shared lock before forfeiting its slot (the fast tick never waits) |
| `CLAUDE_PERMISSION_MODE` | `acceptEdits` | passed to run-\*.sh; use `bypassPermissions` for fully unattended if a command isn't allowlisted |
| `CLAUDE_MODEL` | session default | passed to run-\*.sh |

**Running a tick by hand:** an `implement`/`review`/`resolve` tick spawns agents
that run for **several minutes** — longer than some interactive shells allow. Run
it detached so it can't be killed mid-transition (which would strand a PR under an
`agent:reviewing`/`resolving` lock label until you reset it):

```bash
mkdir -p .agents/logs
nohup .agents/dispatch.sh > .agents/logs/tick.log 2>&1 &   # returns immediately
```

launchd runs on a 10-minute interval and has no such limit, so this only affects
manual runs.

### Option B — GitHub Actions (best practice for always-on / event-driven)

Instead of polling, react to events (`issues.opened → implement`,
`pull_request.opened → review+acceptance`, `pull_request_review.submitted →
resolve`) plus a `schedule:` cron for the cycle. Runs where the artifacts live and
doesn't need your Mac awake. You must provide `claude` + auth on the runner:
either a **self-hosted runner** (keeps your interactive auth) or an
`ANTHROPIC_API_KEY` secret on a hosted runner, with `CLAUDE_PERMISSION_MODE=bypassPermissions`
since it's fully unattended. The same `dispatch.sh` logic lifts over unchanged.

## Guardrails (built in)

- **One action per tick** + **mkdir lock** → no stampede, no overlap.
- **In-flight labels** → double-firing is visible and prevented across restarts.
- **Conflicts can't reach a merge.** At the merge boundary (`maybe_merge`), an accepted
  PR that's `CONFLICTING` is routed to `agent:conflict` and reconciled (highest
  priority) rather than merged — so neither automerge nor a human ever lands a branch
  that can't merge. (A human can also hand-label `agent:conflict` to force it sooner.)
  `reconcile` only ever merges `main` in — never rebases or force-pushes (force-push is
  denied by policy). A reconcile that can't resolve a conflict without a product
  decision blocks and asks, never guesses.
- **Stale-based code can't reach main.** At the merge boundary (`maybe_merge`) an
  accepted PR that is merely **behind** `main` — no textual conflict — is reconciled
  first, so CI validates the merged result and semantic drift can't slip through on a
  green-against-a-stale-base PR. Scoped to the accept boundary so fast-moving main
  doesn't churn intermediate runs; pair with GitHub's "require branches up to date"
  protection for a server-side backstop.
- **Round cap** (`SPACORY_MAX_ROUNDS`) → a non-converging PR is blocked, not looped
  forever. Counted only **since the budget last reset**, on two principled signals: a
  **fresh attempt** (the PR re-entering the resolve↔review loop from outside it — a
  reopen from `accepted`/`blocked`, a `clarify`, a `reconcile`, a rebase-relabel, or
  first implement) or a **spec edit** (the linked issue body changing). Both are read off the
  dispatcher-owned label timeline / issue metadata, so there's no human-vs-agent
  ambiguity. So evolving requirements and a converged PR reopened for one more change
  don't burn the budget; the cap trips on genuine agent-vs-agent stalling *within a
  single attempt*. The block is unconditional (never an auto-accept): the cap only
  fires from `do_resolve`, i.e. while changes are outstanding, so the only sensible
  terminal is to hand it to a human.
- **Transient run failures are retried** (`SPACORY_AGENT_RETRIES`, default 1)
  before blocking — a stalled API stream or killed process gets another attempt, so
  a one-off infra hiccup no longer strands an otherwise-healthy PR. Retries are safe
  because a non-zero exit is never a "changes requested" verdict (that's a parsed
  comment on a clean exit); `implement` only retries while no PR exists yet, so a
  retry can't duplicate the branch/PR.
- **Unparseable verdict / exhausted-retry run failure → `agent:blocked` + Telegram**,
  never a guess.
- **Agents never self-merge.** The terminal step is a human (or the explicit,
  opt-in `SPACORY_AUTOMERGE` — infrastructure the human chose, gated on green CI).
