#!/usr/bin/env bash
# build.sh — cross-platform build wrapper
# Handles macOS where GNU `timeout` is not available.
# Usage: bash scripts/build.sh [timeout_seconds]
#   timeout_seconds defaults to 120.
#
# Priority:
#   1) GNU timeout  (Linux / macOS with brew coreutils)
#   2) gtimeout     (macOS brew coreutils alternate name)
#   3) no timeout   (plain npm run build — safe fallback)

set -euo pipefail

TIMEOUT_SECS="${1:-120}"
BUILD_CMD="npm run build"

if command -v timeout &>/dev/null; then
  exec timeout "$TIMEOUT_SECS" $BUILD_CMD
elif command -v gtimeout &>/dev/null; then
  exec gtimeout "$TIMEOUT_SECS" $BUILD_CMD
else
  # No timeout utility — run directly; CI kill by job timeout if needed.
  echo "[build.sh] WARNING: timeout/gtimeout not found — running build without time limit" >&2
  exec $BUILD_CMD
fi
