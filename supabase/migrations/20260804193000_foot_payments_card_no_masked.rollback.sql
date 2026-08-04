-- ROLLBACK: 20260804193000_foot_payments_card_no_masked.sql
-- T-20260804-foot-CBAND-PAYRESP-RECORD-PERSIST-VERIFY (AC-5/AC-6, DA §7)
-- ADDITIVE 대칭 롤백 = 트리거·가드함수 DROP + 컬럼 DROP.
--   ⚠ foot_is_luhn 은 cband_pa_pci_guard(mig 20260731190000)도 공유 → 여기서 DROP 금지(공유 헬퍼 보존).
BEGIN;

DROP TRIGGER IF EXISTS trg_payments_card_no_masked_pci_guard ON public.payments;
DROP FUNCTION IF EXISTS public.payments_card_no_masked_pci_guard();
ALTER TABLE public.payments DROP COLUMN IF EXISTS card_no_masked;

COMMIT;
