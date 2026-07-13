#!/usr/bin/env bash
#
# Spacory agent dispatcher — a STATELESS, IDEMPOTENT orchestrator for the
# Product/Engineer agent loop. The ticket state machine lives entirely in GitHub
# (issue/PR state + `agent:*` labels); this script derives what to do from that
# state and fires the matching headless agent run. It keeps no memory of its own.
#
# Run it on a timer (launchd — see .agents/launchd/) or by hand. Each invocation
# does AT MOST ONE pipeline action (highest priority first), so a short tick can
# never stampede a stack of expensive agent runs. A flock guarantees overlapping
# ticks don't pile up; `agent:*` in-flight labels make double-firing visible and
# survive restarts.
#
#   The label state machine (this script owns every transition):
#
#     issue  agent:triage      ── triage ──▶  enriched backlog issue | closed (rejected)
#     issue  agent:ready        ── implement ──▶  PR agent:review
#     PR     agent:review        ── review + acceptance ──▶  agent:changes | agent:accepted
#     PR     agent:changes       ── resolve  ──▶  PR agent:review   (loops, capped)
#     issue/PR agent:clarify      ── clarify  ──▶  spec refined; PR→agent:review, issue→backlog
#     PR     agent:accepted      ── human merges (or SPACORY_AUTOMERGE=1 + CI green)
#     *      agent:blocked       ── needs a human; never touched again automatically
#
#   agent:triage is the human intake front door: open a rough idea issue, label it
#   agent:triage, and the Product Agent grooms it (accept+enrich, or reject+close).
#   An accepted idea lands in the backlog like a cycle-created issue; promoting it
#   to agent:ready stays a human decision.
#
#   agent:clarify is the mid-flight refinement door: label an issue OR a PR
#   agent:clarify when you've left a question/comment that should reshape the spec
#   (the "daily-scrum" case — raise it on the PR where the confusion lives). The
#   Product Agent answers and folds any decision back into the *issue* body, then
#   a PR is sent back to agent:review to be re-judged against the updated spec.
#   Because editing the issue body resets the review-round budget (see
#   review_rounds), legitimate spec growth no longer burns the loop guard.
#
#   Priority per tick (drain PRs before pulling new work):
#     1. agent:changes   PR       → resolve
#     2. agent:clarify   issue/PR → clarify (answer + refine spec), then transition
#     3. agent:review    PR       → review + acceptance (in parallel), then transition
#     4. agent:triage    issue    → triage (groom an idea), then transition
#     5. agent:ready     issue (no open PR) → implement
#   The product `cycle` (issue creation) is NOT run here — schedule it separately
#   (see .agents/launchd/com.spacory.agents.cycle.plist.template). Keeping ticket
#   *creation* on its own slow cadence stops a runaway cycle from flooding the
#   implement queue.
#
# Usage:
#   .agents/dispatch.sh            # do one pipeline action, then exit (the timer path)
#   .agents/dispatch.sh setup      # create the agent:* labels (idempotent), then exit
#   .agents/dispatch.sh status     # print the current pipeline, change nothing
#   .agents/dispatch.sh cycle      # run one product cycle now (for the cycle timer)
#
# Env knobs:
#   SPACORY_MAX_ROUNDS    resolve↔review rounds before giving up → blocked (default 5).
#                         Counted only SINCE the linked issue's body was last
#                         edited, so a human amending the spec (directly or via an
#                         agent:clarify run) resets the budget — the cap trips on
#                         genuine agent-vs-agent non-convergence, not on legitimate
#                         spec growth (see review_rounds / spec_reset_time).
#   SPACORY_AUTOMERGE     "1" to `gh pr merge --squash` an accepted PR once CI is
#                         green. Default off — the agents never self-merge, and this
#                         is infrastructure the human explicitly opted into, not an
#                         agent approving its own work.
#   CLAUDE_PERMISSION_MODE passed through to the run-*.sh scripts (default there is
#                         acceptEdits; use bypassPermissions for fully unattended if
#                         a needed command isn't allowlisted).
#   CLAUDE_MODEL          passed through to the run-*.sh scripts.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

