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
# survive restarts. BOTH agent runs (engineer, which creates branches and edits
# files; and product, which edits project-memory.md and may switch branches) execute
# in a throwaway git worktree, never the primary checkout — so a concurrent
# manual/interactive run in the primary tree can't have its HEAD or working files
# yanked out mid-run (see run-engineer.sh / run-product.sh, which self-isolate).
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
#   agent:clarify when you've left a question/comment (the "daily-scrum" case — raise
#   it on the PR where the confusion lives). On an ISSUE, the Product Agent answers
#   and folds any decision into the issue body. On a PR, BOTH agents run in parallel
#   (like review+acceptance): Product handles product/scope questions + the issue
#   body, and Engineer handles technical questions + the PR's own metadata (title /
#   description) via `gh pr edit` — the artifact Product won't touch and `resolve`
#   won't (non-code). The PR then returns to agent:review to be re-judged against the
#   updated spec. Because editing the issue body resets the review-round budget (see
#   review_rounds), legitimate spec growth no longer burns the loop guard.
#
#   Priority per tick (drain PRs before pulling new work):
#     1. agent:changes   PR       → resolve
#     2. agent:clarify   issue/PR → clarify (issue: Product; PR: Product + Engineer), then transition
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
#                         Counted only SINCE the budget last reset, on either of two
#                         principled signals: a FRESH ATTEMPT (the PR re-entered the
#                         review loop from outside — a reopen from accepted/blocked, a
#                         clarify, a rebase-relabel, the first implement) or a SPEC
#                         EDIT (the linked issue body changed). So a converged PR
#                         reopened for one more change, and evolving requirements, both
#                         start fresh — the cap trips on genuine agent-vs-agent
#                         non-convergence within a single attempt (see review_rounds /
#                         budget_reset_time / loop_entry_time).
#   SPACORY_AUTOMERGE     "1" to `gh pr merge --squash` an accepted PR once CI is
#                         green. Default off — the agents never self-merge, and this
#                         is infrastructure the human explicitly opted into, not an
#                         agent approving its own work.
#   CLAUDE_PERMISSION_MODE passed through to the run-*.sh scripts (default there is
#                         acceptEdits; use bypassPermissions for fully unattended if
#                         a needed command isn't allowlisted).
#   CLAUDE_MODEL          passed through to the run-*.sh scripts.
#   SPACORY_AGENT_RETRIES how many EXTRA attempts to give an agent run that exits
#                         non-zero before blocking (default 1 → 2 attempts total).
#                         A non-zero exit is always an infrastructure fault — a
#                         stalled API stream, a killed process, a crash — never a
#                         "changes requested" verdict (those come back as a parsed
#                         PR comment on a clean exit), so retrying can only re-attempt
#                         a transient fault, never mask a real rejection. Set 0 to
#                         disable and block on the first failure (the old behaviour).
#   SPACORY_AGENT_RETRY_BACKOFF_SECS
#                         seconds to wait between those attempts (default 20).
#   SPACORY_CYCLE_LOCK_WAIT_SECS
#                         how long a once-a-day `cycle` waits for the shared lock
#                         before forfeiting its slot (default 1800 = 30m). A `tick`
#                         never waits — it fires every ~10 min, so it just skips.
#   SPACORY_INFLIGHT_STALE_MINS
#                         how old (minutes) a leaked per-run git *worktree* must be
#                         before a tick force-removes it (default 120 = 2h). Must
#                         clearly exceed a healthy engineer run so a live *manual*
#                         run-engineer.sh worktree (which doesn't hold the dispatch
#                         lock) is never yanked. NOTE: orphaned in-flight *labels* are
#                         no longer governed by a timeout — holding the lock proves no
#                         run is active, so they're reclaimed immediately (see
#                         reclaim_orphaned_inflight).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

