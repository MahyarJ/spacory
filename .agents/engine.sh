#!/usr/bin/env bash
#
# Shared agent-engine adapter for the Spacory headless runners
# (run-engineer.sh / run-product.sh).
#
# Those runners are engine-agnostic: each builds a prompt plus a role "shim"
# system-prompt file, then hands both to whichever coding-agent CLI is selected
# by SPACORY_AGENT_ENGINE (default: claude). Everything downstream — the six
# `.claude/skills/*/SKILL.md` files, the dispatcher, notify.sh, the worktree
# isolation — is plain Markdown + gh/git/npm and needs no per-engine change.
#
# Claude Code does two things Codex has no native equivalent for:
#   1. --append-system-prompt-file  → inject the role shim as a system prompt.
#   2. `/engineer-agent implement 2` slash form → auto-load the matching SKILL.md.
# The codex backend folds the shim into the prompt and prepends a short note that
# maps Claude's "invoke the <name> skill" / slash vocabulary onto "read
# .claude/skills/<name>/SKILL.md and follow it" — so the same skills drive the
# run unchanged, no duplication.
#
# Contract:
#   require_engine                       # fail loud if the selected CLI is missing
#   launch_agent <prompt> <shim_file> <permission_mode>
#                                        # run the engine to completion, return its rc
#
# Env read here:
#   SPACORY_AGENT_ENGINE   claude (default) | codex
#   CLAUDE_MODEL           model for claude   (--model);  ignored by codex
#   CLAUDE_EFFORT          reasoning effort   (--effort); claude only
#   CODEX_MODEL            model for codex    (-m);       optional (else codex default)
# The <permission_mode> arg is the caller's resolved CLAUDE_PERMISSION_MODE.

spacory_engine() { printf '%s' "${SPACORY_AGENT_ENGINE:-claude}"; }

# Mirror the old inline `command -v claude` gate: fail before launching a session
# if the selected engine's CLI isn't installed (or the engine name is bogus).
require_engine() {
  case "$(spacory_engine)" in
    claude) command -v claude >/dev/null 2>&1 \
              || { echo "error: 'claude' CLI not found on PATH" >&2; return 1; } ;;
    codex)  command -v codex  >/dev/null 2>&1 \
              || { echo "error: 'codex' CLI not found on PATH (SPACORY_AGENT_ENGINE=codex)" >&2; return 1; } ;;
    *)      echo "error: unknown SPACORY_AGENT_ENGINE='$(spacory_engine)' (expected 'claude' or 'codex')" >&2; return 1 ;;
  esac
}

# launch_agent <prompt> <shim_file> <permission_mode>
launch_agent() {
  case "$(spacory_engine)" in
    codex) _launch_codex "$@" ;;
    *)     _launch_claude "$@" ;;
  esac
}

_launch_claude() {
  local prompt="$1" shim="$2" mode="$3"
  local args=( -p "$prompt" --append-system-prompt-file "$shim" --permission-mode "$mode" )
  [ -n "${CLAUDE_MODEL:-}" ]  && args+=( --model  "$CLAUDE_MODEL" )
  [ -n "${CLAUDE_EFFORT:-}" ] && args+=( --effort "$CLAUDE_EFFORT" )
  claude "${args[@]}"
}

_launch_codex() {
  local prompt="$1" shim="$2" mode="$3"

  # Codex has no --append-system-prompt-file and no skill loader: fold the role
  # shim + a skill-resolution note into the prompt itself. The note is what lets
  # the unmodified SKILL.md files (which reference each other by path) drive Codex.
  local shim_text=""
  [ -f "$shim" ] && shim_text="$(cat "$shim")"$'\n\n'
  local note
  note=$'NOTE FOR THIS RUN (Codex engine): this project\'s agent instructions are Claude Code "skills" — plain Markdown files at .claude/skills/<name>/SKILL.md. Wherever the text below tells you to invoke or use the `<name>` skill, read .claude/skills/<name>/SKILL.md and follow it exactly. If the prompt opens with a Claude slash-command line such as `/engineer-agent implement 2`, read it as: invoke the engineer-agent skill in "implement" mode on item #2. Do all your work through the gh and git CLIs and this repo\'s npm scripts.'
  local full="${shim_text}${note}"$'\n\n'"${prompt}"

  local args=( exec "$full" -C "$PWD" --skip-git-repo-check )
  [ -n "${CODEX_MODEL:-}" ] && args+=( -m "$CODEX_MODEL" )

  # Map the Claude permission vocabulary onto Codex sandbox/approval flags. Both
  # agents need to write the workspace AND reach the network (gh + the Telegram
  # curl in notify.sh), and must never stall on a prompt in a headless run.
  case "$mode" in
    bypassPermissions)
      args+=( --dangerously-bypass-approvals-and-sandbox ) ;;
    *)  # acceptEdits (default) and anything else.
      args+=( --sandbox workspace-write
              -c approval_policy="never"
              -c sandbox_workspace_write.network_access=true ) ;;
  esac

  codex "${args[@]}"
}
