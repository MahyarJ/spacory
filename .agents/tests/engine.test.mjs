import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
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
    "tee",
    "mkfifo",
    "cmp",
    "readlink",
  ]) {
    const source = [`/bin/${name}`, `/usr/bin/${name}`].find(existsSync);
    assert.ok(source, `missing test utility ${name}`);
    symlinkSync(source, path.join(bin, name));
  }
  symlinkSync(process.execPath, path.join(bin, "node"));
  const mock = `#!${process.execPath}
const fs = require('node:fs');
fs.appendFileSync(process.env.CALLS, JSON.stringify({cli: require('node:path').basename(process.argv[1]), args: process.argv.slice(2), home: process.env.CODEX_HOME, pid: process.pid, ppid: process.ppid}) + '\\n');
const cli = require('node:path').basename(process.argv[1]);
const code = Number((cli === 'claude' || cli === 'codex') ? (process.env.MOCK_EXIT || 0) : 0);
if (process.env.MOCK_GATE === '1' && (cli === 'claude' || cli === 'codex')) {
  process.stdout.write('stdout-before\\n');
  process.stderr.write('stderr-before\\n');
  process.stdin.once('data', () => {
    process.stdout.write('stdout-after\\n');
    process.stderr.write('stderr-after\\n');
    process.stdin.destroy();
    process.exitCode = code;
  });
} else if (process.env.MOCK_SIGNAL_PARENT === '1' && (cli === 'claude' || cli === 'codex')) {
  process.kill(process.ppid, 'SIGTERM');
  process.stdin.resume();
} else {
  process.stdout.write(process.env.MOCK_STDOUT || '');
  process.stderr.write(process.env.MOCK_STDERR || '');
  process.exitCode = code;
}
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
  const run = (script, overrides = {}, args = [], adapter = engine) =>
    spawnSync(
      "/bin/bash",
      [
        "-c",
        `set -euo pipefail\nsource "$1"\n${script}`,
        "test",
        adapter,
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
  adapter = engine,
) {
  const selected = setup.match(
    /configure_agent (product|engineer|reviewer) (\w+)/,
  );
  const taskRole =
    selected?.[1] === "reviewer" ? "engineer" : selected?.[1] || "engineer";
  const taskMode = selected?.[2] || "implement";
  const task = `/${taskRole}-agent ${taskMode} 14\n\ntask with 'quotes'\nnext line`;
  const process = f.run(
    `${setup}\nrc=0\nlaunch_agent "$2" "$3" "$4" || rc=$?\n${save}\nexit "$rc"`,
    overrides,
    [task, shim, permission],
    adapter,
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
    "/engineer-agent implement 14\n\ntask with 'quotes'\nnext line",
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
    assert.ok(
      call.args[1].startsWith("Role instructions\n\nCanonical instructions"),
    );
    assert.ok(
      call.args[1].includes("BEGIN .agents/instructions/engineer-agent.md"),
    );
    assert.ok(
      call.args[1].includes(
        readFileSync(
          path.join(root, ".agents/instructions/engineer-agent.md"),
          "utf8",
        ).trimEnd(),
      ),
    );
    assert.ok(
      call.args[1].endsWith(
        "/engineer-agent implement 14\n\ntask with 'quotes'\nnext line",
      ),
    );
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
    `launch_agent task "$2" acceptEdits\nSPACORY_AGENT_ENGINE=codex\nconfigure_agent engineer implement\nlaunch_agent task "$2" acceptEdits\n${save}`,
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

test("stdout and stderr stream before the mock CLI is allowed to finish", async () => {
  const f = fixture();
  const child = spawn(
    "/bin/bash",
    [
      "-c",
      `set -euo pipefail
