-- ROLLBACK: T-20260622-foot-CONSULT-ASSIGN-BALANCE
-- assign_consultant_atomic 을 BALANCE-FIX 직전 정의(진행중-only 카운트)로 복원.
-- = 20260602250000_tz_checkin_kst_unify.sql line 129-156 정의 그대로.
--   (status IN ('consult_waiting','consultation') · kst_date 당일버킷 유지)

BEGIN;

CREATE OR REPLACE FUNCTION assign_consultant_atomic(
  p_clinic_id UUID,
  p_date TEXT,
  p_max_concurrent INT DEFAULT 3
) RETURNS UUID AS $$
DECLARE
  v_best_id UUID;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('assign_consultant_' || p_clinic_id::TEXT || p_date));

  SELECT ra.staff_id INTO v_best_id
  FROM room_assignments ra
  WHERE ra.clinic_id = p_clinic_id
    AND ra.date = p_date::DATE   -- tz-exempt: ra.date 는 DATE 컬럼(시간성분 없음), p_date 파라미터 캐스트 — 타임존 무관
    AND ra.room_type = 'consultation'
    AND ra.staff_id IS NOT NULL
  ORDER BY (
    SELECT COUNT(*) FROM check_ins ci
    WHERE ci.clinic_id = p_clinic_id
      AND ci.consultant_id = ra.staff_id
      AND ci.status IN ('consult_waiting', 'consultation')
      AND kst_date(ci.checked_in_at) = p_date::DATE   -- tz-exempt: 좌변 kst_date()로 KST 통일; p_date::DATE 는 파라미터 캐스트로 timestamp 버킷팅 아님
  ) ASC
  LIMIT 1;

  RETURN v_best_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION assign_consultant_atomic(uuid, text, int) IS
  'T-20260602-foot-TZ-AUDIT-FIX: 상담사별 당일 진행중 체크인 카운트로 부하분산. (BALANCE-FIX 롤백 상태)';

-- 검증: 옛 필터 복원 확인
DO $$
DECLARE
  v_def TEXT := pg_get_functiondef('assign_consultant_atomic(uuid,text,int)'::regprocedure);
BEGIN
  IF position('consult_waiting'', ''consultation' IN v_def) = 0 THEN
    RAISE EXCEPTION 'ASSERT FAILED: 롤백(진행중-only 필터) 미반영';
  END IF;
  RAISE NOTICE 'ROLLBACK 완료: assign_consultant_atomic 진행중-only 복원.';
END;
$$;

COMMIT;
