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

## PR descriptions

Apply this convention when creating or updating a PR description, regardless of
provider. Always use these four Markdown section headings, in this order, even
for small changes. Scale the content to the change; each section can be one
short sentence:

- `## Summary` — the concrete problem and resulting behavior.
- `## Key decisions` — non-obvious choices and why they were made.
- `## Acceptance criteria` — concise links between requirements and evidence.
- `## Validation and limitations` — checks run, results, and material unverified behavior;
  distinguish automated checks from manual/browser verification.

Explain each fact once. Do not repeat implementation details in the acceptance
mapping, copy the full issue checklist, or recount conversation history and
abandoned approaches. Use brief cross-references when needed. Keep the headings
for predictable navigation; if a section has nothing applicable, say so briefly
instead of inventing content. There is no word-count or checklist-length target.
Describe the final change and actual verification, and preserve issue linkage
such as `Closes #N`.

## Formatting & style

- **Don't hand-format.** Let Biome do it: `npm run check:fix`. Only
  `style/noNonNullAssertion` is disabled (idiomatic for the SVG canvas refs).
- Match the existing code style and architecture; read neighbouring code first.

## Keep fixes narrow

- **Trace the failure through the existing code.** Work from a concrete failing
  case. Look for a fix in the existing handler, state transition, or layout at
  the point where it goes wrong. When feedback questions the complexity of a
  fix, revisit the approach and remove work the revised fix makes unnecessary.
- **Tie each new moving part to a requirement.** Add state, effects, listeners,
  timers, or helpers only when a concrete requirement needs them. For a non-obvious
  addition, use the PR's Key decisions section or the review reply to explain
  which behavior would break with a smaller change.
- **Challenge avoidable complexity in review.** Point to the existing code
  that can handle the case and ask for the narrower fix when it preserves the
  required behavior. Evaluate the responsibilities and cleanup the change adds.

## Discipline

- **Stay strictly in scope.** Implement/resolve only what the issue or the review
  comments ask. Don't refactor unrelated code, rename things, or "improve" areas
  you weren't asked about.
- **No AI / Claude attribution** in commits or PRs — no `Co-Authored-By: Claude`
  trailer, no "Generated with Claude Code" footer. Repo policy.

For verifying a change is green, follow the `spacory-verify` skill (the
definition of done).
