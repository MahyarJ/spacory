#!/usr/bin/env bash
#
# Run the Spacory **Product Agent** in a fresh, headless Claude session in ONE of
# its modes. The Product Agent is one role (product) in several capacities —
# the full contract lives in the `product-agent` skill
# (.claude/skills/product-agent/SKILL.md); product-agent-prompt.md is a thin
# shim that points the headless run at it.
#
#   cycle       read project-memory.md + issues → create/refine issues (default)
#   acceptance  judge a PR vs the issue's criteria → posts an acceptance comment
#   clarify     answer product questions on an issue/PR → posts a reply comment
#   triage      groom a human-submitted idea issue → enrich into a spec, or reject
#
# Usage:
#   .agents/run-product.sh                                  # run a product cycle
#   .agents/run-product.sh "focus on PNG/SVG export"        # cycle + extra steer
#   .agents/run-product.sh acceptance 14                    # acceptance-test PR #14
#   .agents/run-product.sh acceptance 14 "watch mobile UX"  # acceptance + extra note
#   .agents/run-product.sh clarify 9                        # answer product Qs on #9
#   .agents/run-product.sh triage 42                        # triage idea issue #42
#
# Isolation: a product run edits project-memory.md and (per the skill) commits it to
# main, and it may `git switch` branches — the exact thing that corrupts a concurrent
# run (a manual/interactive session, or the parallel review+acceptance in do_review)
# sharing one working tree. Historically these ran in the caller's checkout and could
# yank a human's HEAD onto main mid-session. So, exactly like run-engineer.sh, this
# script now re-runs itself inside a throwaway git worktree detached at the
# freshly-fetched origin/main and tears it down afterwards. project-memory.md lives
# on main, so — unlike an engineer feature branch — the isolated run lands it back on
# main from the worktree via `git push origin HEAD:main` (see land_memory below); the
# agent is told to just edit-and-leave the file when it's in a detached worktree.
# Set SPACORY_AGENT_ISOLATED=1 to skip the wrapper and run in place (the wrapper uses
# the guard to avoid double-wrapping; a disposable CI checkout can set it too).
#
# Env overrides (isolation):
#   SPACORY_AGENT_ISOLATED   set to skip the worktree wrapper and run in place.
#   SPACORY_WORKTREE_BASE    where per-run worktrees live
#                            (default: $TMPDIR/spacory-agent-worktrees).
#
# Env overrides:
#   CLAUDE_PERMISSION_MODE   default: acceptEdits
#                            (use "bypassPermissions" for fully unattended runs)
#   CLAUDE_MODEL             default: the session default model. Set in
#                            .agents/.env to pin (dispatch.sh sources it); this
#                            repo defaults to "sonnet".
#   CLAUDE_EFFORT            default: the CLI's default effort. Set in
#                            .agents/.env to pin a reasoning-effort level (e.g.
#                            "medium"); passed through as `--effort`.
#
# Note: for an unattended headless run to not stall, the GitHub commands the
# agent uses must be permitted. This repo's .claude/settings.json allows git and
# `gh pr/run`; cycle mode also needs `Bash(gh issue:*)` (it creates issues).
# Either add that to the allowlist, or run with
# CLAUDE_PERMISSION_MODE=bypassPermissions in a trusted environment.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
PROMPT="$SCRIPT_DIR/product-agent-prompt.md"

command -v claude >/dev/null 2>&1 || { echo "error: 'claude' CLI not found on PATH" >&2; exit 1; }
[ -f "$PROMPT" ] || { echo "error: missing prompt file: $PROMPT" >&2; exit 1; }

# Keep the caller's exact argv so we can re-invoke ourselves verbatim inside the
# isolation worktree below (preserving a multi-word extra-instruction argument).
ORIG_ARGS=("$@")

# acceptance, clarify and triage each take a number; cycle is the default and
# takes none.
MODE="cycle"
case "${1:-}" in
  acceptance|clarify|triage)
    MODE="$1"
    shift
    NUM="${1:-}"
    NUM="${NUM#\#}"   # tolerate a leading '#'
    case "$NUM" in
      ''|*[!0-9]*)
        echo "usage: $(basename "$0") $MODE <number> [extra instruction]" >&2
        exit 2
        ;;
    esac
    shift
    ;;
