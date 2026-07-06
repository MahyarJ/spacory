# CLAUDE.md

Guidance for AI agents (and humans) working in this repo. Keep it short; link to
`docs/` for depth.

## What this is

Spacory — an open-source 2D floor-plan editor (React + TypeScript + SVG, Vite).
Goal: easy floor-plan creation for non-CAD users.

- Architecture & data model: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
- Why things are the way they are: [`docs/DECISIONS.md`](docs/DECISIONS.md)
- User-facing overview & scripts: [`README.md`](README.md)

## Commands

```bash
npm run dev          # dev server
npm test             # Vitest (randomized order)
npm run check        # Biome lint + format + import-organize (read-only)
npm run check:fix    # apply Biome's safe fixes
npx tsc -b           # type-check
npm run build        # tsc -b + vite build
```

## Definition of done (run before every push — this is what CI runs)

```bash
npm run check && npx tsc -b && npm test
```

CI (`.github/workflows/ci.yml`, Node 24) runs `biome ci` → `tsc -b` → tests on
push/PR to `main`.

## Conventions

- **Pure logic, well tested.** Geometry (`src/geometry/`), serialization
  (`src/app/io.ts`), and undo history (`src/app/history.ts`) are pure modules with
  Vitest tests. Add logic there with tests rather than inside components.
- **Lint/format with Biome** (`biome.json`). Don't hand-format; run `check:fix`.
  Only `style/noNonNullAssertion` is disabled (idiomatic for the SVG canvas refs).
- **State** lives in one Zustand store (`src/app/store.ts`); `plan` is the source
  of truth. All plan edits go through `commit()`, which also drives undo history
  and localStorage autosave. Coordinates are plain numbers in cm.
- **Tests run shuffled** — never rely on test order or mutate a shared fixture.

## Workflow

- Do work on a **branch**, open a **PR**, and make sure **CI is green** before
  merging. Delete the branch after merge (don't leave stale merged branches).
  The `/ship` skill (`.claude/skills/ship`) automates this loop.
- Commit messages: concise, imperative subject + a short body explaining why.
- When you make a non-obvious design choice, add an entry to
  [`docs/DECISIONS.md`](docs/DECISIONS.md) so the reasoning isn't lost.

## Important: no AI attribution

Do **not** add AI/Claude attribution to commits or PRs:

- no `Co-Authored-By: Claude ...` trailer in commit messages
- no "Generated with Claude Code" footer in PR descriptions

## Notes

- `docs/` is the shared source of truth for architecture and decisions.
- The two-agent (Product / Engineer) workflow lives in `.agents/`; its living
  institutional memory is `project-memory.md` in the repo root. Each agent's
  behaviour is now a reusable **skill** (`.claude/skills/{product,engineer}-agent`,
  plus shared `spacory-preflight` / `spacory-verify` / `spacory-conventions` /
  `spacory-notify`); the `.agents/*-prompt.md` files are thin shims over them, so the
  same contract works headlessly and in an interactive `/product-agent` chat.
- The agent loop can be **orchestrated on a timer**: `.agents/dispatch.sh` is a
  stateless dispatcher over `agent:*` GitHub labels (implement → review+accept →
  resolve → merge), installed via launchd (`.agents/launchd/install.sh`). See
  [`docs/AUTOMATION.md`](docs/AUTOMATION.md).
- Generated `*.module.css.d.ts` are gitignored.