source "$1"
rc=0
launch_agent task "$2" acceptEdits || rc=$?
${save}
exit "$rc"`,
      "stream-test",
      engine,
      f.shim,
    ],
    {
      cwd: root,
      env: { ...f.env, MOCK_GATE: "1", MOCK_EXIT: "17" },
    },
  );
  let stdout = "";
  let stderr = "";
  let released = false;
  const release = () => {
    if (
      !released &&
      stdout.includes("stdout-before\n") &&
      stderr.includes("stderr-before\n")
    ) {
      released = true;
      child.stdin.end("continue\n");
    }
  };
  child.stdout.on("data", (data) => {
    stdout += data;
    release();
  });
  child.stderr.on("data", (data) => {
    stderr += data;
    release();
  });
  const timer = setTimeout(() => child.kill("SIGKILL"), 10000);
  try {
    const code = await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("close", resolve);
    });
    assert.ok(
      released,
      "both streams must arrive while the CLI is waiting for input",
    );
    assert.equal(code, 17);
    const result = readFileSync(f.env.RESULT, "utf8").split("\0");
    assert.equal(stdout, "stdout-before\nstdout-after\n");
    assert.equal(stderr, "stderr-before\nstderr-after\n");
    assert.equal(result[6], stdout);
    assert.equal(result[7], stderr);
    assert.ok(
      !readdirSync(f.dir).some((name) =>
        name.startsWith("spacory-agent-result."),
      ),
    );
  } finally {
    clearTimeout(timer);
  }
});

test("capture cleans up on interruption and preserves caller traps", () => {
  const f = fixture();
  const trapResult = path.join(f.dir, "caller-trap");
  const r = f.run(
    `trap 'printf caller-exit > "$TRAP_RESULT"' EXIT
