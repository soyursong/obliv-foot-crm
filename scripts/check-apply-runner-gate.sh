#!/usr/bin/env bash
# check-apply-runner-gate.sh — per-migration apply 러너 gate-배선 fail-closed 린트
# ─────────────────────────────────────────────────────────────────────────────
# 티켓: T-20260801-meta-DBGATE-GUARD-XCRM-ROLLOUT (foot leg · requirement 3)
#
# 배경: foot 티켓-전용 per-migration mjs 러너(scripts/apply_*.mjs — 대부분
#       scripts/lib/foot_migration_ledger.mjs 의 applyMigration()/query() 로 Management
#       API POST)가 db_apply_guard.sh chokepoint 를 우회하는 별도 prod-write 경로 →
#       `--apply`/env flag 단독 honor-system COMMIT 을 집행할 수 있는 재발 표면.
#       이식된 canonical guard-lane (assertApplyGateForRunner)이 러너에 배선돼야만 닫힌다
#       (crm e1e4202 runner_gate_unwired 교훈 — 라이브러리 추가만으로는 NO-GO).
#
# 규칙(fail-closed): push 대상 range(remote..local)에서 "신규 추가된" scripts/apply_*.mjs
#   중 prod-write 통로(`--apply`)를 갖고 assertApplyGateForRunner 배선이 없는 파일 → BLOCK.
#   ※ 기존 legacy 러너(range 밖) 는 대상 아님(신규 카피 소스가 ungated 로 재생산되는 것만 차단).
#   ※ dry-run 전용(`--apply` 미보유) 러너·probe/diag 스크립트는 대상 아님.
#
# 사용:
#   bash scripts/check-apply-runner-gate.sh range <remote_sha> <local_sha>
#   bash scripts/check-apply-runner-gate.sh files  <file...>            # 명시 파일 검사
#
# 탈출구: APPLY_RUNNER_GATE_BYPASS=1 (사유 명기 의무 — historical 봉인 러너 등 예외)
set -euo pipefail
REPO_ROOT="$(git rev-parse --show-toplevel)"
Z40="0000000000000000000000000000000000000000"
MODE="${1:-}"; shift || true

if [ "${APPLY_RUNNER_GATE_BYPASS:-0}" = "1" ]; then
  echo "⚠️  [apply-runner-gate] BYPASS=1 — 러너 gate 린트 우회(사유 명기 의무)" >&2
  exit 0
fi

collect_range() {
  local remote_sha="$1" local_sha="$2" base
  if [ "$remote_sha" = "$Z40" ] || ! git -C "$REPO_ROOT" rev-parse -q --verify "$remote_sha^{commit}" >/dev/null 2>&1; then
    # 신규 remote 브랜치 → tip 스냅샷의 apply 러너 전량은 과대검사 → 직전 커밋 대비만.
    base="$(git -C "$REPO_ROOT" rev-parse -q --verify "${local_sha}~1" 2>/dev/null || true)"
    [ -z "$base" ] && { echo ""; return; }
  else
    base="$remote_sha"
  fi
  # 추가(A)·수정(M) 된 apply 러너만 (삭제 D 제외)
  git -C "$REPO_ROOT" diff --name-only --diff-filter=AM "$base" "$local_sha" -- 'scripts/apply_*.mjs' 2>/dev/null || true
}

FILES=""
case "$MODE" in
  range) FILES="$(collect_range "${1:-$Z40}" "${2:-HEAD}")" ;;
  files) FILES="$*" ;;
  *) echo "usage: $0 range <remote_sha> <local_sha> | files <file...>" >&2; exit 64 ;;
esac

[ -z "${FILES// /}" ] && { echo "✅ [apply-runner-gate] 검사 대상 apply 러너 없음."; exit 0; }

fail=0
while IFS= read -r f; do
  [ -z "$f" ] && continue
  path="$REPO_ROOT/$f"
  [ -f "$path" ] || continue
  # prod-write 통로(`--apply`) 미보유 = dry-run/probe 전용 → 대상 아님
  if ! grep -qE -- "--apply" "$path"; then continue; fi
  # historical 봉인 러너(deprecation seal) = `--apply` 분기 제거 선언 → 대상 아님
  if grep -qE "HISTORICAL[- ]?SEAL|deprecation|forward 사용 금지|canonical guard-lane" "$path"; then continue; fi
  # gate 배선 확인
  if grep -qE "assertApplyGateForRunner" "$path"; then continue; fi
  echo "❌ [apply-runner-gate] $f — prod-write(--apply) 러너인데 assertApplyGateForRunner 미배선." >&2
  echo "     → APPLY 분기 직전 assertApplyGateForRunner({ticketId,targetRef,applyRequested,migrationSql,evidenceLog}) 호출 배선" >&2
  echo "       또는 historical 봉인(--apply 분기 제거 + deprecation 헤더). 템플릿: scripts/_TEMPLATE_apply_runner_gated.mjs" >&2
  fail=1
done <<< "$FILES"

[ "$fail" -eq 0 ] && echo "✅ [apply-runner-gate] 신규/변경 apply 러너 gate 배선 정합."
exit "$fail"
