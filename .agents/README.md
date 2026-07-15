# Spacory Agents

A lightweight **two-agent development workflow**. Two agents collaborate
asynchronously through **GitHub** (Issues and PR comments) — they never share a session,
never depend on each other being "live," and are each spun up fresh per run.

There are exactly **two roles**, each exercised in more than one *capacity*. A PR
reviewer who leaves comments is the **Engineer Agent** (review capacity); the one who
addresses those comments is the **Engineer Agent** (resolve capacity); the one who
acceptance-tests in the product voice is the **Product Agent** (acceptance capacity). No
new agent "types" are invented — same two roles, different modes, each a fresh headless
run coordinating through GitHub.

```
                 reads/writes
  ┌──────────────┐   ┌─────────────────────┐
  │ project-     │◀──│   Product Agent     │  owns WHAT & WHY
  │ memory.md    │──▶│ (senior PM/analyst) │
  └──────────────┘   └─────────┬───────────┘
        ▲                      │ creates
        │ you edit             ▼
   (human, anytime)      GitHub Issues ──────┐
                                             │ assigned (issue # only)
                              ┌──────────────▼──────┐
                              │   Engineer Agent    │  owns HOW
                              │ (senior engineer)   │
                              └──────────┬──────────┘
                                         │ opens
                                         ▼
                                  Pull Request → CI → review
```

## The two agents

| | Product Agent | Engineer Agent |
|---|---|---|
| **Role** | Senior PM / analyst — the "what & why" | Senior engineer — the "how" |
| **Skill** (source of truth) | [`product-agent`](../.claude/skills/product-agent/SKILL.md) | [`engineer-agent`](../.claude/skills/engineer-agent/SKILL.md) |
| **System-prompt shim** | [`product-agent-prompt.md`](product-agent-prompt.md) | [`engineer-agent-prompt.md`](engineer-agent-prompt.md) |
| **Modes** | `cycle` · `acceptance` · `clarify` · `triage` | `implement` · `review` · `resolve` · `clarify` |
| **Never** | writes app code; revisits settled architecture; merges | reads `project-memory.md` or other product context; guesses on ambiguity; merges |

Each role is **mode-aware**: the task it's given selects the mode, and it runs only
that mode per run.

### Where the behaviour lives: skills, not the system prompt

Each role's full contract lives in a **skill** under
[`.claude/skills/`](../.claude/skills/), so it can be **reused** both by these
headless runs and directly in an interactive Claude Code chat (via the `/` command
of the same name). The two `*-prompt.md` files are now **thin shims**: they set the
role identity and hard invariants, then tell the agent to invoke its skill.

Shared building blocks each role reuses (also usable on their own in a chat):

| Skill | What it is |
|---|---|
| [`spacory-preflight`](../.claude/skills/spacory-preflight/SKILL.md) | Confirm `gh auth status` before touching any issue/PR/memory |
| [`spacory-verify`](../.claude/skills/spacory-verify/SKILL.md) | The definition of done — `npm run check && npx tsc -b && npm test` |
| [`spacory-conventions`](../.claude/skills/spacory-conventions/SKILL.md) | Repo code conventions (single store + `commit()`, pure tested modules, Biome, cm) |
| [`spacory-notify`](../.claude/skills/spacory-notify/SKILL.md) | The Telegram wrap-up via `.agents/notify.sh` |

### Engineer Agent modes

| Mode | Input | Reads | Writes |
|---|---|---|---|
| `implement` | an Issue # | **only** that issue + the source code | a branch + PR referencing the issue |
| `review` | a PR # | the PR diff + its linked issue (read-only on code) | a code-review **comment** on the PR |
| `resolve` | a PR # | the PR's comments + diff | new commits pushed to the PR's branch |
| `clarify` | a PR/Issue # | the open questions (or a settled decision) + diff/code | a reply **comment** answering **technical** questions + any **non-code** PR edit (title/description); **code → `resolve`** |

### Product Agent modes