esac
EXTRA="${*:-}"

# Verify GitHub auth (bash, zero model cost) — after arg validation so a usage error
# still reports usage. The agent works entirely through gh, so fail loud now rather
# than launching a session that would only hit the failure mid-run.
gh auth status >/dev/null 2>&1 || {
  echo "error: gh CLI is not authenticated — run 'gh auth login' (or refresh the token)" >&2
  exit 1
}

# ── isolation: run in a throwaway git worktree, never the caller's checkout ────
# (args are validated above, so a bad invocation fails before we create anything.)
SPACORY_WORKTREE_BASE="${SPACORY_WORKTREE_BASE:-${TMPDIR:-/tmp}/spacory-agent-worktrees}"
if [ -z "${SPACORY_AGENT_ISOLATED:-}" ]; then
  command -v git >/dev/null 2>&1 || { echo "error: git required to isolate the run" >&2; exit 1; }
  git -C "$REPO_ROOT" fetch --quiet origin \
    || { echo "error: git fetch failed; cannot isolate the run" >&2; exit 1; }
  mkdir -p "$SPACORY_WORKTREE_BASE"
  WORKTREE="$SPACORY_WORKTREE_BASE/prod-$$-${RANDOM}"
  git -C "$REPO_ROOT" worktree add --detach --quiet "$WORKTREE" origin/main \
    || { echo "error: git worktree add failed ($WORKTREE)" >&2; exit 1; }
  # Reuse the caller's installed deps so any verify the agent runs works without
  # a fresh npm install.
  if [ -d "$REPO_ROOT/node_modules" ] && [ ! -e "$WORKTREE/node_modules" ]; then
    ln -s "$REPO_ROOT/node_modules" "$WORKTREE/node_modules"
  fi
  cleanup_worktree() {
    git -C "$REPO_ROOT" worktree remove --force "$WORKTREE" 2>/dev/null || rm -rf "$WORKTREE"
    git -C "$REPO_ROOT" worktree prune 2>/dev/null || true
  }
  trap cleanup_worktree EXIT
  echo "→ isolating product run in worktree ${WORKTREE##*/} (detached at origin/main)" >&2
  # Re-invoke the worktree's OWN copy so REPO_ROOT resolves to it; the guard stops
  # that copy from isolating again (or the dispatcher from double-wrapping).
  set +e
  SPACORY_AGENT_ISOLATED=1 "$WORKTREE/.agents/run-product.sh" "${ORIG_ARGS[@]}"
  rc=$?
  set -e
  exit "$rc"
fi

PERMISSION_MODE="${CLAUDE_PERMISSION_MODE:-acceptEdits}"

case "$MODE" in
  acceptance)
    TASK="Acceptance-test pull request #$NUM (Product Agent acceptance mode): verify it against the linked issue's acceptance criteria and user value, leave a comment, and make no code changes or project-memory.md edits."
    [ -n "$EXTRA" ] && TASK="$TASK Note for this run: $EXTRA"
    echo "→ Product Agent  [acceptance] #$NUM  (permission-mode: $PERMISSION_MODE)" >&2
    ;;
  clarify)
    TASK="Answer the product questions on #$NUM (Product Agent clarify mode): reply on the thread with product decisions, defer any technical questions to the Engineer Agent, update the issue/project-memory.md only if an answer changes the spec, and make no code changes."
    [ -n "$EXTRA" ] && TASK="$TASK Note for this run: $EXTRA"
    echo "→ Product Agent  [clarify] #$NUM  (permission-mode: $PERMISSION_MODE)" >&2
    ;;
  triage)
    TASK="Triage GitHub issue #$NUM (Product Agent triage mode): judge this human-submitted idea against project-memory.md and post one 'Product triage' verdict comment. On accept, rewrite the issue into a full spec (title, user story, acceptance criteria, technical context, out of scope). On reject, comment the rationale and close the issue. If you need a product decision you can't infer, ask on the issue and stop. Make no code changes and do not touch agent:* labels."
    [ -n "$EXTRA" ] && TASK="$TASK Note for this run: $EXTRA"
    echo "→ Product Agent  [triage] #$NUM  (permission-mode: $PERMISSION_MODE)" >&2
    ;;
  *)
    TASK="Run a product cycle for this repo."
    [ -n "$EXTRA" ] && TASK="$TASK Additional focus for this run: $EXTRA"
    echo "→ Product Agent  [cycle]  (permission-mode: $PERMISSION_MODE)" >&2
    ;;
