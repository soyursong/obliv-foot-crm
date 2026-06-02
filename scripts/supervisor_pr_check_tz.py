#!/usr/bin/env python3
"""
supervisor_pr_check_tz.py — Timezone PR check rule (Cross-CRM contract §10-2)

Ticket: T-20260602-infra-RECONCILIATION-CRON-TIMEZONE (AC-5/6/7)
Owner:  agent-fdd-supervisor

Purpose
-------
Reject SQL view / aggregation PRs that bucket timestamps without an explicit
`AT TIME ZONE 'Asia/Seoul'`. UTC↔KST mixing at the day boundary is the root
cause of dopamine↔CRM stat mismatches (5 Agent C diagnosis).

Two modes
---------
  1. PR gate (AC-5/6):   --diff <unified.diff|->     scans only added (+) lines
  2. Audit scan (AC-7):  --files <a.sql b.sql ...>   scans full file contents
                         --scan-dir <dir>            recurse *.sql under dir

Exemption (AC-6)
----------------
A violation is suppressed when an explicit exemption is declared:
  - inline:  `-- tz-exempt: <reason>`  on the same or preceding line
  - PR-wide: `--pr-body <file>` containing a line `# tz-exempt: <reason>`
Reason text after the marker is mandatory (empty reason = not exempt).

Exit codes
----------
  0  no non-exempt violations
  1  one or more non-exempt violations  (PR REJECT)
  2  usage / IO error
"""
import argparse
import os
import re
import sys

# --- aggregation patterns that bucket a timestamp into a date/hour ---------
AGG_PATTERNS = [
    (re.compile(r"\bdate_trunc\s*\(", re.I), "date_trunc()"),
    (re.compile(r"\bto_char\s*\([^)]*,\s*'[^']*(YYYY|MM|DD|HH)[^']*'", re.I), "to_char(date fmt)"),
    (re.compile(r"::\s*date\b", re.I), "::date cast"),
    (re.compile(r"\bcast\s*\([^)]+\bas\s+date\s*\)", re.I), "cast(.. as date)"),
    (re.compile(r"\bextract\s*\(\s*(day|doy|week|month|year|hour|dow|isodow)\b", re.I), "extract(date part)"),
    (re.compile(r"group\s+by\b.*\bdate\b", re.I), "GROUP BY date"),
]

# A line is "safe" only if it carries an explicit Asia/Seoul conversion.
TZ_OK = re.compile(r"at\s+time\s+zone\s+'asia/seoul'", re.I)
# pure date columns (no time component) are not a tz hazard
DATE_COL_HINT = re.compile(r"\b\w*(date|일자|날짜)\b\s*(::|,|\)|$)", re.I)

EXEMPT_INLINE = re.compile(r"--\s*tz-exempt:\s*(\S.*)$", re.I)
EXEMPT_PRBODY = re.compile(r"#\s*tz-exempt:\s*(\S.*)$", re.I)


def pr_body_exempt(path):
    if not path:
        return None
    try:
        with open(path, encoding="utf-8") as fh:
            for ln in fh:
                m = EXEMPT_PRBODY.search(ln)
                if m:
                    return m.group(1).strip()
    except OSError as e:
        print(f"[tz-check] WARN: cannot read pr-body {path}: {e}", file=sys.stderr)
    return None


def scan_lines(lines, source):
    """lines: list of (lineno, text). returns list of violation dicts."""
    violations = []
    prev_exempt = False
    for lineno, raw in lines:
        text = raw.rstrip("\n")
        inline_exempt = EXEMPT_INLINE.search(text)
        # strip the trailing -- comment for pattern matching to avoid noise
        code = re.split(r"--", text, maxsplit=1)[0]
        agg_hit = None
        for pat, label in AGG_PATTERNS:
            if pat.search(code):
                agg_hit = label
                break
        if not agg_hit:
            prev_exempt = bool(inline_exempt and inline_exempt.group(1).strip())
            continue
        if TZ_OK.search(code):
            prev_exempt = False
            continue
        # exemption: inline on same line, or a tz-exempt comment on prev line
        exempted = (inline_exempt and inline_exempt.group(1).strip()) or prev_exempt
        prev_exempt = False
        if exempted:
            continue
        violations.append({
            "source": source,
            "lineno": lineno,
            "pattern": agg_hit,
            "snippet": code.strip()[:140],
        })
    return violations


