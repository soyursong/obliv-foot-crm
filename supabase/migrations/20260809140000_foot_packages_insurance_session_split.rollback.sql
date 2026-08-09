-- ROLLBACK (대칭 원복): 20260809140000_foot_packages_insurance_session_split
--   T-20260808-foot-PENCHART-INSURANCE-SPLIT-PHASE2 의 대칭 down.
--   up = ADD CONSTRAINT + ADD COLUMN covered_sessions/noncovered_sessions.
--   down = DROP CONSTRAINT → DROP COLUMN×2 (역순).
--
-- ⚠ 원복 시 packages 헤더 급여/비급여 회차 split 소멸 → 판매시 입력값 유실.
--   ADDITIVE·nullable 컬럼이므로 매출/기존 로직 무영향(VG3 firewall: 매출은 service_charges only).
--   신규 컬럼이라 기존 데이터 무손상(둘 다 NULL 이었음).
--
-- 멱등: DROP ... IF EXISTS.

BEGIN;

ALTER TABLE public.packages DROP CONSTRAINT IF EXISTS packages_insurance_split_sum_chk;
ALTER TABLE public.packages DROP COLUMN IF EXISTS noncovered_sessions;
ALTER TABLE public.packages DROP COLUMN IF EXISTS covered_sessions;

COMMIT;
