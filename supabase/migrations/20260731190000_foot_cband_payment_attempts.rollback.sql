-- ROLLBACK: 20260731190000_foot_cband_payment_attempts.sql (K6)
-- T-20260731-foot-CBAND-CAT-DIRECT-PAY-PLANA-BUILD
-- ADDITIVE 역: 신규 트리거/함수/테이블 제거. 기존 객체 무접촉.
-- ⚠ K7(payments.payment_attempt_id FK → cband_payment_attempts)을 먼저 롤백해야 이 테이블 DROP 가능.

BEGIN;

DROP TRIGGER IF EXISTS trg_cband_pa_pci_guard ON public.cband_payment_attempts;
DROP TRIGGER IF EXISTS trg_cband_pa_sim_stamp ON public.cband_payment_attempts;
DROP TRIGGER IF EXISTS trg_cband_pa_touch_updated_at ON public.cband_payment_attempts;

DROP TABLE IF EXISTS public.cband_payment_attempts;

DROP FUNCTION IF EXISTS public.cband_pa_pci_guard();
DROP FUNCTION IF EXISTS public.cband_pa_sim_stamp();
DROP FUNCTION IF EXISTS public.cband_pa_touch_updated_at();
-- foot_is_luhn 은 공용 헬퍼 가능성 → 조건부 유지(다른 가드가 참조 시 DROP 금지). 보수적으로 남긴다.
-- DROP FUNCTION IF EXISTS public.foot_is_luhn(text);  -- 필요 시 수동.

COMMIT;