MAX_ROUNDS="${SPACORY_MAX_ROUNDS:-5}"
AUTOMERGE="${SPACORY_AUTOMERGE:-0}"

# ── logging ────────────────────────────────────────────────────────────────
log()  { printf '%s  %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }
die()  { log "ERROR: $*"; exit 1; }

notify() {
  # Best-effort Telegram wrap-up; never fails the run.
  "$SCRIPT_DIR/notify.sh" "$1" >/dev/null 2>&1 || true
}

command -v gh >/dev/null 2>&1 || die "'gh' CLI not found on PATH"
gh auth status >/dev/null 2>&1 || die "gh is not authenticated (run: gh auth login)"

# ── labels ────────────────────────────────────────────────────────────────
# Description + colour for each state. `gh label create` is idempotent via
# `--force` (updates if it exists).
ensure_labels() {
  local -a specs=(
    "agent:triage|d4c5f9|Human-submitted idea awaiting Product triage"
    "agent:triaging|fbca04|Product Agent is triaging this idea"
    "agent:ready|0e8a16|Issue is ready for the Engineer Agent to implement"
    "agent:implementing|fbca04|Engineer Agent is implementing this issue"
    "agent:review|1d76db|PR awaiting Engineer review + Product acceptance"
    "agent:reviewing|c5def5|Review + acceptance in flight"
    "agent:changes|d93f0b|Changes requested — awaiting Engineer resolve"
    "agent:resolving|fbca04|Engineer Agent is resolving review comments"
    "agent:clarify|c2e0c6|A human question/comment should reshape the spec — awaiting Product clarify"
    "agent:clarifying|fbca04|Product Agent is clarifying and refining the spec"
    "agent:accepted|0e8a16|Passed review + acceptance — awaiting human merge"
    "agent:blocked|b60205|Needs a human; the dispatcher will not touch it"
  )
  local spec name colour desc
  for spec in "${specs[@]}"; do
    IFS='|' read -r name colour desc <<<"$spec"
    gh label create "$name" --color "$colour" --description "$desc" --force >/dev/null
  done
  log "Ensured agent:* labels exist."
}

# add/remove a label on an issue-or-PR number (both use `gh issue edit` since PRs
# are issues to the labels API, but `gh pr edit` is clearer for PRs).
add_label()    { gh "$1" edit "$2" --add-label "$3"    >/dev/null; }   # $1=issue|pr
remove_label() { gh "$1" edit "$2" --remove-label "$3" >/dev/null 2>&1 || true; }

# swap: remove $3, add $4 on $1(issue|pr) #$2
swap_label() { remove_label "$1" "$2" "$3"; add_label "$1" "$2" "$4"; }

block() {  # $1=issue|pr $2=number $3=reason
  local kind="$1" num="$2" reason="$3"
  # strip any in-flight/queue labels, mark blocked.
  for l in agent:triage agent:triaging agent:ready agent:implementing agent:review agent:reviewing agent:changes agent:resolving agent:clarify agent:clarifying; do
    remove_label "$kind" "$num" "$l"
  done
  add_label "$kind" "$num" "agent:blocked"
  log "BLOCKED $kind #$num — $reason"
  notify "🚧 Spacory agents: $kind #$num blocked — $reason. Needs a human."
}

# ── verdict parsing ─────────────────────────────────────────────────────────
# The agents post plain PR comments with a recognizable header + a Verdict line.
# We read the NEWEST such comment created AFTER the PR's head commit (so a stale
# approval from before the latest `resolve` push is never counted). ISO-8601 "Z"
# timestamps compare correctly as strings.
pr_head_date() {
  gh pr view "$1" --json commits --jq '.commits[-1].committedDate // ""'
}

# newest comment body (newlines flattened) matching a header, created after $2.
latest_comment() {  # $1=pr $2=after-iso $3=header-substring
  gh pr view "$1" --json comments \
    --jq ".comments[] | select(.createdAt > \"$2\") | [.createdAt, (.body|gsub(\"[\\n\\r]\";\" \"))] | @tsv" 2>/dev/null \
    | grep -F "$3" | tail -1 | cut -f2- || true
}

# classify a verdict comment body → pass | changes | none
verdict_of() {  # $1=body
  local body_lc; body_lc="$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]')"
  [ -z "$body_lc" ] && { echo none; return; }
  case "$body_lc" in
    *"changes requested"*) echo changes ;;
    *approve*|*accepted*)  echo pass ;;
    *) echo none ;;
  esac
}

