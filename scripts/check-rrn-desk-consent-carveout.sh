#!/usr/bin/env bash
# check-rrn-desk-consent-carveout.sh
# ─────────────────────────────────────────────────────────────────────────────
# T-20260719-foot-RRN-ENC-DESK-CONSENT-GATE (CEO 결정 B안, 2026-07-25).
# LOGIC-LOCK: L-007 — 데스크 rrn_encrypt = 진료계약 근거 동의게이트 예외.
#
# 목적: B안(데스크 입력=진료계약 근거로 동의게이트 불요)이 코드에서 조용히 뒤집히는 것을
#   머지 게이트로 차단한다. 두 방향의 drift 를 잡는다:
#   (1) L-007 예외 마킹이 데스크 rrn_encrypt 저장 경로에서 사라짐(=예외 의도 소실).
#   (2) 데스크 rrn_encrypt 앞단에 consent_sensitive 요구 차단 게이트가 신설됨(=A안 회귀).
#   → 위반 시 RED. 예외를 정말 바꾸려면 CEO/legal 재결정 + L-007 갱신 후 이 게이트도 함께 갱신.
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail

CHART="src/pages/CustomerChartPage.tsx"
REGISTRY="LOGIC-LOCK-REGISTRY.md"
fail=0

echo "── L-007 데스크 rrn_encrypt 동의게이트 예외(B안) 래칫 ──────────"

# 1) 레지스트리에 L-007 ACTIVE 등재 확인.
if ! grep -q "L-007 —" "$REGISTRY" 2>/dev/null; then
  echo "❌ $REGISTRY 에 L-007 등재 누락."
  fail=1
else
  echo "  ✓ 레지스트리 L-007 등재"
fi

# 2) 데스크 저장 경로 두 곳(saveRrn·handleInfoPanelSave)에 L-007 마킹 존치.
lock_hits="$(grep -c 'LOGIC-LOCK: L-007' "$CHART" 2>/dev/null || echo 0)"
if [ "$lock_hits" -lt 2 ]; then
  echo "❌ $CHART 의 LOGIC-LOCK: L-007 마킹이 $lock_hits 개(기대 ≥2: saveRrn + handleInfoPanelSave)."
  echo "   데스크 rrn_encrypt 저장 경로의 B안 예외 주석이 소실/이동됨 — 복원 또는 CEO/legal 재결정 필요."
  fail=1
else
  echo "  ✓ 데스크 저장 경로 L-007 마킹 $lock_hits 개"
fi

# 3) A안 회귀 차단: 데스크 rrn_encrypt 호출 파일의 **코드**에 consent_sensitive 요구 차단 게이트 신설 금지.
#    (동의 컬럼을 rrn 저장의 선행조건으로 참조하는 실코드 패턴만 잡는다. L-007 설명 주석은 consent_sensitive
#     문자열을 담고 있으므로 주석 라인(// 또는 * 로 시작)은 제외해 오탐 방지. 부가 동의 캡처는
#     ConsentFormDialog 소관이며 이 데스크 차트 파일 코드에는 존재하지 않아야 한다.)
consent_refs="$(grep -nE 'consent_sensitive' "$CHART" 2>/dev/null \
  | grep -vE '^[0-9]+:[[:space:]]*(//|\*|/\*)' || true)"
if [ -n "$consent_refs" ]; then
  echo "❌ $CHART 에 consent_sensitive 참조 발견 — 데스크 rrn 저장에 동의 게이트가 유입됐을 가능성(A안 회귀):"
  echo "$consent_refs"
  echo "   B안 하에서 데스크 rrn_encrypt 는 consent 게이트 없이 저장하는 것이 정상. CEO/legal 재결정 없이 추가 금지."
  fail=1
else
  echo "  ✓ 데스크 차트에 consent_sensitive 차단 게이트 없음(A안 회귀 0)"
fi

echo ""
if [ "$fail" -ne 0 ]; then
  echo "❌ L-007 래칫 실패 — 위 항목 확인."
  exit 1
fi
echo "✅ L-007 데스크 rrn_encrypt 동의게이트 예외(B안) 유지 — 통과."