# Load config from the gitignored .agents/.env (CLAUDE_MODEL, CLAUDE_PERMISSION_MODE,
# Telegram creds, …) and export it so the run-*.sh children inherit it. launchd
# starts with a bare environment, so without this the pass-through vars are unset.
if [ -f "$SCRIPT_DIR/.env" ]; then
  set -a
  . "$SCRIPT_DIR/.env"
  set +a
fi

MAX_ROUNDS="${SPACORY_MAX_ROUNDS:-5}"
AUTOMERGE="${SPACORY_AUTOMERGE:-0}"
INFLIGHT_STALE_MINS="${SPACORY_INFLIGHT_STALE_MINS:-120}"
AGENT_RETRIES="${SPACORY_AGENT_RETRIES:-1}"
AGENT_RETRY_BACKOFF_SECS="${SPACORY_AGENT_RETRY_BACKOFF_SECS:-20}"

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
    "agent:clarify|c2e0c6|A human question/comment to answer — awaiting clarify (Product for an issue; Product + Engineer for a PR)"
    "agent:clarifying|fbca04|Clarify in flight (Product; also Engineer on a PR)"
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

# The resolve↔review "loop" labels — the ping-pong the round cap guards. Every other
# agent:* state (accepted, blocked, clarify/clarifying, ready/implementing, triage…)
# is OUTSIDE the loop: leaving for one and coming back is a NEW attempt.
AGENT_LOOP_LABELS='agent:review agent:reviewing agent:changes agent:resolving'

# ISO time the PR most recently (re)ENTERED the review loop from OUTSIDE it — the
# "fresh attempt" signal. A `→ loop` label transition whose previous agent state was
# a non-loop state (or none) counts: first implement (agent:review with no prior
# agent label), a reopen from agent:accepted or agent:blocked, and a clarify round
# (…→agent:clarifying→agent:review) all reset the clock; a within-loop resolve→review
# does NOT. Read purely off the label timeline, which the dispatcher owns — so unlike
# comment authorship there's no human-vs-agent ambiguity. Streams every agent:*
# `labeled` event in chronological order (--paginate preserves order across pages)
# and lets awk carry the prev-state across pages, since a jq reduce would reset its
# accumulator per page and misfire.
loop_entry_time() {  # $1=pr
  gh api "repos/:owner/:repo/issues/$1/timeline" --paginate \
    --jq '.[] | select(.event=="labeled" and (.label.name|startswith("agent:"))) | [.created_at, .label.name] | @tsv' \
    2>/dev/null \
  | awk -F'\t' -v loops="$AGENT_LOOP_LABELS" '
      BEGIN { n=split(loops, a, " "); for (i=1;i<=n;i++) loop[a[i]]=1 }
      { if (($2 in loop) && (prev=="" || !(prev in loop))) reset=$1; prev=$2 }
      END { print reset }' \
  || echo ""
}

