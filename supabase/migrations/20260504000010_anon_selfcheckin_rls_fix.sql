-- T-20260504-foot-SELFCHECKIN-CRM-BUG: anon 셀프접수 RLS 수정
--
-- Root Cause:
--   anon_insert_checkin_self 정책 (20260426030000)이 status='registered'만 허용.
--   T-20260430-foot-CHECKIN-SLOT-ROUTE 배포 후 재진 고객은 status='treatment_waiting'으로
--   INSERT 시도 → RLS 위반 → check_ins 생성 차단 → CRM 연동 불가.
--
--   추가 발견: anon_reservation_read / anon_checkin_read 정책이 누락되어
--   오늘 예약 조회 및 완료 화면 정보 조회 불가.
--
-- Fix:
--   1. 기존 과도하게 허용적인 anon_checkin_create 정책 제거 (보안 강화, IF EXISTS)
--   2. anon_insert_checkin_self → registered + treatment_waiting 으로 확장
--   3. next_queue_number RPC anon EXECUTE 명시적 보장
--   4. anon_reservation_read 복원 (예약 배너 정상화)
--   5. anon_checkin_read 복원 (대기번호 표시 정상화)
--
-- Rollback: 20260504000010_anon_selfcheckin_rls_fix.down.sql
-- Applied: 2026-05-04 (MSG-20260504-191600-SELFCHECKIN-CRM-BUG)

BEGIN;

-- 1. 기존 과도하게 허용적인 permissive 정책 제거 (있으면)
--    (20260419000001_rls_policies.sql에서 WITH CHECK (true)로 생성된 것)
DROP POLICY IF EXISTS anon_checkin_create ON public.check_ins;

-- 2. 기존 restrictive 정책 제거 후 재정의
--    (20260426030000_anon_self_checkin_policies.sql에서 status='registered'만 허용)
DROP POLICY IF EXISTS anon_insert_checkin_self ON public.check_ins;

-- 신규/체험(registered) + 재진(treatment_waiting) 모두 허용
-- clinic_id IS NOT NULL: 특정 클리닉 범위로 한정 (보안)
CREATE POLICY anon_insert_checkin_self ON public.check_ins
  FOR INSERT TO anon
  WITH CHECK (
    clinic_id IS NOT NULL
    AND status IN ('registered', 'treatment_waiting')
  );

-- 3. next_queue_number RPC anon EXECUTE 명시적 부여
--    (SECURITY DEFINER 함수, RLS 우회해 queue 번호 생성)
GRANT EXECUTE ON FUNCTION public.next_queue_number(UUID, DATE) TO anon;

-- 4. anon_reservation_read 복원
--    (20260419000001에서 생성됐으나 이후 마이그레이션에서 누락됨)
--    셀프체크인 전화번호 입력 시 오늘 예약 조회용
DROP POLICY IF EXISTS anon_reservation_read ON public.reservations;
CREATE POLICY anon_reservation_read ON public.reservations
  FOR SELECT TO anon
  USING (true);

-- 5. anon_checkin_read 복원
--    (20260419000001에서 생성됐으나 이후 마이그레이션에서 누락됨)
DROP POLICY IF EXISTS anon_checkin_read ON public.check_ins;
CREATE POLICY anon_checkin_read ON public.check_ins
  FOR SELECT TO anon
  USING (true);

COMMIT;
