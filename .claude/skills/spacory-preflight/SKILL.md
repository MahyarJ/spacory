---
name: spacory-preflight
description: Preflight for Spacory's Product/Engineer agent runs — confirm GitHub CLI auth before touching any issue, PR, or project-memory.md. Use at the start of every agent run (cycle / acceptance / implement / review / resolve / clarify) before reading or writing anything on GitHub.
---

# Preflight: confirm GitHub access before touching anything

Both agents work through the `gh` CLI (and, for code-writing modes, `git`).
Verify auth **first** so an expired token fails loud instead of mid-run:

```bash
gh auth status   # must succeed before you do anything else
```

If it fails (e.g. an expired token):

- Do **not** read or modify `project-memory.md`.
- Do **not** create issues, post comments, commit, or push.
- Send the **blocked** wrap-up message (see the `spacory-notify` skill) noting
  that `gh` is not authenticated, and **stop**, reporting the failure plainly.

Run this once, at the very start of the run, regardless of mode.
