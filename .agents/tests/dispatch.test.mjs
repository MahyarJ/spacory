import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const scripts = fileURLToPath(new URL("../", import.meta.url));
const sha = (character) => character.repeat(40);

function mock() {
  const fs = require("node:fs");
  const [command, ...args] = process.argv.slice(2);
  const state = JSON.parse(fs.readFileSync(process.env.FIXTURE_STATE, "utf8"));
  const save = () =>
    fs.writeFileSync(process.env.FIXTURE_STATE, JSON.stringify(state));
  const output = (value) =>
    console.log(typeof value === "object" ? JSON.stringify(value) : value);
  const add = (body) => {
    state.comments.push({
      id: 100 + state.comments.length,
      user: { id: 42 },
      author_association: "OWNER",
      created_at: new Date(
        Date.UTC(2026, 0, 1, 0, 0, state.comments.length + 1),
      ).toISOString(),
      body,
    });
  };
  const arg = (name) => args[args.indexOf(name) + 1];
  if (command === "gh") {
    const [kind, verb, number] = args;
    if (kind === "auth") return;
    if (kind === "api") {
      if (verb === "user") output(42);
      else if (verb.endsWith("/comments"))
        output([
          verb.includes("/pulls/") ? state.inlineComments : state.comments,
        ]);
      else if (verb.includes("/compare/")) output(state.behind ?? 0);
      else if (verb.endsWith("/timeline") && args.includes("--slurp"))
        output([state.timeline ?? []]);
      else if (!verb.endsWith("/timeline")) throw new Error(args.join(" "));
      return;
    }
    if (kind === "repo") return output("owner/spacory");
    if (verb === "list") {
      if (kind === "issue") {
        if (state.issueLabels.includes(arg("--label"))) output(12);
        if (state.laterIssueLabels.includes(arg("--label"))) output(13);
      } else if (state.exists) {
        const matches = args.includes("--label")
          ? state.labels.includes(arg("--label"))
          : arg("--jq").includes("+#12");
        if (matches) output(34);
      }
      return;
    }
    if (verb === "view") {
      const fields = arg("--json");
      if (kind === "issue") {
        for (const label of number === "12"
          ? state.issueLabels
          : state.laterIssueLabels)
          output(label);
      } else if (fields === "headRefOid") output(state.head);
      else if (fields === "headRefName") output("branch");
      else if (fields === "mergeable") output("MERGEABLE");
      else if (fields === "statusCheckRollup") output(state.ci ?? "PASS");
      else if (fields === "body") output(12);
      else if (fields === "comments")
        output(
          state.comments.filter(({ body }) =>
            body.includes("**Engineer review**"),
          ).length,
        );
      else if (fields.startsWith("state,")) {
        output({
          state: state.exists ? "OPEN" : "CLOSED",
          isDraft: state.draft ?? false,
          isCrossRepository: false,
          labels: state.labels.map((name) => ({ name })),
          headRefOid: state.head,
          baseRefOid: "e".repeat(40),
        });
      } else throw new Error(args.join(" "));
      return;
    }
    if (verb === "edit") {
      const key =
        kind === "pr"
          ? "labels"
          : number === "12"
            ? "issueLabels"
            : "laterIssueLabels";
      if (args.includes("--remove-label"))
        state[key] = state[key].filter(
          (label) => !arg("--remove-label").split(",").includes(label),
        );
      if (
        args.includes("--add-label") &&
        !state[key].includes(arg("--add-label"))
      )
        state[key].push(arg("--add-label"));
      if (
        kind === "pr" &&
        arg("--add-label") === "agent:clarifying" &&
        state.pushOnClarify
      ) {
        state.head = state.pushOnClarify.repeat(40);
        delete state.pushOnClarify;
        if (state.commentOnClarify) add(state.commentOnClarify);
      }
      if (
        kind === "pr" &&
        arg("--add-label") === "agent:review" &&
        state.labels.includes("agent:clarifying") &&
        state.commentOnClarifyHandoff
      ) {
        add(state.commentOnClarifyHandoff);
        if (state.inlineOnClarifyHandoff)
          state.inlineComments.push(state.comments.pop());
        delete state.commentOnClarifyHandoff;
      }
      return save();
    }
    if (verb === "merge") {
      state.merges.push(arg("--match-head-commit"));
      return save();
    }
    if (verb === "comment" && number === "34") {
      add(arg("--body"));
      return save();
    }
    throw new Error(args.join(" "));
  }
  if (command === "git" || command === "notify") return;
  if (process.env.SPACORY_WEBHOOK_SECRET)
    throw new Error("Webhook secret leaked into agent environment");
  const [mode, number, context] = args;
  state.calls.push({
    mode,
    number,
    agent: command,
    head: state.head,
    context,
    resume: process.env.SPACORY_AGENT_RESUME_ID || null,
  });
  const entry = state.answers.shift() ?? {};
  if (entry.mode && entry.mode !== mode)
    throw new Error(`expected ${entry.mode}, got ${mode}`);
  const current = state.head;
  if (mode === "implement") state.exists = true;
  if (mode === "reconcile" && entry.push) state.behind = 0;
  if (entry.push) state.head = entry.push.repeat(40);
  if (!entry.noVerdict && (mode === "review" || mode === "acceptance")) {
    const role = mode === "review" ? "Engineer review" : "Product acceptance";
    const verdict =
      entry.verdict ?? (mode === "review" ? "approve" : "accepted");
    add(
      `**${role}**\n**Head:** ${current}\n${entry.clarify ? `**Clarify:** ${entry.clarify}\n` : ""}**Verdict:** ${verdict}`,
    );
  }
  if (mode === "clarify") {
    add(
      `**${command === "engineer" ? "Engineer" : "Product"} clarification**\nSummary`,
    );
    if (entry.comment) add(entry.comment);
  }
  save();
  process.exitCode = entry.exit ?? 0;
}

