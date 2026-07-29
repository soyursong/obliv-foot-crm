#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════════════════════
# redpay_poller_checkout_sync.sh
# T-20260729-foot-REDPAY-POLLER-DEDICATED-CHECKOUT — 결제 폴러 전용 checkout 관리자.
#
# 왜: 결제 폴러 launchd(com.obliv.foot.redpay-macstudio-poller)가 dev 피처 체크아웃
#     (~/GitHub/obliv-foot-crm)과 WorkingDirectory 를 공유하면, dev 가 non-main 브랜치를
#     체크아웃한 순간 폴러가 stale 코드로 실행된다(T-20260728-AUTOSEED deploy_reflection_fail RC).
#     → 폴러 전용 main-고정 checkout 을 분리해 dev 피처 체크아웃과 독립시킨다.
#
# 불변식(§AC2): 전용 checkout 의 정지상태 = 항상 origin/main HEAD.
#     dev 가 어떤 브랜치를 체크아웃해도 이 디렉토리는 불변.
#
# 사용:
#   bash scripts/redpay_poller_checkout_sync.sh            # FF sync (fetch + reset --hard origin/main). 멱등.
#   bash scripts/redpay_poller_checkout_sync.sh --create   # 최초 생성(git worktree add --detach) + sync + 검증
#   bash scripts/redpay_poller_checkout_sync.sh --verify   # 검증만(on-disk shasum == origin/main blob)
#
# 참고: launchd ProgramArguments 는 매 사이클 진입 시 동일 FF(fetch+reset)를 best-effort 로 인라인
#       수행하므로 이 스크립트는 최초 생성·수동 sync·검증·runbook 용. (docs/REDPAY-POLLER-DEDICATED-CHECKOUT-RUNBOOK.md)
# ══════════════════════════════════════════════════════════════════════════════
set -euo pipefail

DED="${REDPAY_POLLER_CHECKOUT:-/Users/domas/GitHub/obliv-foot-crm-redpay-poller}"
SRC="${REDPAY_POLLER_SRC_REPO:-/Users/domas/GitHub/obliv-foot-crm}"   # worktree add 는 기존 레포 .git 를 공유
POLLER_REL="scripts/redpay_macstudio_poller.mjs"
LIB_REL="scripts/lib/redpay_wl_fingerprint.mjs"

log() { echo "[$(date '+%Y-%m-%dT%H:%M:%S%z')][redpay-poller-sync] $*"; }

create_checkout() {
  if [ -d "$DED/.git" ] || git -C "$SRC" worktree list | grep -q "$DED"; then
    log "전용 checkout 이미 존재: $DED — 생성 스킵, sync 로 진행"
    return 0
  fi
  log "전용 checkout 생성: git worktree add --detach $DED origin/main"
  git -C "$SRC" fetch origin main --quiet
  git -C "$SRC" worktree add --detach "$DED" origin/main
}

sync_checkout() {
  log "FF sync: fetch origin main → reset --hard origin/main"
  git -C "$DED" fetch origin main --quiet
  git -C "$DED" reset --hard --quiet origin/main
  log "sync 완료: HEAD=$(git -C "$DED" rev-parse HEAD)"
}

verify_checkout() {
  local head origin_main disk_poller blob_poller disk_lib blob_lib
  head="$(git -C "$DED" rev-parse HEAD)"
  origin_main="$(git -C "$DED" rev-parse origin/main)"
  disk_poller="$(shasum "$DED/$POLLER_REL" | awk '{print $1}')"
  blob_poller="$(git -C "$DED" show origin/main:"$POLLER_REL" | shasum | awk '{print $1}')"
  disk_lib="$(shasum "$DED/$LIB_REL" | awk '{print $1}')"
  blob_lib="$(git -C "$DED" show origin/main:"$LIB_REL" | shasum | awk '{print $1}')"

  log "HEAD=$head  origin/main=$origin_main"
  log "poller on-disk=$disk_poller  origin/main-blob=$blob_poller"
  log "lib    on-disk=$disk_lib  origin/main-blob=$blob_lib"

  local ok=1
  [ "$head" = "$origin_main" ] || { log "FAIL: HEAD != origin/main"; ok=0; }
  [ "$disk_poller" = "$blob_poller" ] || { log "FAIL: poller on-disk != origin/main blob (stale!)"; ok=0; }
  [ "$disk_lib" = "$blob_lib" ] || { log "FAIL: lib on-disk != origin/main blob (stale!)"; ok=0; }
  if [ "$ok" = "1" ]; then
    log "✅ VERIFY OK — 전용 checkout = origin/main 고정, stale 불가(§AC2)"
    return 0
  else
    log "❌ VERIFY FAIL"
    return 1
  fi
}

case "${1:-}" in
  --create) create_checkout; sync_checkout; verify_checkout ;;
  --verify) verify_checkout ;;
  *)        sync_checkout; verify_checkout ;;
esac
