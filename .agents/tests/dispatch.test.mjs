import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
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
        output([verb.includes("/pulls/") ? [] : state.comments]);
      else if (verb.includes("/compare/")) output(0);
      else if (!verb.endsWith("/timeline")) throw new Error(args.join(" "));
      return;
    }
    if (kind === "repo") return output("owner/spacory");
    if (verb === "list") {
      if (kind === "issue") {
        if (state.issueLabels.includes(arg("--label"))) output(12);
      } else if (
        state.exists &&
        (!args.includes("--label") || state.labels.includes(arg("--label")))
      )
        output(34);
      return;
    }
    if (verb === "view") {
      const fields = arg("--json");
      if (kind === "issue") {
        for (const label of state.issueLabels) output(label);
      } else if (fields === "headRefOid") output(state.head);
      else if (fields === "headRefName") output("branch");
      else if (fields === "mergeable") output("MERGEABLE");
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
          isDraft: false,
          isCrossRepository: false,
          labels: state.labels.map((name) => ({ name })),
          headRefOid: state.head,
          baseRefOid: "e".repeat(40),
        });
      } else throw new Error(args.join(" "));
      return;
    }
    if (verb === "edit") {
      const key = kind === "pr" ? "labels" : "issueLabels";
      if (args.includes("--remove-label"))
        state[key] = state[key].filter(
          (label) => label !== arg("--remove-label"),
        );
      if (
        args.includes("--add-label") &&
        !state[key].includes(arg("--add-label"))
      )
        state[key].push(arg("--add-label"));
      return save();
    }
    if (verb === "comment" && number === "34") {
      add(arg("--body"));
      return save();
    }
    throw new Error(args.join(" "));
  }
  if (command === "git" || command === "notify") return;
  const [mode, , context] = args;
  state.calls.push({ mode, agent: command, head: state.head, context });
  const entry = state.answers.shift() ?? {};
  if (entry.mode && entry.mode !== mode)
    throw new Error(`expected ${entry.mode}, got ${mode}`);
  const current = state.head;
  if (mode === "implement") state.exists = true;
  if (entry.push) state.head = entry.push.repeat(40);
  if (mode === "review" || mode === "acceptance") {
    const role = mode === "review" ? "Engineer review" : "Product acceptance";
    const verdict =
      entry.verdict ?? (mode === "review" ? "approve" : "accepted");
    add(
      `**${role}**\n**Head:** ${current}\n${entry.clarify ? `**Clarify:** ${entry.clarify}\n` : ""}**Verdict:** ${verdict}`,
    );
  }
  if (mode === "clarify")
    add(
      `**${command === "engineer" ? "Engineer" : "Product"} clarification**\nSummary`,
    );
  save();
}

function fixture(t, overrides = {}) {
  const root = mkdtempSync(path.join(os.tmpdir(), "spacory-dispatch-test-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const dir = path.join(root, ".agents");
  const bin = path.join(root, "bin");
  mkdirSync(dir);
  mkdirSync(bin);
  for (const filename of ["dispatch.sh", "pr-dispatch.sh", "pr-state.mjs"]) {
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
    comments: [],
    calls: [],
    answers: [],
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
          SPACORY_MAX_ROUNDS: "5",
          SPACORY_AUTOMERGE: "0",
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
const marker = (action, head) =>
  `<!-- spacory-dispatch ${JSON.stringify({ action, head, requests: [] })} -->`;
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
