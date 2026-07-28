#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════════════════════
# redpay_poller_cutover.sh
# T-20260729-foot-REDPAY-POLLER-DEDICATED-CHECKOUT — 무유실 구→신 WorkingDirectory 전환(AC3).
#
# 안전 불변식:
#   · 구 launchd 완전 unload 후 신 load  → 구/신 이중 실행(중복 seed/write) 구조적 불가.
#     (Label 동일 = com.obliv.foot.redpay-macstudio-poller. unload-first 강제로 dual-run 봉인.)
#   · 멱등 재기동 → redpay_raw_transactions 멱등키(external_trxid,external_status,amount) upsert 라
#     한 사이클 재실행/스킵돼도 유실0. redpay_poller_state.last_incremental_to heartbeat 로 윈도 이어감.
#   · 전환 전/후 텔레메트리(autoseed_*/tid_alarm_*) 연속성 + 200 OK 를 로그에서 확인.
#
# 사용 (supervisor/macstudio, ★AUTOSEED soak 종료 후 권장):
#   bash scripts/redpay_poller_cutover.sh          # 실전 전환
#   bash scripts/redpay_poller_cutover.sh --dry     # 계획만 출력(unload/load 미수행)
#
# 사전조건: 전용 checkout 존재·검증 완료(scripts/redpay_poller_checkout_sync.sh --create).
# runbook: docs/REDPAY-POLLER-DEDICATED-CHECKOUT-RUNBOOK.md
# ══════════════════════════════════════════════════════════════════════════════
set -euo pipefail

LABEL="com.obliv.foot.redpay-macstudio-poller"
LA="/Users/domas/Library/LaunchAgents/${LABEL}.plist"
DED="/Users/domas/GitHub/obliv-foot-crm-redpay-poller"
NEW_PLIST="${DED}/scripts/launchd/${LABEL}.plist"
LOG_OUT="/Users/domas/logs/redpay_macstudio_poller.out"
DRY=0; [ "${1:-}" = "--dry" ] && DRY=1

log() { echo "[$(date '+%Y-%m-%dT%H:%M:%S%z')][cutover] $*"; }
last_telemetry() { grep -E '완료 elapsed_ms=' "$LOG_OUT" 2>/dev/null | tail -1 || echo "(none)"; }
last_wd() { launchctl list "$LABEL" 2>/dev/null | grep -iE 'WorkingDirectory|/GitHub/obliv-foot-crm' || true; }

echo "════════ REDPAY POLLER CUTOVER — 구→신 전용 checkout ════════"
log "신 WorkingDirectory = $DED"
log "신 plist            = $NEW_PLIST"

# 0) 사전검증 — 전용 checkout 을 origin/main 으로 FF 후 self-contained shasum 검증(외부 스크립트 비의존)
if [ ! -d "$DED/.git" ] && ! git -C "$DED" rev-parse --git-dir >/dev/null 2>&1; then
  log "ABORT: 전용 checkout 없음($DED) → redpay_poller_checkout_sync.sh --create 먼저"; exit 1
fi
log "전용 checkout FF: fetch origin main → reset --hard origin/main"
git -C "$DED" fetch origin main --quiet && git -C "$DED" reset --hard --quiet origin/main
if [ ! -f "$NEW_PLIST" ]; then log "ABORT: 신 plist 없음($NEW_PLIST) — main 에 plist 미반영(merge 대기?)"; exit 1; fi
_head="$(git -C "$DED" rev-parse HEAD)"; _om="$(git -C "$DED" rev-parse origin/main)"
_dp="$(shasum "$DED/scripts/redpay_macstudio_poller.mjs" | awk '{print $1}')"
_bp="$(git -C "$DED" show origin/main:scripts/redpay_macstudio_poller.mjs | shasum | awk '{print $1}')"
log "verify: HEAD=$_head origin/main=$_om  poller on-disk=$_dp blob=$_bp"
[ "$_head" = "$_om" ] && [ "$_dp" = "$_bp" ] || { log "ABORT: 전용 checkout != origin/main (stale)"; exit 1; }
log "✅ 전용 checkout = origin/main 고정 확인"

# 1) 전환 전 baseline 스냅샷(연속성 대조용)
BEFORE_TELE="$(last_telemetry)"
log "BEFORE 텔레메트리: $BEFORE_TELE"

if [ "$DRY" = "1" ]; then
  log "[DRY] 계획: unload($LABEL) → symlink 재지정($LA → $NEW_PLIST) → load → 연속성 확인. (미수행)"
  exit 0
fi

# 2) 구 launchd 완전 unload (이중 실행 봉인 — 반드시 load 전에)
log "구 launchd unload…"
launchctl unload -w "$LA" 2>/dev/null || launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
sleep 2
if launchctl list | grep -q "$LABEL"; then
  log "ABORT: unload 후에도 $LABEL 잔존 — 이중 실행 위험, 수동 확인 필요"; exit 1
fi
log "unload 확인 완료 — launchctl list 에 $LABEL 부재(이중 실행 불가)"

# 3) LaunchAgents symlink 을 전용 checkout 의 plist 로 재지정(plist 자체도 main-고정)
log "symlink 재지정: $LA → $NEW_PLIST"
ln -sf "$NEW_PLIST" "$LA"
ls -l "$LA"

# 4) 신 load
log "신 launchd load…"
launchctl load -w "$LA"
sleep 3
launchctl list | grep "$LABEL" || { log "ABORT: load 후 $LABEL 미등록"; exit 1; }
log "load 확인 완료"

# 5) 첫 사이클 유도 + 연속성 확인
log "RunAtLoad 첫 사이클 대기(최대 30s)…"
for i in $(seq 1 30); do
  AFTER_TELE="$(last_telemetry)"
  [ "$AFTER_TELE" != "$BEFORE_TELE" ] && [ "$AFTER_TELE" != "(none)" ] && break
  sleep 1
done
AFTER_TELE="$(last_telemetry)"
echo "──────── 연속성 evidence ────────"
log "BEFORE: $BEFORE_TELE"
log "AFTER : $AFTER_TELE"
grep -E '✅ 레드페이 200 OK|가동: mode=|poller_state heartbeat|autoseed_|tid_alarm_' "$LOG_OUT" | tail -8
echo "─────────────────────────────────"
if echo "$AFTER_TELE" | grep -q 'autoseed_' && echo "$AFTER_TELE" | grep -q 'tid_alarm_'; then
  log "✅ CUTOVER OK — 신 WorkingDirectory 가동 + 200 OK + autoseed_*/tid_alarm_* 텔레메트리 연속"
else
  log "⚠ 텔레메트리 마커 확인 필요 — 로그 수동 점검(첫 사이클이 아직 미완일 수 있음)"
fi
