-- T-20260514-foot-CHECKIN-AUTO-STAGE: anon RLS 정책 확장
--
-- Root Cause:
--   20260504000010_anon_selfcheckin_rls_fix.sql에서 anon_insert_checkin_self 정책이
--   status IN ('registered', 'treatment_waiting')만 허용.
--   셀프접수 초진·체험(new/experience) → consult_waiting 직행 INSERT 시 RLS 위반으로 차단됨.
--
-- Fix:
--   anon_insert_checkin_self 정책에 'consult_waiting' 추가
--   → 초진·체험: consult_waiting, 재진: treatment_waiting 모두 허용
--
-- Rollback: 20260517000010_anon_rls_consult_waiting.down.sql

BEGIN;

DROP POLICY IF EXISTS anon_insert_checkin_self ON public.check_ins;

-- 신규(consult_waiting) + 재진(treatment_waiting) + 레거시(registered) 모두 허용
-- clinic_id IS NOT NULL: 특정 클리닉 범위로 한정 (보안)
CREATE POLICY anon_insert_checkin_self ON public.check_ins
  FOR INSERT TO anon
  WITH CHECK (
    clinic_id IS NOT NULL
    AND status IN ('registered', 'consult_waiting', 'treatment_waiting')
  );

COMMIT;
