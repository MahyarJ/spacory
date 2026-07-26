---
name: spacory-conventions
description: Spacory's code conventions the Engineer Agent must honor when writing or reviewing code — single Zustand store + commit() chokepoint, pure tested modules for logic, Biome for formatting, cm coordinates, stay in scope, no AI attribution. Use whenever implementing, resolving, or reviewing code in this repo.
---

# Spacory code conventions

Honor these whenever you write, resolve, or review code in this repo. They are
the same conventions `CLAUDE.md` documents — this skill is the reusable copy for
the agents.

## State & data model

- **One Zustand store** (`src/app/store.ts`); `plan` is the source of truth.
- **Every plan edit goes through `commit()`** — it drives undo history and
  localStorage autosave. No plan mutation bypasses it.
- Coordinates are plain numbers in **cm**.

## Where logic lives

- **Pure logic belongs in pure, tested modules** — `src/geometry/`,
  `src/app/io.ts` (serialization), `src/app/history.ts` (undo) — with Vitest
  tests, **not** inside components.
- Add or update tests for any logic you add, especially in the pure modules.

## Documentation

- **Keep `README.md` in step with user-visible changes, in the same PR.** If your
  change adds or alters something a user sees — a new feature, a keyboard
  shortcut, or a capability that graduates from the README's "Not yet" list —
  update `README.md` alongside the code (its Features list, shortcuts table,
  and/or "Not yet" section). This is part of "done," **not** scope creep, so it
  does not conflict with "stay in scope" below. The issue usually spells out the
  exact README delta; follow it. Skip the README for purely internal work — bug
  fixes with no visible behavior change, refactors, tests, or automation/tooling.

## Formatting & style

- **Don't hand-format.** Let Biome do it: `npm run check:fix`. Only
  `style/noNonNullAssertion` is disabled (idiomatic for the SVG canvas refs).
- Match the existing code style and architecture; read neighbouring code first.

## Discipline

- **Stay strictly in scope.** Implement/resolve only what the issue or the review
  comments ask. Don't refactor unrelated code, rename things, or "improve" areas
  you weren't asked about.
- **No AI / Claude attribution** in commits or PRs — no `Co-Authored-By: Claude`
  trailer, no "Generated with Claude Code" footer. Repo policy.

For verifying a change is green, follow the `spacory-verify` skill (the
definition of done).
