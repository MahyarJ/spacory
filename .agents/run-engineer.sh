#!/usr/bin/env bash
#
# Run the Spacory **Engineer Agent** in a fresh, headless Claude session in ONE of
# its modes. The Engineer Agent is one role (a senior engineer) in several
# capacities — the full contract lives in the `engineer-agent` skill
# (.claude/skills/engineer-agent/SKILL.md); engineer-agent-prompt.md is a thin
# shim that points the headless run at it.
#
#   implement  the issue is the only spec → branch + PR (default mode)
#   review     read-only pass over a PR   → posts a code-review comment
#   resolve    address a PR's comments    → new commits pushed to the PR's branch
#   reconcile  branch conflicts with main → merge main in, fix conflicts, push
#   clarify    answer technical questions → posts a reply comment (no code changes)
#
# Usage:
#   .agents/run-engineer.sh 2                      # implement issue #2 (default)
#   .agents/run-engineer.sh implement 2            # explicit form
#   .agents/run-engineer.sh '#2' "prefer geometry" # leading # ok; optional note
#   .agents/run-engineer.sh review 14              # review PR #14 (comments only)
#   .agents/run-engineer.sh resolve 14             # resolve PR #14's review comments
#   .agents/run-engineer.sh reconcile 14           # merge main into PR #14, fix conflicts
#   .agents/run-engineer.sh clarify 14             # answer technical questions on #14
#
# Fan-out: review and acceptance are independent read-only passes — run them in
# parallel by backgrounding separate calls, e.g.:
#   .agents/run-engineer.sh review 14 &
#   .agents/run-product.sh  acceptance 14 &
#   wait
#
# Isolation: an engineer run creates branches and edits files, so it must never
# touch the caller's working tree (the primary checkout a human or a concurrent run
# may be using). This script re-runs itself inside a throwaway git worktree detached
# at the freshly-fetched origin/main and tears it down afterwards — so the same
# safety holds whether it's fired by the dispatcher or by hand. Set
# SPACORY_AGENT_ISOLATED=1 to skip that (the dispatcher relies on the guard to avoid
# double-wrapping; CI/tests where the checkout is already disposable can too).
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
#                            repo pins "opus".
#   CLAUDE_EFFORT            default: the CLI's default effort. Set in
#                            .agents/.env to pin a reasoning-effort level (e.g.
#                            "high"); passed through as `--effort`.
#
# Note: for an unattended headless run to not stall, the commands the agent uses
# must be permitted. This repo's .claude/settings.json allows git, npm, `gh pr`
# and `gh run`; implement/review also use `gh issue`, so you likely need
# `Bash(gh issue:*)` too. Either add that to the allowlist, or run with
# CLAUDE_PERMISSION_MODE=bypassPermissions in a trusted environment.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
PROMPT="$SCRIPT_DIR/engineer-agent-prompt.md"

command -v claude >/dev/null 2>&1 || { echo "error: 'claude' CLI not found on PATH" >&2; exit 1; }
[ -f "$PROMPT" ] || { echo "error: missing prompt file: $PROMPT" >&2; exit 1; }

usage() {
  echo "usage: $(basename "$0") [implement|review|resolve|reconcile|clarify] <number> [extra instruction]" >&2
  echo "       (a bare number defaults to: implement <number>)" >&2
  exit 2
}

# Keep the caller's exact argv so we can re-invoke ourselves verbatim inside the
# isolation worktree below (preserving a multi-word extra-instruction argument).
ORIG_ARGS=("$@")

# First arg may be a mode word; otherwise it's the number and the mode is implement.
MODE="implement"
case "${1:-}" in
  implement|review|resolve|reconcile|clarify) MODE="$1"; shift ;;
esac

NUM="${1:-}"
NUM="${NUM#\#}"   # tolerate a leading '#'
case "$NUM" in
  ''|*[!0-9]*) usage ;;
esac
shift
EXTRA="${*:-}"

