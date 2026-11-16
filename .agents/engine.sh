#!/usr/bin/env bash
# Source-only shell interface; no agent process launches until launch_agent is called.
# configure_agent <role> <mode>; require_engine; launch_agent <prompt> <shim> <permissions>
# launch_agent returns the RAW CLI exit code and replays captured stdout/stderr.
# Result variables: SPACORY_AGENT_RESULT_{PROVIDER,MODEL,ROLE,MODE,STATUS,EXIT_CODE,STDOUT,STDERR}.
# STATUS: success | configuration_error | authentication_error | execution_error.

_SPACORY_ENGINE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$_SPACORY_ENGINE_DIR/providers/claude.sh"
source "$_SPACORY_ENGINE_DIR/providers/codex.sh"

# Indirect expansion works on macOS Bash 3.2. Empty overrides fall through.
_spacory_setting() {
  local key value
  for key in "$@"; do
    value="${!key:-}"
    if [ -n "$value" ]; then printf '%s' "$value"; return; fi
  done
}

configure_agent() {
  SPACORY_AGENT_ROLE="${1:-}"
  SPACORY_AGENT_MODE="${2:-}"
  local role mode prefix legacy_model=CLAUDE_MODEL
  case "$SPACORY_AGENT_ROLE:$SPACORY_AGENT_MODE" in
    product:cycle|product:acceptance|product:clarify|product:triage|engineer:implement|engineer:resolve|engineer:reconcile|engineer:clarify|reviewer:review|:) ;;
    *) _spacory_reset_result; _spacory_config_error 'invalid agent role/mode'; return 1 ;;
  esac
  role="$(printf '%s' "$SPACORY_AGENT_ROLE" | tr '[:lower:]' '[:upper:]')"
  mode="$(printf '%s' "$SPACORY_AGENT_MODE" | tr '[:lower:]' '[:upper:]')"
  prefix="SPACORY_${role}"
  SPACORY_RESOLVED_PROVIDER="$(_spacory_setting "${prefix}_${mode}_PROVIDER" "${prefix}_PROVIDER" SPACORY_AGENT_PROVIDER SPACORY_AGENT_ENGINE)"
  SPACORY_RESOLVED_PROVIDER="${SPACORY_RESOLVED_PROVIDER:-claude}"
  [ "$SPACORY_RESOLVED_PROVIDER" != codex ] || legacy_model=CODEX_MODEL
  SPACORY_RESOLVED_MODEL="$(_spacory_setting "${prefix}_${mode}_MODEL" "${prefix}_MODEL" SPACORY_AGENT_MODEL "$legacy_model")"
}

spacory_engine() { printf '%s' "${SPACORY_RESOLVED_PROVIDER:-${SPACORY_AGENT_PROVIDER:-${SPACORY_AGENT_ENGINE:-claude}}}"; }

_spacory_reset_result() {
  SPACORY_AGENT_RESULT_PROVIDER="$(spacory_engine)"
  SPACORY_AGENT_RESULT_MODEL="${SPACORY_RESOLVED_MODEL:-}"
  SPACORY_AGENT_RESULT_ROLE="${SPACORY_AGENT_ROLE:-}"
  SPACORY_AGENT_RESULT_MODE="${SPACORY_AGENT_MODE:-}"
  SPACORY_AGENT_RESULT_STATUS=success
  SPACORY_AGENT_RESULT_EXIT_CODE=0
  SPACORY_AGENT_RESULT_STDOUT=''
  SPACORY_AGENT_RESULT_STDERR=''
}

_spacory_config_error() {
  SPACORY_AGENT_RESULT_STATUS=configuration_error
  SPACORY_AGENT_RESULT_EXIT_CODE=1
  SPACORY_AGENT_RESULT_STDERR="error: $*"$'\n'
  printf '%s' "$SPACORY_AGENT_RESULT_STDERR" >&2
  return 1
}

