#!/usr/bin/env bash
# Install or remove the Spacory systemd jobs from the /opt/spacory checkout.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd -P)"
CHECKOUT=/opt/spacory
UNIT_DIR=/etc/systemd/system
TEMPLATE=spacory-agents@.service
WEBHOOK=spacory-agents-webhook.service
TIMERS=(spacory-agents-tick.timer spacory-agents-cycle.timer)
JOBS=("$WEBHOOK" "${TIMERS[@]}")

as_root() {
  if [ "$EUID" -eq 0 ]; then "$@"; else sudo -- "$@"; fi
}

install_units() {
  if [ ! -d "$CHECKOUT" ] || [ "$REPO_ROOT" != "$(cd "$CHECKOUT" && pwd -P)" ]; then
    echo "Run install from the Spacory checkout at $CHECKOUT." >&2
    return 1
  fi
  if ! id -u spacory >/dev/null 2>&1; then
    echo 'Create the spacory service account before installing. See docs/AUTOMATION.md.' >&2
    return 1
  fi

  local unit sources=()
  for unit in "$TEMPLATE" "${JOBS[@]}"; do sources+=("$SCRIPT_DIR/$unit"); done
  systemd-analyze verify "${sources[@]}"
  as_root install -m 0644 -- "${sources[@]}" "$UNIT_DIR/"
  as_root systemctl daemon-reload
  as_root systemctl enable --now "${JOBS[@]}"
}

uninstall_units() {
  local unit worker state installed=()
  for unit in "$TEMPLATE" "${JOBS[@]}"; do
    if [ -f "$UNIT_DIR/$unit" ]; then installed+=("$UNIT_DIR/$unit"); fi
  done
  if [ "${#installed[@]}" -eq 0 ]; then
    echo 'Spacory systemd units are not installed.'
    return 0
  fi

  for unit in "${JOBS[@]}"; do
    if [ -f "$UNIT_DIR/$unit" ]; then as_root systemctl disable --now "$unit"; fi
  done
  if [ -f "$UNIT_DIR/$TEMPLATE" ]; then
    for worker in spacory-agents@tick.service spacory-agents@cycle.service; do
      state="$(systemctl show --property=ActiveState --value "$worker")"
      case "$state" in
        active|activating|deactivating|reloading) as_root systemctl stop "$worker" ;;
      esac
    done
  fi
  as_root rm -f -- "${installed[@]}"
  as_root systemctl daemon-reload
}

show_status() {
  systemctl list-unit-files "${JOBS[@]}"
  systemctl list-timers --all "${TIMERS[@]}"
  systemctl show "$WEBHOOK" --property=ActiveState,SubState
}

case "${1:-install}" in
  install) install_units ;;
  uninstall) uninstall_units ;;
  status) show_status ;;
  *) echo "usage: $(basename "$0") [install|status|uninstall]" >&2; exit 2 ;;
esac