# newest ISSUE comment body (newlines flattened) matching a header substring.
# Triage runs on a fresh issue, so no "after head commit" filter is needed —
# the newest matching comment is this run's verdict.
latest_issue_comment() {  # $1=issue $2=header-substring
  gh issue view "$1" --json comments \
    --jq '.comments[] | (.body|gsub("[\n\r]";" "))' 2>/dev/null \
    | grep -F "$2" | tail -1 || true
}

# classify a Product triage verdict body → accepted | rejected | needs | none.
# Order matters: reject wins over accept if both words somehow appear.
triage_verdict_of() {  # $1=body
  local lc; lc="$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]')"
  [ -z "$lc" ] && { echo none; return; }
  case "$lc" in
    *reject*)                                            echo rejected ;;
    *accept*|*enrich*)                                   echo accepted ;;
    *"needs input"*|*"needs info"*|*question*|*clarif*)  echo needs ;;
    *) echo none ;;
  esac
}

# the issue number a PR closes (from its "Closes/Fixes/Resolves #N" body), or "".
issue_for_pr() {  # $1=pr
  gh pr view "$1" --json body \
    --jq '(.body // "") | capture("(?i)(clos|fix|resolv)e[sd]? +#(?<n>[0-9]+)") | .n' \
    2>/dev/null || true
}

# ISO time the linked issue's body was last edited, or "" (never edited / no
# linked issue / lookup failed). This is the "spec changed" signal that resets
# the review-round budget: both a human editing the issue and an agent:clarify
# run edit the body, so legitimate spec growth doesn't count as non-convergence.
# "" sorts before every ISO timestamp, so a missing value safely counts ALL
# rounds (today's behaviour) rather than zeroing the guard.
spec_reset_time() {  # $1=pr
  local issue; issue="$(issue_for_pr "$1")"
  [ -z "$issue" ] && { echo ""; return; }
  local nwo owner name
  nwo="$(gh repo view --json nameWithOwner -q .nameWithOwner 2>/dev/null)" || { echo ""; return; }
  owner="${nwo%%/*}"; name="${nwo##*/}"
  gh api graphql -f query="query{repository(owner:\"$owner\",name:\"$name\"){issue(number:$issue){lastEditedAt}}}" \
    --jq '.data.repository.issue.lastEditedAt // ""' 2>/dev/null || echo ""
}

# count Engineer-review rounds this PR has seen SINCE the spec last changed (loop
# guard). Only reviews posted after the linked issue's last body edit count, so a
# human amending the spec mid-PR (directly or via agent:clarify) resets the clock
# — the cap trips on genuine agent-vs-agent stalling, not on evolving requirements.
review_rounds() {  # $1=pr
  local since; since="$(spec_reset_time "$1")"
  gh pr view "$1" --json comments \
    --jq "[.comments[] | select(.createdAt > \"$since\") | select(.body | test(\"Engineer review\"))] | length"
}

