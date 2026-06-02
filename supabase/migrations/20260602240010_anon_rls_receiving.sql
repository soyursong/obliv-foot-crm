-- T-20260602-foot-CHECKIN-RECEIVING-SLOT
-- anon 셀프체크인 INSERT RLS — 'receiving' 허용값 추가.
--
-- 배경:
--   신규(초진) 셀프접수 INSERT status가 consult_waiting → receiving 으로 변경됨
--   (SelfCheckIn.tsx). 기존 anon_insert_checkin_self 정책은
--   status IN ('registered','treatment_waiting','consult_waiting') 만 허용 →
--   receiving INSERT 시 RLS 위반 차단됨.
--
-- 변경 성격: 기존 anon insert 경로의 "허용 status 값"만 확장.
--            신규 anon 쓰기 경로 신설 아님 (bundle 공통제약 준수, planner DECISION ⓐ).
--   선례: 20260510000010_anon_rls_consult_waiting.sql (consult_waiting 추가 시 동일 패턴).
-- Rollback: 20260602240010_anon_rls_receiving.rollback.sql
-- 운영 적용: supervisor 게이트.

BEGIN;

DROP POLICY IF EXISTS anon_insert_checkin_self ON public.check_ins;

CREATE POLICY anon_insert_checkin_self ON public.check_ins
  FOR INSERT TO anon
  WITH CHECK (
    clinic_id IS NOT NULL
    AND status IN ('registered', 'treatment_waiting', 'consult_waiting', 'receiving')
  );

COMMIT;