| Mode | Input | Reads | Writes |
|---|---|---|---|
| `cycle` | repo | `project-memory.md` (first), repo selectively, existing issues | GitHub Issues; updates `project-memory.md`; Telegram |
| `acceptance` | a PR # | the PR diff + the linked issue's acceptance criteria (may read memory, never writes it) | an acceptance **comment** on the PR |
| `clarify` | an Issue/PR # | the open question comments + `project-memory.md` | a reply **comment** answering the **product** questions; surgical spec/memory edits only if the answer changes the spec |
| `triage` | an Issue # (a human-submitted idea) | the raw idea + `project-memory.md` | one `🪐 Product triage` **verdict comment**; on accept the issue rewritten into a full spec; on reject a rationale + the issue **closed** |

### Bring an idea to the Product Agent (intake)

Have a feature idea or notice a missing capability? Don't write the spec yourself —
open a rough issue (a title + a few sentences) and hand it to the Product Agent:

```bash
gh issue create --title "Idea: <one line>" --body "<why it'd help / rough sketch>" \
  --label agent:triage
# then let the dispatcher pick it up, or run it now:
.agents/run-product.sh triage <N>       # headless
# or, in a chat:  /product-agent triage <N>
```

The Product Agent judges it against `project-memory.md` and either **enriches** it
into a proper issue (User story · Acceptance criteria · Technical context · Out of
scope) — landing it in the backlog just like a `cycle`-created issue — or
**rejects** it with a rationale and closes it. An enriched idea waits in the
backlog until **you** promote it with `agent:ready` — triage never pushes work into
the build loop on its own.

### Reviewing a PR: fan out, then resolve manually

When a PR is open, fan out the two **independent, read-only** review passes — they share
nothing and post separate PR comments, so run them in parallel:

```bash
.agents/run-engineer.sh review 14 &     # Engineer: code review comment
.agents/run-product.sh  acceptance 14 &  # Product: acceptance comment
wait
```

Then **you** read the comments and, if there's anything to fix, re-run the Engineer
Agent in resolve mode on that PR — a fresh, stateless run whose spec is the PR's
comments:

```bash
.agents/run-engineer.sh resolve 14       # addresses the comments, pushes to the branch
```

You can drive every step manually like this — each is a fresh headless run that
coordinates only through GitHub — **or** hand the whole loop to the optional,
label-driven dispatcher (`dispatch.sh`), which derives the next action from the
`agent:*` labels and fires the matching run on a timer. See
[`../docs/AUTOMATION.md`](../docs/AUTOMATION.md). Either way, merging stays a human
action.

## How to invoke

### Quickest: the wrapper scripts

```bash
# Product Agent
.agents/run-product.sh                 # run a product cycle (create/refine issues)
.agents/run-product.sh "focus on export"   # optional extra steer for this run
.agents/run-product.sh acceptance 14   # acceptance-test PR #14 (posts a comment)
.agents/run-product.sh clarify 9       # answer product/scope questions on #9 (posts a reply)
.agents/run-product.sh triage 42       # triage idea issue #42 (enrich into a spec, or reject)

# Engineer Agent
.agents/run-engineer.sh 2              # implement issue #2 (opens a PR) — default mode
.agents/run-engineer.sh '#2' "note"    # leading # tolerated; optional extra note
.agents/run-engineer.sh review 14      # review PR #14 (posts a comment, no code changes)
.agents/run-engineer.sh resolve 14     # resolve PR #14's review comments (pushes fixes)
.agents/run-engineer.sh clarify 14     # answer technical questions on #14 (posts a reply)
```

### Answering a question: route it to the right lane

