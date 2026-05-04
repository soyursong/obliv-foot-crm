-- T-20260504-foot-TREATMENT-SIMPLIFY
-- 진료종류 간소화: 담당실장 / 치료구분 / 치료내용(다중선택) 필드 추가
-- 레이저 시간 기본값 12분 → 10분 변경 (현장 요청)
-- risk: DB 스키마 변경 (ADD COLUMN) — 롤백 SQL 하단 첨부

-- ─── 1. check_ins 신규 필드 ───────────────────────────────────────────────────

ALTER TABLE check_ins
  ADD COLUMN IF NOT EXISTS assigned_counselor_id UUID REFERENCES staff(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS treatment_category    TEXT,
  ADD COLUMN IF NOT EXISTS treatment_contents    TEXT[];

COMMENT ON COLUMN check_ins.assigned_counselor_id IS '담당실장 (staff.id FK)';
COMMENT ON COLUMN check_ins.treatment_category    IS '치료구분: 발톱무좀 | 내성발톱';
COMMENT ON COLUMN check_ins.treatment_contents    IS '치료내용 다중선택: 가열, 비가열, 포돌로게, 수액';

-- ─── 2. clinics.laser_time_units 기본값 10분으로 업데이트 ─────────────────────

ALTER TABLE clinics
  ALTER COLUMN laser_time_units SET DEFAULT '[10, 15, 20, 30]'::jsonb;

-- 기존 row 중 구 기본값([12, 15, 20, 30])을 그대로 쓰는 클리닉만 10분으로 교체
UPDATE clinics
  SET laser_time_units = '[10, 15, 20, 30]'::jsonb
  WHERE laser_time_units = '[12, 15, 20, 30]'::jsonb;

-- ─── ROLLBACK ─────────────────────────────────────────────────────────────────
-- ALTER TABLE check_ins DROP COLUMN IF EXISTS assigned_counselor_id;
-- ALTER TABLE check_ins DROP COLUMN IF EXISTS treatment_category;
-- ALTER TABLE check_ins DROP COLUMN IF EXISTS treatment_contents;
-- ALTER TABLE clinics ALTER COLUMN laser_time_units SET DEFAULT '[12, 15, 20, 30]'::jsonb;
-- UPDATE clinics SET laser_time_units = '[12, 15, 20, 30]'::jsonb
--   WHERE laser_time_units = '[10, 15, 20, 30]'::jsonb;