function fixture(t, overrides = {}, options = {}) {
  const root = mkdtempSync(path.join(os.tmpdir(), "spacory-dispatch-test-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const dir = path.join(root, ".agents");
  const bin = path.join(root, "bin");
  mkdirSync(dir);
  mkdirSync(bin);
  mkdirSync(path.join(dir, "logs"));
  copyFileSync(path.join(scripts, "engine.sh"), path.join(dir, "engine.sh"));
  cpSync(path.join(scripts, "providers"), path.join(dir, "providers"), {
    recursive: true,
  });
  if (options.usage)
    writeFileSync(
      path.join(dir, "logs", "usage.jsonl"),
      `${JSON.stringify(options.usage)}\n`,
    );
  for (const filename of [
    "dispatch.sh",
    "pr-dispatch.sh",
    "pr-state.mjs",
    "usage.mjs",
  ]) {
    copyFileSync(path.join(scripts, filename), path.join(dir, filename));
  }
  const mockFile = path.join(root, "mock.cjs");
  writeFileSync(mockFile, `(${mock.toString()})();\n`);
  for (const [file, command] of [
    [path.join(bin, "gh"), "gh"],
    [path.join(bin, "git"), "git"],
    [path.join(dir, "run-engineer.sh"), "engineer"],
    [path.join(dir, "run-product.sh"), "product"],
    [path.join(dir, "notify.sh"), "notify"],
  ]) {
    writeFileSync(
      file,
      `#!/usr/bin/env bash\nexec node '${mockFile}' ${command} "$@"\n`,
      { mode: 0o755 },
    );
  }
  const file = path.join(root, "state.json");
  const get = () => JSON.parse(readFileSync(file, "utf8"));
  const set = (state) => writeFileSync(file, JSON.stringify(state));
  set({
    head: sha("a"),
    exists: true,
    labels: ["agent:review"],
    issueLabels: [],
    laterIssueLabels: [],
    comments: [],
    inlineComments: [],
    calls: [],
    answers: [],
    merges: [],
    ...overrides,
  });
  return {
    get,
    set,
    dispatch: (...args) => {
      const run = spawnSync("bash", [path.join(dir, "dispatch.sh"), ...args], {
        cwd: root,
        env: {
          ...process.env,
          PATH: `${bin}:${process.env.PATH}`,
          FIXTURE_STATE: file,
          SPACORY_DISPATCH_LOCK: path.join(root, "dispatch.lock"),
          SPACORY_AGENT_RETRIES: "0",
          SPACORY_WEBHOOK_SECRET: "fixture-webhook-secret",
          SPACORY_MAX_ROUNDS: "5",
          SPACORY_AUTOMERGE: options.automerge ? "1" : "0",
          SPACORY_REVIEWER_RESUME: options.usage ? "1" : "0",
        },
        encoding: "utf8",
        timeout: 30000,
      });
      assert.equal(run.status, 0, run.stdout + run.stderr + (run.error ?? ""));
      return get();
    },
  };
}

const calls = (state) => state.calls.map(({ mode }) => mode);
const marker = (action, head, requests = [], role) =>
  `<!-- spacory-dispatch ${JSON.stringify({ action, head, requests, role })} -->`;
const comment = (id, body, user = 42) => ({
  id,
  user: { id: user },
  author_association: user === 42 ? "OWNER" : "NONE",
  created_at: `2026-01-01T00:00:${String(id - 99).padStart(2, "0")}.000Z`,
  body,
});

// Targeted wakes drive the entire loop without a scheduled scan.
test("implementation, Engineer request, pushed fix and approval hand off directly", (t) => {
  const f = fixture(t, {
    exists: false,
    labels: [],
    issueLabels: ["agent:ready"],
    answers: [
      { mode: "implement" },
      { mode: "review", verdict: "changes requested" },
      { mode: "resolve", push: "b" },
    ],
  });
  const state = f.dispatch("wake", "issue", "12");
  assert.deepEqual(calls(state), [
    "implement",
    "review",
    "resolve",
    "review",
    "acceptance",
  ]);
  assert.deepEqual(state.labels, ["agent:accepted"]);
  assert.match(
    state.calls[3].context,
    new RegExp(`Previous head: ${sha("a")}`),
  );
  assert.match(state.calls[4].context, /Engineer's approval and evidence/);
  assert.deepEqual(calls(f.dispatch("wake", "pr", "34")), calls(state));
});

test("a clean PR runs Engineer then Product exactly once", (t) => {
  const f = fixture(t);
  const state = f.dispatch("wake", "pr", "34");
  assert.deepEqual(calls(state), ["review", "acceptance"]);
  assert.deepEqual(state.labels, ["agent:accepted"]);
  assert.deepEqual(calls(f.dispatch("wake", "pr", "34")), calls(state));
});

test("a requested fix without a push blocks instead of restarting review", (t) => {
  const f = fixture(t, {
    answers: [{ mode: "review", verdict: "changes requested" }],
  });
  const state = f.dispatch("wake", "pr", "34");
  assert.deepEqual(calls(state), ["review", "resolve"]);
  assert.deepEqual(state.labels, ["agent:blocked"]);
});

test("Product changes get an Engineer re-review before acceptance", (t) => {
  const f = fixture(t, {
    answers: [
      { mode: "review" },
      { mode: "acceptance", verdict: "changes requested" },
      { mode: "resolve", push: "b" },
    ],
  });
  const state = f.dispatch("wake", "pr", "34");
  assert.deepEqual(calls(state), [
    "review",
    "acceptance",
    "resolve",
    "review",
    "acceptance",
  ]);
  assert.deepEqual(state.labels, ["agent:accepted"]);
});

for (const mode of ["review", "acceptance"]) {
  test(`a push during ${mode} never advances the previous verdict`, (t) => {
    const answers = mode === "review" ? [] : [{ mode: "review" }];
    answers.push({ mode, push: "b" });
    const f = fixture(t, { answers });
    const state = f.dispatch("wake", "pr", "34");
    assert.deepEqual(
      calls(state),
      mode === "review"
        ? ["review", "review", "acceptance"]
        : ["review", "acceptance", "review", "acceptance"],
    );
    assert.equal(state.calls.at(-1).head, sha("b"));
    assert.deepEqual(calls(f.dispatch("wake", "pr", "34")), calls(state));
  });
}

test("health check recovers a completed review on an orphaned in-flight label", (t) => {
  const f = fixture(t, {
    labels: ["agent:reviewing"],
    comments: [
      comment(100, marker("review", sha("a"))),
      comment(
        101,
        `**Engineer review**\n**Head:** ${sha("a")}\n**Verdict:** approve`,
      ),
    ],
  });
  const state = f.dispatch("tick");
  assert.deepEqual(calls(state), ["acceptance"]);
  assert.deepEqual(state.labels, ["agent:accepted"]);
  state.head = sha("b");
  f.set(state);
  assert.deepEqual(calls(f.dispatch("tick")), [
    "acceptance",
    "review",
    "acceptance",
  ]);
});

test("health check recognizes a push already made by an interrupted Resolve", (t) => {
  const f = fixture(t, {
    head: sha("b"),
    labels: ["agent:resolving"],
    comments: [comment(100, marker("resolve", sha("a")))],
  });
  assert.deepEqual(calls(f.dispatch("tick")), ["review", "acceptance"]);
});

test("clarify waits for a comment, and an explicit lane keeps the other agent idle", (t) => {
  const f = fixture(t, { labels: ["agent:clarify"] });
  const state = f.dispatch("wake", "pr", "34");
  assert.deepEqual(calls(state), []);
  state.comments.push(
    comment(100, "Please clarify the copy.\n/agent clarify product"),
  );
  f.set(state);
  const complete = f.dispatch("wake", "pr", "34");
  assert.deepEqual(calls(complete), ["clarify", "review", "acceptance"]);
  assert.equal(complete.calls[0].agent, "product");
  assert.match(complete.calls[0].context, /comment-100/);
  assert.deepEqual(calls(f.dispatch("wake", "pr", "34")), calls(complete));
});

test("conditional approval can clarify an artifact without a human comment", (t) => {
  const f = fixture(t, {
    answers: [
      {
        mode: "review",
        verdict: "approve pending non-code fixes",
        clarify: "engineer",
      },
    ],
  });
  const state = f.dispatch("wake", "pr", "34");
  assert.deepEqual(calls(state), ["review", "clarify", "review", "acceptance"]);
  assert.equal(state.calls[1].agent, "engineer");
  assert.deepEqual(state.labels, ["agent:accepted"]);
});

test("an unavailable reviewer session falls back to a fresh pass for the same head", (t) => {
  const session = "951bd111-72e7-489f-a22d-2dcb6bff6cc1";
  const f = fixture(
    t,
    {
      head: sha("b"),
      labels: ["agent:resolving"],
      comments: [
        comment(100, marker("review", sha("a"))),
        comment(
          101,
          `**Engineer review**\n**Head:** ${sha("a")}\n**Verdict:** changes requested`,
        ),
        comment(102, marker("resolve", sha("a"))),
      ],
      answers: [{ mode: "review", noVerdict: true, exit: 1 }],
    },
    {
      usage: {
        event: "run",
        role: "reviewer",
        mode: "review",
        pr: 34,
        head: sha("a"),
        provider: "claude",
        configuredModel: null,
        exitCode: 0,
        session,
      },
    },
  );
  const state = f.dispatch("wake", "pr", "34");
  assert.deepEqual(calls(state), ["review", "review", "acceptance"]);
  assert.deepEqual(
    state.calls.map((call) => call.resume),
    [session, null, null],
  );
  assert.ok(state.calls[1].context.includes("comment 101"));
});

test("recovery picks up the newest live label after an interrupted label swap", (t) => {
  const f = fixture(t, {
    head: sha("b"),
    labels: ["agent:resolving", "agent:review"],
    timeline: [
      { event: "labeled", label: { name: "agent:resolving" } },
      { event: "labeled", label: { name: "agent:review" } },
    ],
    comments: [comment(100, marker("resolve", sha("a")))],
  });
  const state = f.dispatch("wake", "pr", "34");
  assert.deepEqual(calls(state), ["review", "acceptance"]);
  assert.deepEqual(state.labels, ["agent:accepted"]);
});

test("merge waits for green CI and pins the approved head", (t) => {
  const f = fixture(t, { ci: "PENDING" }, { automerge: true });
  const state = f.dispatch("wake", "pr", "34");
  assert.deepEqual(state.labels, ["agent:accepted"]);
  assert.deepEqual(state.merges, []);
  state.ci = "PASS";
  f.set(state);
  assert.deepEqual(f.dispatch("wake", "pr", "34").merges, [sha("a")]);
});

test("a stale base reconciles and requires approvals for the new head", (t) => {
  const f = fixture(t, {
    behind: 1,
    answers: [
      { mode: "review" },
      { mode: "acceptance" },
      { mode: "reconcile", push: "b" },
    ],
  });
  const state = f.dispatch("wake", "pr", "34");
  assert.deepEqual(calls(state), [
    "review",
    "acceptance",
    "reconcile",
    "review",
    "acceptance",
  ]);
  assert.equal(state.calls.at(-1).head, sha("b"));
});

for (const draft of [false, true]) {
  test(`recovery scans past an issue with an existing ${draft ? "draft" : "managed"} PR`, (t) => {
    const f = fixture(t, {
      draft,
      labels: ["agent:blocked"],
      issueLabels: ["agent:ready"],
      laterIssueLabels: ["agent:ready"],
    });
    const state = f.dispatch("tick");
    assert.deepEqual(state.issueLabels, draft ? ["agent:ready"] : []);
    assert.deepEqual(
      state.calls.map(({ mode, number }) => [mode, number]),
      [["implement", "13"]],
    );
  });
}

test("manual clarification queued after a push waits for the question", (t) => {
  const f = fixture(t, {
    head: sha("b"),
    labels: ["agent:clarify"],
    comments: [
      comment(100, marker("review", sha("a"))),
      comment(
        101,
        `**Engineer review**\n**Head:** ${sha("a")}\n**Verdict:** approve`,
      ),
    ],
  });
  const waiting = f.dispatch("wake", "pr", "34");
  assert.deepEqual(waiting.labels, ["agent:clarify"]);
  assert.deepEqual(calls(waiting), []);
  waiting.comments.push(
    comment(102, "Clarify the copy.\n/agent clarify product"),
  );
  f.set(waiting);
  const done = f.dispatch("wake", "pr", "34");
  assert.deepEqual(calls(done), ["clarify", "review", "acceptance"]);
  assert.equal(done.calls[0].agent, "product");
});

test("a push invalidates a queued conditional clarification for the old head", (t) => {
  const f = fixture(t, {
    pushOnClarify: "b",
    answers: [
      {
        mode: "review",
        verdict: "approve pending non-code fixes",
        clarify: "product",
      },
    ],
  });
  const state = f.dispatch("wake", "pr", "34");
  assert.deepEqual(calls(state), ["review", "review", "acceptance"]);
  assert.deepEqual(state.labels, ["agent:accepted"]);
  assert.equal(state.calls[1].head, sha("b"));
});

test("an explicit review after blocked Resolve replaces the prior same-head verdict", (t) => {
  const f = fixture(t, {
    answers: [{ mode: "review", verdict: "changes requested" }],
  });
  const blocked = f.dispatch("wake", "pr", "34");
  assert.deepEqual(blocked.labels, ["agent:blocked"]);
  blocked.labels = ["agent:review"];
  f.set(blocked);
  const done = f.dispatch("wake", "pr", "34");
  assert.deepEqual(calls(done), ["review", "resolve", "review", "acceptance"]);
  assert.deepEqual(done.labels, ["agent:accepted"]);
  assert.equal(done.calls[2].head, sha("a"));
});

test("a maintainer question takes priority over an expired conditional clarification", (t) => {
  const question = "Clarify the revised behavior.\n/agent clarify product";
  const f = fixture(t, {
    pushOnClarify: "b",
    commentOnClarify: question,
    answers: [
      {
        mode: "review",
        verdict: "approve pending non-code fixes",
        clarify: "engineer",
      },
    ],
  });
  const state = f.dispatch("wake", "pr", "34");
  assert.deepEqual(calls(state), ["review", "clarify", "review", "acceptance"]);
  const [, clarify] = state.calls;
  assert.equal(clarify.agent, "product");
  assert.equal(clarify.head, sha("b"));
  const request = state.comments.find(({ body }) => body === question);
  assert.match(
    clarify.context,
    new RegExp(`requests in this run: comment-${request.id}\\.`),
  );
});

test("a push during Engineer clarification skips the remaining conditional Product lane", (t) => {
  const f = fixture(t, {
    answers: [
      {
        mode: "review",
        verdict: "approve pending non-code fixes",
        clarify: "both",
      },
      { mode: "clarify", push: "b" },
    ],
  });
  const state = f.dispatch("wake", "pr", "34");
  assert.deepEqual(
    state.calls.map(({ mode, agent, head }) => [mode, agent, head]),
    [
      ["review", "engineer", sha("a")],
      ["clarify", "engineer", sha("a")],
      ["review", "engineer", sha("b")],
      ["acceptance", "product", sha("b")],
    ],
  );
  assert.deepEqual(state.labels, ["agent:accepted"]);
});

for (const timing of [
  "explicit while replying",
  "plain while replying",
  "plain during handoff",
  "inline during handoff",
]) {
  test(`clarification drains a late ${timing} request before re-review`, (t) => {
    const first = "Clarify the revised scope.\n/agent clarify product";
    const inline = timing.startsWith("inline");
    const explicit = inline || timing.startsWith("explicit");
    const question = explicit
      ? "Clarify the revision handling.\n/agent clarify engineer"
      : "Does the revised behavior also handle this case?";
    const duringHandoff = timing.endsWith("handoff");
    const f = fixture(t, {
      pushOnClarify: "b",
      commentOnClarify: first,
      commentOnClarifyHandoff: duringHandoff ? question : null,
      inlineOnClarifyHandoff: inline,
      answers: [
        {
          mode: "review",
          verdict: "approve pending non-code fixes",
          clarify: "engineer",
        },
        { mode: "clarify", comment: duringHandoff ? null : question },
      ],
    });
    const done = f.dispatch("wake", "pr", "34");
    const lateRoles = explicit ? ["engineer"] : ["engineer", "product"];
    assert.deepEqual(
      done.calls.map(({ mode, agent }) => [mode, agent]),
      [
        ["review", "engineer"],
        ["clarify", "product"],
        ...lateRoles.map((agent) => ["clarify", agent]),
        ["review", "engineer"],
        ["acceptance", "product"],
      ],
    );
    const lateComments = inline ? done.inlineComments : done.comments;
    const lateComment = lateComments.find(({ body }) => body === question);
    const requestId = `${inline ? "inline" : "comment"}-${lateComment.id}`;
    for (const clarification of done.calls.slice(2, -2)) {
      assert.match(
        clarification.context,
        new RegExp(`requests in this run: ${requestId}\\.`),
      );
    }
    assert.deepEqual(done.labels, ["agent:accepted"]);
    assert.deepEqual(f.dispatch("wake", "pr", "34").calls, done.calls);
  });
}

test("recovery resumes a recorded clarification before the label swap", (t) => {
  const head = sha("a");
  const recorded = marker("clarify", head, ["comment-101"], "engineer");
  const f = fixture(t, {
    labels: ["agent:review"],
    comments: [
      comment(100, marker("clarified", head, ["comment-99"])),
      comment(101, "Check one more detail.\n/agent clarify engineer"),
      comment(102, recorded),
    ],
  });
  const done = f.dispatch("tick");
  assert.deepEqual(
    done.calls.map(({ mode, agent }) => [mode, agent]),
    [
      ["clarify", "engineer"],
      ["review", "engineer"],
      ["acceptance", "product"],
    ],
  );
  assert.equal(done.comments.filter(({ body }) => body === recorded).length, 1);
  assert.deepEqual(done.labels, ["agent:accepted"]);
});

for (const productReplied of [true, false]) {
  test(`recovery drains a recorded batch with ${productReplied ? "both replies" : "one reply"} before a new question`, (t) => {
    const head = sha("a");
    const first = "comment-100";
    const lateNumber = productReplied ? 104 : 103;
    const late = `comment-${lateNumber}`;
    const recorded = marker("clarify", head, [first]);
    const f = fixture(t, {
      labels: ["agent:clarifying"],
      comments: [
        comment(100, "Clarify how this should work."),
        comment(101, recorded),
        comment(102, "**Engineer clarification**\nFirst reply."),
        ...(productReplied
          ? [comment(103, "**Product clarification**\nFirst reply.")]
          : []),
        comment(
          lateNumber,
          "Check the technical edge case.\n/agent clarify engineer",
        ),
      ],
    });
    const done = f.dispatch("tick");
    const clarifications = done.calls.filter(({ mode }) => mode === "clarify");
    assert.deepEqual(
      clarifications.map(({ agent }) => agent),
      productReplied ? ["engineer"] : ["product", "engineer"],
    );
    assert.match(
      clarifications.at(-1).context,
      new RegExp(`requests in this run: ${late}\\.`),
    );
    if (!productReplied)
      assert.match(
        clarifications[0].context,
        new RegExp(`requests in this run: ${first}\\.`),
      );
    const finished = done.comments.filter(({ body }) =>
      body.startsWith('<!-- spacory-dispatch {"action":"clarified"'),
    );
    assert.deepEqual(
      finished.map(
        ({ body }) =>
          JSON.parse(body.slice("<!-- spacory-dispatch ".length, -4)).requests,
      ),
      [[first], [late]],
    );
    assert.deepEqual(done.labels, ["agent:accepted"]);
  });
}
