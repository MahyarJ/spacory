import assert from "node:assert/strict";
import { test } from "node:test";
import { providerResult, reviewerSession, usageReport } from "../usage.mjs";

const session = "951bd111-72e7-489f-a22d-2dcb6bff6cc1";
const first = "a".repeat(40);
const second = "b".repeat(40);

const initial = {
  event: "run",
  role: "reviewer",
  mode: "review",
  provider: "codex",
  configuredModel: "model",
  pr: 34,
  head: first,
  startedAt: "2026-01-01T00:00:00Z",
  elapsedSeconds: 7,
  exitCode: 0,
  session,
  input: 10,
  cachedInput: 2,
  output: 5,
};

test("a resume lookup is scoped to reviewer, PR, head and provider/model", () => {
  const selection = {
    pr: 34,
    previousHead: first,
    provider: "codex",
    model: "model",
  };
  assert.equal(
    reviewerSession(
      [
        initial,
        {
          ...initial,
          role: "engineer",
          session: "02a09dd9-9593-4859-9e41-b23cd253811c",
        },
      ],
      selection,
    ),
    session,
  );
  assert.equal(reviewerSession([initial], { ...selection, pr: 35 }), undefined);
  assert.equal(
    reviewerSession([initial], { ...selection, previousHead: second }),
    undefined,
  );
  assert.equal(
    reviewerSession([initial], { ...selection, provider: "claude" }),
    undefined,
  );
  assert.equal(
    reviewerSession([initial], { ...selection, model: "other" }),
    undefined,
  );
  assert.equal(
    reviewerSession([{ ...initial, exitCode: 1 }], selection),
    undefined,
  );
});

test("usage totals cover all review attempts and time until acceptance", () => {
  const report = usageReport([
    initial,
    {
      ...initial,
      startedAt: "2026-01-01T00:00:15Z",
      head: second,
      previousHead: first,
      resumed: true,
      input: 5,
    },
    {
      ...initial,
      startedAt: "2026-01-01T00:00:25Z",
      role: "product",
      mode: "acceptance",
      head: second,
      input: null,
    },
    { event: "accepted", pr: 34, head: second, at: "2026-01-01T00:00:42Z" },
  ]);
  assert.deepEqual(report.byPR[34].input, { total: 15, reported: 2 });
  assert.equal(report.byPR[34].secondsToAcceptance, 42);
  assert.equal(report.rereview.resumed.runs, 1);
  assert.equal(report.rereview.fresh.runs, 0);
  assert.equal(providerResult("codex", "").input, null);
});
