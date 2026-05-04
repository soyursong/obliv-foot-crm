-- ROLLBACK: T-20260504-foot-TREATMENT-SIMPLIFY
-- 진료종류 간소화 롤백 — 컬럼 제거 + laser_time_units 기본값 복원

-- 1. check_ins 신규 컬럼 제거
ALTER TABLE check_ins DROP COLUMN IF EXISTS assigned_counselor_id;
ALTER TABLE check_ins DROP COLUMN IF EXISTS treatment_category;
ALTER TABLE check_ins DROP COLUMN IF EXISTS treatment_contents;

-- 2. clinics.laser_time_units 기본값 복원 (12, 15, 20, 30)
ALTER TABLE clinics
  ALTER COLUMN laser_time_units SET DEFAULT '[12, 15, 20, 30]'::jsonb;

UPDATE clinics
  SET laser_time_units = '[12, 15, 20, 30]'::jsonb
  WHERE laser_time_units = '[10, 15, 20, 30]'::jsonb;
