#!/usr/bin/env bash
#
# Run the Spacory **Engineer Agent** in a fresh, headless Claude session against
# exactly ONE GitHub issue.
#
# It reads only the assigned issue (its single spec), implements it on a branch,
# runs the definition of done (check + tsc + tests), opens a PR that references
# the issue, and (optionally) posts a Telegram message. If the issue is
# ambiguous it comments asking for clarification and stops instead of guessing.
# See .agents/engineer-agent-prompt.md for the full role.
#
# Usage:
#   .agents/run-engineer.sh 2
#   .agents/run-engineer.sh '#2' "prefer the pure-geometry path"   # leading # ok
#
# Env overrides:
#   CLAUDE_PERMISSION_MODE   default: acceptEdits
#                            (use "bypassPermissions" for fully unattended runs)
#   CLAUDE_MODEL             default: the session default model
#
# Note: for an unattended headless run to not stall, the commands the agent uses
# must be permitted. This repo's .claude/settings.json allows git, npm, `gh pr`
# and `gh run`; the Engineer also reads/comments on issues, so you likely need
# `Bash(gh issue:*)` too. Either add that to the allowlist, or run with
# CLAUDE_PERMISSION_MODE=bypassPermissions in a trusted environment.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
PROMPT="$SCRIPT_DIR/engineer-agent-prompt.md"

command -v claude >/dev/null 2>&1 || { echo "error: 'claude' CLI not found on PATH" >&2; exit 1; }
[ -f "$PROMPT" ] || { echo "error: missing prompt file: $PROMPT" >&2; exit 1; }

ISSUE="${1:-}"
ISSUE="${ISSUE#\#}"   # tolerate a leading '#'
case "$ISSUE" in
  ''|*[!0-9]*)
    echo "usage: $(basename "$0") <issue-number> [extra instruction]" >&2
    exit 2
    ;;
esac
shift
EXTRA="${*:-}"

PERMISSION_MODE="${CLAUDE_PERMISSION_MODE:-acceptEdits}"

TASK="Implement GitHub issue #$ISSUE."
[ -n "$EXTRA" ] && TASK="$TASK Note for this run: $EXTRA"

cd "$REPO_ROOT"
echo "→ Engineer Agent  issue #$ISSUE  (permission-mode: $PERMISSION_MODE)" >&2

args=( -p "$TASK"
       --append-system-prompt-file "$PROMPT"
       --permission-mode "$PERMISSION_MODE" )
[ -n "${CLAUDE_MODEL:-}" ] && args+=( --model "$CLAUDE_MODEL" )

exec claude "${args[@]}"
