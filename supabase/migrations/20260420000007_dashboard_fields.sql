-- 대시보드 튜닝(#15) 관련 스키마 보강
-- #29 외국인 / #30 priority flag / 원장실 배정 / sort_order / 시술 스킵 메모

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS is_foreign BOOLEAN DEFAULT FALSE;

ALTER TABLE check_ins
  ADD COLUMN IF NOT EXISTS priority_flag TEXT
    CHECK (priority_flag IS NULL OR priority_flag IN ('CP','#')),
  ADD COLUMN IF NOT EXISTS examination_room TEXT,
  ADD COLUMN IF NOT EXISTS sort_order INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS skip_reason TEXT;