ci_green() {  # $1=pr → 0 if all required checks passed (or none exist)
  local state
  state="$(gh pr view "$1" --json statusCheckRollup \
    --jq '[.statusCheckRollup[]? | select(.__typename=="CheckRun" or .__typename=="StatusContext")]
          | (if length==0 then "NONE"
             elif any(.conclusion=="FAILURE" or .conclusion=="CANCELLED" or .conclusion=="TIMED_OUT" or .state=="FAILURE" or .state=="ERROR") then "FAIL"
             elif all((.conclusion // .state) as $c | ($c=="SUCCESS" or $c=="NEUTRAL" or $c=="SKIPPED")) then "PASS"
             else "PENDING" end)' 2>/dev/null)"
  [ "$state" = "PASS" ] || [ "$state" = "NONE" ]
}

# find an open PR that closes issue #N (matches the engineer's "Closes #N" body,
# or a branch name ending in the issue number).
pr_for_issue() {  # $1=issue number
  gh pr list --state open --json number,body,headRefName \
    --jq ".[] | select(((.body // \"\") | test(\"(?i)(clos|fix|resolv)e[sd]? +#$1\\\\b\"))
                        or ((.headRefName // \"\") | test(\"[^0-9]$1$|^$1$\"))) | .number" \
    | head -1
}

# ── agent runners (headless) ─────────────────────────────────────────────────
run_engineer() { "$SCRIPT_DIR/run-engineer.sh" "$@"; }
run_product()  { "$SCRIPT_DIR/run-product.sh"  "$@"; }

# Safety net: project-memory.md is the Product Agent's shared memory and belongs on
# main (the Engineer never reads it). The agent is supposed to commit+push it itself
# (see the product-agent skill), but if a run left it dirty, land it on main here so
# it isn't swept into a feature branch or lost. Deterministic, best-effort, never
# fails the tick. Only ever touches project-memory.md.
commit_memory() {
  git diff --quiet -- project-memory.md \
    && git diff --cached --quiet -- project-memory.md && return 0
  log "project-memory.md left dirty by the product run; auto-committing it to main."
  local branch; branch="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo main)"
  if [ "$branch" != "main" ]; then
    # the file is branch-invariant (only the Product Agent edits it), so switching
    # carries the single-file change onto main without conflict.
    git switch main >/dev/null 2>&1 || { log "  couldn't switch to main; leaving memory dirty"; return 0; }
  fi
  git add project-memory.md
  git commit -m "Update project memory (dispatcher auto-commit)" >/dev/null 2>&1 \
    || { log "  nothing to commit after all"; [ "$branch" != main ] && git switch "$branch" >/dev/null 2>&1 || true; return 0; }
  git push origin main >/dev/null 2>&1 || log "  push to main failed; committed locally."
  [ "$branch" != "main" ] && git switch "$branch" >/dev/null 2>&1 || true
  log "✓ project-memory.md committed to main."
}

# ── pipeline actions ─────────────────────────────────────────────────────────
list_issues() { gh issue list --state open --label "$1" --json number --jq '.[].number'; }
list_prs()    { gh pr    list --state open --label "$1" --json number --jq '.[].number'; }

do_resolve() {  # $1=pr
  local pr="$1" rounds; rounds="$(review_rounds "$pr")"
  if [ "${rounds:-0}" -ge "$MAX_ROUNDS" ]; then
    block pr "$pr" "hit SPACORY_MAX_ROUNDS ($MAX_ROUNDS) review rounds without converging"
    return
  fi
  log "→ resolve PR #$pr (round $((rounds+1))/$MAX_ROUNDS)"
  swap_label pr "$pr" agent:changes agent:resolving
  if run_engineer resolve "$pr"; then
    swap_label pr "$pr" agent:resolving agent:review
    log "✓ resolved PR #$pr → agent:review"
  else
    block pr "$pr" "engineer resolve run failed"
  fi
}

do_review() {  # $1=pr — review + acceptance in parallel, then transition on verdicts
  local pr="$1"
  log "→ review + acceptance PR #$pr"
  swap_label pr "$pr" agent:review agent:reviewing
  local head_date; head_date="$(pr_head_date "$pr")"

  local rc_e=0 rc_p=0
  run_engineer review "$pr" & local pid_e=$!
  run_product  acceptance "$pr" & local pid_p=$!
  wait "$pid_e" || rc_e=$?
  wait "$pid_p" || rc_p=$?
  if [ "$rc_e" -ne 0 ] || [ "$rc_p" -ne 0 ]; then
    block pr "$pr" "review/acceptance run failed (engineer=$rc_e product=$rc_p)"
    return
  fi

  local eng prod
  eng="$(verdict_of "$(latest_comment "$pr" "$head_date" "Engineer review")")"
  prod="$(verdict_of "$(latest_comment "$pr" "$head_date" "Product acceptance")")"
  log "  verdicts: engineer=$eng product=$prod"

  if [ "$eng" = none ] || [ "$prod" = none ]; then
    block pr "$pr" "could not parse a verdict (engineer=$eng product=$prod) — check the PR comments"
  elif [ "$eng" = changes ] || [ "$prod" = changes ]; then
    swap_label pr "$pr" agent:reviewing agent:changes
    log "✓ PR #$pr → agent:changes"
    notify "🔁 Spacory agents: PR #$pr needs changes (engineer=$eng product=$prod)."
  else
    swap_label pr "$pr" agent:reviewing agent:accepted
    log "✓ PR #$pr → agent:accepted"
    maybe_merge "$pr"
  fi
}

maybe_merge() {  # $1=pr — only if the human opted in AND CI is green
  local pr="$1"
  if [ "$AUTOMERGE" != "1" ]; then
    notify "✅ Spacory agents: PR #$pr accepted — ready for you to merge."
    return
  fi
  if ci_green "$pr"; then
    log "→ automerge PR #$pr (SPACORY_AUTOMERGE=1, CI green)"
    if gh pr merge "$pr" --squash --delete-branch >/dev/null 2>&1; then
      log "✓ merged PR #$pr"
      notify "🎉 Spacory agents: PR #$pr merged (accepted + CI green)."
    else
      notify "⚠️ Spacory agents: PR #$pr accepted but automerge failed — merge it by hand."
    fi
  else
    log "  PR #$pr accepted but CI not green yet; leaving for a later tick."
  fi
}

do_triage() {  # $1=issue — a human-submitted idea; groom it or reject it
  local issue="$1"
  log "→ triage issue #$issue"
  swap_label issue "$issue" agent:triage agent:triaging
  if ! run_product triage "$issue"; then
    block issue "$issue" "product triage run failed"
    return
  fi
  commit_memory   # triage may record the decision in project-memory.md
  local verdict
  verdict="$(triage_verdict_of "$(latest_issue_comment "$issue" "Product triage")")"
  log "  triage verdict: $verdict"
  case "$verdict" in
    accepted)
      # the agent rewrote the issue into a spec. Clear the in-flight label so it lands
      # in the backlog like a cycle-created issue — a groomed issue awaiting a human's
      # agent:ready.
      remove_label issue "$issue" agent:triaging
      log "✓ issue #$issue enriched (awaiting a human agent:ready)"
      notify "🧭 Spacory agents: idea #$issue groomed & enriched — review it and label agent:ready to build." ;;
    rejected)
      # the agent already commented the rationale and closed the issue.
      remove_label issue "$issue" agent:triaging
      log "✓ issue #$issue rejected & closed in triage"
      notify "🧭 Spacory agents: idea #$issue rejected in triage (closed, with rationale)." ;;
    needs)
      block issue "$issue" "triage needs a human product decision (the agent asked a question)" ;;
    *)
      block issue "$issue" "could not parse a triage verdict — check issue #$issue's comments" ;;
  esac
}

