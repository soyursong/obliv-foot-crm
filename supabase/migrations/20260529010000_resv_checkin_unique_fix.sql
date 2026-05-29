-- T-20260529-foot-RESV-CHECKIN-NOSAVE (P1)
-- 예약 기반 셀프접수 저장 안 됨 — unique_reservation_checkin 인덱스 재정의
--
-- ─── 근본 원인 ────────────────────────────────────────────────────────────────
-- unique_reservation_checkin 인덱스:
--   ON check_ins (reservation_id) WHERE reservation_id IS NOT NULL
--   ↑ status 제한 없음 — cancelled 체크인도 인덱스에 포함
--
-- 시나리오:
--   1. 체크인 생성 (reservation_id = R1) → trigger가 예약 status → checked_in
--   2. 스태프가 해당 체크인 취소 (status = cancelled)
--   3. 스태프가 예약 status 수동 복원 → confirmed
--   4. 고객 셀프접수 재시도 → matchedReservationId = R1 → INSERT
--   5. 인덱스가 cancelled 체크인(R1)과 충돌 → 23505 unique violation
--   6. ciErr 설정 → setStep('error') → "접수 실패" 화면
--
-- 워크인은 reservation_id = null → 인덱스 미적용 → 정상 동작 설명
--
-- ─── 검증 (live DB 실증) ──────────────────────────────────────────────────────
-- INSERT with reservation_id=R1 → 성공 (b08d40a3 생성)
-- 같은 R1로 재INSERT → {"code":"23505","message":"duplicate key value violates unique constraint \"unique_reservation_checkin\""}
-- status=cancelled로 변경 후 재INSERT → 여전히 23505 (포함 확인)
--
-- ─── 수정 ────────────────────────────────────────────────────────────────────
-- 기존 인덱스 DROP → status <> 'cancelled' 조건 추가하여 재생성
-- cancelled 체크인은 "논리 삭제"이므로 예약 슬롯 재사용 허용
--
-- ─── 리스크 ──────────────────────────────────────────────────────────────────
-- LOW: 동일 예약 중복 체크인(활성 상태)은 코드 레벨(lines 960-979) + 인덱스 이중 방어
-- 단순 체크인(cancelled 제외)만 허용 → 기존 기능 파괴 없음
--
-- ─── 롤백 ────────────────────────────────────────────────────────────────────
-- 20260529010000_resv_checkin_unique_fix.rollback.sql
--
-- ticket: T-20260529-foot-RESV-CHECKIN-NOSAVE
-- author: dev-foot / 2026-05-29

BEGIN;

-- ═══════════════════════════════════════════════════════════════════════════════
-- SECTION 1: 기존 unique_reservation_checkin 인덱스 제거
-- ═══════════════════════════════════════════════════════════════════════════════

DROP INDEX IF EXISTS unique_reservation_checkin;

-- ═══════════════════════════════════════════════════════════════════════════════
-- SECTION 2: cancelled 제외 조건으로 재생성
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE UNIQUE INDEX unique_reservation_checkin
  ON public.check_ins (reservation_id)
  WHERE reservation_id IS NOT NULL
    AND status <> 'cancelled';

COMMENT ON INDEX unique_reservation_checkin IS
  'T-20260529-foot-RESV-CHECKIN-NOSAVE: 예약 ID 당 활성 체크인 1개 한정.'
  ' cancelled 제외 — 취소 후 재접수 허용. 기존 활성 체크인과의 충돌만 방어.';

-- ═══════════════════════════════════════════════════════════════════════════════
-- SECTION 3: 검증
-- ═══════════════════════════════════════════════════════════════════════════════

DO $$
BEGIN
  -- 인덱스 존재 확인
  IF NOT EXISTS (
    SELECT 1
    FROM   pg_indexes
    WHERE  tablename  = 'check_ins'
      AND  indexname  = 'unique_reservation_checkin'
  ) THEN
    RAISE EXCEPTION 'ASSERT FAILED: unique_reservation_checkin 인덱스 없음';
  END IF;

  -- 인덱스 조건에 cancelled 제외 포함 확인
  IF NOT EXISTS (
    SELECT 1
    FROM   pg_indexes
    WHERE  tablename  = 'check_ins'
      AND  indexname  = 'unique_reservation_checkin'
      AND  indexdef   LIKE '%cancelled%'
  ) THEN
    RAISE EXCEPTION 'ASSERT FAILED: unique_reservation_checkin 인덱스에 cancelled 제외 조건 없음';
  END IF;

  RAISE NOTICE 'T-20260529-foot-RESV-CHECKIN-NOSAVE: unique_reservation_checkin 인덱스 재정의 완료.';
  RAISE NOTICE '  old: WHERE reservation_id IS NOT NULL';
  RAISE NOTICE '  new: WHERE reservation_id IS NOT NULL AND status <> ''cancelled''';
END;
$$;

COMMIT;
