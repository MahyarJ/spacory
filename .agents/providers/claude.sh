#!/usr/bin/env bash
# Claude loading adapter. Keep the legacy CLI argument shape.
_launch_claude() {
  local prompt="$1" shim="$2" mode="$3"
  local args=( -p "$prompt" --append-system-prompt-file "$shim" --permission-mode "$mode" )
  [ -n "${SPACORY_RESOLVED_MODEL:-}" ]  && args+=( --model  "$SPACORY_RESOLVED_MODEL" )
  [ -n "${CLAUDE_EFFORT:-}" ] && args+=( --effort "$CLAUDE_EFFORT" )
  claude "${args[@]}"
}