do_clarify() {  # $1=issue|pr $2=number — answer a human question, refine the spec
  local kind="$1" num="$2"
  log "→ clarify $kind #$num"
  swap_label "$kind" "$num" agent:clarify agent:clarifying
  if ! run_product clarify "$num"; then
    block "$kind" "$num" "product clarify run failed"
    return
  fi
  commit_memory   # clarify may record a decision in project-memory.md
  if [ "$kind" = pr ]; then
    # The spec may have moved; re-judge the PR against it. Editing the issue body
    # (which clarify does when a decision changes the spec) resets the round
    # budget, so this fresh review round doesn't count as non-convergence.
    swap_label pr "$num" agent:clarifying agent:review
    log "✓ clarified PR #$num → agent:review (re-evaluate against the updated spec)"
    notify "💬 Spacory agents: clarified PR #$num — re-reviewing against the updated spec."
  else
    # An issue: it's refined and back in the backlog; promoting to agent:ready
    # stays a human decision (same as a triage-accepted issue).
    remove_label issue "$num" agent:clarifying
    log "✓ clarified issue #$num (spec refined; awaiting a human next step)"
    notify "💬 Spacory agents: clarified issue #$num (spec refined if the answer changed it)."
  fi
}

do_implement() {  # $1=issue
  local issue="$1"
  log "→ implement issue #$issue"
  swap_label issue "$issue" agent:ready agent:implementing
  if ! run_engineer implement "$issue"; then
    block issue "$issue" "engineer implement run failed"
    return
  fi
  local pr; pr="$(pr_for_issue "$issue")"
  if [ -z "$pr" ]; then
    block issue "$issue" "implement finished but no PR closing #$issue was found (did the agent ask a question instead?)"
    return
  fi
  remove_label issue "$issue" agent:implementing
  add_label pr "$pr" agent:review
  log "✓ implemented issue #$issue → PR #$pr (agent:review)"
}

