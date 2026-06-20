#!/usr/bin/env bash
#
# Run the Spacory **Product Agent** in a fresh, headless Claude session in ONE of
# its two modes. The Product Agent is one role (product) in two capacities —
# see .agents/product-agent-prompt.md for the full contract.
#
#   cycle       read project-memory.md + issues → create/refine issues (default)
#   acceptance  judge a PR vs the issue's criteria → posts an acceptance comment
#
# Usage:
#   .agents/run-product.sh                                  # run a product cycle
#   .agents/run-product.sh "focus on PNG/SVG export"        # cycle + extra steer
#   .agents/run-product.sh acceptance 14                    # acceptance-test PR #14
#   .agents/run-product.sh acceptance 14 "watch mobile UX"  # acceptance + extra note
#
# Env overrides:
#   CLAUDE_PERMISSION_MODE   default: acceptEdits
#                            (use "bypassPermissions" for fully unattended runs)
#   CLAUDE_MODEL             default: the session default model
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

PERMISSION_MODE="${CLAUDE_PERMISSION_MODE:-acceptEdits}"

MODE="cycle"
if [ "${1:-}" = "acceptance" ]; then
  MODE="acceptance"
  shift
  PR="${1:-}"
  PR="${PR#\#}"   # tolerate a leading '#'
  case "$PR" in
    ''|*[!0-9]*)
      echo "usage: $(basename "$0") acceptance <pr-number> [extra instruction]" >&2
      exit 2
      ;;
  esac
  shift
fi
EXTRA="${*:-}"

if [ "$MODE" = "acceptance" ]; then
  TASK="Acceptance-test pull request #$PR (Product Agent acceptance mode): verify it against the linked issue's acceptance criteria and user value, leave a comment, and make no code changes or project-memory.md edits."
  [ -n "$EXTRA" ] && TASK="$TASK Note for this run: $EXTRA"
  echo "→ Product Agent  [acceptance] #$PR  (permission-mode: $PERMISSION_MODE)" >&2
else
  TASK="Run a product cycle for this repo."
  [ -n "$EXTRA" ] && TASK="$TASK Additional focus for this run: $EXTRA"
  echo "→ Product Agent  [cycle]  (permission-mode: $PERMISSION_MODE)" >&2
fi

cd "$REPO_ROOT"

args=( -p "$TASK"
       --append-system-prompt-file "$PROMPT"
       --permission-mode "$PERMISSION_MODE" )
[ -n "${CLAUDE_MODEL:-}" ] && args+=( --model "$CLAUDE_MODEL" )

exec claude "${args[@]}"