require_engine() {
  # Preserve the legacy zero-argument API.
  configure_agent "${SPACORY_AGENT_ROLE:-}" "${SPACORY_AGENT_MODE:-}" || return
  _spacory_reset_result
  local provider; provider="$(spacory_engine)"
  case "$provider" in
    claude) ;;
    codex)
      [ -n "${CODEX_HOME:-}" ] || { _spacory_config_error 'set CODEX_HOME explicitly in the calling environment to select the Codex account'; return 1; }
      case "$CODEX_HOME" in
        /*) ;;
        *) _spacory_config_error 'CODEX_HOME must be an absolute path'; return 1 ;;
      esac
      [ -d "$CODEX_HOME" ] && [ -r "$CODEX_HOME" ] && [ -x "$CODEX_HOME" ] || { _spacory_config_error 'CODEX_HOME must be an existing accessible directory'; return 1; }
      ;;
    *) _spacory_config_error "unknown agent provider '$provider' (expected claude or codex)"; return 1 ;;
  esac
  command -v "$provider" >/dev/null 2>&1 || { _spacory_config_error "'$provider' CLI not found on PATH"; return 1; }
}

launch_agent() {
  require_engine || return
  [ "$#" -eq 3 ] || { _spacory_config_error 'launch_agent requires prompt, shim, and permission mode'; return 1; }
  [ -f "$2" ] && [ -r "$2" ] || { _spacory_config_error "missing or unreadable prompt file: $2"; return 1; }
  if [ "$(spacory_engine)" = codex ]; then
    case "$3" in
      acceptEdits|bypassPermissions) ;;
      *) _spacory_config_error "unsupported Codex permission mapping: $3"; return 1 ;;
    esac
  fi
  local capture rc=0
  capture="$(mktemp -d "${TMPDIR:-/tmp}/spacory-agent-result.XXXXXX")" || { _spacory_config_error 'cannot create result capture directory'; return 1; }
  # Conditional invocation records failures without changing the caller's errexit.
  case "$(spacory_engine)" in
    claude) _launch_claude "$@" >"$capture/stdout" 2>"$capture/stderr" || rc=$? ;;
    codex) _launch_codex "$@" >"$capture/stdout" 2>"$capture/stderr" || rc=$? ;;
  esac
  # Sentinel preserves trailing newlines in the normalized shell strings.
  SPACORY_AGENT_RESULT_STDOUT="$(cat "$capture/stdout"; printf '.')"
  SPACORY_AGENT_RESULT_STDOUT="${SPACORY_AGENT_RESULT_STDOUT%.}"
  SPACORY_AGENT_RESULT_STDERR="$(cat "$capture/stderr"; printf '.')"
  SPACORY_AGENT_RESULT_STDERR="${SPACORY_AGENT_RESULT_STDERR%.}"
  cat "$capture/stdout"
  cat "$capture/stderr" >&2
  rm -f "$capture/stdout" "$capture/stderr"
  rmdir "$capture"
  SPACORY_AGENT_RESULT_EXIT_CODE="$rc"
  if [ "$rc" -ne 0 ]; then
    SPACORY_AGENT_RESULT_STATUS=execution_error
    local diagnostics
    diagnostics="$(printf '%s\n%s' "$SPACORY_AGENT_RESULT_STDERR" "$SPACORY_AGENT_RESULT_STDOUT" | tr '[:upper:]' '[:lower:]')"
    case "$diagnostics" in
      *'not logged in'*|*'not authenticated'*|*'authentication failed'*|*'failed to authenticate'*|*'oauth token has expired'*|*'please run /login'*|*'refresh_token_reused'*|*'authentication_error'*|*'invalid api key'*|*'invalid_api_key'*|*'token expired'*|*'unauthorized'*) SPACORY_AGENT_RESULT_STATUS=authentication_error ;;
      *'unknown model'*|*'invalid model'*|*'model not found'*|*'model_not_found'*|*'invalid configuration'*|*'error loading config'*|*'failed to load config'*|*'unrecognized option'*|*'unknown option'*|*'unexpected argument'*) SPACORY_AGENT_RESULT_STATUS=configuration_error ;;
    esac
  fi
  return "$rc"
}
