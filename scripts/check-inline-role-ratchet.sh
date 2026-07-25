#!/usr/bin/env bash
# check-inline-role-ratchet.sh
# ─────────────────────────────────────────────────────────────────────────────
# T-20260725-foot-PERMISSION-PARITY-PLAYBOOK STEP 6 (인라인 role=== 누적 방지).
#
# 목적: 권한 판정이 여기저기 흩어진 인라인 `x.role === 'admin'` 패턴이 '새로' 늘어나는
#   것을 머지 게이트로 차단한다(누적=재정의 drift 원천). 기존 것은 SSOT predicate
#   (src/lib/permissions.ts)로 점진 이관하되(=축소만 허용), 신규 추가는 금지한다.
#
# 방식(ratchet): 현재 인라인 카운트가 커밋된 baseline 을 '초과'하면 FAIL.
#   - 새 인라인 role=== 추가 → 카운트 증가 → RED (= "신규 PR 인라인 role 게이트 0").
#   - SSOT predicate 로 이관해 카운트 감소 → baseline 을 그만큼 낮춰 커밋(ratchet down).
#   ★SSOT(permissions.ts)는 제외(그곳이 role=== 의 정당한 거처).
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail

BASELINE_FILE="scripts/.inline-role-baseline"

# permissions.ts(SSOT) 제외한 src 내 인라인 `.role === '<literal>'` 카운트.
current="$(grep -rInE "\.role\s*===\s*'[a-z_]+'" src --include='*.ts' --include='*.tsx' 2>/dev/null \
  | grep -v 'src/lib/permissions.ts' | wc -l | tr -d ' ')"

if [ ! -f "$BASELINE_FILE" ]; then
  echo "❌ baseline 파일 부재: $BASELINE_FILE"
  exit 1
fi
baseline="$(tr -dc '0-9' < "$BASELINE_FILE")"

echo "── STEP6 inline role=== ratchet ──────────────────────────────"
echo "  baseline : $baseline"
echo "  current  : $current"

if [ "$current" -gt "$baseline" ]; then
  echo ""
  echo "❌ 인라인 role=== 이 baseline 을 초과($current > $baseline)."
  echo "  신규 인라인 role 판정 추가 금지 — src/lib/permissions.ts 의 SSOT predicate"
  echo "  (canAccess/hasOpsAuthority/isStaffUnlockRole 등)를 사용하세요."
  grep -rInE "\.role\s*===\s*'[a-z_]+'" src --include='*.ts' --include='*.tsx' 2>/dev/null \
    | grep -v 'src/lib/permissions.ts' | head -80
  exit 1
fi

if [ "$current" -lt "$baseline" ]; then
  echo ""
  echo "ℹ️  이관 진전: current($current) < baseline($baseline)."
  echo "  $BASELINE_FILE 를 $current 로 낮춰 커밋하면 ratchet 이 조여집니다(권장)."
fi

echo ""
echo "✅ 신규 인라인 role=== 0 (ratchet 통과)"
exit 0
