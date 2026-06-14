-- T-20260614-foot-HEALER-RESV-CLASSIFY-DEF rollback
-- is_healer_intent 컬럼 제거. healer_flag(별도 컬럼)·기존 데이터는 영향 없음.
ALTER TABLE public.reservations DROP COLUMN IF EXISTS is_healer_intent;