trap ':' TERM
trap -p EXIT TERM > "$TMPDIR/traps-before"
rc=0
launch_agent task "$2" acceptEdits || rc=$?
trap -p EXIT TERM > "$TMPDIR/traps-after"
${save}
exit "$rc"`,
    { MOCK_SIGNAL_PARENT: "1", TRAP_RESULT: trapResult },
    [f.shim],
  );
  assert.equal(r.status, 143, r.stderr);
  assert.equal(readFileSync(trapResult, "utf8"), "caller-exit");
  assert.equal(
    readFileSync(path.join(f.dir, "traps-before"), "utf8"),
    readFileSync(path.join(f.dir, "traps-after"), "utf8"),
  );
  assert.ok(
    !readdirSync(f.dir).some((name) =>
      name.startsWith("spacory-agent-result."),
    ),
    r.stderr,
  );
});

test("stream capture quotes agent text as data and cleans up after setup failure", () => {
  const f = fixture();
  const text = "quotes '\" `ignored` $(ignored) \\ ";
  const r = launch(f, {
    MOCK_STDOUT: `${text}\n\n`,
    MOCK_STDERR: `${text}\n`,
    MOCK_EXIT: "29",
  });
  assert.equal(r.status, 29);
  assert.equal(r.result[6], `${text}\n\n`);
  assert.equal(r.result[7], `${text}\n`);
  rmSync(path.join(f.bin, "mkfifo"));
  writeFileSync(path.join(f.bin, "mkfifo"), "#!/bin/bash\nexit 1\n", {
    mode: 0o755,
  });
  const failed = launch(f);
  assert.equal(failed.status, 1, failed.stderr);
  assert.ok(
    !readdirSync(f.dir).some((name) =>
      name.startsWith("spacory-agent-result."),
    ),
    r.stderr,
  );
});

for (const [role, mode, names] of [
  ["product", "triage", ["product-agent"]],
  ["engineer", "implement", ["engineer-agent"]],
  ["reviewer", "review", ["reviewer", "engineer-agent"]],
]) {
  test(`Codex embeds the exact ${role} and shared contracts independently of cwd`, () => {
    const f = fixture();
    const r = launch(
      f,
      { SPACORY_AGENT_ENGINE: "codex" },
      `configure_agent ${role} ${mode}\ncd "$TMPDIR"`,
    );
    assert.equal(r.status, 0, r.stderr);
    const prompt = f.calls()[0].args[1];
    const expected = [
      ...names,
      "spacory-conventions",
      "spacory-verify",
      "spacory-notify",
    ];
    assert.deepEqual(
      [...prompt.matchAll(/BEGIN \.agents\/instructions\/([^\n]+)\.md/g)].map(
        (match) => match[1],
      ),
      expected,
    );
    for (const name of expected) {
      const content = readFileSync(
        path.join(root, `.agents/instructions/${name}.md`),
        "utf8",
      ).trimEnd();
      assert.ok(
        prompt.includes(
          `BEGIN .agents/instructions/${name}.md\n${content}\nEND .agents/instructions/${name}.md`,
        ),
      );
    }
    assert.ok(prompt.includes(`role=${role} mode=${mode}`));
  });
}

for (const [role, mode, name, damage] of [
  ["product", "cycle", "product-agent", "missing"],
  ["engineer", "implement", "engineer-agent", "empty"],
  ["reviewer", "review", "reviewer", "missing"],
  ["reviewer", "review", "engineer-agent", "missing"],
  ["engineer", "resolve", "spacory-verify", "directory"],
]) {
  test(`Codex rejects ${damage} ${name} contract before invoking any CLI`, () => {
    const f = fixture();
    const copy = path.join(f.dir, "checkout/.agents");
    mkdirSync(copy, { recursive: true });
    for (const file of ["engine.sh", "providers", "instructions"]) {
      cpSync(path.join(root, ".agents", file), path.join(copy, file), {
        recursive: true,
      });
    }
    const file = path.join(copy, "instructions", `${name}.md`);
    rmSync(file);
    if (damage === "empty") writeFileSync(file, "");
    if (damage === "directory") mkdirSync(file);
    const r = launch(
      f,
      { SPACORY_AGENT_ENGINE: "codex" },
      `configure_agent ${role} ${mode}`,
      "acceptEdits",
      f.shim,
      path.join(copy, "engine.sh"),
    );
    assert.equal(r.status, 1, r.stderr);
    assert.equal(r.result[4], "configuration_error");
    assert.ok(r.stderr.includes(`${name}.md`));
    assert.deepEqual(f.calls(), []);
  });
}

test("Codex refuses an ambiguous legacy prompt rather than guessing a contract", () => {
  const f = fixture();
  const r = f.run(
    `rc=0; launch_agent 'unstructured task' "$2" acceptEdits || rc=$?\n${save}\nexit "$rc"`,
    { SPACORY_AGENT_ENGINE: "codex" },
    [f.shim],
  );
  assert.equal(r.status, 1);
  assert.ok(r.stderr.includes("explicit valid role/mode"));
  assert.deepEqual(f.calls(), []);
});

for (const kind of ["file", "symlink", "dangling", "directory"]) {
  test(`installer preserves unrelated ${kind} destinations and preflights both prompts`, () => {
    const f = fixture();
    const prompts = path.join(f.env.CODEX_HOME, "prompts");
    mkdirSync(prompts);
    const dest = path.join(prompts, "product-agent.md");
    const target = path.join(f.dir, "unrelated-target");
    if (kind === "file") writeFileSync(dest, "unrelated");
    if (kind === "directory") mkdirSync(dest);
    if (kind === "symlink") writeFileSync(target, "unrelated target");
    if (["symlink", "dangling"].includes(kind)) symlinkSync(target, dest);
    const installer = path.join(root, ".agents/codex/install-prompts.sh");
    const run = (args = []) =>
      spawnSync("/bin/bash", [installer, ...args], {
        env: f.env,
        encoding: "utf8",
        timeout: 10000,
      });
    assert.equal(run().status, 1);
    assert.ok(
      !existsSync(path.join(prompts, "engineer-agent.md")),
      "preflight must avoid partial installation",
    );
    if (kind === "file") assert.equal(readFileSync(dest, "utf8"), "unrelated");
    if (["symlink", "dangling"].includes(kind))
      assert.equal(readlinkSync(dest), target);
    if (kind === "symlink")
      assert.equal(readFileSync(target, "utf8"), "unrelated target");
    assert.equal(
      run(["--force", "--copy"]).status,
      kind === "directory" ? 1 : 0,
    );
    if (kind === "symlink")
      assert.equal(readFileSync(target, "utf8"), "unrelated target");
    assert.deepEqual(f.calls(), []);
  });
}

test("installer safely converts owned links to copies and refuses symlinked prompt directories", () => {
  const f = fixture();
  const installer = path.join(root, ".agents/codex/install-prompts.sh");
  const run = (args = []) =>
    spawnSync("/bin/bash", [installer, ...args], {
      env: f.env,
      encoding: "utf8",
      timeout: 10000,
    });
  assert.equal(run().status, 0);
  assert.equal(run(["--copy"]).status, 0);
  assert.equal(run().status, 0);
  const prompts = path.join(f.env.CODEX_HOME, "prompts");
  rmSync(prompts, { recursive: true });
  const unrelated = path.join(f.dir, "unrelated-prompts");
  mkdirSync(unrelated);
  symlinkSync(unrelated, prompts);
  assert.equal(run(["--force"]).status, 1);
  assert.deepEqual(readdirSync(unrelated), []);
});

test("stream readers drain large outputs without changing the raw failure exit", () => {
  const f = fixture();
  const stdout = `${"out'\"\\$".repeat(4096)}\n\n`;
  const stderr = `${"err'\"\\$".repeat(4096)}\n\n`;
  const r = launch(f, {
    MOCK_STDOUT: stdout,
    MOCK_STDERR: stderr,
    MOCK_EXIT: "31",
  });
  assert.equal(r.status, 31);
  assert.equal(r.stdout, stdout);
  assert.equal(r.stderr, stderr);
  assert.equal(r.result[6], stdout);
  assert.equal(r.result[7], stderr);
  assert.ok(
    !readdirSync(f.dir).some((name) =>
      name.startsWith("spacory-agent-result."),
    ),
  );
});

// Signal only the public runner PID, not the capture worker or process group.
// A detached group gives failed tests a bounded, mock-only cleanup fallback.
async function cancellationFixture(provider, script) {
  const f = fixture();
  const child = spawn(
    "/bin/bash",
    script
      ? ["-c", script, "caller", engine, f.shim]
      : [path.join(root, ".agents/run-engineer.sh"), "implement", "14"],
    {
      cwd: root,
      env: { ...f.env, SPACORY_AGENT_ENGINE: provider, MOCK_GATE: "1" },
      detached: true,
    },
  );
  const exited = once(child, "exit");
  let stdout = "";
  let stderr = "";
  let readyResolve;
  const ready = new Promise((resolve) => {
    readyResolve = resolve;
  });
  const checkReady = () => {
    if (
      stdout.includes("stdout-before\n") &&
      stderr.includes("stderr-before\n")
    )
      readyResolve();
  };
  child.stdout.on("data", (data) => {
    stdout += data;
    checkReady();
  });
  child.stderr.on("data", (data) => {
    stderr += data;
    checkReady();
  });
  const stopGroup = () => {
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch (error) {
      if (error.code !== "ESRCH") throw error;
    }
  };
  const timer = setTimeout(stopGroup, 10000);
  try {
    await Promise.race([
      ready,
      exited.then(() => {
        throw new Error(`runner exited before mock CLI was ready: ${stderr}`);
      }),
    ]);
  } catch (error) {
    clearTimeout(timer);
    stopGroup();
    throw error;
  }
  return {
    ...f,
    child,
    exited,
    finish: () => {
      clearTimeout(timer);
      stopGroup();
    },
  };
}

for (const [provider, signal, code] of [
  ["claude", "SIGTERM", 143],
  ["claude", "SIGINT", 130],
  ["claude", "SIGHUP", 129],
  ["codex", "SIGTERM", 143],
]) {
  test(`${provider}: ${signal} to the public runner stops the CLI and removes captures`, async () => {
    const f = await cancellationFixture(provider);
    try {
      const cli = f.calls().find((call) => call.cli === provider);
      assert.ok(cli);
      f.child.kill(signal);
      const [exitCode, exitSignal] = await f.exited;
      assert.equal(exitCode, code);
      assert.equal(exitSignal, null);
      for (const pid of [cli.pid, cli.ppid]) {
        assert.throws(
          () => process.kill(pid, 0),
          { code: "ESRCH" },
          `process ${pid} must be reaped before the runner exits`,
        );
      }
      assert.ok(
        !readdirSync(f.dir).some((name) =>
          name.startsWith("spacory-agent-result."),
        ),
      );
    } finally {
      f.finish();
    }
  });
}

test("runner cancellation invokes the original signal handler after cleanup and restores traps", async () => {
  const f = await cancellationFixture(
    "claude",
    `set -euo pipefail
