#!/usr/bin/env bash
# T-20260629-foot-INGEST-EF-401-VERIFYJWT — reservation-ingest-from-dopamine 실 write 스모크
#
# verify_jwt=false 게이트웨이 hotfix 검증 fixture. supervisor 실 write E2E gap 해소용.
#
# ── 사용법 ────────────────────────────────────────────────────────
#   # negative(시나리오 2): secret 불요, 즉시 실행 가능
#   bash scripts/T-20260629-foot-INGEST-EF-401-VERIFYJWT_smoke.sh
#
#   # positive(AC3): 평문 공유 secret 주입 시 활성
#   DOPAMINE_CALLBACK_SECRET=<plaintext> bash scripts/T-20260629-foot-INGEST-EF-401-VERIFYJWT_smoke.sh
#
# ⚠ 평문 secret 은 절대 하드코딩/커밋 금지. 환경변수로만 주입.
#   평문 공유 secret 은 도파민 push EF env(FOOT_CALLBACK_SECRET) 에만 존재 →
#   foot/supervisor 는 digest(d2f0a6a2…)만 보유. AC3 positive 는 secret 주입 시 또는
#   시나리오1(도파민 UI→push→foot cross-service)로 검증.
set -uo pipefail

EF_URL="${INGEST_EF_URL:-https://rxlomoozakkjesdqjtvd.supabase.co/functions/v1/reservation-ingest-from-dopamine}"
SECRET="${DOPAMINE_CALLBACK_SECRET:-}"
PASS=0
FAIL=0

note()  { printf '\n\033[1m== %s ==\033[0m\n' "$1"; }
check() { # check <expected_status> <actual_status> <label>
  if [ "$1" = "$2" ]; then printf '  \033[32mPASS\033[0m %s (HTTP %s)\n' "$3" "$2"; PASS=$((PASS+1));
  else printf '  \033[31mFAIL\033[0m %s (expected %s, got %s)\n' "$3" "$1" "$2"; FAIL=$((FAIL+1)); fi
}

BODY='{"source_system":"dopamine","external_id":"smoke-verifyjwt","clinic_slug":"jongno-foot","customer":{"phone_e164":"+821000000000","name":"SMOKE"},"reservation":{"scheduled_at":"2026-12-31T14:30:00+09:00"}}'

note "EF: $EF_URL"

# ── 시나리오 2-A: 헤더 없는 POST → 401 (게이트웨이 open + 코드 인증 gate) ──
note "시나리오2-A: X-Callback-Secret 없는 POST → 401 UNAUTHORIZED"
RESP=$(curl -s -o /tmp/_ingest_a.txt -w '%{http_code}' -X POST "$EF_URL" -H 'Content-Type: application/json' -d "$BODY")
check 401 "$RESP" "no-secret → 401"
printf '    body: %s\n' "$(cat /tmp/_ingest_a.txt)"
if grep -q 'Missing authorization header' /tmp/_ingest_a.txt; then
  printf '  \033[31mFAIL\033[0m 게이트웨이 401 잔존 — verify_jwt=false 미적용\n'; FAIL=$((FAIL+1))
else
  printf '  \033[32mPASS\033[0m 게이트웨이 401 소거 (EF 코드 응답 = verify_jwt=false 적용)\n'; PASS=$((PASS+1))
fi

# ── 시나리오 2-B: 잘못된 secret → 401 ──
note "시나리오2-B: 잘못된 X-Callback-Secret POST → 401 UNAUTHORIZED"
RESP=$(curl -s -o /tmp/_ingest_b.txt -w '%{http_code}' -X POST "$EF_URL" -H 'Content-Type: application/json' -H 'X-Callback-Secret: WRONG_VALUE' -d "$BODY")
check 401 "$RESP" "wrong-secret → 401"
printf '    body: %s\n' "$(cat /tmp/_ingest_b.txt)"

# ── 시나리오 2-C: GET → 405 (요청이 EF 코드 도달 증명) ──
note "시나리오2-C: GET → 405 METHOD_NOT_ALLOWED (게이트웨이 open 증명)"
RESP=$(curl -s -o /tmp/_ingest_c.txt -w '%{http_code}' -X GET "$EF_URL" -H 'X-Callback-Secret: irrelevant')
check 405 "$RESP" "GET → 405"
printf '    body: %s\n' "$(cat /tmp/_ingest_c.txt)"

# ── AC3 positive: 올바른 secret → 2xx + reservation_id (secret 주입 시만) ──
if [ -n "$SECRET" ]; then
  note "AC3: 올바른 X-Callback-Secret POST → 2xx + reservation_id (멱등키 고정)"
  # external_id 는 reservations.external_id(uuid 컬럼) 정합 — 비-UUID 는 'invalid input syntax for type uuid' 500.
  #   고정 UUID 로 멱등(재실행 applied:false, 누적 0). 픽스처 스윕 정합: name 'qa-res-%' + memo '[QA-FIXTURE]'(정확 일치)
  #   → playwright global-teardown cleanupAll 이 customers/reservations 전수 스윕(잔존 0).
  AC3_BODY='{"source_system":"dopamine","external_id":"e2e0a3c3-0000-4000-8000-00000000ac03","clinic_slug":"jongno-foot","customer":{"phone_e164":"+821099990000","name":"qa-res-verifyjwt-ac3"},"reservation":{"scheduled_at":"2026-12-31T23:30:00+09:00","slot_type":"new_consult","memo":"[QA-FIXTURE]"}}'
  RESP=$(curl -s -o /tmp/_ingest_d.txt -w '%{http_code}' -X POST "$EF_URL" -H 'Content-Type: application/json' -H "X-Callback-Secret: $SECRET" -d "$AC3_BODY")
  if [ "${RESP:0:1}" = "2" ]; then printf '  \033[32mPASS\033[0m valid-secret → %s\n' "$RESP"; PASS=$((PASS+1)); else printf '  \033[31mFAIL\033[0m valid-secret (got %s)\n' "$RESP"; FAIL=$((FAIL+1)); fi
  printf '    body: %s\n' "$(cat /tmp/_ingest_d.txt)"
  note "AC3-멱등: 동일 external_id 재POST → applied:false"
  RESP=$(curl -s -o /tmp/_ingest_e.txt -w '%{http_code}' -X POST "$EF_URL" -H 'Content-Type: application/json' -H "X-Callback-Secret: $SECRET" -d "$AC3_BODY")
  printf '    HTTP %s body: %s\n' "$RESP" "$(cat /tmp/_ingest_e.txt)"
  grep -q '"applied":false' /tmp/_ingest_e.txt && { printf '  \033[32mPASS\033[0m 멱등 applied:false\n'; PASS=$((PASS+1)); } || { printf '  \033[31mFAIL\033[0m 멱등 미동작\n'; FAIL=$((FAIL+1)); }
else
  note "AC3 positive: SKIP — DOPAMINE_CALLBACK_SECRET 미주입"
  printf '  평문 공유 secret 미보유. 시나리오1(도파민 UI→push→foot cross-service)로 실 write 검증.\n'
fi

note "RESULT: PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ]
