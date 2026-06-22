-- T-20260622-foot-CONSULT-ASSIGN-BALANCE (P1) — 상담사 자동배정 쏠림 버그픽스
--
-- ─── 배경 ────────────────────────────────────────────────────────────────────
-- assign_consultant_atomic 은 room_assignments(consultation) 상담사 중 "당일 부하가
-- 가장 적은" 사람에게 신규 체크인을 배정한다(ORDER BY COUNT ... ASC LIMIT 1).
-- 그런데 부하 카운트 서브쿼리가 `ci.status IN ('consult_waiting','consultation')`,
-- 즉 *진행중* 건만 셌다.
--   → 상담을 끝내(done/이후 단계로 전이) 더 이상 진행중이 아닌 건은 0으로 집계.
--   → 이미 오늘 상담 5건을 끝낸 A(진행중 0) 가 "부하 0" 으로 보여 계속 선택됨.
--   → 진행중 1건뿐인(그러나 누적은 적은) B 보다 A 가 뽑히는 역전 → 임별 쏠림.
--
-- ─── 해소 ────────────────────────────────────────────────────────────────────
-- 부하 = "당일 이 상담사에게 배정된 누적 건수(취소 제외)" 로 정의.
--   AS-IS: ci.status IN ('consult_waiting', 'consultation')   -- 진행중만
--   TO-BE: ci.status <> 'cancelled'                            -- 당일 누적(취소만 제외)
--
-- ─── status enum 근거 (AC-3 triage) ──────────────────────────────────────────
-- check_ins.status CHECK constraint(20260602240000_check_ins_receiving_status.sql) 15종:
--   registered, receiving, checklist, consult_waiting, consultation, exam_waiting,
--   examination, treatment_waiting, preconditioning, laser_waiting, healer_waiting,
--   laser, payment_waiting, done, cancelled
--   · 종결상태는 done(정상완료) + cancelled(취소) 둘뿐. no_show/noshow 상태는 enum에 없음.
--   · done(정상완료)은 반드시 포함 ← 버그 핵심(끝낸 상담이 부하에서 누락되던 문제).
--   · cancelled(취소/노쇼 우회)만 제외 ← 실제 진료를 받지 않은 건이므로 부하 아님.
--   → `<> 'cancelled'` 가 정확. 추가 제외 종결상태 없음.
--
-- ─── 불변 (변경 없음) ─────────────────────────────────────────────────────────
-- 함수 시그니처(uuid,text,int) · advisory lock · ra 조건 · ORDER BY ... ASC LIMIT 1
-- · kst_date(ci.checked_in_at) = p_date::DATE 당일버킷(KST) — status 필터만 변경.
--
-- 멱등: CREATE OR REPLACE. 롤백: 20260622170000_..._cumulative.rollback.sql
-- 적용: node scripts/apply_20260622170000_foot_assign_consultant_daily_cumulative.mjs
-- 운영 적용: supervisor DDL-diff 게이트.
-- author: dev-foot / 2026-06-22

BEGIN;

-- ── assign_consultant_atomic — 상담사별 *당일 누적*(취소 제외) 부하분산 ──
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
      AND ci.status <> 'cancelled'   -- BALANCE-FIX: 진행중만(IN consult_waiting/consultation) → 당일 누적(취소 제외). done 포함이 핵심.
      AND kst_date(ci.checked_in_at) = p_date::DATE   -- tz-exempt: 좌변 kst_date()로 KST 통일; p_date::DATE 는 파라미터 캐스트로 timestamp 버킷팅 아님
  ) ASC
  LIMIT 1;

  RETURN v_best_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION assign_consultant_atomic(uuid, text, int) IS
  'T-20260622-foot-CONSULT-ASSIGN-BALANCE: 상담사 자동배정 = 당일 누적 부하(취소 제외) 최소 선택.'
  ' status <> cancelled (진행중만 집계하던 쏠림 버그픽스). advisory lock 직렬화 · kst_date 당일버킷.';

-- ── 자체 검증: 새 필터 반영 + 옛 필터 제거 확인 ──
DO $$
DECLARE
  v_def TEXT := pg_get_functiondef('assign_consultant_atomic(uuid,text,int)'::regprocedure);
BEGIN
  IF position('ci.status <> ''cancelled''' IN v_def) = 0 THEN
    RAISE EXCEPTION 'ASSERT FAILED: 신규 status 필터(<> cancelled) 미반영';
  END IF;
  IF position('consult_waiting'', ''consultation' IN v_def) > 0 THEN
    RAISE EXCEPTION 'ASSERT FAILED: 옛 진행중-only 필터 잔존';
  END IF;
  IF position('kst_date(ci.checked_in_at)' IN v_def) = 0 THEN
    RAISE EXCEPTION 'ASSERT FAILED: kst_date 당일버킷 손실(불변 위반)';
  END IF;
  RAISE NOTICE 'T-20260622-foot-CONSULT-ASSIGN-BALANCE: status<>cancelled 누적집계 적용 완료.';
END;
$$;

COMMIT;
