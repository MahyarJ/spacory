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
#
# Usage:
#   .agents/run-product.sh                                  # run a product cycle
#   .agents/run-product.sh "focus on PNG/SVG export"        # cycle + extra steer
#   .agents/run-product.sh acceptance 14                    # acceptance-test PR #14
#   .agents/run-product.sh acceptance 14 "watch mobile UX"  # acceptance + extra note
#   .agents/run-product.sh clarify 9                        # answer product Qs on #9
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

# acceptance and clarify both take a number; cycle is the default and takes none.
MODE="cycle"
case "${1:-}" in
  acceptance|clarify)
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
  *)
    TASK="Run a product cycle for this repo."
    [ -n "$EXTRA" ] && TASK="$TASK Additional focus for this run: $EXTRA"
    echo "→ Product Agent  [cycle]  (permission-mode: $PERMISSION_MODE)" >&2
    ;;
esac

# Lead the prompt with the slash-command form so Claude Code deterministically
# expands the product-agent skill (the documented user-invoked path) instead of
# relying on the model to invoke it from the appended shim. $MODE is the skill's
# mode word (cycle|acceptance|clarify); cycle takes no number.
SLASH="/product-agent $MODE"
[ -n "${NUM:-}" ] && SLASH="$SLASH $NUM"
TASK="$SLASH

$TASK"

cd "$REPO_ROOT"

args=( -p "$TASK"
       --append-system-prompt-file "$PROMPT"
       --permission-mode "$PERMISSION_MODE" )
[ -n "${CLAUDE_MODEL:-}" ] && args+=( --model "$CLAUDE_MODEL" )

exec claude "${args[@]}"
