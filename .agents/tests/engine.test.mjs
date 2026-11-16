import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(fileURLToPath(new URL("../../", import.meta.url)));
const engine = path.join(root, ".agents/engine.sh");
const fixtures = [];
afterEach(() => {
  for (const dir of fixtures.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

function fixture() {
  const dir = mkdtempSync(path.join(tmpdir(), "spacory-mock-"));
  fixtures.push(dir);
  const bin = path.join(dir, "bin");
  const home = path.join(dir, "selected account");
  mkdirSync(bin);
  mkdirSync(home);
  // A closed PATH: real Claude, Codex, gh, git, npm and curl cannot be reached.
  for (const name of [
    "cat",
    "tr",
    "mktemp",
    "rm",
    "rmdir",
    "dirname",
    "mkdir",
    "ln",
    "cp",
  ]) {
    const source = [`/bin/${name}`, `/usr/bin/${name}`].find(existsSync);
    assert.ok(source, `missing test utility ${name}`);
    symlinkSync(source, path.join(bin, name));
  }
  const mock = `#!${process.execPath}
const fs = require('node:fs');
fs.appendFileSync(process.env.CALLS, JSON.stringify({cli: require('node:path').basename(process.argv[1]), args: process.argv.slice(2), home: process.env.CODEX_HOME}) + '\\n');
process.stdout.write(process.env.MOCK_STDOUT || '');
process.stderr.write(process.env.MOCK_STDERR || '');
const cli = require('node:path').basename(process.argv[1]);
process.exit(Number((cli === 'claude' || cli === 'codex') ? (process.env.MOCK_EXIT || 0) : 0));
`;
  for (const cli of ["claude", "codex", "gh", "git"]) {
    writeFileSync(path.join(bin, cli), mock, { mode: 0o755 });
  }
  const shim = path.join(dir, "role shim.md");
  writeFileSync(shim, "Role instructions\n");
  const env = {
    PATH: bin,
    HOME: dir,
    TMPDIR: dir,
    CODEX_HOME: home,
    CALLS: path.join(dir, "calls.jsonl"),
    RESULT: path.join(dir, "result"),
    SPACORY_AGENT_ISOLATED: "1",
  };
  const run = (script, overrides = {}, args = []) =>
    spawnSync(
      "/bin/bash",
      [
        "-c",
        `set -euo pipefail\nsource "$1"\n${script}`,
        "test",
        engine,
        ...args,
      ],
      {
        cwd: root,
        env: { ...env, ...overrides },
        encoding: "utf8",
        timeout: 10000,
      },
    );
  const calls = () =>
    existsSync(env.CALLS)
      ? readFileSync(env.CALLS, "utf8")
          .trim()
          .split("\n")
          .filter(Boolean)
          .map(JSON.parse)
      : [];
  return { dir, bin, shim, env, run, calls };
}

const save = `printf '%s\\0' "$SPACORY_AGENT_RESULT_PROVIDER" "$SPACORY_AGENT_RESULT_MODEL" "$SPACORY_AGENT_RESULT_ROLE" "$SPACORY_AGENT_RESULT_MODE" "$SPACORY_AGENT_RESULT_STATUS" "$SPACORY_AGENT_RESULT_EXIT_CODE" "$SPACORY_AGENT_RESULT_STDOUT" "$SPACORY_AGENT_RESULT_STDERR" > "$RESULT"`;
function launch(
  f,
  overrides = {},
  setup = "",
  permission = "acceptEdits",
  shim = f.shim,
) {
  const process = f.run(
    `${setup}\nrc=0\nlaunch_agent "$2" "$3" "$4" || rc=$?\n${save}\nexit "$rc"`,
    overrides,
    ["task with 'quotes'\nnext line", shim, permission],
  );
  return {
    ...process,
    result: readFileSync(f.env.RESULT, "utf8").split("\0").slice(0, -1),
  };
}

test("Claude legacy invocation is unchanged, with exact output and raw exit status", () => {
  const f = fixture();
  const r = launch(f, {
    CLAUDE_MODEL: "sonnet",
    CLAUDE_EFFORT: "medium",
    MOCK_STDOUT: "answer\n\n",
    MOCK_STDERR: "warning\n",
  });
  assert.equal(r.status, 0);
  assert.deepEqual(f.calls()[0].args, [
    "-p",
    "task with 'quotes'\nnext line",
    "--append-system-prompt-file",
    f.shim,
    "--permission-mode",
    "acceptEdits",
    "--model",
    "sonnet",
    "--effort",
    "medium",
  ]);
  assert.deepEqual(r.result, [
    "claude",
    "sonnet",
    "",
    "",
    "success",
    "0",
    "answer\n\n",
    "warning\n",
  ]);
  assert.equal(r.stdout, "answer\n\n");
  assert.equal(r.stderr, "warning\n");
  assert.ok(
    !readdirSync(f.dir).some((name) =>
      name.startsWith("spacory-agent-result."),
    ),
  );
});

test("Claude forwards custom permission modes and leaves model/effort unset by default", () => {
  const f = fixture();
  assert.equal(launch(f, {}, "", "plan").status, 0);
  assert.deepEqual(f.calls()[0].args.slice(-2), ["--permission-mode", "plan"]);
  assert.equal(f.calls()[0].args.length, 6);
});

test("role/mode provider and model overrides resolve independently with legacy fallback", () => {
  const f = fixture();
  const r = launch(
    f,
    {
      SPACORY_AGENT_ENGINE: "claude",
      SPACORY_AGENT_PROVIDER: "codex",
      SPACORY_PRODUCT_PROVIDER: "claude",
      SPACORY_PRODUCT_TRIAGE_PROVIDER: "codex",
      SPACORY_AGENT_MODEL: "global",
      SPACORY_PRODUCT_MODEL: "role",
      SPACORY_PRODUCT_TRIAGE_MODEL: "mode",
      CLAUDE_MODEL: "legacy",
      CODEX_MODEL: "codex-legacy",
    },
    "configure_agent product triage",
  );
  assert.equal(r.status, 0);
  assert.deepEqual(r.result.slice(0, 4), [
    "codex",
    "mode",
    "product",
    "triage",
  ]);
  for (const [env, model] of [
    [{ SPACORY_PRODUCT_MODEL: "role" }, "role"],
    [{ SPACORY_AGENT_MODEL: "global" }, "global"],
    [{ CLAUDE_MODEL: "legacy" }, "legacy"],
    [{}, ""],
  ]) {
    const next = launch(f, env, "configure_agent product cycle");
    assert.equal(next.result[1], model);
  }
  const reviewer = launch(
    f,
    {
      SPACORY_ENGINEER_PROVIDER: "codex",
      SPACORY_REVIEWER_MODEL: "review-model",
    },
    "configure_agent reviewer review",
  );
  assert.deepEqual(reviewer.result.slice(0, 4), [
    "claude",
    "review-model",
    "reviewer",
    "review",
  ]);
});

for (const permission of ["acceptEdits", "bypassPermissions"]) {
  test(`Codex loads canonical instructions and maps ${permission} with explicit account`, () => {
    const f = fixture();
    const r = launch(
      f,
      {
        SPACORY_AGENT_ENGINE: "codex",
        CODEX_MODEL: "selected-model",
        CLAUDE_MODEL: "ignored",
        CLAUDE_EFFORT: "ignored",
      },
      "configure_agent engineer implement",
      permission,
    );
    assert.equal(r.status, 0);
    const call = f.calls()[0];
    assert.equal(call.home, f.env.CODEX_HOME);
    assert.equal(call.args[0], "exec");
    assert.ok(call.args[1].startsWith("Role instructions\n\nNOTE"));
    assert.ok(call.args[1].includes(".agents/instructions/<name>.md"));
    assert.ok(call.args[1].endsWith("task with 'quotes'\nnext line"));
    assert.deepEqual(call.args.slice(2, 7), [
      "-C",
      root,
      "--skip-git-repo-check",
      "-m",
      "selected-model",
    ]);
    assert.deepEqual(
      call.args.slice(7),
      permission === "acceptEdits"
        ? [
            "--sandbox",
            "workspace-write",
            "-c",
            "approval_policy=never",
            "-c",
            "sandbox_workspace_write.network_access=true",
          ]
        : ["--dangerously-bypass-approvals-and-sandbox"],
    );
  });
}

for (const [env, permission, message] of [
  [
    { SPACORY_AGENT_ENGINE: "invalid" },
    "acceptEdits",
    "unknown agent provider",
  ],
  [
    { SPACORY_AGENT_ENGINE: "codex", CODEX_HOME: "" },
    "acceptEdits",
    "set CODEX_HOME explicitly",
  ],
  [
    { SPACORY_AGENT_ENGINE: "codex", CODEX_HOME: "relative" },
    "acceptEdits",
    "absolute path",
  ],
  [
    {
      SPACORY_AGENT_ENGINE: "codex",
      CODEX_HOME: "/nonexistent-spacory-test-account",
    },
    "acceptEdits",
    "existing accessible directory",
  ],
  [{ SPACORY_AGENT_ENGINE: "codex" }, "plan", "unsupported Codex permission"],
]) {
  test(`preflight rejects ${message} without launching CLI`, () => {
    const f = fixture();
    const r = launch(f, env, "", permission);
    assert.equal(r.status, 1);
    assert.equal(r.result[4], "configuration_error");
    assert.ok(r.stderr.includes(message));
    assert.deepEqual(f.calls(), []);
  });
}

test("missing CLI, missing shim, invalid role/mode and bad interface fail before launch", () => {
  for (const type of ["cli", "shim", "role", "arguments"]) {
    const f = fixture();
    if (type === "cli") rmSync(path.join(f.bin, "claude"));
    if (type === "role" || type === "arguments") {
      const command =
        type === "role" ? "configure_agent engineer nonsense" : "launch_agent";
      const r = f.run(`rc=0; ${command} || rc=$?\n${save}\nexit "$rc"`);
      assert.equal(r.status, 1);
    } else {
      const r = launch(
        f,
        {},
        "",
        "acceptEdits",
        type === "shim" ? path.join(f.dir, "absent") : f.shim,
      );
      assert.equal(r.status, 1);
      assert.equal(r.result[4], "configuration_error");
    }
    assert.deepEqual(f.calls(), []);
  }
});

for (const provider of ["claude", "codex"]) {
  for (const [stderr, status] of [
    ["Authentication failed: invalid API key\n", "authentication_error"],
    ["Not logged in\n", "authentication_error"],
    ["Error loading config: invalid model\n", "configuration_error"],
    ["unexpected argument '--bad'\n", "configuration_error"],
    ["network connection reset\n", "execution_error"],
  ]) {
    test(`${provider}: ${status} retains process exit 23`, () => {
      const f = fixture();
      const r = launch(f, {
        SPACORY_AGENT_ENGINE: provider,
        MOCK_EXIT: "23",
        MOCK_STDERR: stderr,
      });
      assert.equal(r.status, 23);
      assert.equal(r.result[4], status);
      assert.equal(r.result[5], "23");
      assert.equal(r.stderr, stderr);
    });
  }
}

test("success is not confused with diagnostic-like agent prose; stdout failures classify", () => {
  const f = fixture();
  assert.equal(
    launch(f, { MOCK_STDOUT: "not logged in" }).result[4],
    "success",
  );
  assert.equal(
    launch(f, { MOCK_STDOUT: "authentication_error", MOCK_EXIT: "7" })
      .result[4],
    "authentication_error",
  );
});

for (const [runner, modes] of [
  ["engineer", ["implement", "review", "resolve", "reconcile", "clarify"]],
  ["product", ["cycle", "acceptance", "clarify", "triage"]],
]) {
  for (const mode of modes) {
    test(`${runner} ${mode}: legacy entry point uses configured role with mocked processes only`, () => {
      const f = fixture();
      const args = mode === "cycle" ? [] : [mode, "14"];
      const r = spawnSync(
        "/bin/bash",
        [path.join(root, `.agents/run-${runner}.sh`), ...args],
        {
          cwd: root,
          env: { ...f.env, SPACORY_REVIEWER_PROVIDER: "codex" },
          encoding: "utf8",
          timeout: 10000,
        },
      );
      assert.equal(r.status, 0, r.stderr);
      const call = f
        .calls()
        .find((c) => c.cli === "claude" || c.cli === "codex");
      assert.equal(call.cli, mode === "review" ? "codex" : "claude");
      assert.ok(call.args[1].includes(`/${runner}-agent ${mode}`));
      assert.ok(
        f
          .calls()
          .every(
            (c) => c.cli !== "git" || ["diff", "rev-list"].includes(c.args[0]),
          ),
      );
    });
  }
}

test("runner preflight errors precede GitHub/worktree operations", () => {
  const f = fixture();
  const r = spawnSync(
    "/bin/bash",
    [path.join(root, ".agents/run-engineer.sh"), "review", "14"],
    {
      cwd: root,
      env: { ...f.env, SPACORY_REVIEWER_PROVIDER: "codex", CODEX_HOME: "" },
      encoding: "utf8",
      timeout: 10000,
    },
  );
  assert.equal(r.status, 1);
  assert.deepEqual(f.calls(), []);
});

test("installer requires an explicit account; link/copy installation is isolated and repeatable", () => {
  const f = fixture();
  const installer = path.join(root, ".agents/codex/install-prompts.sh");
  const run = (env, args = []) =>
    spawnSync("/bin/bash", [installer, ...args], {
      env: { ...f.env, ...env },
      encoding: "utf8",
      timeout: 10000,
    });
  assert.equal(run({ CODEX_HOME: "" }).status, 1);
  assert.ok(!existsSync(path.join(f.env.HOME, ".codex")));
  assert.equal(run({}).status, 0);
  assert.equal(run({}).status, 0);
  for (const name of ["product", "engineer"]) {
    const installed = path.join(f.env.CODEX_HOME, `prompts/${name}-agent.md`);
    assert.equal(
      readFileSync(installed, "utf8"),
      readFileSync(
        path.join(root, `.agents/codex/prompts/${name}-agent.md`),
        "utf8",
      ),
    );
    rmSync(installed);
  }
  assert.equal(run({}, ["--copy"]).status, 0);
  assert.equal(run({}, ["--copy"]).status, 0);
  assert.equal(run({}, ["--bogus"]).status, 2);
  assert.deepEqual(f.calls(), []);
});

test("Claude compatibility copies match canonical contracts byte for byte", () => {
  const r = spawnSync(
    process.execPath,
    [path.join(root, ".agents/sync-instructions.mjs"), "--check"],
    { encoding: "utf8", timeout: 10000 },
  );
  assert.equal(r.status, 0, r.stderr);
});

test("legacy engine selection can change between launches in the same shell", () => {
  const f = fixture();
  const r = f.run(
    `launch_agent task "$2" acceptEdits\nSPACORY_AGENT_ENGINE=codex\nlaunch_agent task "$2" acceptEdits\n${save}`,
    {},
    [f.shim],
  );
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(
    f.calls().map((c) => c.cli),
    ["claude", "codex"],
  );
});

test("CLI exits remain unchanged through both runners, including product cleanup", () => {
  for (const runner of ["engineer", "product"]) {
    const f = fixture();
    const r = spawnSync(
      "/bin/bash",
      [
        path.join(root, `.agents/run-${runner}.sh`),
        ...(runner === "engineer" ? ["14"] : []),
      ],
      {
        env: { ...f.env, MOCK_EXIT: "19" },
        encoding: "utf8",
        timeout: 10000,
      },
    );
    assert.equal(r.status, 19, r.stderr);
    assert.ok(f.calls().some((c) => c.cli === "claude"));
  }
});
