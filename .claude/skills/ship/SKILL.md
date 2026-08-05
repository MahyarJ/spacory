---
name: ship
description: Ship a change in this repo the standard way — branch, verify (Biome + tsc + tests), commit, push, open a PR, and confirm CI is green. Use when the user asks to commit/push/PR/ship work, or after completing a change that should land on main.
---

# Ship a change

Follow these steps to land work on `main` the way this project expects. Assumes
the change is already implemented in the working tree.

## 1. Branch (never commit straight to main)

If currently on `main`, create a descriptive branch first:

```bash
git checkout -b <type>/<short-slug>   # e.g. feat/…, fix/…, chore/…, docs/…
```

If already on a feature branch, stay on it.

## 2. Verify — the definition of done (must all pass)

These are the gates the **`spacory-verify`** skill defines — it is the canonical
source; keep the two in sync (or invoke `/spacory-verify`).

```bash
npm run check:fix     # apply Biome formatting/safe fixes
npm run check         # confirm Biome is clean
npx tsc -b            # type-check
npm test              # Vitest (runs shuffled)
```

If anything fails, fix it before continuing. For UI/behaviour changes, also
sanity-check with `npm run dev` when feasible.

## 3. Commit

**One line, imperative subject — no body.** These PRs squash-merge to `main`, so a
per-commit body doesn't survive; put the "why" in the PR description.

Keep the message clean: **no AI/Claude attribution** (no `Co-Authored-By: Claude`),
and **no local/operational data** — spend/token figures, automation on/off state,
absolute paths, account/token/secret or `.env` contents. Public repo: describe the
change, not your machine.

## 4. Push + open PR

```bash
git push -u origin <branch>
gh pr create --base main --title "<title>" --body "<summary>"
```

PR body: what changed, why, and how it was verified — **from the diff's view, never
your environment** (same no-local-data rule as the commit above). **No "Generated
with Claude Code" footer.**

## 5. Confirm CI is green

```bash
run_id=$(gh run list --branch <branch> --limit 1 --json databaseId -q '.[0].databaseId')
gh run watch "$run_id" --exit-status
gh pr checks <pr-number>
```

Report the PR URL and CI result. Leave merging to the user unless told otherwise.

## 6. After merge

Delete the merged branch (don't leave stale branches on the remote):

```bash
git push origin --delete <branch>   # will prompt (intentional)
```

## Notes

- If the change involves a non-obvious design decision, add an entry to
  `docs/DECISIONS.md`.
- Keep the PR focused; prefer one logical change per PR.
