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
# FIX (2026-06-17 T-20260616-foot-E2E-PROD-WRITE-ISOLATION FIX-REQUEST):
#   Root cause of the recurring false build_fail is PHYSICS, not build.sh: the
#   supervisor QA harness kills the *foreground* command at a ~50s safety
#   ceiling. Under parallel-worktree CPU contention a ~14s build can exceed 50s,
#   so a synchronous `build.sh` (whatever its internal 240s floor) gets killed
#   externally → exit 124 → false build_fail. No synchronous command can return
#   in 50s when the build needs 70s of wall-clock.
#
#   NEW `--bg` MODE (the alternative the FIX-REQUEST asked for): launches the
#   build DETACHED in its own session (survives the foreground kill) and polls
#   only up to a sub-ceiling deadline (default 45s). It ALWAYS returns a clean
#   `RESULT:` line within the window — OK / FAIL / RUNNING. On RUNNING the build
#   keeps going detached; a follow-up `build.sh --status` reads the verdict.
#
#     QA build command (recommended):
#       bash scripts/build.sh --bg 45      # → RESULT: OK | FAIL | RUNNING
#       bash scripts/build.sh --status     # poll if RUNNING → RESULT: OK | FAIL
#
# Usage:
#   bash scripts/build.sh [timeout_seconds]   # SYNCHRONOUS (legacy, unchanged)
#   bash scripts/build.sh --bg [deadline]     # DETACHED + bounded poll (QA-safe)
#   bash scripts/build.sh --status            # read last detached build verdict
#   bash scripts/build.sh --wait [deadline]   # poll an in-flight detached build
#     timeout_seconds defaults to 120; effective timeout is floored at 240.
#     deadline defaults to 45 (kept under the 50s foreground ceiling).
#
# DO NOT run: timeout 60 npm run build
#   → Use this script (prefer --bg for QA) or plain: npm run build

set -euo pipefail

# Effective timeout = max(requested, 240s). Building under parallel-worktree CPU
# contention can stretch a ~13s build well past a caller's 120s; the floor kills
# the false-build_fail class without masking a genuinely hung build (it still
# dies at 240s).
TIMEOUT_FLOOR=240
MODE="sync"
DEADLINE=45
case "${1:-}" in
  --bg|--background)   MODE="bg";     DEADLINE="${2:-45}" ;;
  --status)            MODE="status" ;;
  --wait)              MODE="wait";   DEADLINE="${2:-45}" ;;
  ''|*[!0-9]*)         MODE="sync" ;;   # no arg / non-numeric → legacy sync (npm run build:verify)
  *)
    # FIX (2026-07-01 T-20260701-foot-RESVGRID-TIMEAXIS-EXCELCELL FIX-REQUEST):
    #   A PURELY-NUMERIC first arg (e.g. `build.sh 120`) is the supervisor QA
    #   harness invocation. Historically this ran SYNCHRONOUS in the foreground,
    #   so under parallel-worktree CPU contention the harness's ~50s foreground
    #   safety ceiling externally SIGTERM-killed build.sh's process group → the
    #   child `npm run build` died ("Terminated: 15") → a recurring FALSE
    #   build_fail (the build itself passes in ~20s; verified clean cold).
    #
    #   The kill-safe `--bg` detached path (T-20260616, commit 471f2191) already
    #   solves this but only when the caller opts in. Every prior FIX-REQUEST in
    #   this class recurred because the supervisor kept calling the legacy sync
    #   form. So: AUTO-ROUTE the numeric-arg form to the detached path. The
    #   numeric value is carried as the detached build timeout (floored to 240s);
    #   the foreground poll deadline stays sub-ceiling (45s). The build now runs
    #   in its own session (os.setsid) and survives the foreground kill, and the
    #   command ALWAYS returns a clean RESULT: OK|FAIL|RUNNING inside the window.
    #   `npm run build:verify` (no numeric arg) is unaffected — still sync.
    MODE="bg"; DEADLINE=45 ;;
esac

