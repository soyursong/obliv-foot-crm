#!/usr/bin/env bash
# build.sh — cross-platform build wrapper
# Handles macOS EINTR/uv_cwd issue caused by timeout/gtimeout sending SIGALRM
# to Node.js processes (libuv uv_cwd() is not signal-safe on macOS).
#
# FIX (2026-05-27 T-20260526-foot-LAYOUT-USER-CUSTOM FIX-3):
#   timeout/gtimeout replaced with a pure-shell background watchdog.
#   Watchdog sends SIGTERM only — no SIGALRM → no EINTR in uv_cwd.
#
# FIX (2026-05-28 T-20260525-foot-PENCHART-FORM-BLACKSCR FIX-REQUEST):
#   Auto-install node_modules if missing (git worktree environments).
#   tsc lives in node_modules/.bin — worktrees start without node_modules.
#
# Usage: bash scripts/build.sh [timeout_seconds]
#   timeout_seconds defaults to 120.
#
# DO NOT run: timeout 60 npm run build
#   → Use this script or plain: npm run build

set -euo pipefail

TIMEOUT_SECS="${1:-120}"

# ── dependency guard (git worktree / fresh clone) ────────────────────────────
# node_modules/.bin/tsc is required by `npm run build`.
# In git worktree environments node_modules is not present → auto-install.
if [ ! -f "node_modules/.bin/tsc" ]; then
  echo "[build.sh] node_modules/.bin/tsc not found — running npm ci ..."
  npm ci --prefer-offline 2>&1 || npm ci
  echo "[build.sh] npm ci complete."
fi
# ─────────────────────────────────────────────────────────────────────────────

# Start build in background
npm run build &
BUILD_PID=$!

# Spawn watchdog: kill build if it exceeds timeout
(
  sleep "$TIMEOUT_SECS"
  if kill -0 "$BUILD_PID" 2>/dev/null; then
    echo "[build.sh] TIMEOUT after ${TIMEOUT_SECS}s — killing build (PID $BUILD_PID)" >&2
    kill "$BUILD_PID" 2>/dev/null
  fi
) &
WATCHDOG_PID=$!

# Wait for build to complete
if wait "$BUILD_PID"; then
  BUILD_EXIT=0
else
  BUILD_EXIT=$?
fi

# Clean up watchdog
kill "$WATCHDOG_PID" 2>/dev/null
wait "$WATCHDOG_PID" 2>/dev/null || true

exit "$BUILD_EXIT"