esac

# Lead the prompt with the slash-command form so Claude Code deterministically
# expands the product-agent skill (the documented user-invoked path) instead of
# relying on the model to invoke it from the appended shim. $MODE is the skill's
# mode word (cycle|acceptance|clarify|triage); cycle takes no number.
SLASH="/product-agent $MODE"
[ -n "${NUM:-}" ] && SLASH="$SLASH $NUM"
TASK="$SLASH

$TASK"

cd "$REPO_ROOT"

# Deterministic memory-landing safety net for the isolated run. The agent edits
# project-memory.md in this (detached, based-at-origin/main) worktree and — per the
# skill — leaves the git work to us, because `git switch main` would fail while main
# is checked out in the primary tree. So after the run we commit any dirty memory
# file and push it to main with `HEAD:main` (fetch+rebase first to absorb a race).
# Guarded to only ever land project-memory.md: if HEAD carries anything else we
# refuse to push, so an opted-out (SPACORY_AGENT_ISOLATED=1) run in a real checkout
# can't shove unrelated commits onto main. Best-effort; never fails the run.
land_memory() {
  if ! git diff --quiet -- project-memory.md 2>/dev/null \
     || ! git diff --cached --quiet -- project-memory.md 2>/dev/null; then
    git add project-memory.md 2>/dev/null || true
    git commit -m "Update project memory (headless product run)" >/dev/null 2>&1 || true
  fi
  # Nothing committed beyond origin/main? Then there's nothing to push.
  [ -z "$(git rev-list origin/main..HEAD 2>/dev/null)" ] && return 0
  local changed; changed="$(git diff --name-only origin/main...HEAD 2>/dev/null || true)"
  if [ "$changed" != "project-memory.md" ]; then
    echo "warning: HEAD is ahead of origin/main with non-memory changes ($changed); not auto-landing on main" >&2
    return 0
  fi
  # Push HEAD:main, retrying the fetch+rebase+push a few times. The worktree is torn
  # down right after this, so a lost push means a lost memory commit — and the
  # dispatch lock only serializes *our* runs, not an external push to main. Re-basing
  # onto the advanced origin/main and retrying wins the race in practice; we only
  # warn (never fail the run) once a few attempts can't land it.
  local tries=0
  while :; do
    git fetch --quiet origin main 2>/dev/null || true
    git rebase --quiet origin/main >/dev/null 2>&1 || git rebase --abort >/dev/null 2>&1 || true
    if git push origin HEAD:main >/dev/null 2>&1; then
      if [ "$tries" -eq 0 ]; then
        echo "→ landed project-memory.md on main" >&2
      else
        echo "→ landed project-memory.md on main (attempt $((tries + 1)))" >&2
      fi
      return 0
    fi
    tries=$((tries + 1))
    [ "$tries" -ge 3 ] && break
    sleep 2
  done
  echo "warning: could not land project-memory.md on main after $tries attempts (origin/main kept advancing, or network down); NOT landed" >&2
}

echo "→ Product Agent  [$MODE]${NUM:+ #$NUM}  running…" >&2

args=( -p "$TASK"
       --append-system-prompt-file "$PROMPT"
       --permission-mode "$PERMISSION_MODE" )
[ -n "${CLAUDE_MODEL:-}" ] && args+=( --model "$CLAUDE_MODEL" )
[ -n "${CLAUDE_EFFORT:-}" ] && args+=( --effort "$CLAUDE_EFFORT" )

# Not `exec`: we need to land project-memory.md from this worktree before it's torn
# down by the wrapper's cleanup trap.
set +e
claude "${args[@]}"
rc=$?
set -e

land_memory
exit "$rc"