When a thread on an issue/PR has open **questions** (yours or another agent's), dispatch
the agent whose lane they fall in — there's no parsing or `@mention` convention: each
agent answers the questions in its lane and explicitly **defers the rest** to the other
by name. Technical questions (feasibility, how the code behaves, effort) go to the
Engineer; product questions (scope, desired behavior, which design is right) go to
Product. A mixed thread is just two runs:

```bash
.agents/run-engineer.sh clarify 17 &   # answers the technical questions
.agents/run-product.sh  clarify 17 &   # answers the product questions
wait
```

The dividing line is **code vs. non-code, on the artifact you own**: `clarify` does the
**non-code** work — it answers questions and, when an answer settles the spec, makes the
non-code edit to its own artifact (Product → the issue / `project-memory.md`; Engineer →
the PR title/description). **Code** changes are only ever Engineer `resolve` (commits +
push). Product therefore has no `resolve` — it has no code job. Merging stays a human
action, as does trivial metadata hygiene if you'd rather not spin an agent for it.

In the **orchestrated loop** you don't dispatch this by hand: label the issue *or* the
PR **`agent:clarify`** and the dispatcher runs Product `clarify` for you — the
mid-flight refinement door (the "daily-scrum" case: raise it on the PR where the
confusion lives, and the decision is folded back into the issue). For a PR it then goes
back for a fresh review round against the updated spec; because editing the issue body
resets the review-round budget, refining a spec this way never trips the loop's
non-convergence cap. See [`../docs/AUTOMATION.md`](../docs/AUTOMATION.md).

Each script launches a **fresh, headless** `claude` session (`-p`) whose prompt leads
with the `/<role>-agent <mode> [number]` slash form — so Claude Code deterministically
expands the role skill (the documented user-invoked path) rather than leaving it to the
model — with the matching shim appended as the system prompt, runs from the repo root,
and validates its input. Useful env overrides:

- `CLAUDE_PERMISSION_MODE` (default `acceptEdits`) — set `bypassPermissions` for a
  fully unattended run in a trusted environment.
- `CLAUDE_MODEL` — pin a specific model; defaults to the session default. This repo
  pins `opus` in `.agents/.env`.

> **Config surface:** `dispatch.sh` sources `.agents/.env` (gitignored) and exports
> it, so that file is the single place to set any of these knobs — `CLAUDE_MODEL`,
> `CLAUDE_PERMISSION_MODE`, `SPACORY_MAX_ROUNDS`, `SPACORY_AUTOMERGE`, and the
> Telegram creds. See `.agents/.env.example` for the documented list.

> **Permissions:** headless runs only execute commands the permission mode/allowlist
> permit. `.claude/settings.json` already allows `git`, `npm`, `gh pr`, `gh run`,
> `gh issue` (Product creates issues; Engineer reads/comments on them), and
> `.agents/notify.sh` (the Telegram helper). Because each role now runs by invoking a
> **skill**, the allowlist also permits the `Skill(...)` invocations the shims and
> shared skills rely on (`product-agent`, `engineer-agent`, `spacory-preflight`,
> `spacory-verify`, `spacory-conventions`, `spacory-notify`) — otherwise an
> `acceptEdits` run could stall on the first skill call. Otherwise run with
> `CLAUDE_PERMISSION_MODE=bypassPermissions` so a headless run doesn't stall.

### In an interactive Claude Code chat: invoke the skill

Because each role is a skill, you can drive either agent from a normal chat session
without the wrapper scripts — just invoke the skill and name the mode:

```
/product-agent cycle
/product-agent acceptance 14
/product-agent triage 42
/engineer-agent implement 42
/engineer-agent review 14
/engineer-agent clarify 17
```

The shared skills work standalone too — e.g. `/spacory-verify` to run the definition
of done, or `/spacory-conventions` to load the repo's code conventions. This is the
same behaviour the headless runs use, so the two never drift.

### Manual: feed the prompt yourself

These prompts are thin **system-prompt shims** — feed the file's contents as the
agent's system prompt, then give it the run-specific input below. Each shim tells the
agent to invoke its skill and run the mode the task names. **The task selects the
mode**, so the task wording matters.

**Product Agent** — the task picks `cycle`, `acceptance`, `clarify`, or `triage`:

```
System prompt: contents of .agents/product-agent-prompt.md
Task (cycle):       "Run a product cycle for the repo at /path/to/spacory."
Task (acceptance):  "Acceptance-test pull request #14."
Task (clarify):     "Answer the product questions on issue #9."
Task (triage):      "Triage GitHub issue #42."
```

In `cycle` it reads `project-memory.md`, surveys issues, creates new issues, updates
`project-memory.md`, and posts a Telegram summary. In `acceptance` it judges PR #14
against the linked issue's acceptance criteria and posts a PR comment (no memory edits).

**Engineer Agent** — the task picks `implement`, `review`, `resolve`, or `clarify`:

```
System prompt: contents of .agents/engineer-agent-prompt.md
Task (implement):  "Implement GitHub issue #42."
Task (review):     "Review pull request #14."
Task (resolve):    "Resolve the review comments on pull request #14."
Task (clarify):    "Answer the technical questions on pull request #14."
```

In `implement` it reads only that issue, implements it on a branch, runs the project's
checks (`npm run check && npx tsc -b && npm test`), opens a PR referencing the issue, and
posts a Telegram done/blocked message — asking on the issue and stopping if it's
ambiguous. In `review` it posts a code-review comment without touching code. In `resolve`
it addresses the PR's comments and pushes to the branch.

> Both agents use the `gh` CLI for GitHub. Make sure `gh auth status` is logged in to
> an account with access to the repo before running.

## The memory model

Institutional memory is **not** kept in agent sessions (fragile) and we do **not**
re-read every closed ticket each run (expensive). Instead, one living document —
[`../project-memory.md`](../project-memory.md) in the repo root — is the compressed
memory of the project.

- The **Product Agent** reads it before each run and updates it after (Changelog,
  "Current state", "Known gaps").
- The **Engineer Agent** never touches it.
- **You (the human)** can edit it anytime to steer the agents.

### Editing `project-memory.md` to redirect the agents

`project-memory.md` is your steering wheel. To change what the Product Agent does next,
edit these sections — **human edits win** over the agent's own assessments:

- **"What the Product Agent should focus on next"** — reorder or rewrite to change
  priorities for the next run.
- **"What the Product Agent should NOT do"** — add constraints to take things off the
  table (out-of-scope features, decisions not to revisit).
- **"Known gaps & open questions"** — answer an open question here and the agent will
  stop deferring it; add a gap to point the agent at something new.
- **"Current state"** — correct anything that has drifted from reality.

The Engineer Agent is steered per-issue: edit (or comment on) the **GitHub Issue**
itself, since the issue is its only spec.

## Telegram setup

Both agents post a Telegram message at the end through one committed helper,
[`notify.sh`](notify.sh) (`.agents/notify.sh "<message>"`). The helper loads
credentials, sends via the Bot API, and exits cleanly if Telegram isn't configured —
so the prompts never embed a token and headless runs need just one permission rule
(`Bash(.agents/notify.sh:*)`, already in `.claude/settings.json`).

> **Sandbox & network:** Claude Code's Bash sandbox blocks outbound network by default,
> *independently of* the permission allowlist — so allowing the command is not enough.
> `.claude/settings.json` therefore also opens `api.telegram.org` via
> `sandbox.network.allowedDomains`. Permissions gate *what runs* (the helper); the
> sandbox gates *what it can reach* (only Telegram). `bypassPermissions` skips prompts
> but does **not** lift the network sandbox, so the domain allowlist is required either
> way.

**Credentials are never stored in the committed prompt files** — they live in a
gitignored env file (or, in CI, repository secrets). To enable notifications:

1. **Create a bot** — message [@BotFather](https://t.me/BotFather) on Telegram, send
   `/newbot`, and copy the **bot token** it gives you.
2. **Get your chat ID** — send any message to your new bot, then open
   `https://api.telegram.org/bot<YOUR_BOT_TOKEN>/getUpdates` and read
   `result[].message.chat.id` (for a group, add the bot to the group first).
3. **Create your local env file** from the committed template and fill in the values:

   ```bash
   cp .agents/.env.example .agents/.env
   # then edit .agents/.env:
   #   TELEGRAM_BOT_TOKEN=123456:ABC-DEF...   # from BotFather
   #   TELEGRAM_CHAT_ID=987654321             # your chat or group id
   ```

   `.agents/.env` is **gitignored** (only `.agents/.env.example`, which holds no
   secrets, is committed). The agents `source` this file at send time.

**Running in CI?** Don't ship the `.env` file. Instead store `TELEGRAM_BOT_TOKEN` and
`TELEGRAM_CHAT_ID` as repository secrets and export them into the agent's environment —
the same `if [ -n "$TELEGRAM_BOT_TOKEN" ]` guard picks them up.

Until the variables are set (no `.env`, no exported secrets), the agents skip the send
and report the outcome in their final text output instead.