# ── the tick: one action, highest priority first ────────────────────────────
dispatch_once() {
  local n
  for n in $(list_prs "agent:changes"); do do_resolve "$n"; return; done
  # Human questions/refinements come next — answer them before more review or
  # implement churn. agent:clarify can sit on either an issue or a PR.
  for n in $(list_prs    "agent:clarify"); do do_clarify pr    "$n"; return; done
  for n in $(list_issues "agent:clarify"); do do_clarify issue "$n"; return; done
  for n in $(list_prs "agent:review");  do do_review  "$n"; return; done
  for n in $(list_issues "agent:triage"); do do_triage "$n"; return; done
  for n in $(list_issues "agent:ready"); do
    # skip if a PR already exists for it (belt-and-suspenders)
    [ -n "$(pr_for_issue "$n")" ] && { log "issue #$n already has a PR; skipping"; continue; }
    do_implement "$n"; return
  done
  # any accepted PRs still waiting? nudge automerge (no-op if AUTOMERGE off).
  for n in $(list_prs "agent:accepted"); do maybe_merge "$n"; done
  log "Nothing to do."
}

print_status() {
  echo "Spacory agent pipeline ($(gh repo view --json nameWithOwner -q .nameWithOwner)):"
  local l
  for l in agent:triage agent:triaging agent:ready agent:implementing agent:review agent:reviewing agent:changes agent:resolving agent:clarify agent:clarifying agent:accepted agent:blocked; do
    printf '  %-20s' "$l"
    gh issue list --state open --label "$l" --json number --jq '[.[].number] | map("#\(.)") | join(" ")' 2>/dev/null | tr -d '\n'
    printf ' | '
    gh pr list --state open --label "$l" --json number --jq '[.[].number] | map("#\(.)") | join(" ")' 2>/dev/null
  done
}

# ── entrypoint (lock-guarded so overlapping ticks skip) ──────────────────────
main() {
  case "${1:-tick}" in
    setup)  ensure_labels; exit 0 ;;
    status) print_status;  exit 0 ;;
    cycle)
      log "→ product cycle"
      if run_product; then log "✓ product cycle complete"; else notify "⚠️ Spacory agents: product cycle failed."; fi
      commit_memory
      exit 0 ;;
    tick)   dispatch_once ;;
    *)      die "unknown command: $1 (use: setup | status | cycle | tick)" ;;
  esac
}

# A mkdir-based lock: portable (macOS has no `flock`) and atomic. A stale lock
# older than 2h is reclaimed so a crashed tick can't wedge the loop forever.
LOCK="${TMPDIR:-/tmp}/spacory-dispatch.lock.d"
if [ -d "$LOCK" ] && [ -n "$(find "$LOCK" -maxdepth 0 -mmin +120 2>/dev/null)" ]; then
  log "Reclaiming stale lock (>2h old)."
  rmdir "$LOCK" 2>/dev/null || true
fi
if ! mkdir "$LOCK" 2>/dev/null; then
  log "Another dispatch is still running; skipping this tick."
  exit 0
fi
trap 'rmdir "$LOCK" 2>/dev/null || true' EXIT

main "$@"