# ISO time the review-round budget was last reset — the LATER of two principled
# "clean slate" signals (not a growing special-case list):
#   (a) a FRESH ATTEMPT began — the PR re-entered the review loop from outside it
#       (see loop_entry_time): a reopen from accepted/blocked, a clarify round, a
#       rebase-then-relabel, or the first implement.
#   (b) the SPEC MOVED — the linked issue's body was last edited (a human, directly
#       or via agent:clarify); legitimate spec growth isn't non-convergence.
# "" (no signal at all) sorts before every ISO timestamp, so a missing value safely
# counts ALL rounds rather than zeroing the guard.
budget_reset_time() {  # $1=pr
  local edited="" entry=""
  local issue; issue="$(issue_for_pr "$1")"
  if [ -n "$issue" ]; then
    local nwo; nwo="$(gh repo view --json nameWithOwner -q .nameWithOwner 2>/dev/null || echo "")"
    if [ -n "$nwo" ]; then
      edited="$(gh api graphql -f query="query{repository(owner:\"${nwo%%/*}\",name:\"${nwo##*/}\"){issue(number:$issue){lastEditedAt}}}" \
        --jq '.data.repository.issue.lastEditedAt // ""' 2>/dev/null || echo "")"
    fi
  fi
  entry="$(loop_entry_time "$1")"
  # echo the later of the two ISO-8601 timestamps (they compare correctly as strings).
  if [[ "$entry" > "$edited" ]]; then echo "$entry"; else echo "$edited"; fi
}

# count Engineer-review rounds this PR has seen SINCE its budget last reset (loop
# guard). Only reviews posted after budget_reset_time count — so a fresh attempt (a
# reopen from accepted/blocked, a clarify, a rebase-relabel) OR a spec edit resets the
# clock. The cap trips on genuine agent-vs-agent stalling, not on evolving
# requirements or on a converged PR being reopened for one more change.
review_rounds() {  # $1=pr
  local since; since="$(budget_reset_time "$1")"
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
# Product runs self-isolate in a throwaway worktree too (see run-product.sh): they
# edit project-memory.md and may `git switch`, which would otherwise corrupt a
# concurrent run sharing the primary checkout (the bug where a cycle yanked a live
# session onto main). Because project-memory.md lives on main, the isolated run
# lands it back on main from the worktree via `git push origin HEAD:main`; the
# commit_memory safety net below is the outer backstop for the rare in-place run.
run_product()  { "$SCRIPT_DIR/run-product.sh"  "$@"; }

# Engineer runs create branches, switch HEAD, and edit files — the exact thing that
# corrupts a concurrent run (a manual/interactive session, or the parallel
# review+acceptance in do_review) sharing one working tree. run-engineer.sh
# self-isolates in a throwaway git worktree (detached at origin/main), so there is
# nothing to wrap here; we just call it. The base dir is shared with run-engineer.sh
# (same default + SPACORY_WORKTREE_BASE override) so prune_stale_worktrees below can
# reclaim any worktree a killed run leaked before its own cleanup ran.
SPACORY_WORKTREE_BASE="${SPACORY_WORKTREE_BASE:-${TMPDIR:-/tmp}/spacory-agent-worktrees}"
run_engineer() { "$SCRIPT_DIR/run-engineer.sh" "$@"; }

# Run an agent command ("$@"), retrying on a non-zero exit up to AGENT_RETRIES extra
# times with a short backoff; returns the last attempt's exit code. $1 is a short
# human label for the log. A non-zero exit from a run-*.sh is always an
# infrastructure fault — a stalled API stream ("Response stalled mid-stream"), a
# killed process, a crash — never a "changes requested" verdict (which is a parsed PR
# comment on a *clean* exit), so a retry only ever re-attempts a transient fault and
# can't paper over a genuine rejection. Bounded so a hard-down API can't spin a tick
# forever. NOT for implement: re-running it once a PR exists would duplicate the
# branch/PR, so do_implement guards its own retry on pr_for_issue (see there).
run_with_retry() {  # $1=log-label  $2..=command to run
  local label="$1"; shift
  local attempt=1 max=$(( AGENT_RETRIES + 1 )) rc=0
  while :; do
    rc=0; "$@" || rc=$?
    [ "$rc" -eq 0 ] && return 0
    if [ "$attempt" -ge "$max" ]; then
      log "  $label failed (exit $rc) after $attempt attempt(s); giving up."
      return "$rc"
    fi
    log "  $label failed (exit $rc); retrying (attempt $((attempt+1))/$max) in ${AGENT_RETRY_BACKOFF_SECS}s…"
    sleep "$AGENT_RETRY_BACKOFF_SECS"
    attempt=$(( attempt + 1 ))
  done
}

# Safety net: project-memory.md is the Product Agent's shared memory and belongs on
# main (the Engineer never reads it). Isolated product runs now land it on main from
# their own worktree (run-product.sh's land_memory), so the primary checkout is
# normally clean by the time we get here and this no-ops. It remains as an outer
# backstop for an in-place run (SPACORY_AGENT_ISOLATED=1) that left it dirty: land it
# on main so it isn't swept into a feature branch or lost. Deterministic,
# best-effort, never fails the tick. Only ever touches project-memory.md.
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
  if run_with_retry "engineer resolve #$pr" run_engineer resolve "$pr"; then
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
  run_with_retry "engineer review #$pr"   run_engineer review "$pr"     & local pid_e=$!
  run_with_retry "product acceptance #$pr" run_product acceptance "$pr" & local pid_p=$!
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
  if ! run_with_retry "product triage #$issue" run_product triage "$issue"; then
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

  if [ "$kind" = pr ]; then
    # A PR clarify has TWO lanes, so run BOTH agents in parallel (mirroring
    # do_review's review+acceptance): the Product Agent answers product/scope
    # questions and folds decisions into the *issue* body / project-memory.md; the
    # Engineer Agent answers technical questions and edits the PR's own metadata —
    # crucially its **description/title** via `gh pr edit`, which Product refuses to
    # touch (not its artifact) and `resolve` won't touch (non-code). Without the
    # engineer lane, a "the PR body is stale" request deadlocks: every agent
    # correctly defers to engineer-clarify, which nothing ever invoked. They edit
    # disjoint artifacts (Product: issue/memory; Engineer: PR metadata), and the
    # engineer run self-isolates in a worktree, so the two can't collide.
    local rc_e=0 rc_p=0
    run_with_retry "engineer clarify #$num" run_engineer clarify "$num" & local pid_e=$!
    run_with_retry "product clarify #$num"  run_product  clarify "$num" & local pid_p=$!
    wait "$pid_e" || rc_e=$?
    wait "$pid_p" || rc_p=$?
    if [ "$rc_e" -ne 0 ] || [ "$rc_p" -ne 0 ]; then
      block pr "$num" "clarify run failed (engineer=$rc_e product=$rc_p)"
      return
    fi
    commit_memory   # the product lane may record a decision in project-memory.md
    # The spec may have moved; re-judge the PR against it. Editing the issue body
    # (which clarify does when a decision changes the spec) resets the round budget,
    # so this fresh review round doesn't count as non-convergence.
    swap_label pr "$num" agent:clarifying agent:review
    log "✓ clarified PR #$num → agent:review (re-evaluate against the updated spec)"
    notify "💬 Spacory agents: clarified PR #$num — re-reviewing against the updated spec."
  else
    # An issue has no PR artifact, so only the Product Agent (the spec owner) runs.
    if ! run_with_retry "product clarify #$num" run_product clarify "$num"; then
      block issue "$num" "product clarify run failed"
      return
    fi
    commit_memory   # clarify may record a decision in project-memory.md
    # It's refined and back in the backlog; promoting to agent:ready stays a human
    # decision (same as a triage-accepted issue).
    remove_label issue "$num" agent:clarifying
    log "✓ clarified issue #$num (spec refined; awaiting a human next step)"
    notify "💬 Spacory agents: clarified issue #$num (spec refined if the answer changed it)."
  fi
}

do_implement() {  # $1=issue
  local issue="$1"
  log "→ implement issue #$issue"
  swap_label issue "$issue" agent:ready agent:implementing
  # A stalled implement is worth retrying, but — unlike the comment-only runs —
  # only until a PR closing this issue exists: once the branch/PR is up, re-running
  # would recreate them and duplicate the work. So we retry by hand with that guard
  # between attempts rather than through run_with_retry.
  local attempt=1 max=$(( AGENT_RETRIES + 1 )) rc=0
  while :; do
    rc=0; run_engineer implement "$issue" || rc=$?
    { [ "$rc" -eq 0 ] || [ "$attempt" -ge "$max" ] || [ -n "$(pr_for_issue "$issue")" ]; } && break
    log "  engineer implement #$issue failed (exit $rc); retrying (attempt $((attempt+1))/$max) in ${AGENT_RETRY_BACKOFF_SECS}s…"
    sleep "$AGENT_RETRY_BACKOFF_SECS"
    attempt=$(( attempt + 1 ))
  done
  local pr; pr="$(pr_for_issue "$issue")"
  if [ -n "$pr" ]; then
    remove_label issue "$issue" agent:implementing
    add_label pr "$pr" agent:review
    log "✓ implemented issue #$issue → PR #$pr (agent:review)"
  elif [ "$rc" -ne 0 ]; then
    block issue "$issue" "engineer implement run failed (after $attempt attempt(s))"
  else
    block issue "$issue" "implement finished but no PR closing #$issue was found (did the agent ask a question instead?)"
  fi
}

# ── self-healing: reclaim in-flight labels no live run is holding ────────────
# Each do_* swaps a queue label to its transient `agent:*ing` twin, runs the agent
# synchronously, then swaps to the next state — all while holding the dispatch lock
# (see the mkdir lock at the bottom). So an `agent:*ing` label only ever exists
# *while a run is executing under the lock*. This reclaim runs at the top of every
# tick, and the tick can only get here having ALREADY acquired that same lock — which
# means no other run is in progress right now. Therefore any in-flight label present
# at this moment is necessarily orphaned: left behind either by a run that died
# mid-flight (machine slept, process killed, timeout, crash) before its final swap,
# or by a human who applied the transient label by hand (a common mix-up, since
# `agent:resolving` looks like a thing you'd request with — the request label is
# `agent:changes`). Neither is a live run, and no queue scan in dispatch_once would
# ever action an in-flight label, so we return it to its originating queue label,
# where this same tick (or the next) re-runs it (every do_* is idempotent).
#
# No age threshold is used: the *lock* — not a timeout — proves the label is stale,
# so recovery is immediate (a mislabel is fixed within one tick) rather than waiting
# out a conservative window. The reclaim only ever swaps labels, so `status` keeps
# reflecting reality and each recovery is logged + notified. (A run that genuinely
# *fails* doesn't reach here — do_* calls block() on a non-zero run — so this only
# ever catches externally-killed runs and hand-applied labels.)
reclaim_inflight() {  # $1=issue|pr $2=in-flight label $3=queue label
  local kind="$1" label="$2" queue="$3" num
  for num in $(gh "$kind" list --state open --label "$label" --json number --jq '.[].number' 2>/dev/null); do
    log "↩︎ recovering $kind #$num: $label with no active run → $queue"
    swap_label "$kind" "$num" "$label" "$queue"
    notify "♻️ Spacory agents: recovered $kind #$num — $label had no active run → $queue."
  done
}

reclaim_orphaned_inflight() {
  reclaim_inflight issue agent:triaging     agent:triage
  reclaim_inflight issue agent:implementing agent:ready
  reclaim_inflight pr    agent:reviewing    agent:review
  reclaim_inflight pr    agent:resolving    agent:changes
  # agent:clarify can sit on either an issue or a PR, so its in-flight twin can too.
  reclaim_inflight pr    agent:clarifying   agent:clarify
  reclaim_inflight issue agent:clarifying   agent:clarify
}

# Remove per-run git worktrees leaked by an engineer run that died before its own
# cleanup ran (machine slept, process killed, crash). `git worktree prune` clears
# metadata for vanished dirs; we also delete any run-* dir older than
# INFLIGHT_STALE_MINS so crashes can't accumulate 200 MB checkouts. Unlike the
# in-flight *label* reclaim above, this keeps an age threshold: a worktree can be
# created by a *manual* run-engineer.sh that isn't holding the dispatch lock, so
# "we hold the lock" doesn't prove a given worktree is idle — the window must
# clearly exceed a healthy engineer run so a live manual one is never yanked.
# Best-effort; never fails the tick.
prune_stale_worktrees() {
  git worktree prune 2>/dev/null || true
  [ -d "$SPACORY_WORKTREE_BASE" ] || return 0
  local d
  for d in "$SPACORY_WORKTREE_BASE"/run-*; do
    [ -d "$d" ] || continue
    if [ -n "$(find "$d" -maxdepth 0 -mmin +"$INFLIGHT_STALE_MINS" 2>/dev/null)" ]; then
      log "↩︎ pruning stale agent worktree ${d##*/} (>${INFLIGHT_STALE_MINS}m old)"
      git worktree remove --force "$d" 2>/dev/null || rm -rf "$d"
    fi
  done
  git worktree prune 2>/dev/null || true
}

# ── the tick: one action, highest priority first ────────────────────────────
dispatch_once() {
  local n
  # First, self-heal: reclaim any ticket stranded on an in-flight label (a dead run,
  # or a hand-applied transient label) now that we hold the lock, and clean up any
  # worktree an engineer run leaked when it died.
  reclaim_orphaned_inflight
  prune_stale_worktrees
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
      local ok=1
      run_product && log "✓ product cycle complete" || ok=0
      commit_memory
      # Deterministic wrap-up, like every do_* action: the agent is *supposed* to
      # self-notify (spacory-notify), but that's a soft instruction it can skip —
      # notably on a no-op cycle — so the dispatcher guarantees the human hears the
      # cycle ran regardless.
      if [ "$ok" = 1 ]; then
        notify "🪐 Spacory agents: product cycle complete — check GitHub for any new or refined issues."
      else
        notify "⚠️ Spacory agents: product cycle failed."
      fi
      exit 0 ;;
    tick)   dispatch_once ;;
    *)      die "unknown command: $1 (use: setup | status | cycle | tick)" ;;
  esac
}

