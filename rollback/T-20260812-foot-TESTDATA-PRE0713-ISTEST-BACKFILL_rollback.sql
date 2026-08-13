-- ============================================================
-- ROLLBACK (폴백) — T-20260812-foot-TESTDATA-PRE0713-ISTEST-BACKFILL STEP3 백필
-- is_test=true → false 역전. ★단, 백필이 실제로 flip 한 행(before=false)만 복원.
--   → 백필 이전부터 is_test=true 였던 3건(및 그 외 기존 true)은 절대 건드리지 않음(fidelity rollback).
-- audit 테이블(backfill_audit_20260812_istest)의 before_image 를 근거로 복원.
-- DB: rxlomoozakkjesdqjtvd (obliv-foot-crm / prod). GO-token 관리하 실행.
-- ============================================================

BEGIN;

-- audit 에 is_test_before=false 로 기록된 행만 false 로 되돌림 (우리가 flip 한 것만)
UPDATE public.customers cu
SET is_test = false
FROM public.backfill_audit_20260812_istest a
WHERE cu.id = a.id
  AND a.is_test_before = false
  AND cu.is_test IS TRUE;

-- 검증: 복원 후 audit(before=false) 대상 중 true 로 남은 것 = 0
DO $$
DECLARE v_left int;
BEGIN
  SELECT count(*)::int INTO v_left
  FROM public.customers cu JOIN public.backfill_audit_20260812_istest a ON a.id = cu.id
  WHERE a.is_test_before = false AND cu.is_test IS TRUE;
  IF v_left <> 0 THEN
    RAISE EXCEPTION '[ROLLBACK ABORT] 복원 후 잔여 true % <> 0', v_left;
  END IF;
  RAISE NOTICE '[ROLLBACK] OK — before=false 대상 전건 false 복원';
END $$;

COMMIT;

-- audit 테이블은 감사 목적 보존(즉시 DROP 안 함). 완전 정리 필요 시 별도:
--   DROP TABLE IF EXISTS public.backfill_audit_20260812_istest;