def parse_diff(stream):
    """Yield (source, [(lineno, addedtext)]) groups from a unified diff.
    Only '+' added lines are considered (PR gate)."""
    cur_file = None
    new_lineno = 0
    buckets = {}
    for raw in stream:
        if raw.startswith("+++ "):
            cur_file = raw[4:].strip()
            if cur_file.startswith("b/"):
                cur_file = cur_file[2:]
            buckets.setdefault(cur_file, [])
            continue
        if raw.startswith("@@"):
            m = re.search(r"\+(\d+)", raw)
            new_lineno = int(m.group(1)) if m else 0
            continue
        if raw.startswith("+") and not raw.startswith("+++"):
            if cur_file:
                buckets[cur_file].append((new_lineno, raw[1:]))
            new_lineno += 1
        elif raw.startswith("-"):
            continue  # removed line, no new_lineno advance
        else:
            new_lineno += 1
    return buckets


def collect_sql_files(files, scan_dir):
    out = list(files or [])
    if scan_dir:
        for root, _, names in os.walk(scan_dir):
            for n in names:
                if n.endswith(".sql"):
                    out.append(os.path.join(root, n))
    return out


def main():
    ap = argparse.ArgumentParser(description="Timezone PR check (Asia/Seoul) — contract §10-2")
    ap.add_argument("--diff", help="unified diff file or '-' for stdin (PR gate, +lines only)")
    ap.add_argument("--files", nargs="*", default=[], help="SQL files to scan in full (audit)")
    ap.add_argument("--scan-dir", help="recurse *.sql under dir (audit)")
    ap.add_argument("--pr-body", help="PR body file; '# tz-exempt: reason' exempts whole PR")
    ap.add_argument("--quiet", action="store_true", help="only print violations")
    args = ap.parse_args()

    body_exempt = pr_body_exempt(args.pr_body)
    if body_exempt:
        print(f"[tz-check] PR-wide tz-exempt: {body_exempt} — PASS (manual review required)")
        return 0

    all_violations = []
    scanned = 0

    if args.diff:
        stream = sys.stdin if args.diff == "-" else open(args.diff, encoding="utf-8")
        try:
            buckets = parse_diff(stream)
        finally:
            if stream is not sys.stdin:
                stream.close()
        for src, lines in buckets.items():
            if not src.endswith(".sql"):
                continue
            scanned += 1
            all_violations += scan_lines(lines, src)

    sql_files = collect_sql_files(args.files, args.scan_dir)
    for fp in sql_files:
        try:
            with open(fp, encoding="utf-8", errors="replace") as fh:
                lines = [(i + 1, ln) for i, ln in enumerate(fh)]
        except OSError as e:
            print(f"[tz-check] WARN: {fp}: {e}", file=sys.stderr)
            continue
        scanned += 1
        all_violations += scan_lines(lines, fp)

    if not args.diff and not sql_files:
        print("[tz-check] nothing to scan (need --diff, --files or --scan-dir)", file=sys.stderr)
        return 2

    if all_violations:
        print(f"[tz-check] ❌ REJECT — {len(all_violations)} timezone violation(s) "
              f"across {scanned} source(s):")
        for v in all_violations:
            print(f"  {v['source']}:{v['lineno']}  [{v['pattern']}]  {v['snippet']}")
        print("\nFix: wrap the timestamp with "
              "`AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Seoul'` before bucketing,")
        print("or declare `-- tz-exempt: <reason>` (line) / `# tz-exempt: <reason>` (PR body).")
        return 1

    if not args.quiet:
        print(f"[tz-check] ✅ PASS — {scanned} source(s), no timezone violations")
    return 0


if __name__ == "__main__":
    sys.exit(main())