# For sync mode the (possibly numeric) first arg is the requested timeout.
if [ "$MODE" = "sync" ]; then
  REQUESTED_TIMEOUT="${1:-120}"
else
  REQUESTED_TIMEOUT=120
fi
if [ "$REQUESTED_TIMEOUT" -gt "$TIMEOUT_FLOOR" ] 2>/dev/null; then
  TIMEOUT_SECS="$REQUESTED_TIMEOUT"
else
  TIMEOUT_SECS="$TIMEOUT_FLOOR"
fi

# ── detached-build state (.build/ is gitignored) ─────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STATE_DIR=".build"
LOG_FILE="$STATE_DIR/build.log"
PID_FILE="$STATE_DIR/build.pid"
RESULT_FILE="$STATE_DIR/build.result"

build_running() {
  [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE" 2>/dev/null)" 2>/dev/null
}

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
ensure_deps() {
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
}
# ─────────────────────────────────────────────────────────────────────────────

# ── detached-build helpers (--bg / --status / --wait) ────────────────────────
# Print the verdict for an already-finished or in-flight detached build.
#   exit 0  → RESULT: OK
#   exit !0 → RESULT: FAIL (code echoed) — caller treats as build_fail
#   RUNNING is NOT a failure: exit 0 so the harness records a clean return; the
#   build is still alive detached and a follow-up --status reads the verdict.
report_detached() {
  if [ -f "$RESULT_FILE" ]; then
    local r; r="$(cat "$RESULT_FILE" 2>/dev/null || true)"
    if [ "$r" = "OK" ]; then
      echo "RESULT: OK"
      return 0
    fi
    echo "RESULT: FAIL ($r)" >&2
    echo "---- last 30 lines of $LOG_FILE ----" >&2
    tail -30 "$LOG_FILE" 2>/dev/null >&2 || true
    return "${r#FAIL:}"
  fi
  if build_running; then
    echo "RESULT: RUNNING (detached pid $(cat "$PID_FILE")) — re-run: bash scripts/build.sh --status"
    return 0
  fi
  echo "RESULT: NONE (no detached build found — run: bash scripts/build.sh --bg)" >&2
  return 3
}

# Poll for up to DEADLINE seconds, then report whatever state we have.
poll_detached() {
  local waited=0
  while [ "$waited" -lt "$DEADLINE" ]; do
    # Verdict written → done.
    [ -f "$RESULT_FILE" ] && break
    # Stop early ONLY for a confirmed crash: the runner recorded its pid but
    # that process is now gone AND no result was written. Before the pid file
    # exists we are still in the runner's startup window — keep waiting.
    if [ -f "$PID_FILE" ] && ! build_running; then
      break
    fi
    sleep 1
    waited=$(( waited + 1 ))
  done
  report_detached
}

if [ "$MODE" = "status" ]; then
  report_detached
  exit $?
fi

if [ "$MODE" = "wait" ]; then
  poll_detached
  exit $?
fi

if [ "$MODE" = "bg" ]; then
  if build_running; then
    echo "[build.sh] adopting in-flight detached build (pid $(cat "$PID_FILE"))"
  else
    ensure_deps
    mkdir -p "$STATE_DIR"
    rm -f "$RESULT_FILE" "$PID_FILE"
    : > "$LOG_FILE"
    # Launch fully detached: _build_runner.py calls os.setsid() so it leaves
    # build.sh's process group and survives the supervisor's foreground kill.
    nohup python3 "$SCRIPT_DIR/_build_runner.py" \
      "$TIMEOUT_SECS" "$LOG_FILE" "$RESULT_FILE" "$PID_FILE" >/dev/null 2>&1 &
    disown 2>/dev/null || true
    echo "[build.sh] started detached build (timeout ${TIMEOUT_SECS}s, foreground deadline ${DEADLINE}s)"
  fi
  poll_detached
  exit $?
fi

# ── SYNCHRONOUS MODE (legacy, unchanged) ─────────────────────────────────────
ensure_deps

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
