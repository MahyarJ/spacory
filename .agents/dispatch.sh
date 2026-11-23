#!/usr/bin/env bash
#
# Spacory runs one agent pipeline at a time. GitHub labels expose the work
# state and PR comments hold checkpoints and verdicts for recovery. A completed
# stage immediately evaluates the next stage for that PR.
#
#   tick (default)      Recover missed work and start the next eligible job.
#   wake pr|issue N     Re-evaluate a GitHub artifact under the same lock.
#   cycle              Run the scheduled Product planning cycle.
#   webhook            Receive and queue signed GitHub wake-ups.
#   setup | status     Create the labels or print their current assignments.
# See docs/AUTOMATION.md for setup and recovery.
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

if [ "${1:-}" = webhook ]; then
  exec node "$SCRIPT_DIR/webhook.mjs"
fi
unset SPACORY_WEBHOOK_SECRET

export SPACORY_AGENT_USAGE_LOG="${SPACORY_AGENT_USAGE_LOG:-$SCRIPT_DIR/logs/usage.jsonl}"

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
    "agent:review|1d76db|PR awaiting Engineer review, then Product acceptance"
    "agent:reviewing|c5def5|Engineer review or Product acceptance in flight"
    "agent:changes|d93f0b|Changes requested — awaiting Engineer resolve"
    "agent:resolving|fbca04|Engineer Agent is resolving review comments"
    "agent:conflict|d93f0b|Branch conflicts with main — awaiting Engineer reconcile"
    "agent:reconciling|fbca04|Engineer Agent is merging main in & resolving conflicts"
    "agent:clarify|c2e0c6|A human question/comment to answer — clarify (Product on an issue; Product + Engineer on a PR)"
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
  # Keep the blocked marker visible throughout cleanup.
  add_label "$kind" "$num" "agent:blocked"
  local l
  for l in agent:triage agent:triaging agent:ready agent:implementing agent:review agent:reviewing agent:changes agent:resolving agent:conflict agent:reconciling agent:clarify agent:clarifying; do
    remove_label "$kind" "$num" "$l"
  done
  log "BLOCKED $kind #$num — $reason"
  notify "🚧 Spacory agents: $kind #$num blocked — $reason. Needs a human."
}

# ── triage verdict parsing ─────────────────────────────────────────────────
# Isolate the decision text the agents put on their `**Verdict:** …` line — the
# parsing contract spelled out in the product-agent / engineer-agent skills. The
# comment bodies are fed in already newline-flattened (latest_comment /
# latest_issue_comment turn every newline into a space), and the Verdict line is the
# LAST line of the comment, so everything after the final "verdict:" marker IS the
# verdict clause. Classifying only this clause — instead of the whole comment —
# stops incidental prose elsewhere in the write-up from being read as a verdict:
# e.g. an out-of-scope note mentioning "palm rejection" used to flip an *accepted*
# triage to "rejected" (see docs/DECISIONS.md). If a comment carries no marker at all
# (older/hand-written), fall back to the whole body so it still classifies as before.
verdict_clause() {  # $1=flattened comment body
  case "$1" in
    *[Vv]erdict:*) printf '%s' "${1##*[Vv]erdict:}" ;;   # tail after the last marker
    *)             printf '%s' "$1" ;;
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
  local lc; lc="$(verdict_clause "$1" | tr '[:upper:]' '[:lower:]')"
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
#       reconcile (agent:conflict→review), a rebase-then-relabel, or the first implement.
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
# reopen from accepted/blocked, a clarify, a reconcile, a rebase-relabel) OR a spec
# edit resets the clock. The cap trips on genuine agent-vs-agent stalling, not on evolving
# requirements or on a converged PR being reopened for one more change.
review_rounds() {  # $1=pr
  local since; since="$(budget_reset_time "$1")"
  gh pr view "$1" --json comments \
    --jq "[.comments[] | select(.createdAt > \"$since\") | select(.body | test(\"Engineer review\"))] | length"
}

# GitHub's mergeability verdict for a PR → MERGEABLE | CONFLICTING | UNKNOWN.
# UNKNOWN means GitHub hasn't finished (re)computing the merge yet — common for a few
# seconds after any push — so callers must treat ONLY the explicit "CONFLICTING" as a
# conflict and let UNKNOWN recompute on the next tick. Never guess from UNKNOWN.
pr_mergeable() {  # $1=pr
  gh pr view "$1" --json mergeable --jq '.mergeable // "UNKNOWN"' 2>/dev/null || echo "UNKNOWN"
}

