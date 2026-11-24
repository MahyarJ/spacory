#!/usr/bin/env bash
# Claude loading adapter. Keep the legacy CLI argument shape.
_launch_claude() {
  local prompt="$1" shim="$2" mode="$3"
  local args=( -p "$prompt" --append-system-prompt-file "$shim" --permission-mode "$mode" )
  [ -n "${SPACORY_RESOLVED_MODEL:-}" ]  && args+=( --model  "$SPACORY_RESOLVED_MODEL" )
  [ -n "${CLAUDE_EFFORT:-}" ] && args+=( --effort "$CLAUDE_EFFORT" )
  [ -z "${SPACORY_AGENT_USAGE_LOG:-}" ] || args+=( --output-format stream-json --verbose )
  if [ "$SPACORY_AGENT_ROLE:$SPACORY_AGENT_MODE" = reviewer:review ] && [ -n "${SPACORY_AGENT_RESUME_ID:-}" ]; then
    args+=( --resume "$SPACORY_AGENT_RESUME_ID" )
  fi
  exec claude "${args[@]}"
}
