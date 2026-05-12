-- ============================================================
-- ROLLBACK: T-20260512-foot-QUICK-RX-BUTTON
-- quick_rx_buttons 테이블 삭제 + prescription_status 컬럼 제거
-- ============================================================

BEGIN;

DROP TABLE IF EXISTS public.quick_rx_buttons;

ALTER TABLE public.check_ins
  DROP COLUMN IF EXISTS prescription_status;

COMMIT;
