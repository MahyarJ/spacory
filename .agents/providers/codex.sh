#!/usr/bin/env bash
# Codex loading adapter; CODEX_HOME is validated by engine.sh.
_launch_codex() {
  local prompt="$1" shim="$2" mode="$3"

  # Codex has no --append-system-prompt-file and no skill loader: fold the role
  # shim + a skill-resolution note into the prompt itself. The note is what lets
  # the canonical contracts drive Codex without copying role behavior.
  local shim_text=""
  [ -f "$shim" ] && shim_text="$(cat "$shim")"$'\n\n'
  local note
  note=$'NOTE FOR THIS RUN (Codex engine): this project\'s canonical agent instructions are plain Markdown files at .agents/instructions/<name>.md. Wherever the text below tells you to invoke or use the `<name>` skill, read .agents/instructions/<name>.md and follow it exactly. For a skill with no canonical file (such as ship), read .claude/skills/<name>/SKILL.md instead. If the prompt opens with a Claude slash-command line such as `/engineer-agent implement 2`, read it as: invoke the engineer-agent skill in "implement" mode on item #2. Do all your work through the gh and git CLIs and this repo\'s npm scripts.'
  local full="${shim_text}${note}"$'\n\n'"${prompt}"

  local args=( exec "$full" -C "$PWD" --skip-git-repo-check )
  [ -n "${SPACORY_RESOLVED_MODEL:-}" ] && args+=( -m "$SPACORY_RESOLVED_MODEL" )

  # Map the Claude permission vocabulary onto Codex sandbox/approval flags. Both
  # agents need to write the workspace AND reach the network (gh + the Telegram
  # curl in notify.sh), and must never stall on a prompt in a headless run.
  case "$mode" in
    bypassPermissions)
      args+=( --dangerously-bypass-approvals-and-sandbox ) ;;
    acceptEdits)
      args+=( --sandbox workspace-write
              -c approval_policy="never"
              -c sandbox_workspace_write.network_access=true ) ;;
  esac

  CODEX_HOME="$CODEX_HOME" codex "${args[@]}"
}
