-- ============================================================
-- AC-2 ROLLBACK — #7 reservations.is_healer_intent (컬럼 제거)
-- T-20260615-foot-PROD-MIGRATION-PARITY-AUDIT
-- ============================================================
-- is_healer_intent 컬럼만 제거. healer_flag(별도 컬럼)·기존 예약 데이터 무영향.
-- FE 는 컬럼 부재 시 healer_flag fallback 으로 graceful degrade.
ALTER TABLE public.reservations DROP COLUMN IF EXISTS is_healer_intent;