# Is the PR's branch strictly BEHIND main — i.e. main has commits the branch doesn't,
# so the PR's green CI validated a STALE base and a semantic drift (an API main changed
# out from under the branch) could slip through even though pr_mergeable says MERGEABLE
# (that only catches TEXTUAL conflicts)? Returns 0 (behind) / 1 (current or unknown).
#
# Uses the compare API's behind_by, which is protection-INDEPENDENT — unlike
# mergeStateStatus=BEHIND, which GitHub only reports when "require branches up to date"
# is enabled. So this fires whether or not that branch protection is on (see
# AUTOMATION.md, which recommends enabling it as the complementary CI-level gate). Any
# API error → treated as "not behind" so an unknown never triggers a needless reconcile.
pr_behind_main() {  # $1=pr
  local head; head="$(gh pr view "$1" --json headRefName --jq '.headRefName' 2>/dev/null)" || return 1
  [ -n "$head" ] || return 1
  local behind
  behind="$(gh api "repos/:owner/:repo/compare/main...$head" --jq '.behind_by // 0' 2>/dev/null || echo 0)"
  [ "${behind:-0}" -gt 0 ]
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
  gh pr list --state open --limit 1000 --json number,body,headRefName \
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
list_issues() { gh issue list --state open --limit 1000 --label "$1" --json number --jq '.[].number'; }
list_prs()    { gh pr    list --state open --limit 1000 --label "$1" --json number --jq '.[].number'; }

source "$SCRIPT_DIR/pr-dispatch.sh"

maybe_merge() {  # $1=pr — only if the human opted in AND CI is green
  local pr="$1" head="$2" announce="$3" live_head
  live_head="$(pr_head_sha "$pr")"
  [ "$live_head" = "$head" ] || return 0
  # The merge boundary is the ONE place a conflict/staleness actually matters, so this
  # is where we gate it (review/resolve work fine against a conflicting branch; the
  # conflict only blocks the merge). A conflicting branch can't be merged (by us or a
  # human), so route it to reconcile instead of attempting a merge that would fail —
  # or, when automerge is off, instead of telling the human it's "ready to merge" when
  # it isn't. maybe_merge runs for every accepted PR every tick (bottom of the tick +
  # right after do_review accepts), so this catches a conflict whenever it surfaces.
  # Only the explicit CONFLICTING acts; UNKNOWN (GitHub still recomputing) recomputes
  # and is re-checked next tick.
  if [ "$(pr_mergeable "$pr")" = CONFLICTING ]; then
    move_pr "$pr" conflict
    log "⚠︎ accepted PR #$pr conflicts with main → agent:conflict (reconcile before merge)"
    notify "🔀 Spacory agents: accepted PR #$pr conflicts with main — reconciling before merge."
    return
  fi
  # Freshness gate (the merge boundary ONLY): even with no textual conflict, a branch
  # that's BEHIND main had its green CI run against a stale base, so a semantic drift
  # could land on merge. Reconcile it first (merge main in → re-review) so CI validates
  # the actual MERGED result before we/anyone merge. Scoped to here — not to
  # implement/resolve or the review queue — so fast-moving main doesn't churn every
  # intermediate run; a PR only needs to be current at the moment it's about to land.
  # (Caveat: if main merges faster than a reconcile→review→accept cycle, a PR can
  # "chase" it — inherent to requiring up-to-date merges; it settles once the burst
  # quiets. See AUTOMATION.md.)
  if pr_behind_main "$pr"; then
    move_pr "$pr" conflict
    log "⚠︎ accepted PR #$pr is behind main → agent:conflict (reconcile so CI validates the merge)"
    notify "🔀 Spacory agents: accepted PR #$pr is behind main — reconciling so CI validates the merged result before merge."
    return
  fi
  if [ "$AUTOMERGE" != "1" ]; then
    [ "$announce" -ne 1 ] || notify "✅ Spacory agents: PR #$pr accepted — ready for you to merge."
    return
  fi
  if ci_green "$pr"; then
    log "→ automerge PR #$pr (SPACORY_AUTOMERGE=1, CI green)"
    if gh pr merge "$pr" --match-head-commit "$head" --squash --delete-branch >/dev/null 2>&1; then
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

do_issue_clarify() {
  local issue="$1"
  swap_label issue "$issue" agent:clarify agent:clarifying
  if ! run_with_retry "product clarify #$issue" run_product clarify "$issue"; then
    block issue "$issue" "clarify run failed"
    return
  fi
  commit_memory
  remove_label issue "$issue" agent:clarifying
  notify "💬 Spacory agents: clarified issue #$issue (spec refined if the answer changed it)."
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
    drive_pr "$pr" 1
    remove_label issue "$issue" agent:implementing
  elif [ "$rc" -ne 0 ]; then
    block issue "$issue" "engineer implement run failed (after $attempt attempt(s))"
  else
    block issue "$issue" "implement finished but no PR closing #$issue was found (did the agent ask a question instead?)"
  fi
}

# ── self-healing: reclaim in-flight labels no live run is holding ────────────
# Acquiring the dispatcher lock means orphaned jobs can be retried. PR recovery
# uses checkpoints to recognize completed reviews and pushes before retrying.
reclaim_inflight() {  # $1=issue|pr $2=in-flight label $3=queue label
  local kind="$1" label="$2" queue="$3" num
  for num in $(gh "$kind" list --state open --label "$label" --json number --jq '.[].number' 2>/dev/null); do
    log "↩︎ recovering $kind #$num: $label with no active run → $queue"
    swap_label "$kind" "$num" "$label" "$queue"
    notify "♻️ Spacory agents: recovered $kind #$num — $label had no active run → $queue."
  done
}

reclaim_orphaned_inflight() {
  local issue pr
  reclaim_inflight issue agent:triaging agent:triage
  reclaim_inflight issue agent:clarifying agent:clarify
  for issue in $(list_issues agent:implementing); do
    pr="$(pr_for_issue "$issue")"
    if [ -n "$pr" ]; then
      drive_pr "$pr" 1
      remove_label issue "$issue" agent:implementing
    else
      swap_label issue "$issue" agent:implementing agent:ready
    fi
  done
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
  for d in "$SPACORY_WORKTREE_BASE"/run-* "$SPACORY_WORKTREE_BASE"/review-pr-*; do
    [ -d "$d" ] || continue
    if [ -n "$(find "$d" -maxdepth 0 -mmin +"$INFLIGHT_STALE_MINS" 2>/dev/null)" ]; then
      log "↩︎ pruning stale agent worktree ${d##*/} (>${INFLIGHT_STALE_MINS}m old)"
      git worktree remove --force "$d" 2>/dev/null || rm -rf "$d"
    fi
  done
  git worktree prune 2>/dev/null || true
}

# Both the scheduled recovery and targeted wakes run with the shared lock.
dispatch_issue() {
  local issue="$1" labels pr
  labels="$(gh issue view "$issue" --json state,labels --jq 'select(.state=="OPEN") | .labels[].name')"
  case $'\n'"$labels"$'\n' in
    *$'\nagent:blocked\n'*) return 0 ;;
    *$'\nagent:clarify\n'*) do_issue_clarify "$issue" ;;
    *$'\nagent:triage\n'*) do_triage "$issue" ;;
    *$'\nagent:ready\n'*)
      pr="$(pr_for_issue "$issue")"
      if [ -n "$pr" ]; then drive_pr "$pr" 1; else do_implement "$issue"; fi
      ;;
  esac
}

