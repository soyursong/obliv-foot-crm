-- ROLLBACK: T-20260721-foot-CUSTOMER-NAME-NFD-NFC-BACKFILL AC-2 소스닫힘 하드닝 (name NFC write-guard)
-- 트리거 신규 생성만 되돌린다(데이터 미변경). 되돌리면 NFD 저장 재허용(방어심층 해제) 되므로 재적용 전 신중.
BEGIN;

DROP TRIGGER IF EXISTS trg_name_nfc_writeguard ON public.customers;
DROP TRIGGER IF EXISTS trg_name_nfc_writeguard ON public.reservations;
DROP TRIGGER IF EXISTS trg_name_nfc_writeguard ON public.check_ins;
DROP FUNCTION IF EXISTS public.fn_name_nfc_writeguard();

COMMIT;
