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
| **Prompt** | [`product-agent-prompt.md`](product-agent-prompt.md) | [`engineer-agent-prompt.md`](engineer-agent-prompt.md) |
| **Modes** | `cycle` · `acceptance` | `implement` · `review` · `resolve` |
| **Never** | writes app code; revisits settled architecture; merges | reads `project-memory.md` or other product context; guesses on ambiguity; merges |

Each prompt is **mode-aware**: the task it's given selects the mode, and it runs only
that mode per run.

### Engineer Agent modes

| Mode | Input | Reads | Writes |
|---|---|---|---|
| `implement` | an Issue # | **only** that issue + the source code | a branch + PR referencing the issue |
| `review` | a PR # | the PR diff + its linked issue (read-only on code) | a code-review **comment** on the PR |
| `resolve` | a PR # | the PR's comments + diff | new commits pushed to the PR's branch |

### Product Agent modes

| Mode | Input | Reads | Writes |
|---|---|---|---|
| `cycle` | repo | `project-memory.md` (first), repo selectively, existing issues | GitHub Issues; updates `project-memory.md`; Telegram |
| `acceptance` | a PR # | the PR diff + the linked issue's acceptance criteria (may read memory, never writes it) | an acceptance **comment** on the PR |

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

There is intentionally **no coordinating/orchestration script** — every step is a fresh
headless run that coordinates only through GitHub. Merging stays a human action.

## How to invoke

### Quickest: the wrapper scripts

```bash
# Product Agent
.agents/run-product.sh                 # run a product cycle (create/refine issues)
.agents/run-product.sh "focus on export"   # optional extra steer for this run
.agents/run-product.sh acceptance 14   # acceptance-test PR #14 (posts a comment)

# Engineer Agent
.agents/run-engineer.sh 2              # implement issue #2 (opens a PR) — default mode
.agents/run-engineer.sh '#2' "note"    # leading # tolerated; optional extra note
.agents/run-engineer.sh review 14      # review PR #14 (posts a comment, no code changes)
.agents/run-engineer.sh resolve 14     # resolve PR #14's review comments (pushes fixes)
```

Each script launches a **fresh, headless** `claude` session (`-p`) with the matching
prompt appended as the system prompt, runs from the repo root, and validates its
input. Useful env overrides:

- `CLAUDE_PERMISSION_MODE` (default `acceptEdits`) — set `bypassPermissions` for a
  fully unattended run in a trusted environment.
- `CLAUDE_MODEL` — pin a specific model; defaults to the session default.

> **Permissions:** headless runs only execute commands the permission mode/allowlist
> permit. `.claude/settings.json` already allows `git`, `npm`, `gh pr`, `gh run`,
> `gh issue` (Product creates issues; Engineer reads/comments on them), and
> `.agents/notify.sh` (the Telegram helper). Otherwise run with
> `CLAUDE_PERMISSION_MODE=bypassPermissions` so a headless run doesn't stall.

### Manual: feed the prompt yourself

These prompts are system prompts — feed the file's contents as the agent's system
prompt, then give it the run-specific input below. **The task selects the mode** (the
prompt branches on it), so the task wording matters.

**Product Agent** — the task picks `cycle` or `acceptance`:

```
System prompt: contents of .agents/product-agent-prompt.md
Task (cycle):       "Run a product cycle for the repo at /path/to/spacory."
Task (acceptance):  "Acceptance-test pull request #14."
```

In `cycle` it reads `project-memory.md`, surveys issues, creates new issues, updates
`project-memory.md`, and posts a Telegram summary. In `acceptance` it judges PR #14
against the linked issue's acceptance criteria and posts a PR comment (no memory edits).

**Engineer Agent** — the task picks `implement`, `review`, or `resolve`:

```
System prompt: contents of .agents/engineer-agent-prompt.md
Task (implement):  "Implement GitHub issue #42."
Task (review):     "Review pull request #14."
Task (resolve):    "Resolve the review comments on pull request #14."
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