dispatch_once() {
  local n prs label seen=' '
  reclaim_orphaned_inflight
  prune_stale_worktrees
  for label in conflict reconciling changes resolving clarify clarifying review reviewing accepted; do
    prs="$(list_prs "agent:$label")"
    for n in $prs; do
      case "$seen" in *" $n "*) continue ;; esac
      seen="$seen$n "
      drive_pr "$n"
    done
  done
  for n in $(list_issues agent:clarify); do do_issue_clarify "$n"; return; done
  for n in $(list_issues agent:triage); do do_triage "$n"; return; done
  for n in $(list_issues agent:ready); do dispatch_issue "$n"; return; done
}

print_status() {
  echo "Spacory agent pipeline ($(gh repo view --json nameWithOwner -q .nameWithOwner)):"
  local l
  for l in agent:triage agent:triaging agent:ready agent:implementing agent:review agent:reviewing agent:changes agent:resolving agent:conflict agent:reconciling agent:clarify agent:clarifying agent:accepted agent:blocked; do
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
    tick) dispatch_once ;;
    wake)
      [[ "${3:-}" =~ ^[1-9][0-9]*$ ]] || die 'wake requires a GitHub number'
      case "${2:-}" in
        pr) drive_pr "$3" 1 ;;
        issue) dispatch_issue "$3" ;;
        *) die 'wake requires pr or issue' ;;
      esac ;;
    *) die "unknown command: $1 (use: setup | status | cycle | tick | wake)" ;;
  esac
}

# The operating system releases the shared lock on exit, including a crash.
# lockf is native to macOS; flock supports Linux runners.
LOCK="${SPACORY_DISPATCH_LOCK:-${TMPDIR:-/tmp}/spacory-dispatch.lock}"
lock_wait=0
[ "${1:-tick}" != cycle ] || lock_wait="${SPACORY_CYCLE_LOCK_WAIT_SECS:-1800}"
exec 9>"$LOCK"
lock_rc=0
if command -v flock >/dev/null 2>&1; then
  flock -E 75 -w "$lock_wait" 9 || lock_rc=$?
else
  lockf -s -t "$lock_wait" 9 || lock_rc=$?
fi
case "$lock_rc" in
  0) ;;
  75)
    log "Another dispatch is still running."
    case "${1:-tick}" in
      wake) exit 75 ;;
      cycle) notify "⚠️ Spacory agents: product cycle skipped — dispatcher busy for ${lock_wait}s." ;;
    esac
    exit 0 ;;
  *) die "could not acquire dispatcher lock (exit $lock_rc)" ;;
esac

main "$@"
