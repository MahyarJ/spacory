#!/usr/bin/env bash
#
# Install Spacory's Codex custom prompts so interactive `codex` users get the same
# slash commands Claude Code users get from .claude/skills:
#
#   /engineer-agent   /product-agent
#
# Codex reads custom prompts from an explicitly selected $CODEX_HOME/prompts.
# These are per-user, not per-repo, so they can't be committed into place — this
# script symlinks the repo's copies in, so they stay in sync as the repo evolves.
#
# Usage:
#   .agents/codex/install-prompts.sh          # symlink (default)
#   .agents/codex/install-prompts.sh --copy   # copy instead of symlink
#
# Re-running is safe (idempotent). Remove with:
#   rm "$CODEX_HOME"/prompts/{engineer,product}-agent.md
set -euo pipefail

SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/prompts" && pwd)"
[ -n "${CODEX_HOME:-}" ] || { echo 'error: set CODEX_HOME explicitly in your calling environment' >&2; exit 1; }
case "$CODEX_HOME" in
  /*) ;;
  *) echo 'error: CODEX_HOME must be an absolute path' >&2; exit 1 ;;
esac
[ -d "$CODEX_HOME" ] || { echo 'error: CODEX_HOME must be an existing directory' >&2; exit 1; }
DEST_DIR="$CODEX_HOME/prompts"

MODE="link"
case "${1:-}" in
  '') ;;
  --copy) MODE=copy ;;
  *) echo 'usage: install-prompts.sh [--copy]' >&2; exit 2 ;;
esac
[ "$#" -le 1 ] || { echo 'usage: install-prompts.sh [--copy]' >&2; exit 2; }

mkdir -p "$DEST_DIR"
for f in engineer-agent.md product-agent.md; do
  src="$SRC_DIR/$f"
  dest="$DEST_DIR/$f"
  if [ "$MODE" = "copy" ]; then
    cp "$src" "$dest"
    echo "→ copied  $dest"
  else
    ln -sfn "$src" "$dest"
    echo "→ linked  $dest → $src"
  fi
done

echo "Done. In an interactive \`codex\` session, type /engineer-agent or /product-agent."
