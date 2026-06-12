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
# FIX (2026-06-12 T-20260612-foot-REFERRAL-VISITTYPE-CHECKBOX FIX-REQUEST):
#   Two root causes of recurring false build_fail under supervisor QA:
#   (1) tsconfig.app.tsbuildinfo is gitignored → every fresh worktree did a COLD
#       full `tsc -b` typecheck. Now seeded from the primary checkout in the
#       worktree fast-path so tsc is incremental (much shorter wall-clock).
#   (2) A caller-passed 120s timeout is too tight when several cold builds
#       contend for CPU on macstudio. A 240s floor is enforced (see below).
#
# Usage: bash scripts/build.sh [timeout_seconds]
#   timeout_seconds defaults to 120; effective timeout is floored at 240.
#
# DO NOT run: timeout 60 npm run build
#   → Use this script or plain: npm run build

set -euo pipefail

# Effective timeout = max(requested, 240s). Building under parallel-worktree CPU
# contention can stretch a ~13s build well past a caller's 120s; the floor kills
# the false-build_fail class without masking a genuinely hung build (it still
# dies at 240s).
TIMEOUT_FLOOR=240
REQUESTED_TIMEOUT="${1:-120}"
if [ "$REQUESTED_TIMEOUT" -gt "$TIMEOUT_FLOOR" ] 2>/dev/null; then
  TIMEOUT_SECS="$REQUESTED_TIMEOUT"
else
  TIMEOUT_SECS="$TIMEOUT_FLOOR"
fi

# ── dependency guard (git worktree / fresh clone) ────────────────────────────
# node_modules/.bin/tsc is required by `npm run build`.
# In git worktree environments node_modules is not present.
#
# FIX (2026-05-31 T-20260527-foot-CLOSE-ITEM-COUNT FIX-REQUEST):
#   Supervisor QA runs in ephemeral git worktrees (isolation: worktree) where
#   node_modules is absent. The old guard ran `npm ci --prefer-offline || npm ci`;
#   when prefer-offline missed (cold/partial cache) the `|| npm ci` fallback did
#   a FULL network install of 530 packages (391MB) → blew past the supervisor's
#   60s external timeout → false build_fail.
#
#   Fast-path: a linked worktree shares the SAME object store as the primary
#   checkout. `git rev-parse --git-common-dir` resolves to the primary repo's
#   .git even from inside a worktree; its parent is the primary checkout root.
#   When that checkout already has node_modules AND its package-lock.json is
#   identical (same deps), we symlink it — near-instant, no install at all.
#   Lock mismatch (feature branch changed deps) → fall back to npm ci.
if [ ! -f "node_modules/.bin/tsc" ]; then
  echo "[build.sh] node_modules/.bin/tsc not found — resolving dependencies ..."
  DEP_START=$(date +%s)

  # Worktree fast-path: reuse the primary checkout's node_modules via symlink.
  GIT_COMMON_DIR="$(git rev-parse --git-common-dir 2>/dev/null || true)"
  if [ -n "$GIT_COMMON_DIR" ]; then
    # --git-common-dir may be relative; resolve to an absolute path first.
    PRIMARY_ROOT="$(cd "$(dirname "$GIT_COMMON_DIR")" 2>/dev/null && pwd || true)"
    if [ -n "$PRIMARY_ROOT" ] && [ "$PRIMARY_ROOT" != "$(pwd)" ] \
       && [ -f "$PRIMARY_ROOT/node_modules/.bin/tsc" ] \
       && [ -f "$PRIMARY_ROOT/package-lock.json" ] \
       && cmp -s package-lock.json "$PRIMARY_ROOT/package-lock.json"; then
      echo "[build.sh] linking node_modules from primary worktree: $PRIMARY_ROOT"
      ln -s "$PRIMARY_ROOT/node_modules" node_modules

      # Seed the tsc incremental cache so `tsc -b` is incremental, not a cold
      # full typecheck. tsconfig.app.tsbuildinfo lives at the repo root (NOT in
      # node_modules) and is gitignored, so a fresh worktree never inherits it.
      # Copy (don't symlink) the primary's so the worktree's own build can
      # update it freely without corrupting the primary's cache.
      for _tsbi in tsconfig.app.tsbuildinfo tsconfig.node.tsbuildinfo; do
        if [ -f "$PRIMARY_ROOT/$_tsbi" ] && [ ! -e "$_tsbi" ]; then
          cp "$PRIMARY_ROOT/$_tsbi" "$_tsbi" 2>/dev/null \
            && echo "[build.sh] seeded tsc cache: $_tsbi" || true
        fi
      done
    fi
  fi

  # Still missing (no usable primary / lock mismatch) → install.
  # prefer-offline + no audit/fund keeps a warm-cache install ~2-3s; the plain
  # `npm ci` last-resort only runs if prefer-offline genuinely fails.
  if [ ! -f "node_modules/.bin/tsc" ]; then
    echo "[build.sh] running npm ci (prefer-offline) ..."
    npm ci --prefer-offline --no-audit --no-fund --loglevel=error \
      || npm ci --no-audit --no-fund
  fi

  echo "[build.sh] dependency setup complete in $(( $(date +%s) - DEP_START ))s."
fi
# ─────────────────────────────────────────────────────────────────────────────

# Start build in background
npm run build &
BUILD_PID=$!

# Spawn watchdog: kill build if it exceeds timeout.
#
# FIX (2026-05-30 T-20260529-foot-CHART-OPEN-FAIL FIX-REQUEST):
#   The previous watchdog blocked in a single long `sleep $TIMEOUT_SECS`.
#   That `sleep` child INHERITS this script's stdout/stderr. On an early
#   (successful) build, cleanup `kill $WATCHDOG_PID` only killed the subshell
#   wrapper — the `sleep` child was orphaned and kept the inherited fds (incl.
#   any captured pipe, e.g. `build.sh 2>&1 | tail`) open for the FULL timeout.
#   Consumers never saw EOF, so a build that finished in ~11s *appeared* to
#   hang for 120s → external timeouts reported a false build_fail.
#
#   Fix: poll in 1s increments and self-exit the instant the build process is
#   gone. The watchdog terminates cleanly on its own (no SIGTERM needed → no
#   "Terminated" job-control notice on the captured stream), and its short
#   `sleep 1` child can never hold a pipe open for more than ~1s.
(
  for (( elapsed = 0; elapsed < TIMEOUT_SECS; elapsed++ )); do
    sleep 1
    kill -0 "$BUILD_PID" 2>/dev/null || exit 0   # build finished → clean exit
  done
  # Timed out: build still running.
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

# Watchdog self-exits within ~1s of the build finishing — just reap it.
wait "$WATCHDOG_PID" 2>/dev/null || true

exit "$BUILD_EXIT"
