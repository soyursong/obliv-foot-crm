#!/usr/bin/env python3
"""_build_runner.py — detached build executor for scripts/build.sh --bg mode.

Why this exists
---------------
Supervisor QA runs the build inside a foreground harness that has a hard ~50s
safety ceiling. Under macstudio parallel-worktree CPU contention a normally
~14s build can stretch past 50s; the harness then SIGKILLs the *foreground
process group* and reports a false `build_fail` (exit 124 / RESULT: TIMEOUT).

This runner is launched by build.sh via `nohup python3 _build_runner.py ... &`
and IMMEDIATELY calls os.setsid(), putting itself in a brand-new session that
is NOT a member of build.sh's process group. So when the supervisor harness
kills build.sh's group at the 50s ceiling, this runner — and the build it owns
— survive. The build finishes and writes its verdict to the result file; the
supervisor's follow-up `build.sh --status` poll then reads RESULT: OK/FAIL.

Args: <timeout_secs> <log_file> <result_file> <pid_file>
Writes to result_file exactly one of: "OK" | "FAIL:<code>" on completion.
"""
import os
import signal
import subprocess
import sys

timeout_secs = int(sys.argv[1])
log_file = sys.argv[2]
result_file = sys.argv[3]
pid_file = sys.argv[4]

# Detach into a new session FIRST so a foreground process-group kill of build.sh
# (supervisor's 50s ceiling) cannot reach this runner or its build child.
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
    with open(pid_file, "w") as pf:
        pf.write(str(proc.pid))
    try:
        rc = proc.wait(timeout=timeout_secs)
        result = "OK" if rc == 0 else f"FAIL:{rc}"
    except subprocess.TimeoutExpired:
        try:
            os.killpg(os.getpgid(proc.pid), signal.SIGTERM)
        except ProcessLookupError:
            pass
        log.write(f"\n[_build_runner] TIMEOUT after {timeout_secs}s — killed build process group\n")
        result = "FAIL:124"

# Write the verdict atomically (temp + rename) so a reader never sees a partial.
tmp = result_file + ".tmp"
with open(tmp, "w") as rf:
    rf.write(result)
os.replace(tmp, result_file)
