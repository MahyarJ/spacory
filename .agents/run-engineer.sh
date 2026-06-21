#!/usr/bin/env bash
#
# Run the Spacory **Engineer Agent** in a fresh, headless Claude session in ONE of
# its three modes. The Engineer Agent is one role (a senior engineer) in three
# capacities — see .agents/engineer-agent-prompt.md for the full contract.
#
#   implement  the issue is the only spec → branch + PR (default mode)
#   review     read-only pass over a PR   → posts a code-review comment
#   resolve    address a PR's comments    → new commits pushed to the PR's branch
#
# Usage:
#   .agents/run-engineer.sh 2                      # implement issue #2 (default)
#   .agents/run-engineer.sh implement 2            # explicit form
#   .agents/run-engineer.sh '#2' "prefer geometry" # leading # ok; optional note
#   .agents/run-engineer.sh review 14              # review PR #14 (comments only)
#   .agents/run-engineer.sh resolve 14             # resolve PR #14's review comments
#
# Fan-out: review and acceptance are independent read-only passes — run them in
# parallel by backgrounding separate calls, e.g.:
#   .agents/run-engineer.sh review 14 &
#   .agents/run-product.sh  acceptance 14 &
#   wait
#
# Env overrides:
#   CLAUDE_PERMISSION_MODE   default: acceptEdits
#                            (use "bypassPermissions" for fully unattended runs)
#   CLAUDE_MODEL             default: the session default model
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
  echo "usage: $(basename "$0") [implement|review|resolve] <number> [extra instruction]" >&2
  echo "       (a bare number defaults to: implement <number>)" >&2
  exit 2
}

# First arg may be a mode word; otherwise it's the number and the mode is implement.
MODE="implement"
case "${1:-}" in
  implement|review|resolve) MODE="$1"; shift ;;
esac

NUM="${1:-}"
NUM="${NUM#\#}"   # tolerate a leading '#'
case "$NUM" in
  ''|*[!0-9]*) usage ;;
esac
shift
EXTRA="${*:-}"

PERMISSION_MODE="${CLAUDE_PERMISSION_MODE:-acceptEdits}"

case "$MODE" in
  implement) TASK="Implement GitHub issue #$NUM." ;;
  review)    TASK="Review pull request #$NUM (Engineer Agent review mode): leave a code-review comment on the PR and make no code changes." ;;
  resolve)   TASK="Resolve the review comments on pull request #$NUM (Engineer Agent resolve mode): push fixes to the PR's branch." ;;
esac
[ -n "$EXTRA" ] && TASK="$TASK Note for this run: $EXTRA"

cd "$REPO_ROOT"
echo "→ Engineer Agent  [$MODE] #$NUM  (permission-mode: $PERMISSION_MODE)" >&2

args=( -p "$TASK"
       --append-system-prompt-file "$PROMPT"
       --permission-mode "$PERMISSION_MODE" )
[ -n "${CLAUDE_MODEL:-}" ] && args+=( --model "$CLAUDE_MODEL" )

exec claude "${args[@]}"