# ── isolation: run in a throwaway git worktree, never the caller's checkout ────
# (args are validated above, so a bad invocation fails before we create anything.)
SPACORY_WORKTREE_BASE="${SPACORY_WORKTREE_BASE:-${TMPDIR:-/tmp}/spacory-agent-worktrees}"
if [ -z "${SPACORY_AGENT_ISOLATED:-}" ]; then
  command -v git >/dev/null 2>&1 || { echo "error: git required to isolate the run" >&2; exit 1; }
  git -C "$REPO_ROOT" fetch --quiet origin \
    || { echo "error: git fetch failed; cannot isolate the run" >&2; exit 1; }
  mkdir -p "$SPACORY_WORKTREE_BASE"
  WORKTREE="$SPACORY_WORKTREE_BASE/run-$$-${RANDOM}"
  git -C "$REPO_ROOT" worktree add --detach --quiet "$WORKTREE" origin/main \
    || { echo "error: git worktree add failed ($WORKTREE)" >&2; exit 1; }
  # Reuse the caller's installed deps so the verify gate runs without npm install.
  if [ -d "$REPO_ROOT/node_modules" ] && [ ! -e "$WORKTREE/node_modules" ]; then
    ln -s "$REPO_ROOT/node_modules" "$WORKTREE/node_modules"
  fi
  cleanup_worktree() {
    git -C "$REPO_ROOT" worktree remove --force "$WORKTREE" 2>/dev/null || rm -rf "$WORKTREE"
    git -C "$REPO_ROOT" worktree prune 2>/dev/null || true
  }
  trap cleanup_worktree EXIT
  echo "→ isolating engineer run in worktree ${WORKTREE##*/} (detached at origin/main)" >&2
  # Re-invoke the worktree's OWN copy so REPO_ROOT resolves to it; the guard stops
  # that copy from isolating again (or the dispatcher from double-wrapping).
  set +e
  SPACORY_AGENT_ISOLATED=1 "$WORKTREE/.agents/run-engineer.sh" "${ORIG_ARGS[@]}"
  rc=$?
  set -e
  exit "$rc"
fi

PERMISSION_MODE="${CLAUDE_PERMISSION_MODE:-acceptEdits}"

case "$MODE" in
  implement) TASK="Implement GitHub issue #$NUM." ;;
  review)    TASK="Review pull request #$NUM (Engineer Agent review mode): leave a code-review comment on the PR and make no code changes." ;;
  resolve)   TASK="Resolve the review comments on pull request #$NUM (Engineer Agent resolve mode): push fixes to the PR's branch." ;;
  reconcile) TASK="Reconcile the merge conflicts on pull request #$NUM (Engineer Agent reconcile mode): merge the latest origin/main into the PR's branch, resolve the conflicts preserving BOTH sides' intent, re-verify, and push. Merge — never rebase or force-push. This is NOT resolving review comments." ;;
  clarify)   TASK="Answer the technical questions on #$NUM (Engineer Agent clarify mode): reply on the thread answering the engineering questions, defer any product questions to the Product Agent, and make no CODE changes. This mode DOES own the PR's own non-code metadata: if the thread shows a settled decision that the PR's title or description is stale/inaccurate, fix it with \`gh pr edit\` — that is your artifact and no other mode will touch it." ;;
esac
[ -n "$EXTRA" ] && TASK="$TASK Note for this run: $EXTRA"

# Lead the prompt with the slash-command form so Claude Code deterministically
# expands the engineer-agent skill (the documented user-invoked path) instead of
# relying on the model to invoke it from the appended shim. $MODE is exactly the
# skill's mode word (implement|review|resolve|reconcile|clarify); the descriptive
# task below still selects the mode and carries any extra note.
TASK="/engineer-agent $MODE $NUM

$TASK"

cd "$REPO_ROOT"
echo "→ Engineer Agent  [$MODE] #$NUM  (permission-mode: $PERMISSION_MODE)" >&2

args=( -p "$TASK"
       --append-system-prompt-file "$PROMPT"
       --permission-mode "$PERMISSION_MODE" )
[ -n "${CLAUDE_MODEL:-}" ] && args+=( --model "$CLAUDE_MODEL" )
[ -n "${CLAUDE_EFFORT:-}" ] && args+=( --effort "$CLAUDE_EFFORT" )

exec claude "${args[@]}"
