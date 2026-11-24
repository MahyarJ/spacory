#!/usr/bin/env bash
# Sourced by dispatch.sh. The dispatcher lock covers every PR handoff below.

pr_head_sha() {
  gh pr view "$1" --json headRefOid --jq .headRefOid
}

read_pr() {
  local state
  state="$(node "$SCRIPT_DIR/pr-state.mjs" read "$1")" || return
  IFS='|' read -r PR_STAGE PR_HEAD PR_BASE PR_ELIGIBLE PR_ENGINEER PR_PRODUCT \
    PR_ENGINEER_ID PR_PREVIOUS_HEAD PR_PREVIOUS_ID PR_CHANGE_HEAD PR_RESOLVE_HEAD \
    PR_RECONCILE_HEAD PR_CLARIFY_ROLE PR_REQUESTS PR_CLARIFY_ENDED PR_ACTIVE_CLARIFICATION \
    PR_ACTIVE_CLARIFY_ROLE PR_CLARIFY_REPLIES PR_EXTRA_LABELS PR_CONDITIONAL_CLARIFY_HEAD <<<"$state"
}

checkpoint() {
  node "$SCRIPT_DIR/pr-state.mjs" record "$@"
}

move_pr() {  # PR, destination stage (PR_STAGE is the live source stage)
  local pr="$1" next="$2"
  [ "$PR_STAGE" != "$next" ] || return 0
  # Keep at least one label during the transition so health checks can find it.
  add_label pr "$pr" "agent:$next"
  if [ -n "$PR_STAGE" ]; then
    gh pr edit "$pr" --remove-label "agent:$PR_STAGE" >/dev/null
  fi
  PR_STAGE="$next"
  log "  PR #$pr → agent:$next"
}

reviewer_session() {
  (
    source "$SCRIPT_DIR/engine.sh"
    configure_agent reviewer review
    node "$SCRIPT_DIR/usage.mjs" session "$1" "$2" "$(spacory_engine)" "$SPACORY_RESOLVED_MODEL"
  )
}

run_pr_verdict() {  # PR, review | acceptance
  local pr="$1" mode="$2" head="$PR_HEAD" attempt=1 rc=0 verdict='none' live resume='' previous=''
  local context="Review the pinned head $head against base $PR_BASE. Use git fetch origin refs/pull/$pr/head and inspect $PR_BASE...$head. If the pinned commit is unavailable, stop without posting a verdict. Include exactly '**Head:** $head' in the verdict comment."
  if [ "$mode" = acceptance ]; then
    context="$context Engineer's approval and evidence for this revision are in comment $PR_ENGINEER_ID (gh api repos/:owner/:repo/issues/comments/$PR_ENGINEER_ID). Walk the user workflow and reference that evidence where applicable."
  elif [ -n "$PR_PREVIOUS_HEAD" ] && [ "$PR_PREVIOUS_HEAD" != "$head" ]; then
    previous="$PR_PREVIOUS_HEAD"
    if [ "${SPACORY_REVIEWER_RESUME:-0}" = 1 ]; then
      resume="$(reviewer_session "$pr" "$previous")" || resume=''
    fi
    context="$context This is a re-review. Previous head: $PR_PREVIOUS_HEAD. Inspect the changes between those SHAs, outstanding blocking findings from comment $PR_PREVIOUS_ID (gh api repos/:owner/:repo/issues/comments/$PR_PREVIOUS_ID), and regressions introduced by the fix. If the previous revision cannot be compared safely, review the full PR."
  else
    context="$context Review the full PR."
  fi

  while :; do
    checkpoint "$pr" "$mode" "$head"
    move_pr "$pr" reviewing
    live="$(pr_head_sha "$pr")"
    [ "$live" = "$head" ] || return 0
    rc=0
    if [ "$mode" = review ]; then
      SPACORY_AGENT_HEAD="$head" SPACORY_AGENT_PREVIOUS_HEAD="$previous" SPACORY_AGENT_RESUME_ID="$resume" \
        run_engineer review "$pr" "$context" || rc=$?
    else
      SPACORY_AGENT_HEAD="$head" run_product acceptance "$pr" "$context" || rc=$?
    fi
    read_pr "$pr"
    [ "$PR_ELIGIBLE" = true ] && [ "$PR_HEAD" = "$head" ] && [ "$PR_STAGE" = reviewing ] || return 0
    if [ "$mode" = review ]; then verdict="$PR_ENGINEER"; else verdict="$PR_PRODUCT"; fi
    [ "$verdict" = none ] || return 0
    if [ -n "$resume" ]; then
      log "  reviewer session produced no verdict; starting a fresh review of PR #$pr."
      resume=''
      continue
    fi
    if [ "$rc" -eq 0 ] || [ "$attempt" -gt "$AGENT_RETRIES" ]; then
      block pr "$pr" "$mode did not publish a verdict for $head (exit $rc)"
      return 0
    fi
    attempt=$((attempt + 1))
    log "  $mode #$pr failed without a verdict; retrying (attempt $attempt)."
    sleep "$AGENT_RETRY_BACKOFF_SECS"
  done
}

