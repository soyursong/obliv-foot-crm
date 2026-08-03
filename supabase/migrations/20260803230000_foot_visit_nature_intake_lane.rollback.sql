-- ROLLBACK — T-20260803-foot-VISIT-NATURE-COLUMN-DERIVESEED (되돌림)
-- 2026-08-03 23:00 KST
-- ⚠ forward-only 원칙상 통상 롤백 불필요(신규 nullable 컬럼·신규그룹 코드는 하류 무영향).
--    긴급 원복이 필요할 때만 사용. 컬럼 DROP은 derive-seed 로 쌓인 값 유실 — 신중.
-- ⚠ derive-seed 백필 롤백은 별도 파일(...derive_seed_backfill.rollback.sql) 선행 권장(신규 컬럼 NULL 복원).
-- =====================================================

DROP FUNCTION IF EXISTS public.get_visit_natures(uuid);

-- 오버레이/코드 = visit_nature 그룹만 제거(보수적 — inflow_channel 등 타 code_type 공용 테이블 보존).
DELETE FROM public.code_availability WHERE code_type = 'visit_nature';
DELETE FROM public.system_codes      WHERE code_type = 'visit_nature';

-- 신규 컬럼 제거 (값 유실 주의 — forward-only라 통상 유지 권장). visit_type 무접촉.
ALTER TABLE public.check_ins    DROP COLUMN IF EXISTS visit_nature;
ALTER TABLE public.reservations DROP COLUMN IF EXISTS visit_nature;

NOTIFY pgrst, 'reload schema';
