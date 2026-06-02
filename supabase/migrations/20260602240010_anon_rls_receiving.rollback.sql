-- T-20260602-foot-CHECKIN-RECEIVING-SLOT 롤백
-- anon_insert_checkin_self 정책에서 'receiving' 제거 →
-- registered + treatment_waiting + consult_waiting 만 허용으로 복원 (20260510000010 기준).
--
-- 주의: 본 롤백 전에 SelfCheckIn.tsx 의 신규 INSERT status가 다시 consult_waiting 으로
--       돌아간 상태여야 함 (CHECK constraint 롤백과 함께 적용).

BEGIN;

DROP POLICY IF EXISTS anon_insert_checkin_self ON public.check_ins;

CREATE POLICY anon_insert_checkin_self ON public.check_ins
  FOR INSERT TO anon
  WITH CHECK (
    clinic_id IS NOT NULL
    AND status IN ('registered', 'treatment_waiting', 'consult_waiting')
  );

COMMIT;
