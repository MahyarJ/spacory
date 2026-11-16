#!/usr/bin/env bash
# Install only into the explicitly selected account. No agent process is started.
# Usage: install-prompts.sh [--copy] [--force]
# Existing matching links/copies are safe to re-run. Unrelated destinations require
# --force; replacing a symlink unlinks it and never writes through to its target.
set -euo pipefail

SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/prompts" && pwd)"
MODE=link
FORCE=0
for arg in "$@"; do
  case "$arg" in
    --copy) MODE=copy ;;
    --force) FORCE=1 ;;
    *) echo 'usage: install-prompts.sh [--copy] [--force]' >&2; exit 2 ;;
  esac
done
[ -n "${CODEX_HOME:-}" ] || { echo 'error: set CODEX_HOME explicitly in your calling environment' >&2; exit 1; }
case "$CODEX_HOME" in
  /*) ;;
  *) echo 'error: CODEX_HOME must be an absolute path' >&2; exit 1 ;;
esac
[ -d "$CODEX_HOME" ] || { echo 'error: CODEX_HOME must be an existing directory' >&2; exit 1; }
DEST_DIR="$CODEX_HOME/prompts"
[ ! -L "$DEST_DIR" ] || { echo 'error: refusing a symlinked prompts directory' >&2; exit 1; }

# Validate the whole install before changing either destination.
for f in engineer-agent.md product-agent.md; do
  src="$SRC_DIR/$f"
  dest="$DEST_DIR/$f"
  [ -f "$src" ] && [ -r "$src" ] || { echo "error: missing prompt: $src" >&2; exit 1; }
  if [ -d "$dest" ] && [ ! -L "$dest" ]; then
    echo "error: refusing to replace directory: $dest" >&2; exit 1
  fi
  if [ -L "$dest" ]; then
    [ "$(readlink "$dest")" = "$src" ] && continue
  elif [ -f "$dest" ] && cmp -s "$src" "$dest"; then
    continue
  elif [ ! -e "$dest" ]; then
    continue
  fi
  [ "$FORCE" = 1 ] || { echo "error: unrelated destination exists: $dest (use --force to replace)" >&2; exit 1; }
done

mkdir -p "$DEST_DIR"
for f in engineer-agent.md product-agent.md; do
  src="$SRC_DIR/$f"
  dest="$DEST_DIR/$f"
  if [ "$MODE" = link ] && [ -L "$dest" ] && [ "$(readlink "$dest")" = "$src" ]; then
    continue
  fi
  if [ ! -L "$dest" ] && [ -f "$dest" ] && cmp -s "$src" "$dest"; then
    continue
  fi
  # Re-check collisions at creation time: never follow an existing symlink or
  # clobber a file introduced after preflight unless --force was explicit.
  if [ -e "$dest" ] || [ -L "$dest" ]; then
    if [ "$FORCE" = 1 ] || { [ -L "$dest" ] && [ "$(readlink "$dest")" = "$src" ]; }; then
      rm -f "$dest"
    else
      echo "error: destination changed during install: $dest" >&2; exit 1
    fi
  fi
  if [ "$MODE" = copy ]; then
    ( set -o noclobber; cat "$src" > "$dest" )
    echo "→ copied  $dest"
  else
    ln -s "$src" "$dest"
    echo "→ linked  $dest → $src"
  fi
done

echo 'Done. Prompts installed in the selected CODEX_HOME.'
