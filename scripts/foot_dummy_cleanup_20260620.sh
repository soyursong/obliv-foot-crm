#!/bin/bash
# foot_dummy_cleanup_20260620.sh — T-20260619-foot-DUMMY-RESV-AUTOASSIGN-VERIFY (AC3 자동삭제)
#
# 6/20 00:30 KST 1회 실행(launchd one-shot)으로 6/19 더미 80건+부속을 자동 정리.
# 실행체 = scripts/rollback_testdummy_assign_0619.mjs --apply
#   (마커 [TEST-0619-ASSIGN] + phone prefix +821096190 2중키로만 한정 DELETE,
#    실환자/마커불일치 1건이라도 발견 시 스크립트 내부에서 ABORT → 운영데이터 무접촉.)
#
# 실행 후 자기 자신(launchd job + plist)을 제거하여 진짜 one-shot 로 동작.
set -euo pipefail

REPO="/Users/domas/Documents/GitHub/obliv-foot-crm"
NODE="/opt/homebrew/bin/node"
LABEL="com.obliv.foot.dummy-cleanup-20260620"
PLIST_SRC="$REPO/scripts/launchd/${LABEL}.plist"
PLIST_LINK="$HOME/Library/LaunchAgents/${LABEL}.plist"
LOG="$HOME/logs/foot_dummy_cleanup_20260620.log"

ts() { TZ=Asia/Seoul date '+%Y-%m-%d %H:%M:%S KST'; }

{
  echo "===== [$(ts)] foot dummy cleanup 6/19 시작 ====="
  cd "$REPO"
  # dry-run 먼저 (증빙 로깅)
  echo "--- DRY-RUN (사전 COUNT) ---"
  "$NODE" scripts/rollback_testdummy_assign_0619.mjs || echo "dry-run rc=$?"
  echo "--- APPLY (실삭제) ---"
  "$NODE" scripts/rollback_testdummy_assign_0619.mjs --apply
  echo "===== [$(ts)] 삭제 완료. self-unload 진행 ====="
} >> "$LOG" 2>&1

# self-cleanup: 1회성 보장 (launchd job 제거 + 심링크 제거)
UID_NUM="$(id -u)"
/bin/launchctl bootout "gui/${UID_NUM}/${LABEL}" 2>/dev/null || /bin/launchctl unload "$PLIST_LINK" 2>/dev/null || true
/bin/rm -f "$PLIST_LINK" 2>/dev/null || true
echo "[$(ts)] launchd job ${LABEL} unloaded + symlink removed (plist 원본은 repo에 보존)" >> "$LOG" 2>&1
