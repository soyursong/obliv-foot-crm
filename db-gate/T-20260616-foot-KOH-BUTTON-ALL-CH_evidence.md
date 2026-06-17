# T-20260616-foot-KOH-BUTTON-ALL-CH — DB-gate evidence (prod apply)
# at: 2026-06-17T01:47:13.531Z
# 적용: request_koh_for_customer RPC (이력무관 전원노출 토글 단일 진입점)

## 1. 마이그레이션 적용
  ✓ 20260617120000_koh_request_for_customer.sql 적용 완료

## 2. RPC probe
  ✓ request_koh_for_customer RPC 존재
  ✓ SECURITY DEFINER
  ✓ authenticated EXECUTE 권한

## 3. 시나리오2 — KOH 보유 고객 ON/OFF (旣 동작 보존)
  ✓ KOH보유 ON → true (got true)
  ✓ ON 후 koh_requested=true KOH행 존재 (got 1)
  ✓ KOH보유 OFF → false (got false)

## 4. 시나리오1 — KOH 이력없는 고객 ON 신규생성 / OFF no-op
  ✓ 이력없음 OFF → false (got false)
  ✓ OFF no-op: KOH행 0 유지 (before 0 after 0)
  ✓ 이력없음 ON → true (got true)
  ✓ ON 후 KOH 검사요청 행 신규 생성
  ✓ 신규행 koh_requested=true (got true)
  ✓ 신규행 price=0 (매출 비귀속) (got 0)
  ✓ 신규행 is_package_session=false (got false)
  ✓ 재ON 멱등 — KOH행 1개 유지(중복생성 없음) (got 1)

## 5. 권한 게이트
  ✓ 미승인 사용자 거부 (42501)

## 결과: PASS ✓
