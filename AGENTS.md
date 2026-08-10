# AGENTS.md

This file exists so tools that read `AGENTS.md` (e.g. OpenAI Codex) pick up the
same guidance Claude Code reads from `CLAUDE.md`.

**The agent guidance for this repo lives in [`CLAUDE.md`](CLAUDE.md).** Read it —
it covers what Spacory is, the commands, the definition of done, conventions, and
the branch → PR → green-CI workflow.

The Product / Engineer agent contracts are Markdown "skills" under
[`.claude/skills/`](.claude/skills/); they're plain files any agent can read and
follow. The headless runners work with either engine — set `SPACORY_AGENT_ENGINE`
(`claude` | `codex`). See [`.agents/README.md`](.agents/README.md).
