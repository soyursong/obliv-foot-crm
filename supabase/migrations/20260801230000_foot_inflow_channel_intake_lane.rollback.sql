-- ROLLBACK — T-20260801-foot-INFLOW-CHANNEL-INTAKE-LANE (되돌림)
-- 2026-08-01 23:00 KST
-- ⚠ forward-only 원칙상 통상 롤백 불필요(신규 nullable 컬럼·신규 테이블은 하류 무영향).
--    긴급 원복이 필요할 때만 사용. 컬럼 DROP은 데이터 유실 — 값이 이미 쌓였으면 신중.
-- =====================================================

DROP FUNCTION IF EXISTS public.get_inflow_channels(uuid);

-- 오버레이/코드 테이블 제거 (신규 테이블 → 하류 무참조)
DROP TABLE IF EXISTS public.code_availability;
-- system_codes 는 향후 타 code_type 공용 가능 → inflow_channel 그룹만 삭제하는 보수적 롤백
DELETE FROM public.system_codes WHERE code_type = 'inflow_channel';
-- (완전 원복이 필요하면 아래 주석 해제 — inflow_channel 외 code_type 미사용 전제)
-- DROP TABLE IF EXISTS public.system_codes;

-- dual-anchor 컬럼 제거 (값 유실 주의 — forward-only라 통상 유지 권장)
ALTER TABLE public.customers    DROP COLUMN IF EXISTS first_inflow_source_ref;
ALTER TABLE public.customers    DROP COLUMN IF EXISTS first_inflow_at;
ALTER TABLE public.customers    DROP COLUMN IF EXISTS first_inflow_channel;
ALTER TABLE public.check_ins    DROP COLUMN IF EXISTS inflow_channel;
ALTER TABLE public.reservations DROP COLUMN IF EXISTS inflow_channel;

NOTIFY pgrst, 'reload schema';
