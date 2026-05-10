-- T-20260510-foot-DASH-SLOT-REWORK-P0: anon RLS — consult_waiting 허용 추가
--
-- Root Cause (QA Fail 2026-05-10 18:35):
--   20260504000010_anon_selfcheckin_rls_fix.sql 에서 anon_insert_checkin_self 정책이
--   status IN ('registered', 'treatment_waiting') 만 허용.
--   DASH-SLOT-REWORK-P0(46c6573) 구현 후 신규고객 셀프접수 시
--   status='consult_waiting' 으로 INSERT → RLS 위반 차단.
--
-- Fix:
--   anon_insert_checkin_self 정책에 'consult_waiting' 추가
--   (registered=체험/미확인, treatment_waiting=재진, consult_waiting=신규초진)
--
-- Rollback: 20260510000010_anon_rls_consult_waiting.down.sql
-- Ticket: T-20260510-foot-DASH-SLOT-REWORK-P0

BEGIN;

DROP POLICY IF EXISTS anon_insert_checkin_self ON public.check_ins;

CREATE POLICY anon_insert_checkin_self ON public.check_ins
  FOR INSERT TO anon
  WITH CHECK (
    clinic_id IS NOT NULL
    AND status IN ('registered', 'treatment_waiting', 'consult_waiting')
  );

COMMIT;
