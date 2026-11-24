import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { once } from "node:events";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { setTimeout } from "node:timers/promises";
import { createWakeQueue, webhookServer, webhookTarget } from "../webhook.mjs";

const repository = "owner/spacory";
const payload = (action, subject) => ({
  repository: { full_name: repository },
  action,
  ...subject,
});

async function until(check) {
  for (let tries = 0; tries < 100; tries++) {
    if (await check()) return;
    await setTimeout(10);
  }
  assert.fail("queue did not settle");
}

test("wake targets include PR opens, human pushes, agent labels and pending clarification comments", () => {
  const pr = { number: 12, labels: [{ name: "agent:clarify" }] };
  const prTarget = { kind: "pr", number: 12 };
  assert.deepEqual(
    webhookTarget(
      "pull_request",
      payload("opened", { pull_request: pr }),
      repository,
    ),
    prTarget,
  );
  assert.deepEqual(
    webhookTarget(
      "pull_request",
      payload("synchronize", { pull_request: pr }),
      repository,
    ),
    prTarget,
  );
  assert.deepEqual(
    webhookTarget(
      "pull_request",
      payload("labeled", { pull_request: pr, label: pr.labels[0] }),
      repository,
    ),
    prTarget,
  );
  assert.deepEqual(
    webhookTarget(
      "issue_comment",
      payload("created", { issue: { ...pr, pull_request: {} } }),
      repository,
    ),
    prTarget,
  );
  assert.deepEqual(
    webhookTarget(
      "pull_request_review_comment",
      payload("created", { pull_request: pr }),
      repository,
    ),
    prTarget,
  );
  assert.deepEqual(
    webhookTarget(
      "issues",
      payload("labeled", {
        issue: { number: 8 },
        label: { name: "agent:ready" },
      }),
      repository,
    ),
    { kind: "issue", number: 8 },
  );
  assert.equal(
    webhookTarget(
      "issue_comment",
      payload("created", {
        issue: { number: 12, pull_request: {}, labels: [] },
      }),
      repository,
    ),
    undefined,
  );
  assert.equal(
    webhookTarget(
      "pull_request",
      payload("synchronize", { pull_request: pr }),
      "other/repo",
    ),
    undefined,
  );
});

test("receiver authenticates the raw body and acknowledges after queueing", async (t) => {
  const secret = "test secret";
  const received = [];
  const server = webhookServer({
    secret,
    repository,
    enqueue: async (target) => received.push(target),
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => server.close());
  const url = `http://127.0.0.1:${server.address().port}/github`;
  const body = JSON.stringify(
    payload("synchronize", { pull_request: { number: 12 } }),
  );
  const sign = (value) =>
    `sha256=${createHmac("sha256", secret).update(value).digest("hex")}`;
  const send = (signature) =>
    fetch(url, {
      method: "POST",
      headers: {
        "X-GitHub-Event": "pull_request",
        "X-Hub-Signature-256": signature,
      },
      body,
    });
  assert.equal((await send(sign(`${body} `))).status, 401);
  assert.deepEqual(received, []);
  assert.equal((await send(sign(body))).status, 202);
  assert.deepEqual(received, [{ kind: "pr", number: 12 }]);
});

test("queue preserves busy and restart wake-ups and handles events arriving during a run", async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "spacory-wake-test-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const target = { kind: "pr", number: 12 };
  let attempted = false;
  const before = await createWakeQueue(
    dir,
    async () => {
      attempted = true;
      return 75;
    },
    10000,
  );
  t.after(before.stop);
  await before.enqueue(target);
  await until(() => attempted);
  before.stop();
  assert.equal((await readdir(dir)).length, 1);

  const received = [];
  let finish;
  const during = new Promise((resolve) => {
    finish = resolve;
  });
  const after = await createWakeQueue(
    dir,
    async (kind, number) => {
      received.push(`${kind}-${number}`);
      if (received.length === 1) await during;
      return 0;
    },
    10,
  );
  t.after(after.stop);
  await until(() => received.length === 1);
  await after.enqueue(target);
  finish();
  await until(async () => (await readdir(dir)).length === 0);
  assert.deepEqual(received, ["pr-12", "pr-12"]);
});
