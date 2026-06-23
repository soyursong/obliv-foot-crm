# T-20260623-foot-PKGTAB-BLOODTEST-NOSVCROW-DECISION — TX-ROLLBACK probe
# at: 2026-06-23T08:37:24.694Z
# 단일 TX 내 DDL 적용→검증→ROLLBACK (prod 영구 변경 없음)

## 1. 마이그 SQL TX 내 적용
  ✓ RPC 생성 + 검증 DO 블록 통과(TX 내)

## 2. RPC 정의
  ✓ request_blood_test_for_customer RPC 존재
  ✓ SECURITY DEFINER
  ✓ authenticated EXECUTE 권한

## 3. 시나리오A — 서비스 보유 고객 ON/OFF
  ✓ 서비스보유 ON → true (got true)
  ✓ ON 후 blood_test_requested=true 행 존재 (got 1)
  ✓ 서비스보유 OFF → false (got false)

## 4. 시나리오B — 서비스 행 없는 고객
  ✓ 서비스없음 OFF → false (got false)
  ✓ OFF no-op: 서비스행 0 유지 (got 0)
  ✓ 서비스없음 ON → true (got true)
  ✓ ON 후 피검사 요청 행 신규 생성
  ✓ 신규행 blood_test_requested=true (got true)
  ✓ 신규행 price=0 (매출 비귀속) (got 0)
  ✓ 신규행 is_package_session=false (got false)
  ✓ 신규행 service_id=NULL (카탈로그 비귀속) (got null)
  ✓ 재ON 멱등 — 서비스행 1개 유지(중복생성 없음) (got 1)

## 5. 권한 게이트 — 미승인 거부
  ✓ 미승인 사용자 거부 (42501)

## TX ROLLBACK 완료 — prod 영구 변경 없음(RPC 미잔존)

## 결과: PASS ✓