run_pr_push() {  # PR, resolve | reconcile
  local pr="$1" mode="$2" head="$PR_HEAD" rounds attempt=1 rc=0 after
  if [ "$mode" = resolve ]; then
    rounds="$(review_rounds "$pr")"
    if [ "$rounds" -ge "$MAX_ROUNDS" ]; then
      block pr "$pr" "hit SPACORY_MAX_ROUNDS ($MAX_ROUNDS) review rounds without converging"
      return 0
    fi
  fi
  checkpoint "$pr" "$mode" "$head"
  move_pr "$pr" "${mode%?}ing"
  while :; do
    after="$(pr_head_sha "$pr")"
    [ "$after" = "$head" ] || break
    rc=0
    SPACORY_AGENT_HEAD="$head" run_engineer "$mode" "$pr" "Start from PR head $head. If the remote head has moved before checkout, stop and let the dispatcher re-evaluate it." || rc=$?
    after="$(pr_head_sha "$pr")"
    [ "$after" = "$head" ] || break
    if [ "$rc" -eq 0 ] || [ "$attempt" -gt "$AGENT_RETRIES" ]; then
      block pr "$pr" "$mode did not push a new revision (exit $rc)"
      return 0
    fi
    attempt=$((attempt + 1))
    log "  $mode #$pr failed without a push; retrying (attempt $attempt)."
    sleep "$AGENT_RETRY_BACKOFF_SECS"
  done
  read_pr "$pr"
  if [ "$PR_STAGE" = "${mode%?}ing" ]; then move_pr "$pr" review; fi
}

run_pr_clarification() {
  local pr="$1" head="$PR_HEAD" requests="$PR_REQUESTS" role="$PR_CLARIFY_ROLE"
  local conditional_head='' detail lane live rc
  if [ -n "$PR_ACTIVE_CLARIFICATION" ]; then
    requests="$PR_ACTIVE_CLARIFICATION"
    role="$PR_ACTIVE_CLARIFY_ROLE"
    conditional_head="$PR_CONDITIONAL_CLARIFY_HEAD"
  else
    checkpoint "$pr" clarify "$head" "$requests" "$role"
    PR_CLARIFY_REPLIES=''
  fi
  move_pr "$pr" clarifying
  detail="Handle these clarification requests in this run: $requests. IDs prefixed comment- are top-level PR conversation comments; IDs prefixed inline- are line comments. Reply to the requests in your lane and post the clarification summary comment."
  for lane in engineer product; do
    [ "$role" = "$lane" ] || [ "$role" = both ] || continue
    case ",$PR_CLARIFY_REPLIES," in *",$lane,"*) continue ;; esac
    if [ -n "$conditional_head" ]; then
      live="$(pr_head_sha "$pr")"
      [ "$live" = "$conditional_head" ] || return 0
    fi
    rc=0
    SPACORY_AGENT_PR="$pr" SPACORY_AGENT_HEAD="$head" "run_$lane" clarify "$pr" "$detail" || rc=$?
    read_pr "$pr"
    [ "$PR_ELIGIBLE" = true ] && [ "$PR_STAGE" = clarifying ] || return 0
    [ -z "$conditional_head" ] || [ "$PR_HEAD" = "$conditional_head" ] || return 0
    [ "$PR_ACTIVE_CLARIFICATION" = "$requests" ] || return 0
    [ "$lane" != product ] || commit_memory
    case ",$PR_CLARIFY_REPLIES," in
      *",$lane,"*) ;;
      *) block pr "$pr" "$lane did not publish a clarification reply (exit $rc)"; return 0 ;;
    esac
  done
  # Record this batch's replies. The next state read checks for pending requests
  # before closing clarification and asking for fresh verdicts.
  checkpoint "$pr" clarified "$head" "$requests"
}

# An unopened handoff can be reconstructed from the linked issue. An ordinary
# PR from the same repository still needs an explicit pipeline label or issue.
intake_pr() {
  local pr="$1" expected_issue="${2:-}" issue labels
  issue="$(issue_for_pr "$pr")"
  [ -n "$issue" ] || return 0
  [ -z "$expected_issue" ] || [ "$issue" = "$expected_issue" ] || return 0
  labels="$(gh issue view "$issue" --json state,labels --jq 'select(.state=="OPEN") | .labels[].name')"
  case $'\n'"$labels"$'\n' in
    *$'\nagent:ready\n'*|*$'\nagent:implementing\n'*)
      [ -n "$PR_STAGE" ] || move_pr "$pr" review
      remove_label issue "$issue" agent:implementing
      remove_label issue "$issue" agent:ready
      ;;
  esac
}

