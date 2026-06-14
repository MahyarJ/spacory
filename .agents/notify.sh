#!/usr/bin/env bash
#
# Send a Telegram notification for the Spacory agents.
#
# Usage:
#   .agents/notify.sh "Your message text (Markdown)"
#
# This is the single, committed entry point both agents use to notify. It exists so
# that headless runs need exactly ONE permission rule — `Bash(.agents/notify.sh:*)` in
# .claude/settings.json — instead of an open-ended curl allowance, and so the message
# logic lives in one place rather than being duplicated in each agent prompt.
#
# Credentials are NEVER stored here. They are loaded from the gitignored
# `.agents/.env` (TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID); in CI they may already be
# exported as environment variables. If neither is present the script prints a notice
# and exits 0 — a missing notification must never fail an agent's run.
#
# Network egress: the curl below reaches api.telegram.org, which the Bash sandbox
# permits via `sandbox.network.allowedDomains` in .claude/settings.json. Permissions
# gate *what runs* (this script); the sandbox gates *what it can reach* (only Telegram).
set -euo pipefail

MESSAGE="${1:-}"
if [ -z "$MESSAGE" ]; then
  echo "usage: $(basename "$0") <message-text>" >&2
  exit 2
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Load credentials from the gitignored .agents/.env if present; otherwise rely on the
# environment (e.g. CI secrets already exported as TELEGRAM_BOT_TOKEN/CHAT_ID).
set -a
[ -f "$SCRIPT_DIR/.env" ] && . "$SCRIPT_DIR/.env"
set +a

if [ -z "${TELEGRAM_BOT_TOKEN:-}" ] || [ -z "${TELEGRAM_CHAT_ID:-}" ]; then
  echo "Telegram not configured (.agents/.env missing or empty) — skipping send; state the outcome in your final output instead."
  exit 0
fi

response="$(curl -s -m 15 "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
  --data-urlencode "chat_id=${TELEGRAM_CHAT_ID}" \
  --data-urlencode "parse_mode=Markdown" \
  --data-urlencode "text=${MESSAGE}" || true)"

if printf '%s' "$response" | grep -q '"ok":true'; then
  echo "Telegram notification sent."
else
  echo "Telegram send failed: ${response:-<no response — network blocked or timed out>}" >&2
  exit 1
fi
