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
 issue agent:ready ──implement──▶ PR agent:review
 PR agent:review ──review + acceptance──▶ agent:changes   (if either asks for changes)
                                    └────▶ agent:accepted  (if both pass)
 PR agent:changes ──resolve──▶ PR agent:review            (loops, capped by SPACORY_MAX_ROUNDS)
 PR agent:accepted ──▶ human merges  (or SPACORY_AUTOMERGE=1 + CI green)
 anything ──▶ agent:blocked          (needs a human; the dispatcher leaves it alone)
```

In-flight states (`agent:implementing` / `reviewing` / `resolving`) are set while
an agent is running so a crash or restart is visible and can't double-fire.

### Enqueuing work

Label an issue **`agent:ready`** to hand it to the loop. Do this by hand, or let
the daily product `cycle` create issues and label the ones it deems ready. (The
`cycle` runs on its own slow timer so it can't flood the implement queue.)

### How a verdict becomes a transition

The Engineer `review` and Product `acceptance` runs each post a PR comment with a
header (`🛠️ Engineer review`, `🪐 Product acceptance`) and a `**Verdict:**` line.
The dispatcher reads the newest such comment **created after the PR's head
commit** (so a stale approval from before the last `resolve` push is ignored) and
maps `changes requested → agent:changes`, `approve`/`accepted → toward
agent:accepted`. If it can't parse a verdict, the PR is **blocked** rather than
guessed at.

## Priority per tick (drain before pulling new work)

1. `agent:changes` PR → **resolve**
2. `agent:review` PR → **review + acceptance** (run in parallel), then transition
3. `agent:ready` issue with no PR → **implement**

One action per tick, so a short interval can never stampede a stack of expensive
agent runs. A `mkdir` lock (macOS has no `flock`) makes overlapping ticks skip;
stale locks >2h are reclaimed.

## Running it

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
| `SPACORY_MAX_ROUNDS` | `3` | resolve↔review rounds before a PR is blocked |
| `SPACORY_AUTOMERGE` | `0` | `1` = squash-merge an accepted PR once CI is green |
| `CLAUDE_PERMISSION_MODE` | `acceptEdits` | passed to run-\*.sh; use `bypassPermissions` for fully unattended if a command isn't allowlisted |
| `CLAUDE_MODEL` | session default | passed to run-\*.sh |

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
- **Round cap** (`SPACORY_MAX_ROUNDS`) → a non-converging PR is blocked, not looped forever.
- **Unparseable verdict / failed run → `agent:blocked` + Telegram**, never a guess.
- **Agents never self-merge.** The terminal step is a human (or the explicit,
  opt-in `SPACORY_AUTOMERGE` — infrastructure the human chose, gated on green CI).
