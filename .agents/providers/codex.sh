#!/usr/bin/env bash
# Codex loading adapter; CODEX_HOME is validated by engine.sh.
# Resolve against this adapter's checkout, never the caller's cwd. Legacy
# launch_agent callers may supply the existing /role-agent mode first line.
_prepare_codex_contract() {
  local role="${SPACORY_AGENT_ROLE:-}" mode="${SPACORY_AGENT_MODE:-}"
  local first command ignored name file text
  local files=()
  if [ -z "$role" ]; then
    first="${1%%$'\n'*}"
    read -r command mode ignored <<< "$first"
    case "$command:$mode" in
      /product-agent:*) role=product ;;
      /engineer-agent:review) role=reviewer ;;
      /engineer-agent:*) role=engineer ;;
    esac
  fi
  case "$role:$mode" in
    product:cycle|product:acceptance|product:clarify|product:triage) files=(product-agent) ;;
    engineer:implement|engineer:resolve|engineer:reconcile|engineer:clarify) files=(engineer-agent) ;;
    reviewer:review) files=(reviewer engineer-agent) ;;
    *) _spacory_config_error 'Codex requires an explicit valid role/mode or /role-agent mode prompt'; return 1 ;;
  esac
  files+=(spacory-conventions spacory-verify spacory-notify)
  _SPACORY_CODEX_CONTRACT="Canonical instructions for role=$role mode=$mode. Run exactly this mode. The contracts below are already loaded; references to these skills mean the included text."
  for name in "${files[@]}"; do
    file="$_SPACORY_ENGINE_DIR/instructions/$name.md"
    [ -f "$file" ] && [ -r "$file" ] && [ -s "$file" ] || { _spacory_config_error "missing, empty, or unreadable canonical contract: $name.md"; return 1; }
    text="$(cat "$file")" || { _spacory_config_error "cannot read canonical contract: $name.md"; return 1; }
    _SPACORY_CODEX_CONTRACT+=$'\n\n'"BEGIN .agents/instructions/$name.md"$'\n'"$text"$'\n'"END .agents/instructions/$name.md"
  done
  SPACORY_AGENT_RESULT_ROLE="$role"
  SPACORY_AGENT_RESULT_MODE="$mode"
}

_launch_codex() {
  local prompt="$1" shim="$2" mode="$3"

  # All role/shared text was resolved and validated before any CLI process.
  local full
  full="$(cat "$shim")"$'\n\n'"$_SPACORY_CODEX_CONTRACT"$'\n\n'"$prompt"

  local args resume="${SPACORY_AGENT_RESUME_ID:-}"
  [ "$SPACORY_AGENT_ROLE:$SPACORY_AGENT_MODE" = reviewer:review ] || resume=''
  if [ -n "$resume" ]; then
    # --sandbox belongs to exec, while resume uses the current directory.
    args=( exec )
    [ "$mode" != acceptEdits ] || args+=( --sandbox workspace-write )
    args+=( resume "$resume" "$full" --all --skip-git-repo-check )
  else
    args=( exec "$full" -C "$PWD" --skip-git-repo-check )
  fi
  [ -z "${SPACORY_AGENT_USAGE_LOG:-}" ] || args+=( --json )
  [ -n "${SPACORY_RESOLVED_MODEL:-}" ] && args+=( -m "$SPACORY_RESOLVED_MODEL" )

  # Map the Claude permission vocabulary onto Codex sandbox/approval flags. Both
  # agents need to write the workspace AND reach the network (gh + the Telegram
  # curl in notify.sh), and must never stall on a prompt in a headless run.
  case "$mode" in
    bypassPermissions)
      args+=( --dangerously-bypass-approvals-and-sandbox ) ;;
    acceptEdits)
      [ -n "$resume" ] || args+=( --sandbox workspace-write )
      args+=( -c approval_policy="never"
              -c sandbox_workspace_write.network_access=true ) ;;
  esac

  CODEX_HOME="$CODEX_HOME" exec codex "${args[@]}"
}
