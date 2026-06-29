-- ROLLBACK: T-20260629-foot-DUMMY-CHECKIN-RESV-LINK §1 (dev-foot)
-- medical_charts.check_in_id FK + index + 컬럼 제거.
-- ⚠ 적재값(결속 링크) 손실 주의 — DML 결속 후 롤백 시 link 소실(진료기록 본체는 무손실).
-- FK만 되돌리려면 ADD COLUMN/INDEX 라인은 건드리지 말고 DROP CONSTRAINT만 실행.

ALTER TABLE public.medical_charts
  DROP CONSTRAINT IF EXISTS medical_charts_check_in_id_fkey;

DROP INDEX IF EXISTS idx_mc_check_in_id;

ALTER TABLE public.medical_charts
  DROP COLUMN IF EXISTS check_in_id;