# Drain one PR while eligible; each completed action re-enters this selector.
# Late events carry only the PR number. Progress depends on current GitHub state.
drive_pr() {
  local pr="$1" intake="${2:-0}" linked_issue="${3:-}" transition=0 announce=0 live
  while [ "$transition" -lt 50 ]; do
    transition=$((transition + 1))
    read_pr "$pr"
    [ "$PR_ELIGIBLE" = true ] || return 0
    if [ "$PR_STAGE" != blocked ] && [ -n "$PR_EXTRA_LABELS" ]; then
      gh pr edit "$pr" --remove-label "$PR_EXTRA_LABELS" >/dev/null
    fi
    if [ "$intake" -eq 1 ] && { [ -z "$PR_STAGE" ] || [ -n "$linked_issue" ]; }; then
      intake=0
      intake_pr "$pr" "$linked_issue"
    fi
    if [ -n "$PR_ACTIVE_CLARIFICATION" ]; then
      case "$PR_STAGE" in
        clarify|clarifying|review|reviewing)
          # A worker may have been interrupted before swapping labels or
          # marking its batch complete. Recover that batch before starting one.
          run_pr_clarification "$pr"
          continue
          ;;
      esac
    fi
    case "$PR_STAGE" in
      '') return 0 ;;
      blocked) return 0 ;;
      clarify|clarifying)
        if [ -n "$PR_REQUESTS" ]; then
          run_pr_clarification "$pr"
        elif [ "$PR_STAGE" = clarifying ] && [ "$PR_CLARIFY_ENDED" = true ]; then
          move_pr "$pr" review
        else
          return 0
        fi
        ;;
      conflict|reconciling)
        if [ "$PR_STAGE" = reconciling ] && [ -n "$PR_RECONCILE_HEAD" ] && [ "$PR_RECONCILE_HEAD" != "$PR_HEAD" ]; then
          move_pr "$pr" review
        else
          run_pr_push "$pr" reconcile
        fi
        ;;
      changes|resolving)
        if { [ "$PR_STAGE" = resolving ] && [ -n "$PR_RESOLVE_HEAD" ] && [ "$PR_RESOLVE_HEAD" != "$PR_HEAD" ]; } ||
          { [ "$PR_STAGE" = changes ] && [ -n "$PR_CHANGE_HEAD" ] && [ "$PR_CHANGE_HEAD" != "$PR_HEAD" ] && [ "$PR_ENGINEER" = none ]; }; then
          move_pr "$pr" review
        else
          run_pr_push "$pr" resolve
        fi
        ;;
      review)
        if [ "$PR_CLARIFY_ENDED" = true ] && [ -n "$PR_REQUESTS" ]; then
          # Pick up requests posted while the clarification label was being removed.
          run_pr_clarification "$pr"
        else
          # A queued review is a new request, even on the same head.
          run_pr_verdict "$pr" review
        fi
        ;;
      reviewing)
        # Read the head again after interpreting the evidence before publishing
        # any transition. The next iteration checks it again before running.
        live="$(pr_head_sha "$pr")"
        [ "$live" = "$PR_HEAD" ] || continue
        if [ "$PR_ENGINEER" = changes ] || [ "$PR_PRODUCT" = changes ]; then
          move_pr "$pr" changes
        elif [ "$PR_ENGINEER" = defer ] || [ "$PR_PRODUCT" = defer ]; then
          checkpoint "$pr" conditional-clarify "$PR_HEAD" "$PR_REQUESTS" "$PR_CLARIFY_ROLE"
          move_pr "$pr" clarifying
        elif [ "$PR_ENGINEER" = none ]; then
          run_pr_verdict "$pr" review
        elif [ "$PR_PRODUCT" = none ]; then
          run_pr_verdict "$pr" acceptance
        else
          move_pr "$pr" accepted
          node "$SCRIPT_DIR/usage.mjs" accepted "$pr" "$PR_HEAD" || true
          announce=1
        fi
        ;;
      accepted)
        if [ "$PR_ENGINEER" != pass ] || [ "$PR_PRODUCT" != pass ]; then
          move_pr "$pr" review
        else
          maybe_merge "$pr" "$PR_HEAD" "$announce"
          live="$(pr_head_sha "$pr")"
          if [ "$live" != "$PR_HEAD" ] || [ "$PR_STAGE" = conflict ]; then
            announce=0
            continue
          fi
          return 0
        fi
        ;;
    esac
  done
  log "PR #$pr reached the dispatch handoff limit; recovery will re-evaluate it."
}
