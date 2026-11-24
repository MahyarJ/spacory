import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";

const prefix = "<!-- spacory-dispatch ";
const actions = new Set([
  "review",
  "acceptance",
  "resolve",
  "reconcile",
  "clarify",
  "conditional-clarify",
  "clarified",
]);
const stages = new Set([
  "agent:blocked",
  "agent:clarify",
  "agent:clarifying",
  "agent:conflict",
  "agent:reconciling",
  "agent:changes",
  "agent:resolving",
  "agent:review",
  "agent:reviewing",
  "agent:accepted",
]);
const sha = /^[0-9a-f]{40}$/;
const requestId = /^(?:comment|inline)-[0-9]+$/;
const maintainer = new Set(["OWNER", "MEMBER", "COLLABORATOR"]);

function gh(...args) {
  return execFileSync("gh", args, {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
}

function recordFrom(body) {
  if (!body.startsWith(prefix) || !body.endsWith(" -->")) return;
  try {
    const record = JSON.parse(body.slice(prefix.length, -4));
    if (
      actions.has(record.action) &&
      sha.test(record.head) &&
      Array.isArray(record.requests) &&
      record.requests.every((id) => requestId.test(id))
    )
      return record;
  } catch {
    // An incomplete marker is not a checkpoint.
  }
}

function verdictFrom(body) {
  const heading = body.split("\n", 1)[0];
  const role = /\*\*Engineer review\*\*/.test(heading)
    ? "review"
    : /\*\*Product acceptance\*\*/.test(heading)
      ? "acceptance"
      : null;
  if (!role) return;
  const head = body.match(/^\*\*Head:\*\* ([a-f0-9]{40})[ \t]*$/m)?.[1];
  const result = body
    .match(
      /^\*\*Verdict:\*\* (accepted pending non-code fix(?:es)?|approve pending non-code fix(?:es)?|changes requested|accepted|approve)(?=[ \t]*(?:[—–:-]|\.?[ \t]*$))/im,
    )?.[1]
    .toLowerCase();
  if (!head || !result) return;
  const clarify =
    body.match(/^\*\*Clarify:\*\* (engineer|product|both)[ \t]*$/m)?.[1] ??
    "both";
  return {
    role,
    head,
    clarify,
    verdict: result.includes("pending")
      ? "defer"
      : result === "changes requested"
        ? "changes"
        : "pass",
  };
}

function clarificationRequest(comment, inline, command) {
  if (!maintainer.has(comment.author_association)) return;
  if (command) return command[1] ?? "both";
  const body = comment.body ?? "";
  // Inline replies and agent runs use the same GitHub account as a maintainer.
  // Inline requests use an explicit command; ordinary PR comments use the label.
  if (inline || body.startsWith(prefix) || !body.trim()) return;
  if (/^\s*\S*\s*\*\*(?:Engineer|Product)\b/.test(body)) return;
  return "both";
}

export function prState(
  pr,
  comments,
  inlineComments,
  actor,
  labelHistory = [],
) {
  const result = {};
  const started = {};
  const handled = new Set();
  let previous;
  let lastProgress = "";
  let lastChanges;
  let clarifyReplies = new Set();
  for (const comment of comments) {
    if (String(comment.user?.id) !== actor) continue;
    const record = recordFrom(comment.body ?? "");
    if (record) {
      const action =
        record.action === "conditional-clarify" ? "clarify" : record.action;
      started[action] = record;
      delete result[action];
      if (action === "review") {
        delete result.acceptance;
        delete started.acceptance;
      }
      if (action === "clarify") clarifyReplies = new Set();
      if (action === "clarified") {
        for (const id of record.requests) handled.add(id);
        previous = undefined;
        lastChanges = undefined;
        delete result.review;
        delete result.acceptance;
        delete started.review;
        delete started.acceptance;
        delete started.clarify;
      }
      if (action !== "clarify") lastProgress = comment.created_at;
      continue;
    }
    if (started.clarify) {
      const reply = (comment.body ?? "")
        .split("\n", 1)[0]
        .match(/\*\*(Engineer|Product) clarification\*\*/)?.[1];
      if (reply) clarifyReplies.add(reply.toLowerCase());
    }
    const verdict = verdictFrom(comment.body ?? "");
    if (!verdict || started[verdict.role]?.head !== verdict.head) continue;
    result[verdict.role] = { ...verdict, id: comment.id };
    if (verdict.verdict === "changes") lastChanges = verdict;
    if (verdict.role === "review") previous = result.review;
  }
  const requests = [];
  const roles = new Set();
  const matching = (role) =>
    result[role]?.head === pr.headRefOid ? result[role] : undefined;
  const engineer = matching("review");
  const product = matching("acceptance");
  const deferred = [engineer, product].find(
    (review) => review?.verdict === "defer",
  );
  if (deferred) {
    roles.add(deferred.clarify);
    requests.push(`comment-${deferred.id}`);
  } else {
    for (const [list, kind] of [
      [comments, "comment"],
      [inlineComments, "inline"],
    ]) {
      for (const comment of list) {
        const id = `${kind}-${comment.id}`;
        if (handled.has(id)) continue;
        const command = (comment.body ?? "").match(
          /^\/agent clarify(?:[ \t]+(engineer|product|both))?[ \t]*$/m,
        );
        if (
          !command &&
          comment.created_at < lastProgress &&
          !started.clarify?.requests.includes(id)
        )
          continue;
        const role = clarificationRequest(comment, kind === "inline", command);
        if (!role) continue;
        requests.push(id);
        roles.add(role);
      }
    }
  }
  const labels = pipelineLabels(pr);
  // Outgoing and incoming labels can coexist if a process died during a swap.
  // Use the most recently applied active label to recover the intended stage.
  const active = labels.includes("agent:blocked")
    ? "agent:blocked"
    : (labelHistory.findLast(
        (entry) =>
          entry.event === "labeled" && labels.includes(entry.label?.name),
      )?.label.name ?? labels[0]);
  const stage = active?.slice(6) ?? "";
  return {
    stage,
    head: pr.headRefOid,
    base: pr.baseRefOid,
    eligible: pr.state === "OPEN" && !pr.isDraft && !pr.isCrossRepository,
    engineer: engineer?.verdict ?? "none",
    product: product?.verdict ?? "none",
    engineerId: engineer?.id ?? "",
    previousHead: previous?.head ?? "",
    previousId: previous?.id ?? "",
    changeHead: lastChanges?.head ?? "",
    resolveHead: started.resolve?.head ?? "",
    reconcileHead: started.reconcile?.head ?? "",
    clarifyRole: roles.size > 1 ? "both" : ([...roles][0] ?? ""),
    requests: [...new Set(requests)].join(","),
    clarifyDone: Boolean(started.clarified && !started.clarify),
    activeClarification: started.clarify?.requests.join(",") ?? "",
    clarifyReplies: [...clarifyReplies].join(","),
    extraLabels: labels.filter((label) => label !== active).join(","),
    conditionalClarifyHead:
      started.clarify?.action === "conditional-clarify"
        ? started.clarify.head
        : "",
  };
}

function pipelineLabels(pr) {
  return pr.labels.map(({ name }) => name).filter((name) => stages.has(name));
}

function paginated(endpoint) {
  return JSON.parse(gh("api", endpoint, "--paginate", "--slurp")).flat();
}

function main([command, number, action, head, requests = ""]) {
  if (!/^[1-9][0-9]*$/.test(number)) throw new Error("Invalid GitHub number");
  if (command === "record") {
    const ids = requests ? requests.split(",") : [];
    if (
      !actions.has(action) ||
      !sha.test(head) ||
      !ids.every((id) => requestId.test(id))
    ) {
      throw new Error("Invalid dispatcher checkpoint");
    }
    gh(
      "pr",
      "comment",
      number,
      "--body",
      `${prefix}${JSON.stringify({ action, head, requests: ids })} -->`,
    );
    return;
  }
  if (command !== "read") throw new Error("Expected read or record");
  const pr = JSON.parse(
    gh(
      "pr",
      "view",
      number,
      "--json",
      "state,isDraft,isCrossRepository,labels,headRefOid,baseRefOid",
    ),
  );
  if (!sha.test(pr.headRefOid) || !sha.test(pr.baseRefOid))
    throw new Error("Missing PR head or base SHA");
  const active = pr.state === "OPEN" && !pr.isDraft && !pr.isCrossRepository;
  const actor = active ? gh("api", "user", "--jq", ".id").trim() : "";
  const comments = active
    ? paginated(`repos/:owner/:repo/issues/${number}/comments`)
    : [];
  const inline =
    active &&
    pr.labels.some(({ name }) =>
      ["agent:clarify", "agent:clarifying"].includes(name),
    )
      ? paginated(`repos/:owner/:repo/pulls/${number}/comments`)
      : [];
  const labelHistory =
    active && pipelineLabels(pr).length > 1
      ? paginated(`repos/:owner/:repo/issues/${number}/timeline`)
      : [];
  console.log(
    Object.values(prState(pr, comments, inline, actor, labelHistory)).join("|"),
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href
) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(`GitHub PR state: ${error.message}`);
    process.exitCode = 1;
  }
}