source "$1"
trap 'printf exit > "$TMPDIR/caller-exit"' EXIT
trap 'for dir in "$TMPDIR"/spacory-agent-result.*; do [ ! -d "$dir" ] || exit 99; done; printf term > "$TMPDIR/caller-term"' TERM
trap -p EXIT HUP INT TERM > "$TMPDIR/traps-before"
rc=0
launch_agent task "$2" acceptEdits || rc=$?
trap -p EXIT HUP INT TERM > "$TMPDIR/traps-after"
exit "$rc"`,
  );
  try {
    f.child.kill("SIGTERM");
    const [code] = await f.exited;
    assert.equal(code, 143);
    assert.equal(readFileSync(path.join(f.dir, "caller-term"), "utf8"), "term");
    assert.equal(readFileSync(path.join(f.dir, "caller-exit"), "utf8"), "exit");
    assert.equal(
      readFileSync(path.join(f.dir, "traps-before"), "utf8"),
      readFileSync(path.join(f.dir, "traps-after"), "utf8"),
    );
    assert.ok(
      !readdirSync(f.dir).some((name) =>
        name.startsWith("spacory-agent-result."),
      ),
    );
  } finally {
    f.finish();
  }
});

test("an explicitly ignored caller signal remains ignored during execution", async () => {
  const f = await cancellationFixture(
    "claude",
    `set -euo pipefail
