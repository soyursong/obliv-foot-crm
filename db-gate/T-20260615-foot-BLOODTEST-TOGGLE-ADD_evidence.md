# T-20260615-foot-BLOODTEST-TOGGLE-ADD — DB-gate evidence (prod apply)
# at: 2026-06-16T16:25:05.177Z
# 적용: blood_test_requested boolean + set_blood_test_requested RPC (KOH 1:1 미러, ADDITIVE)

## 1. 마이그레이션 적용
  ✓ 20260617000000_blood_test_requested.sql 적용 완료

## 2. 컬럼 probe
  ✓ blood_test_requested 컬럼 존재
  ✓ 타입 boolean (got boolean)
  ✓ NOT NULL
  ✓ default false (got false)

## 3. RPC probe
  ✓ set_blood_test_requested RPC 존재
  ✓ SECURITY DEFINER
  ✓ authenticated EXECUTE 권한

## 4. 저장 테스트 (toggle, TX rollback / prod 무변경)
  ✓ ON 저장 → true (got true)
  ✓ OFF 저장 → false, 행 유지 (got false)
  ✓ NULL → false coalesce (got false)
  ✓ 존재하지 않는 row → 예외(not found)
  ✓ 미승인 사용자 거부 (42501)

## 결과: PASS ✓
