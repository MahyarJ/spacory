import assert from "node:assert/strict";
import { test } from "node:test";
import {
  providerResult,
  reviewEligibleAt,
  reviewerSession,
  usageReport,
} from "../usage.mjs";

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
    { event: "eligible", pr: 34, at: "2025-12-31T23:50:00Z" },
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
  assert.equal(report.byPR[34].secondsToFirstReview, 600);
  assert.equal(report.byPR[34].secondsToAcceptance, 642);
  assert.equal(report.rereview.resumed.runs, 1);
  assert.equal(report.rereview.fresh.runs, 0);
  assert.equal(providerResult("codex", "").input, null);
});

test("the report includes queue delay in both orderings and keeps missing eligibility unknown", () => {
  const eligible = { event: "eligible", pr: 34, at: "2026-01-01T00:00:00Z" };
  const accepted = { event: "accepted", pr: 34, at: "2026-01-01T00:01:00Z" };
  const delayed = { ...initial, startedAt: "2026-01-01T00:10:00Z" };
  const delayedAcceptance = { ...accepted, at: "2026-01-01T00:11:00Z" };
  assert.equal(
    usageReport([eligible, initial, accepted]).byPR[34].secondsToAcceptance,
    60,
  );
  assert.equal(
    usageReport([eligible, delayed, delayedAcceptance]).byPR[34]
      .secondsToAcceptance,
    660,
  );
  assert.equal(
    usageReport([delayed, delayedAcceptance]).byPR[34].secondsToAcceptance,
    null,
  );
});

test("eligibility respects opening, queued labels, and draft windows", () => {
  const created = "2026-01-01T00:00:00Z";
  const queued = "2026-01-01T00:10:00Z";
  const ready = "2026-01-01T00:20:00Z";
  const draft = "2026-01-01T00:05:00Z";
  const readyEvent = { __typename: "ReadyForReviewEvent", createdAt: ready };
  const draftEvent = { __typename: "ConvertToDraftEvent", createdAt: draft };
  assert.equal(reviewEligibleAt(created, [], queued), queued);
  assert.equal(reviewEligibleAt(created, [], created), created);
  assert.equal(reviewEligibleAt(created, [readyEvent], queued), ready);
  assert.equal(
    reviewEligibleAt(created, [draftEvent, readyEvent], queued),
    ready,
  );
  assert.equal(
    reviewEligibleAt(created, [draftEvent, readyEvent], created),
    created,
  );
  assert.equal(reviewEligibleAt(created, [], undefined), null);
});
