#!/usr/bin/env bash
#
# Run the Spacory **Product Agent** in a fresh, headless Claude session.
#
# It reads project-memory.md, surveys open/closed GitHub issues, creates new
# well-specified issues, updates project-memory.md, and (optionally) posts a
# Telegram summary. See .agents/product-agent-prompt.md for the full role.
#
# Usage:
#   .agents/run-product.sh
#   .agents/run-product.sh "focus on PNG/SVG export this cycle"   # extra steer
#
# Env overrides:
#   CLAUDE_PERMISSION_MODE   default: acceptEdits
#                            (use "bypassPermissions" for fully unattended runs)
#   CLAUDE_MODEL             default: the session default model
#
# Note: for an unattended headless run to not stall, the GitHub commands the
# agent uses must be permitted. This repo's .claude/settings.json allows git and
# `gh pr/run`, but you likely also need `Bash(gh issue:*)` (the Product Agent
# creates issues). Either add that to the allowlist, or run with
# CLAUDE_PERMISSION_MODE=bypassPermissions in a trusted environment.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
PROMPT="$SCRIPT_DIR/product-agent-prompt.md"

command -v claude >/dev/null 2>&1 || { echo "error: 'claude' CLI not found on PATH" >&2; exit 1; }
[ -f "$PROMPT" ] || { echo "error: missing prompt file: $PROMPT" >&2; exit 1; }

PERMISSION_MODE="${CLAUDE_PERMISSION_MODE:-acceptEdits}"
EXTRA="${*:-}"

TASK="Run a product cycle for this repo."
[ -n "$EXTRA" ] && TASK="$TASK Additional focus for this run: $EXTRA"

cd "$REPO_ROOT"
echo "→ Product Agent  (permission-mode: $PERMISSION_MODE)" >&2

args=( -p "$TASK"
       --append-system-prompt-file "$PROMPT"
       --permission-mode "$PERMISSION_MODE" )
[ -n "${CLAUDE_MODEL:-}" ] && args+=( --model "$CLAUDE_MODEL" )

exec claude "${args[@]}"
