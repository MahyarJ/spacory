---
name: spacory-verify
description: Spacory's definition of done — the exact gates CI runs (Biome check + tsc -b + Vitest). Run before opening a PR or pushing to a branch, and whenever you need to confirm a change is green. Used by the Engineer Agent's implement/resolve modes and by anyone landing a change.
---

# Definition of done (what CI runs)

Before opening a PR or pushing to a branch, run the exact gates CI runs and make
sure they all pass:

```bash
npm run check:fix     # apply Biome's safe fixes first — don't hand-format
npm run check         # Biome lint + format + import-organize (read-only)
npx tsc -b            # type-check
npm test              # Vitest (runs shuffled)
```

The single command CI gates on is:

```bash
npm run check && npx tsc -b && npm test
```

Rules:

- If anything fails, **fix it** — never open a PR or push with failing checks.
- Tests run in randomized order; never rely on test order or mutate a shared
  fixture.
- For UI / behaviour changes, also sanity-check with `npm run dev` when feasible.
