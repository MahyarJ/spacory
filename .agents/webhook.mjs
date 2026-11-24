import { execFileSync, spawn } from "node:child_process";
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { realpathSync } from "node:fs";
import { mkdir, readdir, unlink, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const scripts = fileURLToPath(new URL("./", import.meta.url));
const payloadLimit = 1024 * 1024;
const queueName = /^(pr|issue)-([1-9][0-9]*)\.[a-f0-9-]+$/;
const triggers = {
  pr: new Set([
    "agent:review",
    "agent:changes",
    "agent:clarify",
    "agent:conflict",
  ]),
  issue: new Set(["agent:ready", "agent:triage", "agent:clarify"]),
};

export function webhookTarget(event, payload, repository) {
  if (payload.repository?.full_name?.toLowerCase() !== repository.toLowerCase())
    return;
  const { action, issue, pull_request: pr, label } = payload;
  const kind = pr || issue?.pull_request ? "pr" : "issue";
  const number = pr?.number ?? issue?.number;
  if (!Number.isSafeInteger(number) || number <= 0) return;
  if (
    event === "pull_request" &&
    ["opened", "reopened", "synchronize", "ready_for_review"].includes(action)
  )
    return { kind, number };
  if (
    ["pull_request", "issues"].includes(event) &&
    ["labeled", "unlabeled"].includes(action)
  ) {
    if (
      triggers[kind].has(label?.name) ||
      (action === "unlabeled" && label?.name === "agent:blocked")
    )
      return { kind, number };
  }
  if (
    ["issue_comment", "pull_request_review_comment"].includes(event) &&
    action === "created"
  ) {
    if (
      kind === "pr" &&
      (pr ?? issue).labels?.some(
        ({ name }) => name === "agent:clarify" || name === "agent:clarifying",
      )
    )
      return { kind, number };
  }
}

function verified(body, header, secret) {
  if (typeof header !== "string" || !/^sha256=[\da-f]{64}$/.test(header))
    return false;
  const expected = createHmac("sha256", secret).update(body).digest();
  return timingSafeEqual(expected, Buffer.from(header.slice(7), "hex"));
}

function dispatch(kind, number) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      path.join(scripts, "dispatch.sh"),
      ["wake", kind, number],
      { stdio: ["ignore", "inherit", "inherit"] },
    );
    child.once("error", reject);
    child.once("close", resolve);
  });
}

export async function createWakeQueue(dir, run = dispatch, retryMs = 5000) {
  await mkdir(dir, { recursive: true, mode: 0o700 });
  let timer;
  let running = false;
  let again = false;
  let stopped = false;

  function wake(delay) {
    if (stopped) return;
    if (running) {
      again = true;
      return;
    }
    clearTimeout(timer);
    timer = setTimeout(drain, delay);
    timer.unref();
  }

  async function drain() {
    running = true;
    again = false;
    let retry = false;
    try {
      const batches = new Map();
      for (const name of await readdir(dir)) {
        const match = name.match(queueName);
        if (!match) continue;
        const key = `${match[1]}-${match[2]}`;
        const batch = batches.get(key) ?? {
          kind: match[1],
          number: match[2],
          names: [],
        };
        batch.names.push(name);
        batches.set(key, batch);
      }
      for (const { kind, number, names } of batches.values()) {
        const result = await run(kind, number);
        if (result === 0) {
          await Promise.all(names.map((name) => unlink(path.join(dir, name))));
        } else {
          retry = true;
          if (result === 75) break; // The shared lock is busy for every job.
        }
      }
    } catch (error) {
      console.error(`Webhook queue: ${error.message}`);
      retry = true;
    } finally {
      running = false;
      if (again || retry) wake(retry ? retryMs : 0);
    }
  }

  wake(0); // Files left by a restart are still pending.
  return {
    async enqueue({ kind, number }) {
      await writeFile(path.join(dir, `${kind}-${number}.${randomUUID()}`), "", {
        flag: "wx",
        mode: 0o600,
      });
      wake(0);
    },
    stop() {
      stopped = true;
      clearTimeout(timer);
    },
  };
}

export function webhookServer({ secret, repository, enqueue }) {
  if (!secret || !repository)
    throw new Error("Webhook secret and repository are required");
  return createServer(async (req, res) => {
    if (req.method !== "POST" || req.url !== "/github") {
      res.writeHead(404).end();
      return;
    }
    try {
      const chunks = [];
      let length = 0;
      for await (const chunk of req) {
        length += chunk.length;
        if (length > payloadLimit) {
          res.writeHead(413).end();
          return;
        }
        chunks.push(chunk);
      }
      const body = Buffer.concat(chunks);
      if (!verified(body, req.headers["x-hub-signature-256"], secret)) {
        res.writeHead(401).end();
        return;
      }
      let payload;
      try {
        payload = JSON.parse(body);
        if (!payload || typeof payload !== "object")
          throw new Error("invalid payload");
      } catch {
        res.writeHead(400).end();
        return;
      }
      const target = webhookTarget(
        req.headers["x-github-event"],
        payload,
        repository,
      );
      if (target) await enqueue(target);
      res.writeHead(target ? 202 : 204).end();
    } catch (error) {
      console.error(`Webhook delivery: ${error.message}`);
      res.writeHead(503).end();
    }
  });
}

async function main() {
  const secret = process.env.SPACORY_WEBHOOK_SECRET;
  if (!secret) return; // launchd can install the receiver before it is enabled.
  const repository =
    process.env.SPACORY_WEBHOOK_REPOSITORY ||
    execFileSync(
      "gh",
      ["repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner"],
      { encoding: "utf8" },
    ).trim();
  const port = Number(process.env.SPACORY_WEBHOOK_PORT ?? 8787);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("Invalid SPACORY_WEBHOOK_PORT");
  const dir = path.join(scripts, "logs", "webhook-queue");
  const queue = await createWakeQueue(dir);
  const server = webhookServer({ secret, repository, enqueue: queue.enqueue });
  server.listen(port, "127.0.0.1", () =>
    console.log(
      `Spacory GitHub webhook listening on 127.0.0.1:${port}/github for ${repository}`,
    ),
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href
) {
  try {
    await main();
  } catch (error) {
    console.error(`Webhook receiver: ${error.message}`);
    process.exitCode = 1;
  }
}
