-- Rollback: T-20260602-foot-SLOT-DWELL-TIME (B안)
-- fn_check_in_slot_dwell 제거. 기존 테이블/스키마 변경 없었으므로 함수 DROP 만으로 원복.

BEGIN;

DROP FUNCTION IF EXISTS public.fn_check_in_slot_dwell(UUID[]);

COMMIT;