# A mkdir-based lock: portable (macOS has no `flock`) and atomic. cycle and tick
# share ONE lock on purpose. The agent runs themselves are now isolated in per-run
# worktrees (run-engineer.sh / run-product.sh), so they no longer fight over the
# primary checkout's HEAD — but the dispatcher still touches shared state directly:
# commit_memory's backstop git ops run in the primary tree, and two product runs (or
# a cycle racing a tick) would otherwise push project-memory.md to main concurrently.
# So the lock stays. A stale lock older than 2h is reclaimed so a crashed run can't
# wedge the loop forever.
LOCK="${TMPDIR:-/tmp}/spacory-dispatch.lock.d"

reclaim_stale_lock() {
  if [ -d "$LOCK" ] && [ -n "$(find "$LOCK" -maxdepth 0 -mmin +120 2>/dev/null)" ]; then
    log "Reclaiming stale lock (>2h old)."
    rmdir "$LOCK" 2>/dev/null || true
  fi
}

# The two jobs have very different stakes when they can't get the lock:
#   - the tick fires every ~10 min, so a skipped tick just retries shortly → skip.
#   - the cycle fires once a day, so losing its slot to a concurrent tick would
#     stall issue creation for ~24h → wait (bounded) for the lock instead of
#     silently forfeiting the day. If it still can't get it, say so (and notify).
CYCLE_LOCK_WAIT_SECS="${SPACORY_CYCLE_LOCK_WAIT_SECS:-1800}"  # 30 min

if [ "${1:-tick}" = "cycle" ]; then
  waited=0
  until { reclaim_stale_lock; mkdir "$LOCK" 2>/dev/null; }; do
    if [ "$waited" -ge "$CYCLE_LOCK_WAIT_SECS" ]; then
      log "Dispatch stayed busy for >${CYCLE_LOCK_WAIT_SECS}s; skipping this cycle."
      notify "⚠️ Spacory agents: product cycle skipped — dispatcher busy for >$((CYCLE_LOCK_WAIT_SECS / 60))m."
      exit 0
    fi
    [ "$waited" -eq 0 ] && log "Dispatch busy; waiting up to ${CYCLE_LOCK_WAIT_SECS}s for the lock…"
    sleep 10
    waited=$((waited + 10))
  done
else
  reclaim_stale_lock
  if ! mkdir "$LOCK" 2>/dev/null; then
    log "Another dispatch is still running; skipping this tick."
    exit 0
  fi
fi
trap 'rmdir "$LOCK" 2>/dev/null || true' EXIT

main "$@"
