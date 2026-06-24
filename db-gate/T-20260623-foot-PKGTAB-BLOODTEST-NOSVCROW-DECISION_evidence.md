# T-20260623-foot-PKGTAB-BLOODTEST-NOSVCROW-DECISION — DB-gate evidence (prod apply)
# at: 2026-06-24T12:29:10.764Z
# 적용: request_blood_test_for_customer RPC (단독 검사신청 차단 해소, KOH 1:1 미러)

## 1. 마이그레이션 적용
  ✓ 20260623160000_blood_request_for_customer.sql 적용 완료

## 2. RPC probe
  ✓ request_blood_test_for_customer RPC 존재
  ✓ SECURITY DEFINER
  ✓ authenticated EXECUTE 권한

## 3. 시나리오A — 서비스 보유 고객 ON/OFF (旣 FE 루프 동작 보존)
  ✓ 서비스보유 ON → true (got true)
  ✓ ON 후 blood_test_requested=true 행 존재 (got 1)
  ✓ 서비스보유 OFF → false (got false)

## 4. 시나리오B — 서비스 행 없는 고객 ON 신규생성 / OFF no-op
  ✓ 서비스없음 OFF → false (got false)
  ✓ OFF no-op: 서비스행 0 유지 (before 0 after 0)
  ✓ 서비스없음 ON → true (got true)
  ✓ ON 후 피검사 요청 행 신규 생성
  ✓ 신규행 blood_test_requested=true (got true)
  ✓ 신규행 price=0 (매출 비귀속) (got 0)
  ✓ 신규행 is_package_session=false (got false)
  ✓ 재ON 멱등 — 서비스행 1개 유지(중복생성 없음) (got 1)

## 5. 권한 게이트
  ✓ 미승인 사용자 거부 (42501)

## 결과: PASS ✓
