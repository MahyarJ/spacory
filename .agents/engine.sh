#!/usr/bin/env bash
# Source-only shell interface; no agent process launches until launch_agent is called.
# configure_agent <role> <mode>; require_engine; launch_agent <prompt> <shim> <permissions>
# launch_agent returns the RAW CLI exit code while streaming and capturing stdout/stderr.
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

# A subshell owns all temporary resources and traps. FD 3/4 are the caller's
# stdout/stderr; stdout itself returns only Bash-quoted result assignments.
# Private provider launchers exec here so cli_pid is the actual CLI process.
_spacory_stream_agent() (
  # Subshell variables survive explicit exit until EXIT traps run on Bash 3.2.
  capture='' cli_pid='' stdout_pid='' stderr_pid='' rc=0 output='' errors=''
  _spacory_cleanup_capture() {
    local pid
    for pid in "$cli_pid" "$stdout_pid" "$stderr_pid"; do
      [ -z "$pid" ] || { kill -TERM "$pid" 2>/dev/null || :; }
    done
    for pid in "$cli_pid" "$stdout_pid" "$stderr_pid"; do
      [ -z "$pid" ] || { wait "$pid" 2>/dev/null || :; }
    done
    if [ -n "$capture" ]; then
      rm -f "$capture/stdout" "$capture/stderr" "$capture/stdout.pipe" "$capture/stderr.pipe"
      rmdir "$capture"
    fi
  }
  trap _spacory_cleanup_capture EXIT
  trap 'exit 129' HUP
  trap 'exit 130' INT
  trap 'exit 143' TERM
  capture="$(mktemp -d "${TMPDIR:-/tmp}/spacory-agent-result.XXXXXX")" || exit 1
  mkfifo "$capture/stdout.pipe" "$capture/stderr.pipe" || exit 1
  tee "$capture/stdout" <"$capture/stdout.pipe" >&3 &
  stdout_pid=$!
  tee "$capture/stderr" <"$capture/stderr.pipe" >&4 &
  stderr_pid=$!
  case "$(spacory_engine)" in
    claude) _launch_claude "$@" >"$capture/stdout.pipe" 2>"$capture/stderr.pipe" <&0 & ;;
    codex) _launch_codex "$@" >"$capture/stdout.pipe" 2>"$capture/stderr.pipe" <&0 & ;;
  esac
  cli_pid=$!
  wait "$cli_pid" || rc=$?
  cli_pid=''
  # Explicitly drain both readers before reading results or removing resources.
  wait "$stdout_pid" || :
  stdout_pid=''
  wait "$stderr_pid" || :
  stderr_pid=''
  output="$(cat "$capture/stdout"; printf '.')"
  errors="$(cat "$capture/stderr"; printf '.')"
  # %q is Bash-generated shell quoting: agent text is data, never shell code.
  printf 'SPACORY_AGENT_RESULT_STDOUT=%q\n' "${output%.}"
  printf 'SPACORY_AGENT_RESULT_STDERR=%q\n' "${errors%.}"
  printf 'SPACORY_AGENT_RESULT_EXIT_CODE=%q\n' "$rc"
)

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
  local metadata stream_rc=0 rc
  if [ "$(spacory_engine)" = codex ]; then
    _prepare_codex_contract "$1" || return
  fi
  # Scope FD changes to this block; preserve caller descriptors and traps.
  { metadata="$(_spacory_stream_agent "$@")" || stream_rc=$?; } 3>&1 4>&2
  if [ "$stream_rc" -ne 0 ]; then
    SPACORY_AGENT_RESULT_EXIT_CODE="$stream_rc"
    SPACORY_AGENT_RESULT_STATUS=execution_error
    return "$stream_rc"
  fi
  eval "$metadata"
  rc="$SPACORY_AGENT_RESULT_EXIT_CODE"
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