source "$1"
trap '' TERM
trap -p EXIT HUP INT TERM > "$TMPDIR/traps-before"
rc=0
launch_agent task "$2" acceptEdits || rc=$?
trap -p EXIT HUP INT TERM > "$TMPDIR/traps-after"
exit "$rc"`,
  );
  try {
    f.child.kill("SIGTERM");
    f.child.stdin.end("continue\n");
    const [code, signal] = await f.exited;
    assert.equal(code, 0);
    assert.equal(signal, null);
    assert.equal(
      readFileSync(path.join(f.dir, "traps-before"), "utf8"),
      readFileSync(path.join(f.dir, "traps-after"), "utf8"),
    );
    assert.ok(
      !readdirSync(f.dir).some((name) =>
        name.startsWith("spacory-agent-result."),
      ),
    );
  } finally {
    f.finish();
  }
});

for (const provider of ["claude", "codex"]) {
  test(`${provider} tracks provider usage and resumes only the configured reviewer`, () => {
    const f = fixture();
    const session = "951bd111-72e7-489f-a22d-2dcb6bff6cc1";
    const usage = path.join(f.dir, "usage.jsonl");
    const events =
      provider === "claude"
        ? [
            {
              type: "system",
              subtype: "init",
              model: "resolved-claude",
              session_id: session,
            },
            {
              type: "result",
              result: "review done",
              session_id: session,
              usage: {
                input_tokens: 2,
                cache_read_input_tokens: 3,
                cache_creation_input_tokens: 5,
                output_tokens: 4,
              },
            },
          ]
        : [
            { type: "thread.started", thread_id: session },
            {
              type: "item.completed",
              item: { type: "agent_message", text: "review done" },
            },
            {
              type: "turn.completed",
              usage: {
                input_tokens: 10,
                cached_input_tokens: 3,
                output_tokens: 4,
              },
            },
          ];
    const result = launch(
      f,
      {
        SPACORY_AGENT_ENGINE: provider,
        SPACORY_AGENT_MODEL: "configured",
        SPACORY_AGENT_USAGE_LOG: usage,
        SPACORY_AGENT_PR: "14",
        SPACORY_AGENT_RESUME_ID: session,
        MOCK_STDOUT: events.map((event) => JSON.stringify(event)).join("\n"),
      },
      "configure_agent reviewer review",
    );
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, "review done\n");
    const invocation = f.calls().at(-1).args;
    assert.ok(invocation.includes(session));
    assert.ok(
      invocation.includes(provider === "claude" ? "stream-json" : "--json"),
    );
    if (provider === "codex")
      assert.deepEqual(invocation.slice(0, 5), [
        "exec",
        "--sandbox",
        "workspace-write",
        "resume",
        session,
      ]);
    const row = JSON.parse(readFileSync(usage, "utf8"));
    assert.deepEqual(
      [
        row.provider,
        row.model,
        row.role,
        row.session,
        row.pr,
        row.input,
        row.cachedInput,
        row.output,
        row.resumed,
      ],
      [
        provider,
        provider === "claude" ? "resolved-claude" : "configured",
        "reviewer",
        session,
        14,
        10,
        3,
        4,
        true,
      ],
    );
    assert.equal(typeof row.elapsedSeconds, "number");
  });
}
