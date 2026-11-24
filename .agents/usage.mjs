import { execFileSync } from "node:child_process";
import { appendFileSync, mkdirSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const sessionId = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
const numberOrNull = (value) =>
  Number.isSafeInteger(value) && value >= 0 ? value : null;

function jsonLines(raw) {
  return raw.split("\n").flatMap((line) => {
    try {
      const value = JSON.parse(line);
      return value && typeof value === "object" ? [value] : [];
    } catch {
      return [];
    }
  });
}

export function providerResult(provider, raw, configuredModel = null) {
  const events = jsonLines(raw);
  if (provider === "claude") {
    const init = events.find(
      (event) => event.type === "system" && event.subtype === "init",
    );
    const result = events.findLast((event) => event.type === "result");
    const usage = result?.usage;
    return {
      model:
        init?.model ??
        Object.keys(result?.modelUsage ?? {})[0] ??
        configuredModel,
      session: result?.session_id ?? init?.session_id ?? null,
      input: Number.isSafeInteger(usage?.input_tokens)
        ? usage.input_tokens +
          (usage.cache_creation_input_tokens ?? 0) +
          (usage.cache_read_input_tokens ?? 0)
        : null,
      cachedInput: numberOrNull(usage?.cache_read_input_tokens),
      output: numberOrNull(usage?.output_tokens),
      message: result?.result ?? result?.errors?.join("\n"),
    };
  }
  const thread = events.find((event) => event.type === "thread.started");
  const turn = events.findLast((event) => event.type === "turn.completed");
  const final = events.findLast(
    (event) =>
      event.type === "item.completed" && event.item?.type === "agent_message",
  );
  const problem = events.findLast((event) => event.type === "error");
  return {
    model: turn?.model ?? thread?.model ?? configuredModel,
    session: thread?.thread_id ?? null,
    input: numberOrNull(turn?.usage?.input_tokens),
    cachedInput: numberOrNull(turn?.usage?.cached_input_tokens),
    output: numberOrNull(turn?.usage?.output_tokens),
    message: final?.item.text ?? problem?.message,
  };
}

function append(file, record) {
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  appendFileSync(file, `${JSON.stringify(record)}\n`, { mode: 0o600 });
}

function read(file) {
  try {
    return jsonLines(readFileSync(file, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    return [];
  }
}

// Use GitHub's history so a late delivery or a busy runner doesn't erase queue time.
export function reviewEligibleAt(createdAt, events, queuedAt) {
  if (!createdAt || !queuedAt) return null;
  const draftChanges = events.filter(({ __typename }) =>
    ["ReadyForReviewEvent", "ConvertToDraftEvent"].includes(__typename),
  );
  const queued = queuedAt > createdAt ? queuedAt : createdAt;
  let eligible =
    draftChanges[0]?.__typename === "ReadyForReviewEvent" ? null : queued;
  for (const event of draftChanges) {
    if (event.__typename === "ConvertToDraftEvent") {
      if (eligible && eligible < event.createdAt) return eligible;
      eligible = null;
    } else {
      eligible = event.createdAt > queued ? event.createdAt : queued;
    }
  }
  return eligible;
}

function githubPages(...args) {
  return JSON.parse(
    execFileSync("gh", ["api", ...args, "--paginate", "--slurp"], {
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
    }),
  );
}

function githubEligibility(pr, issue) {
  const query = `query ($owner: String!, $repo: String!, $number: Int!, $endCursor: String) {
    repository(owner: $owner, name: $repo) {
      pullRequest(number: $number) {
        createdAt
        timelineItems(first: 100, after: $endCursor, itemTypes: [LABELED_EVENT, READY_FOR_REVIEW_EVENT, CONVERT_TO_DRAFT_EVENT]) {
          pageInfo { hasNextPage endCursor }
          nodes {
            __typename
            ... on LabeledEvent { createdAt label { name } }
            ... on ReadyForReviewEvent { createdAt }
            ... on ConvertToDraftEvent { createdAt }
          }
        }
      }
    }
  }`;
  const pages = githubPages(
    "graphql",
    "-F",
    "owner={owner}",
    "-F",
    "repo={repo}",
    "-F",
    `number=${pr}`,
    "-f",
    `query=${query}`,
  );
  const pullRequests = pages.map(({ data }) => data.repository.pullRequest);
  const createdAt = pullRequests[0]?.createdAt;
  const events = pullRequests
    .flatMap(({ timelineItems }) => timelineItems.nodes)
    .filter(Boolean);
  let queuedAt = events.find(
    ({ label }) => label?.name === "agent:review",
  )?.createdAt;
  if (issue) {
    const issueEvents = githubPages(
      `repos/:owner/:repo/issues/${issue}/timeline`,
    ).flat();
    queuedAt =
      issueEvents.find(
        ({ event, label }) =>
          event === "labeled" &&
          ["agent:ready", "agent:implementing"].includes(label?.name),
      )?.created_at ?? createdAt;
  }
  return reviewEligibleAt(createdAt, events, queuedAt);
}

export function reviewerSession(
  records,
  { pr, previousHead, provider, model },
) {
  const run = records.findLast(
    (entry) =>
      entry.event === "run" &&
      entry.role === "reviewer" &&
      entry.mode === "review" &&
      entry.pr === pr &&
      entry.head === previousHead &&
      entry.provider === provider &&
      entry.configuredModel === model &&
      entry.exitCode === 0 &&
      sessionId.test(entry.session ?? ""),
  );
  return run?.session;
}

const count = (runs, field) => ({
  total: runs.reduce((sum, run) => sum + (run[field] ?? 0), 0),
  reported: runs.filter((run) => Number.isSafeInteger(run[field])).length,
});

function totals(runs) {
  return {
    runs: runs.length,
    elapsedSeconds: count(runs, "elapsedSeconds"),
    input: count(runs, "input"),
    cachedInput: count(runs, "cachedInput"),
    output: count(runs, "output"),
  };
}

export function usageReport(records) {
  const reviews = records.filter(
    (entry) =>
      entry.event === "run" &&
      ["review", "acceptance"].includes(entry.mode) &&
      entry.pr,
  );
  const byPr = new Map();
  for (const run of reviews) {
    if (!byPr.has(run.pr)) byPr.set(run.pr, []);
    byPr.get(run.pr).push(run);
  }
  const eligibleTimes = new Map();
  for (const entry of records) {
    if (entry.event !== "eligible") continue;
    const at = Date.parse(entry.at);
    if (Number.isFinite(at))
      eligibleTimes.set(
        entry.pr,
        Math.min(at, eligibleTimes.get(entry.pr) ?? Infinity),
      );
  }
  const byPR = {};
  for (const [pr, runs] of byPr) {
    const first = Math.min(
      ...runs.map(({ startedAt }) => Date.parse(startedAt)),
    );
    const accepted = records.findLast(
      (entry) => entry.event === "accepted" && entry.pr === pr,
    );
    const eligible = eligibleTimes.get(pr);
    const acceptedAt = Date.parse(accepted?.at);
    byPR[pr] = {
      ...totals(runs),
      secondsToFirstReview:
        first >= eligible ? (first - eligible) / 1000 : null,
      secondsToAcceptance:
        acceptedAt >= eligible ? (acceptedAt - eligible) / 1000 : null,
    };
  }
  const rereviews = reviews.filter(
    (run) =>
      run.role === "reviewer" &&
      run.previousHead &&
      run.previousHead !== run.head,
  );
  return {
    byPR,
    rereview: {
      fresh: totals(rereviews.filter((run) => !run.resumed)),
      resumed: totals(rereviews.filter((run) => run.resumed)),
    },
  };
}

function main([command, first, ...args], env) {
  if (command === "report") {
    if (!first)
      throw new Error(
        "Usage: usage.mjs report ENGINEER_FIRST_LOG [PARALLEL_LOG]",
      );
    console.log(
      JSON.stringify(
        {
          engineerFirst: usageReport(read(first)),
          ...(args[0] ? { parallel: usageReport(read(args[0])) } : {}),
        },
        null,
        2,
      ),
    );
    return;
  }
  const file = env.SPACORY_AGENT_USAGE_LOG;
  if (!file) return;
  if (command === "session") {
    const [previousHead, provider, model] = args;
    const id = reviewerSession(read(file), {
      pr: Number(first),
      previousHead,
      provider,
      model: model || null,
    });
    if (id) console.log(id);
  } else if (command === "track-eligible") {
    const pr = Number(first);
    if (!Number.isSafeInteger(pr) || pr <= 0)
      throw new Error("Expected a PR number");
    if (
      read(file).some((entry) => entry.event === "eligible" && entry.pr === pr)
    )
      return;
    const [issue] = args;
    if (issue !== undefined && !/^[1-9][0-9]*$/.test(issue))
      throw new Error("Expected a linked issue number");
    const at = githubEligibility(pr, issue);
    if (at) append(file, { event: "eligible", pr, at });
  } else if (command === "eligible") {
    const [at] = args;
    const pr = Number(first);
    if (!Number.isSafeInteger(pr) || pr <= 0)
      throw new Error("Expected a PR number");
    if (!Number.isFinite(Date.parse(at)))
      throw new Error("Expected an eligibility timestamp");
    append(file, { event: "eligible", pr, at });
  } else if (command === "accepted") {
    const [head, at = new Date().toISOString()] = args;
    append(file, { event: "accepted", pr: Number(first), head, at });
  } else if (command === "run") {
    const [model, role, mode, elapsed, exit] = args;
    const configuredModel = model || null;
    const elapsedSeconds = Number(elapsed);
    const raw = readFileSync(0, "utf8");
    const { message, ...data } = providerResult(first, raw, configuredModel);
    const ended = Date.now();
    if (message) console.log(message);
    else if (raw.trim() && !jsonLines(raw).length) process.stdout.write(raw);
    append(file, {
      event: "run",
      provider: first,
      configuredModel,
      role,
      mode,
      elapsedSeconds,
      startedAt: new Date(ended - elapsedSeconds * 1000).toISOString(),
      endedAt: new Date(ended).toISOString(),
      exitCode: Number(exit),
      pr: Number(env.SPACORY_AGENT_PR) || null,
      head: env.SPACORY_AGENT_HEAD || null,
      previousHead: env.SPACORY_AGENT_PREVIOUS_HEAD || null,
      resumed: Boolean(env.SPACORY_AGENT_RESUME_ID),
      ...data,
    });
  } else throw new Error("Unknown usage command");
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href
) {
  try {
    main(process.argv.slice(2), process.env);
  } catch (error) {
    console.error(`Agent usage: ${error.message}`);
    process.exitCode = 1;
  }
}
