# AGENTS.md

This file exists so tools that read `AGENTS.md` (e.g. OpenAI Codex) pick up the
same guidance Claude Code reads from `CLAUDE.md`.

**The agent guidance for this repo lives in [`CLAUDE.md`](CLAUDE.md).** Read it —
it covers what Spacory is, the commands, the definition of done, conventions, and
the branch → PR → green-CI workflow.

The Product / Engineer / Reviewer contracts are canonical Markdown under
[`.agents/instructions/`](.agents/instructions/). Existing Claude skills remain
byte-identical compatibility copies under [`.claude/skills/`](.claude/skills/);
run `npm run agents:sync` after canonical edits. The headless shell adapter supports
Claude and Codex with explicit provider/model overrides by role and mode. Codex
requires `CODEX_HOME` from the calling environment; never store account paths in
repository configuration. See [`.agents/README.md`](.agents/README.md).
