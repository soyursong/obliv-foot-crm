#!/usr/bin/env python3
"""_build_runner.py — detached build executor for scripts/build.sh --bg mode.

Why this exists
---------------
Supervisor QA runs the build inside a foreground harness that has a hard ~50s
safety ceiling. Under macstudio parallel-worktree CPU contention a normally
~14s build can stretch past 50s; the harness then SIGKILLs the *foreground
process group* and reports a false `build_fail` (exit 124 / RESULT: TIMEOUT).

This runner is launched by build.sh (`python3 _build_runner.py ... &`) and
IMMEDIATELY calls os.setsid(), putting itself in a brand-new session that is
NOT a member of build.sh's process group. So when the supervisor harness kills
build.sh's group at the 50s ceiling, this runner — and the build it owns —
survive. The build finishes and writes its verdict to the result file; the
supervisor's follow-up `build.sh --status` poll then reads RESULT: OK/FAIL.

  NOTE (T-20260809-meta-QABUILD-SETSID-NOHUP-DETACH-FALSENONE): build.sh MUST
  NOT wrap this runner in `nohup`. os.setsid() below already provides full
  detach, and on macstudio's non-controlling-terminal QA session BSD `nohup`
  aborts with ENOTTY ("can't detach from console") — killing the runner before
  it starts. build.sh launches us bare and captures our stderr to a launch log.

Args: <timeout_secs> <log_file> <result_file> <pid_file>
Writes to result_file exactly one of:
  "OK" | "FAIL:<code>" on completion, or "ERROR:<cls>" on a runner-level fault.

no-silent-failure invariant (AC-2)
----------------------------------
Any fault in this detached runner (setsid EPERM, npm/python spawn failure, I/O
error) is published as an explicit ERROR verdict — result_file is NEVER left
absent. An absent result_file is what build.sh reads as RESULT: NONE, which is
indistinguishable from "no build ran" and previously masked a healthy build as
a false NONE. Publishing ERROR keeps the failure loud and honest.

Orphan sweep (T-20260616-meta-QA-BUILD-CONTENTION, dev-foot RC)
--------------------------------------------------------------
`vite build` (+ @vitejs/plugin-react) spawns a long-lived **esbuild service**
subprocess — a Go binary that idles at 0%%CPU waiting on a stdin pipe. When the
npm/vite parent exits WITHOUT the esbuild JS API cleanly stopping that service
(or when npm is killed mid-build), the service survives, gets re-parented to
PID 1, and lingers indefinitely at 0%%CPU. On the shared macstudio QA host these
orphans accumulate (3h+) and starve sibling-repo builds → cascade false
build_fail. The OLD code only sent ONE SIGTERM, and ONLY on the timeout path —
the normal-completion path never swept the group at all. We now defensively
tear down the build's whole process group (SIGTERM → grace → SIGKILL) on EVERY
exit path. Safe because the build runs in its own session/PGID
(start_new_session=True), so the sweep targets only the build's own descendants.
"""
import os
import signal
import subprocess
import sys
import time
import traceback

timeout_secs = int(sys.argv[1])
log_file = sys.argv[2]
result_file = sys.argv[3]
pid_file = sys.argv[4]


def write_result(val):
    """Atomically publish the verdict (temp + rename) so a reader never sees a
    partial write. Always called on EVERY exit path — success, build failure,
    timeout, or runner-level fault — so result_file is never left absent."""
    tmp = result_file + ".tmp"
    with open(tmp, "w") as rf:
        rf.write(val)
    os.replace(tmp, result_file)


def sweep_group(pgid, log, grace=3.0):
    """Tear down the build's process group so no esbuild service / vite child is
    left orphaned at 0%CPU. SIGTERM first, then escalate to SIGKILL for anything
    that ignores/traps SIGTERM (esbuild's Go service is a notorious offender).
    `pgid` is captured up-front because the group LEADER (npm) may already be
    dead by the time we sweep — os.getpgid(dead_pid) would then raise."""
    if pgid is None:
        return
    # Phase 1: polite SIGTERM to the whole group.
    try:
        os.killpg(pgid, signal.SIGTERM)
    except (ProcessLookupError, PermissionError):
        return  # group already empty — nothing to reap.
    # Wait out the grace window; bail early once the group is fully gone.
    deadline = time.monotonic() + grace
    while time.monotonic() < deadline:
        try:
            os.killpg(pgid, 0)  # signal 0 == liveness probe
        except (ProcessLookupError, PermissionError):
            return  # group drained cleanly.
        time.sleep(0.2)
    # Phase 2: anything still alive (idle esbuild service) → SIGKILL.
    try:
        os.killpg(pgid, signal.SIGKILL)
        log.write("\n[_build_runner] swept lingering build group with SIGKILL "
                  "(esbuild service orphan guard)\n")
    except (ProcessLookupError, PermissionError):
        pass


def run():
    # Detach into a new session FIRST so a foreground process-group kill of
    # build.sh (supervisor's 50s ceiling) cannot reach this runner or its build
    # child. No nohup: setsid IS the detach (see module docstring).
    os.setsid()

    result = "FAIL:1"
    with open(log_file, "w") as log:
        # start_new_session=True → the npm build gets its own process group so a
        # timeout kill can take down the whole tsc/vite child tree via killpg.
        proc = subprocess.Popen(
            ["npm", "run", "build"],
            stdout=log,
            stderr=subprocess.STDOUT,
            start_new_session=True,
        )
        # Capture the build's process-group id NOW, while the leader is alive.
        # After proc.wait() returns the leader (npm) is dead and os.getpgid()
        # would raise, but surviving grandchildren (the esbuild service) still
        # carry this pgid.
        try:
            build_pgid = os.getpgid(proc.pid)
        except ProcessLookupError:
            build_pgid = proc.pid  # already gone; pid==pgid for a session leader.
        with open(pid_file, "w") as pf:
            pf.write(str(proc.pid))
        try:
            rc = proc.wait(timeout=timeout_secs)
            result = "OK" if rc == 0 else f"FAIL:{rc}"
        except subprocess.TimeoutExpired:
            log.write(f"\n[_build_runner] TIMEOUT after {timeout_secs}s — killing build process group\n")
            result = "FAIL:124"
        finally:
            # ALWAYS sweep the build group — on success, failure, OR timeout. A
            # clean `npm run build` exit can still leave the esbuild service
            # idling at 0%CPU; without this sweep it becomes a PID-1 orphan on
            # the QA host.
            sweep_group(build_pgid, log)
    write_result(result)


try:
    run()
except Exception as exc:
    # no-silent-failure (AC-2): a runner-level fault (setsid EPERM, npm/python
    # spawn failure, I/O error) must be published as an explicit ERROR verdict —
    # NEVER leave result_file absent, which build.sh would read as RESULT: NONE
    # and mistake for "healthy build, no detached run". stderr goes to build.sh's
    # launch log for the operator.
    sys.stderr.write("[_build_runner] FATAL: %r\n" % (exc,))
    traceback.print_exc()
    try:
        write_result("ERROR:%s" % (exc.__class__.__name__,))
    except Exception:
        pass
    sys.exit(1)
