# Spacory Agents

A lightweight **two-agent development workflow**. Two agents collaborate
asynchronously through **GitHub Issues** — they never share a session, never depend on
each other being "live," and are each spun up fresh per run.

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
| **Input** | repo path | a single GitHub Issue number |
| **Reads** | `project-memory.md` (first), then the repo selectively, plus existing issues | **only** the assigned issue (+ its comments); the source code to implement it |
| **Writes** | GitHub Issues; updates `project-memory.md`; Telegram summary | a branch + PR referencing the issue; Telegram done/blocked |
| **Never** | writes app code; revisits settled architecture | reads `project-memory.md` or other product context; guesses on ambiguity |

## How to invoke

### Quickest: the wrapper scripts

```bash
.agents/run-product.sh                 # run a product cycle (create/refine issues)
.agents/run-product.sh "focus on export"   # optional extra steer for this run

.agents/run-engineer.sh 2              # implement issue #2 (opens a PR)
.agents/run-engineer.sh '#2' "note"    # leading # tolerated; optional extra note
```

Each script launches a **fresh, headless** `claude` session (`-p`) with the matching
prompt appended as the system prompt, runs from the repo root, and validates its
input. Useful env overrides:

- `CLAUDE_PERMISSION_MODE` (default `acceptEdits`) — set `bypassPermissions` for a
  fully unattended run in a trusted environment.
- `CLAUDE_MODEL` — pin a specific model; defaults to the session default.

> **Permissions:** headless runs only execute commands the permission mode/allowlist
> permit. `.claude/settings.json` already allows `git`, `npm`, `gh pr`, and `gh run`,
> but the agents also use **`gh issue`** (Product creates issues; Engineer reads/comments
> on them). Add `Bash(gh issue:*)` to the allowlist, or run with
> `CLAUDE_PERMISSION_MODE=bypassPermissions`, so a headless run doesn't stall.

### Manual: feed the prompt yourself

These prompts are system prompts — feed the file's contents as the agent's system
prompt, then give it the run-specific input below.

**Product Agent** — pass the repository path:

```
System prompt: contents of .agents/product-agent-prompt.md
Task:          "Run a product cycle for the repo at /path/to/spacory."
```

It reads `project-memory.md`, checks open/closed issues, creates new issues, updates
`project-memory.md`, and posts a Telegram summary.

**Engineer Agent** — pass the issue number:

```
System prompt: contents of .agents/engineer-agent-prompt.md
Task:          "Implement GitHub issue #42."
```

It reads only that issue, implements it on a branch, runs the project's checks
(`npm run check && npx tsc -b && npm test`), opens a PR that references the issue, and
posts a Telegram done/blocked message. If the issue is ambiguous it comments on the
issue asking for clarification and stops instead of guessing.

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

Both prompts post a Telegram message at the end via the Bot API. **Credentials are
never stored in the committed prompt files** — they live in a gitignored env file (or,
in CI, repository secrets). To enable notifications:

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
