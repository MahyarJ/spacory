#!/usr/bin/env bash
#
# Install (or remove) the Spacory agent launchd jobs for the CURRENT user.
# Renders the *.plist.template files with this checkout's absolute path and a PATH
# that actually contains gh / claude / node / git, then loads them so macOS runs
# them on a timer even across logins/reboots.
#
#   .agents/launchd/install.sh install     # render + load both jobs (default)
#   .agents/launchd/install.sh uninstall   # unload + remove both jobs
#   .agents/launchd/install.sh status      # show whether they're loaded
#
# Notes:
#   * These are per-user LaunchAgents (~/Library/LaunchAgents) — they run as you,
#     reusing your existing `claude` and `gh` auth. No secrets are copied anywhere.
#   * They only run while you're logged in and the Mac is awake. For always-on,
#     use GitHub Actions instead (see docs/AUTOMATION.md).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
DEST="$HOME/Library/LaunchAgents"
LABELS=(com.spacory.agents.dispatch com.spacory.agents.cycle)
UID_NUM="$(id -u)"

# Build a PATH that contains every tool the agents shell out to, by resolving each
# binary's real directory and unioning them with the usual suspects.
build_path() {
  local dirs=() b d
  for b in gh claude node npm git bash; do
    if d="$(command -v "$b" 2>/dev/null)"; then dirs+=("$(dirname "$d")"); fi
  done
  dirs+=(/opt/homebrew/bin /usr/local/bin /usr/bin /bin /usr/sbin /sbin)
  printf '%s\n' "${dirs[@]}" | awk '!seen[$0]++' | paste -sd: -
}

render_and_load() {
  local path_val; path_val="$(build_path)"
  mkdir -p "$DEST" "$REPO_ROOT/.agents/logs"
  local label plist
  for label in "${LABELS[@]}"; do
    plist="$DEST/$label.plist"
    sed -e "s|__REPO_ROOT__|$REPO_ROOT|g" -e "s|__PATH__|$path_val|g" \
      "$SCRIPT_DIR/$label.plist.template" > "$plist"
    launchctl bootout "gui/$UID_NUM/$label" 2>/dev/null || true
    launchctl bootstrap "gui/$UID_NUM" "$plist"
    echo "loaded  $label"
  done
  echo
  echo "PATH given to jobs: $path_val"
  echo "Logs: $REPO_ROOT/.agents/logs/{dispatch,cycle}.log"
}

unload_and_remove() {
  local label
  for label in "${LABELS[@]}"; do
    launchctl bootout "gui/$UID_NUM/$label" 2>/dev/null || true
    rm -f "$DEST/$label.plist"
    echo "removed $label"
  done
}

show_status() {
  local label
  for label in "${LABELS[@]}"; do
    if launchctl print "gui/$UID_NUM/$label" >/dev/null 2>&1; then
      echo "loaded      $label"
    else
      echo "not loaded  $label"
    fi
  done
}

case "${1:-install}" in
  install)   render_and_load ;;
  uninstall) unload_and_remove ;;
  status)    show_status ;;
  *) echo "usage: $(basename "$0") [install|uninstall|status]" >&2; exit 2 ;;
esac
